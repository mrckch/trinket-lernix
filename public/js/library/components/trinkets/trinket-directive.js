(function(angular, module) {

function EmbedApi($window, $rootScope) {
  return {
    restrict: 'AC',
    scope: {
      isModified: '=',
      api: '=',
      runMode: '='
    },
    link: function (scope, element, attrs) {
      scope.loadedTrinketApp = false;

      var unsavedChangesMessage = 'Du hast ungespeicherte Änderungen. Seite wirklich verlassen?';
      var draftMessage = 'A draft of your changes has been saved but others will not see them when you share unless you click Save. Are you sure you want to leave this page?';
      var exitEvents = ['$stateChangeStart', '$locationChangeStart'];
      var registeredEvents = [];
      var canCreate = attrs.canCreate === "true";
      angular.forEach(exitEvents, function(eventName) {
        registeredEvents.push($rootScope.$on(eventName, function(event, toState, toParams, fromState, fromParams) {
          if (toState && fromState && toState.name && fromState.name) {
            if (toState.name.split('.')[0] === fromState.name.split('.')[0]) {
              // state change was for a sub-state so no need to warn user
              return;
            }
          }
          if (canCreate && scope.api && scope.api.isDirty()) {
            var confirmMessage = unsavedChangesMessage;
            if (scope.api._trinket && scope.api._trinket.id) {
              scope.api._updateDraft();
              confirmMessage = draftMessage;
            }
            if (!confirm(confirmMessage)) {
              event.preventDefault();
            }
          }
        }));
      });

      $window.onbeforeunload = function() {
        var unloadMessage = unsavedChangesMessage;
        if (canCreate && scope.api && scope.api.isDirty()) {
          if (scope.api._trinket && scope.api._trinket.id) {
            scope.api._updateDraft();
            unloadMessage = draftMessage;
          }
          return unloadMessage;
        }
      };

      scope.$on('$destroy', function() {
        if (scope.api) {
          scope.api.off('trinket.code.change', onChange);
          scope.api.off('trinket.runMode.change', runModeChange);
        }
        angular.forEach(registeredEvents, function(handler) {
          handler();
        });
        window.onbeforeunload = undefined;

        $window.removeEventListener('message', messageHandler);
      });

      var onChange = function() {
        scope.isModified = true;
        scope.$apply();
      }
      var runModeChange = function(event, opt) {
        scope.runMode = opt.runMode || "";
        scope.$apply();
      }

      function messageHandler(ev) {
        if (ev.data && ev.data === "TrinketApp ready") {
          loadTrinketApp();
        }
      }

      $window.addEventListener('message', messageHandler);

      function loadTrinketApp() {
        var win = (element[0].contentWindow || element[0].contentDocument)

        if (win && win.TrinketApp && !scope.loadedTrinketApp) {
          scope.api = win.TrinketApp;
          win.TrinketApp.on('trinket.code.change', onChange);
          win.TrinketApp.on('trinket.runMode.change', runModeChange);
          scope.loadedTrinketApp = true;
          scope.$apply();
        }
      }
    }
  }
}

module.directive('embedApi', ['$window', '$rootScope', EmbedApi]);

})(window.angular, window.angular.module('trinket.components.trinkets'));
