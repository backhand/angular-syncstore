/*

@license Copyright (C) 2014 Frederik Hannibal <frederik@backhand.dk>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/

(function(window, angular, undefined) {
  'use strict';

  // debounce function borrowed from underscore 
  // so as not to introduce a dependency because
  // of one function
  var _now = Date.now || function() { return new Date().getTime(); };
  var _debounce = function(func, wait, immediate) {
    var timeout, args, context, timestamp, result;

    var later = function() {
      var last = _now() - timestamp;

      if (last < wait && last > 0) {
        timeout = setTimeout(later, wait - last);
      } else {
        timeout = null;
        if (!immediate) {
          result = func.apply(context, args);
          context = args = null;
        }
      }
    };

    return function() {
      context = this;
      args = arguments;
      timestamp = _now();
      var callNow = immediate && !timeout;
      if (!timeout) {
        timeout = setTimeout(later, wait);
      }
      if (callNow) {
        result = func.apply(context, args);
        context = args = null;
      }

      return result;
    };
  };

  function setImmutableProperty(obj, key, val, enumerable) {
    Object.defineProperty(obj, key, {
      value: val,
      writable: false,
      enumerable: !!enumerable,
      configurable: false
    });
  }

  function setHiddenProperty(obj, key, val) {
    Object.defineProperty(obj, key, {
      value: val,
      writable: true,
      enumerable: false,
      configurable: false
    });
  }

  function query(property, val) {
    var q = {};
    q[property] = val;
    return q;
  }

  angular.module('SyncStore', ['ngResource']).
    factory('$store', ['$resource', '$rootScope',
      function($resource, $rootScope) {

        if(!$rootScope.stores) {
          $rootScope.stores = [];
        }

        // Volatile local id, used for quick identification
        // of objects created locally
        var localIdSequence = 1;

        function SyncStoreItem(obj, syncStore) {
          setHiddenProperty(this, 'original', angular.copy(obj));

          syncStore.hiddenItemProperties.forEach(function(property) {
            setHiddenProperty(this, property);
          }, this);

          setImmutableProperty(this, '_id_property', syncStore.idProperty);
          setImmutableProperty(this, '_local_id', localIdSequence++);

          angular.copy(obj, this);
          angular.copy(obj, this.original);
        }

        SyncStoreItem.prototype.hasChanged = function() {
          return !angular.equals(this, this.original);
        };

        SyncStoreItem.prototype.update = function(obj) {
          angular.copy(obj, this);
          return this;
        };

        SyncStoreItem.prototype.setUpdated = function() {
          angular.copy(this, this.original);
          return this;
        };

        function SyncStore(params) {
          var self = this;

          // Event listeners
          setHiddenProperty(this, '_listeners', {});

          // Item hidden properties - useful for volatile
          // ui state like selected etc.
          setHiddenProperty(this, 'hiddenItemProperties', params.hiddenItemProperties || []);

          // Property name to store data under rootScope
          var storeId = params.storeId;
          setImmutableProperty(this, 'storeId', storeId, true);

          // Base url of this resource
          var url = params.url;

          // Threshold item count - beyond this operations will be
          // proxied to remote - not implemented yet
          var threshold = params.threshold;

          // Property of remote identifier, e.g. 'id' or 'userId'
          var idProperty = params.idProperty;
          setImmutableProperty(this, 'idProperty', idProperty, true);

          // Resource methods
          var methods = params.methods;

          // Check input
          if(!storeId) {
            throw new Error('SyncStore: No storeId');
          }
          if(!url) {
            throw new Error('SyncStore: No URL');
          }
          if(!idProperty) {
            throw new Error('SyncStore: No id property');
          }
          
          // Create embedded resource
          var resource = $resource(url, {}, methods);
          setImmutableProperty(this, 'resource', resource, true);

          // Create data container on rootScope
          $rootScope.stores[this.storeId] = [];

          // Map of existing local ids
          var localIds = {};

          // Map of remote ids existing locally
          var remoteIds = {};

          var add = function(item) {
            var itemId = item[idProperty];
            var localItem = remoteIds[itemId];


            // New item from remote - add it to store
            if(!localItem) {
              var storeItem = new SyncStoreItem(item, self);
              localIds[storeItem._local_id] = storeItem;
              remoteIds[itemId] = storeItem;

              $rootScope.stores[storeId].push(storeItem);
              self.emit('create_remote', storeItem);
              return;
            }

            // Check if it was updated remote
            if(!angular.equals(item, localItem)) {
              // Overwrite local item
              // TODO: Check timestamp property and
              //       select latest object
              localItem.update(item).setUpdated();
              self.emit('update_remote', item, localItem);
            }
          };

          var remove = function(item) {
            var localId = item._local_id;

            var deleteIndex = $rootScope.stores[storeId].indexOf(item);
            $rootScope.stores[storeId].splice(deleteIndex, 1);
            delete remoteIds[item[idProperty]];
            delete localIds[localId];
            self.emit('delete_remote', item);
          };

          var removeByRemoteId = function(remoteId) {
            var item = remoteIds[remoteId];
            remove(item);
          };

          this.syncItem = function(remoteId) {
            resource.get(query(idProperty, remoteId), function(item) {
              add(item);
            }, function(err) {
              if(err.status === 404 && remoteIds[remoteId]) {
                // If it exists locally, assume it was deleted on the other end
                removeByRemoteId(remoteId);
              }

            });
          };

          var initialLoad = true;
          this.onData = function(data) {
            if(initialLoad) {
              self.suppressEvents(true);
              initialLoad = false;
            }

            // All items are to be removed unless they exist on the other end
            // - keep track of them here
            var toRemove = angular.copy(remoteIds);

            angular.forEach(data, function(item) {
              var itemId = item[idProperty];

              // Item still exists, don't remove it
              delete toRemove[itemId];

              add(item);
            });

            // Remove those deleted remotely
            angular.forEach(toRemove, function(item, localId) {
              remove(item);
            });

            self.suppressEvents(false);
          };

          var watcher = function(newValue, oldValue) {
            var toDelete = angular.copy(localIds);
            var toCreate = {};
            var toUpdate = {};

            $rootScope.stores[storeId].forEach(function(item, index) {
              if(item._local_id) {
                // Still here, remove from toDelete list
                delete toDelete[item._local_id];

                if(item.hasChanged()) {
                  toUpdate[item._local_id] = item;
                }
              } else {
                // New item, add to toCreate list
                var newItem = new SyncStoreItem(item, self);
                $rootScope.stores[storeId][index] = newItem;
                localIds[newItem._local_id] = newItem;
                toCreate[newItem._local_id] = newItem;
              }
            });

            // Call delete on all toDelete entries
            angular.forEach(toDelete, function(item, localId) {
              var params = {};
              params[idProperty] = item[idProperty];
              resource.delete(params, function() {
                self.emit('delete', item);
                delete localIds[localId];
              });
            });

            // Call create on all toCreate entries
            angular.forEach(toCreate, function(item, localId) {
              resource.create(item, function(result) {
                self.emit('create', result, item);
                item.update(result).setUpdated();
              });
            });

            // Call update on all toUpdate entries
            angular.forEach(toUpdate, function(item, localId) {
              resource.save(item, function(result) {
                self.emit('update', result, item);
                item.update(result).setUpdated();
              });
            });
          };

          // Watch for changes, debounce to 3 secs
          $rootScope.$watch('stores.' + this.storeId, _debounce(watcher, 3000, true), true);
        }

        SyncStore.prototype.load = function() {
          this.resource.query({
            limit: this.threshold,
            offset: 0
          }, this.onData, function(err) {
            self.emit('error', err);
          });
        };

        SyncStore.prototype.on = function(name, fn) {
          this._listeners[name] = this._listeners[name] || [];
          this._listeners[name].push(fn);
        };

        SyncStore.prototype.off = function(name, fn) {
          if(this._listeners[name]) {
            var index = this._listeners.indexOf(fn);
            if(index >= 0) {
              this._listeners.splice(index, 1);
            }
          }
        };

        SyncStore.prototype.emit = function(name) {
          if(this._suppressEvents) return;

          var eventArgs = Array.prototype.slice.call(arguments, 1);

          // TODO: store event args in array and debounce
          // event listener actions by about 2-3 seconds
          for(var i in this._listeners[name]) {
            this._listeners[name][i].apply(this, eventArgs);
          }
        };

        SyncStore.prototype.suppressEvents = function(flag) {
          this._suppressEvents = flag === undefined ? !this._suppressEvents : !!flag;
        };

        function syncStoreFactory(params) {
          return new SyncStore(params);
        }

        return syncStoreFactory;
      }
    ]);

})(window, window.angular);