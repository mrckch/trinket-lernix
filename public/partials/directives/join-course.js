(function(angular) {
  'use strict';

  angular.module('trinket.joinCourse', []).directive('joinCourse', ['$modal', function($modal) {
    function link(scope, element) {
      scope.courses     = scope.courses     || [];
      scope.coursesById = scope.coursesById || {};
      scope.buttonClass = scope.buttonClass || "";

      scope.openJoinCourse = function() {
        var $modalInstance = $modal.open({
          templateUrl : "joinCourse.html",
          controller  : ['$scope', '$http', '$modalInstance', 'notifyjs', 'Restangular', function($scope, $http, $modalInstance, notifyjs, Restangular) {
            $scope.accessCode         = "";
            $scope.required           = true;
            $scope.checkingAccessCode = false;

            $scope.checkAccessCode = function() {
              var vm = this
                , courseUrl, message;

              $scope.checkingAccessCode = true;

              $http.post("/api/courses/join", { accessCode : vm.accessCode })
                .then(function(result) {
                  result = result.data
                  if (result.success) {
                    if (!scope.coursesById[ result.course.id ]) {
                      scope.courses.push( Restangular.restangularizeElement(null, result.course, 'courses') );
                      scope.coursesById[ result.course.id ] = true;

                      courseUrl = "/" + result.course.ownerSlug + "/courses/" + result.course.slug;
                      message   = "You've joined the course \"" + result.course.name + "\"! \
                        Go to the <a class=\"text-link\" href=\"" + courseUrl + "\"><strong>course page</strong></a> now.";

                      notifyjs(angular.element( document.querySelector('#join-course-messages') ),
                        message, { className : "success", autoHideDelay : 10000 });

                      vm.accessCode = "";
                    }
                    else {
                      notifyjs(angular.element( document.querySelector('#join-course-messages') ),
                        "Du bist schon in diesem Kurs.", "success");
                    }
                  }
                  else if (result.alreadyListed) {
                    notifyjs(angular.element( document.querySelector('#join-course-messages') ),
                      "Du bist schon in diesem Kurs.", "success");
                  }
                  else if (result.flash && result.flash.validation) {
                    notifyjs(angular.element( document.querySelector('#join-course-messages') ),
                      "Kein Kurs mit diesem Code gefunden. Bitte Code prüfen und erneut versuchen.", "alert");
                  }
                  else if (result.message) {
                    notifyjs(angular.element( document.querySelector('#join-course-messages') ), result.message, "alert");
                  }
                  else {
                    notifyjs(angular.element( document.querySelector('#join-course-messages') ),
                      "Der Code konnte nicht geprüft werden. Bitte erneut versuchen.", "alert");
                  }

                  $scope.checkingAccessCode = false;
                }, function(err) {
                  notifyjs(angular.element( document.querySelector('#join-course-messages') ),
                    "Der Code konnte nicht geprüft werden. Bitte erneut versuchen.", "alert");

                  $scope.checkingAccessCode = false;
                });
            }

            $scope.close = function() {
              $modalInstance.close();
            }
          }]
        });
      }
    }

    return {
        restrict    : 'E'
      , link        : link
      , templateUrl : '/partials/directives/join-course.html'
      , scope       : {
            courses     : '=?'
          , coursesById : '=?'
          , buttonClass : '@'
        }
    };
  }]);
})(window.angular);
