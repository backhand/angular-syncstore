angular-syncstore
=================

Auto-syncing data store for AngularJS


**Usage**

Add SyncStore module to your app dependencies.  

     angular.module('app', ['SyncStore', ...


**Create a store:**

    contactsStore = $store({
      storeId: 'contacts', // Property name in $rootScope.stores
      url: api.url('/contacts/:id'),
      threshold: 5000, // Fetch limit
      idProperty: 'id',
      methods: {
        query: {
          method: 'GET',
          isArray: true,
          params: {
            limit: 'limit',
            offset: 'offset'
          }
        },
        save: {
          method: 'PUT',
          params: {
            id: '@id'
          }
        },
        create: {
          method: 'POST'
        },
        'delete': {
          method: 'DELETE',
          params: {
            id: 'id'
          }
        }
      }
    });

*The methods query, delete and save must exist on your resource definition.*

This will create a $rootScope.stores.contacts object, which will automatically sync changes to remote on updates,
deletes, creates etc.


**Events**

Add event listeners:

    contactsStore.on(eventName, eventListener);

Supported events are:

*create*:
    
    eventListener(created, item)

*update*:

    eventListener(updated, item)

*delete*:
    
    eventListener(item)

*error*:

    eventListener(error)


Remove listener:

    contactsStore.off(eventName, eventListener);