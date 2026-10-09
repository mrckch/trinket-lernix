(function(angular) {
  return angular
    .module("courseEditor")
    .controller("AssignmentEditorController", ['$scope', '$modalInstance', '$window', 'lesson', 'material', 'trinketTypes', function($scope, $modalInstance, $window, lesson, material, trinketTypes) {

      // editing an existing assignment
      if (material) {
        $scope.material = material;
        $scope.trinket  = angular.copy(material.trinket);
        $scope.existing = true;
      }
      // creating a new assignment
      else {
        $scope.material = { name : "" };
        $scope.trinket  = null;
        $scope.existing = false;
      }

      $scope.lesson       = lesson;
      $scope.trinketTypes = trinketTypes;

      var dates         = ["submissionsDue", "submissionsCutoff", "availableOn", "hideAfter"]
        , displaySuffix = "Display"
        , setPrefix     = "set"
        , enabledSuffix = "Enabled"
        , defaultDate   = {
              "submissionsDue" : function() { // one week from now
                var due = new Date()
                  , weekInMilliseconds = 7 * 24 * 60 * 60 * 1000;

                due.setTime(due.getTime() + weekInMilliseconds);

                return roundMinutes(due);
              }
          }
        , tmpTrinket;

      function roundMinutes(date) {
        // round down to the nearest 0/5 minute mark
        date.setMinutes(date.getMinutes() - date.getMinutes() % 5);
        date.setSeconds(0);
        date.setMilliseconds(0);

        return date;
      }

      // Format date for datetime-local input (YYYY-MM-DDTHH:mm)
      function formatForInput(date) {
        if (!date) return '';
        var d = new Date(date);
        var year = d.getFullYear();
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        var hours = String(d.getHours()).padStart(2, '0');
        var minutes = String(d.getMinutes()).padStart(2, '0');
        return year + '-' + month + '-' + day + 'T' + hours + ':' + minutes;
      }

      // for calendar settings
      $scope.invalidBefore  = {};
      $scope.invalidAfter   = {};
      $scope.tooltips       = {};

      $scope.updateCalendar = function(field) {
        // submissionsDue
        $scope.tooltips.submissionsDue = [];
        if ($scope.submissionsDueEnabled) {
          if ($scope.availableOnEnabled) {
            $scope.invalidBefore.submissionsDue = $scope.availableOn;
            $scope.tooltips.submissionsDue.push({
                'date' : $scope.availableOn
              , 'text' : 'Available On'
            });
          }
          else {
            $scope.invalidBefore.submissionsDue = null;
          }

          if ($scope.submissionsCutoffEnabled || $scope.hideAfterEnabled) {
            var minDate;

            if ($scope.submissionsCutoffEnabled) {
              minDate = $scope.submissionsCutoff;
              $scope.tooltips.submissionsDue.push({
                  'date' : $scope.submissionsCutoff
                , 'text' : 'Submissions Cutoff'
              });
            }

            if ($scope.hideAfterEnabled) {
              if (!minDate || $scope.hideAfter < minDate) {
                minDate = $scope.hideAfter;
              }
              $scope.tooltips.submissionsDue.push({
                  'date' : $scope.hideAfter
                , 'text' : 'Hide After'
              });
            }

            if (minDate) {
              $scope.invalidAfter.submissionsDue = minDate;
            }
          }
          else {
            $scope.invalidAfter.submissionsDue = null;
          }
        }
        else {
          $scope.invalidBefore.submissionsDue = null;
          $scope.invalidAfter.submissionsDue  = null;
        }

        // availableOn
        $scope.tooltips.availableOn = [];
        if ($scope.availableOnEnabled) {
          if ($scope.submissionsDueEnabled || $scope.hideAfterEnabled) {
            var minDate;

            if ($scope.submissionsDueEnabled) {
              minDate = $scope.submissionsDue;
              $scope.tooltips.availableOn.push({
                  'date' : $scope.submissionsDue
                , 'text' : 'Due'
              });

              if ($scope.submissionsCutoffEnabled) {
                $scope.tooltips.availableOn.push({
                    'date' : $scope.submissionsCutoff
                  , 'text' : 'Submissions Cutoff'
                });
              }
            }
            if ($scope.hideAfterEnabled) {
              if (!minDate || $scope.hideAfter < minDate) {
                minDate = $scope.hideAfter;
              }

              $scope.tooltips.availableOn.push({
                  'date' : $scope.hideAfter
                , 'text' : 'Hide After'
              });
            }

            if (minDate) {
              $scope.invalidAfter.availableOn = minDate;
            }
          }
          else {
            $scope.invalidAfter.availableOn = null;
          }
        }
        else {
          $scope.invalidAfter.availableOn = null;
        }

        // submissionsCutoff
        $scope.tooltips.submissionsCutoff = [];
        if ($scope.submissionsCutoffEnabled) {
          // submissionsDue must be enabled for this to be enabled
          $scope.invalidBefore.submissionsCutoff = $scope.submissionsDue;
          $scope.tooltips.submissionsCutoff.push({
              'date' : $scope.submissionsDue
            , 'text' : 'Due'
          });

          if ($scope.availableOnEnabled) {
            $scope.tooltips.submissionsCutoff.push({
                'date' : $scope.availableOn
              , 'text' : 'Available On'
            });
          }
          if ($scope.hideAfterEnabled) {
            $scope.invalidAfter.submissionsCutoff = $scope.hideAfter;
            $scope.tooltips.submissionsCutoff.push({
                'date' : $scope.hideAfter
              , 'text' : 'Hide After'
            });
          }
          else {
            $scope.invalidAfter.submissionsCutoff = null;
          }
        }
        else {
          $scope.invalidBefore.submissionsCutoff = null;
          $scope.invalidAfter.submissionsCutoff  = null;
        }

        // hideAfter
        $scope.tooltips.hideAfter = [];
        if ($scope.hideAfterEnabled) {
          // availableOn must be enabled for this to be enabled
          var maxDate = $scope.availableOn;
          $scope.tooltips.hideAfter.push({
              'date' : $scope.availableOn
            , 'text' : 'Available On'
          });

          if ($scope.submissionsCutoffEnabled) {
            $scope.tooltips.hideAfter.push({
                'date' : $scope.submissionsCutoff
              , 'text' : 'Submissions Cutoff'
            });

            if ($scope.submissionsCutoff > maxDate) {
              maxDate = $scope.submissionsCutoff;
            }
          }
          if ($scope.submissionsDueEnabled) {
            $scope.tooltips.hideAfter.push({
                'date' : $scope.submissionsDue
              , 'text' : 'Due'
            });

            if ($scope.submissionsDue > maxDate) {
              maxDate = $scope.submissionsDue;
            }
          }

          if (maxDate) {
            $scope.invalidBefore.hideAfter = maxDate;
          }
          else {
            $scope.invalidBefore.hideAfter = null;
          }
        }
        else {
          $scope.invalidBefore.hideAfter = null;
          $scope.invalidAfter.hideAfter  = null;
        }
      }

      angular.forEach(dates, function(name) {
        $scope[setPrefix + name] = function(newDate) {
          var dateObj = newDate
                           ? new Date(newDate)
                           : defaultDate[name]
                             ? defaultDate[name]()
                             : roundMinutes(new Date());
          dateObj.setSeconds(0);
          dateObj.setMilliseconds(0);
          $scope[name] = dateObj;
          $scope[name + displaySuffix] = moment(dateObj).format("llll");
        }

        if (material) {
          $scope[setPrefix + name](material.trinket[name].dateValue);
          $scope[name + enabledSuffix] = material.trinket[name].enabled;
        }
        else {
          $scope[setPrefix + name]();
          $scope[name + enabledSuffix] = false;
        }
      });

      // initialize calendar details
      angular.forEach(dates, function(name) {
        $scope.updateCalendar({ field : name });
      });

      angular.forEach(dates, function(name) {
        // setup binding for when date fields change
        $scope.$watch(name, function(newValue, oldValue) {
          $scope.updateCalendar(this);
        });

        // and when date fields enabled/disabled
        $scope.$watch(name + enabledSuffix, function(newValue, oldValue) {
          $scope.updateCalendar(this);
        });
      });

      $scope.saveAssignment = function($event) {
        $event.preventDefault();

        var data, editor;

        if ($scope.material.name && $scope.trinket) {
          data = {
              name             : $scope.material.name
            , lang             : $scope.trinket.lang
            , trinketId        : $scope.trinket.trinketId || "_blank_"
          };

          angular.forEach(dates, function(name) {
            data[name] = $scope[name];
            data[name + enabledSuffix] = $scope[name + enabledSuffix] || false;
          });

          editor = $window.ace.edit("trinket-instructions-editor");
          if (editor.getValue().length) {
            data.content = editor.getValue();
          }

          if (material) {
            material.customPUT(data, 'assignment').then(function(result) {
              $modalInstance.close(result);
            });
          }
          else {
            data.type = 'assignment';
            lesson.materials.post(data).then(function(result) {
              $modalInstance.close(result);
            });
          }
        }
      }

      $scope.changeTrinket = function() {
        tmpTrinket     = $scope.trinket;
        $scope.trinket = undefined;
      }

      $scope.keepTrinket = function() {
        $scope.trinket = tmpTrinket;
      }

      $scope.addSelectedTrinket = function(item) {
        $scope.trinket = {
            lang      : item.lang
          , name      : item.name
          , trinketId : item.id
        };
      }

      $scope.addBlankTrinket = function(type) {
        $scope.trinket = {
            lang : type.lang
          , name : "[Leeres " + type.label + "-Trinket]"
        };
      }

      $scope.toggleSubmissionsDue = function() {
        $scope.submissionsDueEnabled = !$scope.submissionsDueEnabled;

        // disable submissionsCutoff if due disabled
        if (!$scope.submissionsDueEnabled) {
          $scope.submissionsCutoffEnabled = false;
        }
      }

      $scope.toggleSubmissionsCutoff = function() {
        $scope.submissionsCutoffEnabled = !$scope.submissionsCutoffEnabled;

        if ($scope.submissionsCutoffEnabled && $scope.submissionsCutoff < $scope.submissionsDue) {
          $scope.setsubmissionsCutoff($scope.submissionsDue);
        }
      }

      $scope.toggleAvailableOn = function() {
        $scope.availableOnEnabled = !$scope.availableOnEnabled;

        if ($scope.availableOnEnabled) {
          if ($scope.availableOn > $scope.submissionsDue) {
            $scope.setavailableOn($scope.submissionsDue);
          }
        }
        else {
          // disable hideAfter if visibility disabled
          $scope.hideAfterEnabled = false;
        }
      }

      $scope.toggleHideAfter = function() {
        var maxDate;

        $scope.hideAfterEnabled = !$scope.hideAfterEnabled;

        if ($scope.hideAfterEnabled && $scope.submissionsDueEnabled) {
          maxDate = $scope.submissionsDue;

          if ($scope.submissionsCutoffEnabled && $scope.submissionsCutoff > maxDate) {
            maxDate = $scope.submissionsCutoff;
          }

          $scope.sethideAfter(maxDate);
        }
      }

      $scope.close = function() {
        $modalInstance.close();
      }
    }]);
})(window.angular);
