(function(angular, module) {

  function NewFolder(Restangular) {
    return {
      restrict : 'A',
      link : function($scope, element, attrs) {
        $scope.isSubmitting = false;

        element.on('submit', function(event) {
          event.preventDefault();
        });

        $scope.addNewFolder = function() {
          var messageFunc = typeof $scope.folderMessage === 'function'
            ? $scope.folderMessage : function() {};

          $scope.isSubmitting = true;

          $scope.folders.post({ name : $scope.name })
            .then(function(response) {
              if (response.success) {
                $scope.folders.push(
                  Restangular.restangularizeElement(null, response.folder, 'folders')
                );

                messageFunc("Neuer Ordner angelegt.", "success");

                $scope.name = '';
              }
              else if (response.message) {
                messageFunc(response.message, "alert");
              }
              else {
                messageFunc("Der Ordner konnte nicht angelegt werden. Bitte erneut versuchen.", "alert");
              }

              $scope.isSubmitting = false;
            }, function(err) {
              if (err.message) {
                messageFunc(err.message, "alert");
              }
              else {
                messageFunc("Der Ordner konnte nicht angelegt werden. Bitte erneut versuchen.", "alert");
              }

              $scope.isSubmitting = false;
            });
        }
      }
    };
  }

  module.directive('newFolder', ['Restangular', NewFolder]);

})(window.angular, window.angular.module('trinket.components.folders'));
