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

  angular.module('SyncStore', ['ngResource']).
    factory('$store', ['$resource', '$rootScope',
      function($resource, $rootScope) {

        if(!$rootScope.stores) {
          $rootScope.stores = [];
        }

        function listStoreItem(item) {
          // console.log(item._local_id, item);
        }

        // Volatile local id, used for quick identification
        // of objects created locally
        var localIdSequence = 1;

        function SyncStoreItem(obj, idProperty) {
          setHiddenProperty(this, 'original', angular.copy(obj));
          setImmutableProperty(this, '_id_property', idProperty);
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

          var onData = function(data) {
            // console.log(data);
            var toRemove = angular.copy(remoteIds);
            angular.forEach(data, function(item) {
              var itemId = item[idProperty];
              var localItem = remoteIds[item[itemId]];

              // New item from remote - add it to store
              if(!localItem) {
                var storeItem = new SyncStoreItem(item, idProperty);
                localIds[storeItem._local_id] = storeItem;

                $rootScope.stores[storeId].push(storeItem);
                remoteIds[itemId] = storeItem;
                return;
              }

              // Item still exists, don't remove it
              delete toRemove[itemId];

              // Check if it was updated remote
              if(!angular.equals(item, localItem)) {
                // Overwrite local item
                // TODO: Check timestamp property and
                //       select latest object
                localItem.update(item).setUpdated();
                // angular.copy(item, localItem);
              }
            });

            // Remove those deleted remotely
            angular.forEach(toRemove, function(item, localId) {
              // console.log('remove %s', localId, item);
            });
          };

          var watcher = function(newValue, oldValue) {
            if(oldValue.length === 0) {
              // console.log('Initial load');
            }
            
            var toDelete = angular.copy(localIds);
            var toCreate = {};
            var toUpdate = {};

            $rootScope.stores[storeId].forEach(function(item) {
              if(item._local_id) {
                // Still here, remove from toDelete list
                delete toDelete[item._local_id];

                if(item.hasChanged()) {
                  toUpdate[item._local_id] = item;
                }
              } else {
                // New item, add to toCreate list
                var storeItem = new SyncStoreItem(item, idProperty);
                localIds[storeItem._local_id] = storeItem;
                toCreate[storeItem._local_id] = storeItem;
              }
            });

            // Call delete on all toDelete entries
            angular.forEach(toDelete, function(item, localId) {
              // console.log('Delete %s', localId, item);
              item.$delete({}, function() {
                delete localIds[localId];
              });
            });

            // Call create on all toCreate entries
            angular.forEach(toCreate, function(item, localId) {
              // console.log('Create %s', localId, item);
              item.$save({}, function(result) {
                item.update(result).setUpdated();
              });
            });

            // Call update on all toUpdate entries
            angular.forEach(toUpdate, function(item, localId) {
              // console.log('Update %s', localId, item);
              item.$save({}, function(result) {
                item.update(result).setUpdated();
              });
            });
          };

          // Watch for changes, debounce to 3 secs
          $rootScope.$watch('stores.' + this.storeId, _debounce(watcher, 3000), true);

          // Do initial resource load
          this.resource.query({
            limit: this.threshold,
            offset: 0
          }, onData, function(err) {
            // console.log('SyncStore: fetch error', err);
          });
        }

        function syncStoreFactory(params) {
          return new SyncStore(params);
        }

        return syncStoreFactory;
      }
    ]);

})(window, window.angular);