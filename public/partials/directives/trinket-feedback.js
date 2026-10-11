(function(angular) {
  'use strict';

  angular.module('trinket.feedback', [
    'ngAria',
    'trinket.submissions',
    'ui.ace'
  ]).directive('trinketFeedback', ['$compile', '$templateRequest', '$timeout', '$filter', '$sce', 'trinketSubmissions', 'trinketConfig', 'markdownParser', function($compile, $templateRequest, $timeout, $filter, $sce, trinketSubmissions, trinketConfig, markdownParser) {
    function link(scope, element, attrs) {
      scope.canSubmit  = false;
      scope.canUpdate  = false;
      scope.canAccept  = false;
      scope.api        = null;
      scope.state      = null;

      scope.sendingFeedback = false;
      scope.revisionMade    = false;
      scope.acceptingSubmission = false;

      scope.feedbackForm = {
          includeRevision : false
        , allowResubmit   : false
        , comments        : ""
      };

      // Lernix (ADR 0007): Rückmeldungen werden angehängt; der Entwurf kann per Token vorbereitet sein
      scope.draftViaToken = false;
      scope.hasDraft      = false;

      var SOURCE_LABELS = { token : 'per Token gesendet', token_draft : 'per Token vorbereitet' };

      scope.sourceLabel = function(comment) {
        return SOURCE_LABELS[comment.source] || '';
      }

      function feedbackOf(submission) {
        return $filter('filter')(submission.comments || [], { commentType : 'feedback' }, true);
      }

      function draftOf(submission) {
        return $filter('filter')(submission.comments || [], { commentType : 'feedback-draft' }, true)[0];
      }

      function readDraft() {
        var draft = draftOf(scope.submission);
        scope.hasDraft      = !!(draft && draft.commentText);
        scope.draftViaToken = !!(draft && draft.commentText && draft.viaToken);
        return draft && draft.commentText ? draft.commentText : '';
      }

      scope.previousSubmissions = [];
      scope.showSubmission      = {};
      scope.submissionSrc       = {};

      var url, iframe, win, feedbackComments;
      var parser = markdownParser({
          $scope  : scope
        , preview : true
      });

      $templateRequest('/partials/directives/trinket-feedback.html').then(function(html) {
        element.html(html);
        $compile(element.contents())(scope);

        iframe = element.find('iframe');
        iframe.on('load', function() {
          win = this.contentWindow || this.contentDocument;
          scope.api = win.TrinketApp;

          win.TrinketApp.on('trinket.code.change',   scope.setRevisionMade.bind(null, true));
          win.TrinketApp.on('trinket.draft.discard', scope.setRevisionMade.bind(null, false));

          if (win.TrinketApp.viewingDraft()) {
            scope.revisionMade = true;
          }

          scope.canSubmit = scope.canAccept = true;
          scope.$apply();
        });
      });

      scope.$watch("submission", function(newValue, oldValue) {
        scope.canSubmit      = false;
        scope.canUpdate      = false;
        scope.canAccept      = false;
        scope.revisionIframe = null;
        scope.previousSubmissions = [];

        if (scope.submission && scope.submission.lang && scope.submission.shortCode) {
          url         = scope.submission.lang + "/" + scope.submission.shortCode;
          scope.state = scope.submission.state;

          if (scope.state === "submitted") {
            scope.submissionIframe = $sce.trustAsResourceUrl(trinketConfig.getUrl("/assignment-embed-feedback/" + url));

            angular.forEach(scope.submission.submissionOpts, function(val, key) {
              scope.feedbackForm[key] = val;
            });

            scope.feedbackForm.comments = readDraft();
          }
          else if (scope.state === "submittedLate") {
            scope.submissionIframe = $sce.trustAsResourceUrl(trinketConfig.getUrl("/assignment-embed-viewonly/" + url));
          }
          else if (scope.state === "completed") {
            feedbackComments = feedbackOf(scope.submission);
            scope.submissionIframe = $sce.trustAsResourceUrl(trinketConfig.getUrl("/assignment-embed-viewonly/" + url));
            readDraft();

            // die Überarbeitung gehört zur letzten Rückmeldung
            if (feedbackComments.length) {
              var latest = feedbackComments[feedbackComments.length - 1];
              scope.revisionIframe = $sce.trustAsResourceUrl(
                trinketConfig.getUrl("/assignment-embed-viewonly/" + latest.trinketLang + "/" + latest.trinketShortCode)
              );
            }
          }

          // check for previous submissions / feedback
          trinketSubmissions.getUserSubmissionsForMaterial(scope.submission, scope.material)
            .then(function(submissions) {
              submissions.reverse();
              angular.forEach(submissions, function(submission) {
                if (submission.shortCode !== scope.submission.shortCode && submission.submissionState === "completed") {
                  // find teacher feedback (all of it; the revision belongs to the latest)
                  submission.feedbackList = feedbackOf(submission);
                  submission.feedback     = submission.feedbackList[submission.feedbackList.length - 1];

                  if (submission.includeRevision && submission.feedback) {
                    submission.revisionIframe = $sce.trustAsResourceUrl(
                      trinketConfig.getUrl("/assignment-embed-viewonly/" + submission.feedback.trinketLang + "/" + submission.feedback.trinketShortCode)
                    );
                  }

                  scope.previousSubmissions.push(submission);
                }
              });
            });
        }
      });

      scope.sendFeedback = function() {
        scope.canSubmit       = false;
        scope.canUpdate       = false;
        scope.canAccept       = false;
        scope.sendingFeedback = true;

        // ein noch wartendes Speichern des Entwurfs darf nicht nach dem Senden ankommen
        if (scope.autosaveComments.cancel) {
          scope.autosaveComments.cancel();
        }

        trinketSubmissions.sendFeedback(scope.material, scope.submission.id, scope.api.serialize(), scope.feedbackForm)
          .then(function(result) {
            $timeout(function() {
              scope.submission.state       = scope.state = result.submissionState;
              scope.submission.lastUpdated = result.lastUpdated;
              scope.submission.comments    = result.comments;

              scope.submission.submissionOpts = {
                  allowResubmit   : result.allowResubmit
                , includeRevision : result.includeRevision
              };

              feedbackComments = feedbackOf(scope.submission);
              scope.feedbackForm.comments = readDraft();   // der Entwurf ist verbraucht

              if (feedbackComments.length) {
                var latest = feedbackComments[feedbackComments.length - 1];
                scope.revisionIframe = $sce.trustAsResourceUrl(trinketConfig.getUrl("/assignment-embed-viewonly/" + latest.trinketLang + "/" + latest.trinketShortCode));
              }

              scope.sendingFeedback  = false;
            }, 500);
          });
      }

      scope.acceptSubmission = function() {
        scope.canSubmit           = false;
        scope.canUpdate           = false;
        scope.canAccept           = false;
        scope.acceptingSubmission = true;

        trinketSubmissions.acceptSubmission(scope.material, scope.submission.id)
          .then(function(result) {
            $timeout(function() {
              scope.submission.state = scope.state = result.submissionState;
              scope.acceptingSubmission = false;

              if (scope.state === "submitted") {
                scope.canSubmit = true;
              }
            }, 500);
          });
      }

      scope.cancelFeedback = function() {
        // call parent scope cancel to close feedback row
        scope.cancel();
      }

      scope.setRevisionMade = function(val) {
        // enable/disable checkbox to include modified trinket in feedback...
        scope.revisionMade = val;

        scope.$apply();
      }

      scope.submissionOptChange = function(field) {
        trinketSubmissions.autosaveSubmissionOpt(scope.submission.id, field, scope.feedbackForm[field]);
      }

      // Der Entwurf wird beim Tippen gespeichert. Der Editor meldet auch das Vorbelegen als
      // Änderung; gespeichert wird nur, was sich vom zuletzt gespeicherten Entwurf unterscheidet.
      scope.autosaveComments = _.debounce(function(e) {
        var text  = scope.feedbackForm.comments || ''
          , draft = draftOf(scope.submission);

        if (scope.sendingFeedback || text === (draft ? draft.commentText || '' : '')) {
          return;
        }

        trinketSubmissions.autosaveFeedbackComments(scope.submission.id, text)
          .then(function() {
            if (scope.sendingFeedback) {
              return;
            }
            if (draft) {
              draft.commentText = text;
            }
            else {
              scope.submission.comments.push({ commentType : 'feedback-draft', commentText : text });
            }
            scope.hasDraft = !!text;
            if (!text) {
              scope.draftViaToken = false;
            }
          });
      }, 500);

      scope.displayFeedback = function(commentText) {
        return $sce.trustAsHtml( parser( commentText ) );
      }

      scope.editCompleted = function() {
        scope.state = "editing";

        scope.feedbackForm.includeRevision = scope.submission.submissionOpts.includeRevision;
        scope.feedbackForm.allowResubmit   = scope.submission.submissionOpts.allowResubmit;

        // Eine weitere Rückmeldung (ADR 0007): Gesendete bleiben stehen, das Formular beginnt mit
        // dem Entwurf oder leer. Die Überarbeitung der letzten Rückmeldung lässt sich weiterführen.
        var comment = feedbackOf(scope.submission);
        var latest  = comment[comment.length - 1];
        var revisionUrl;

        scope.revisionIframe        = null;
        scope.feedbackForm.comments = readDraft();

        if (latest && latest.trinketShortCode) {
          scope.revisionMade          = true;
          revisionUrl                 = latest.trinketLang + "/" + latest.trinketShortCode;
          scope.revisionId            = latest.trinketId;
        }
        else {
          scope.revisionMade          = false;
          revisionUrl                 = scope.submission.lang + "/" + scope.submission.shortCode;
          scope.revisionId            = scope.submission.trinketId;
        }

        scope.revisionIframe = $sce.trustAsResourceUrl(trinketConfig.getUrl("/assignment-embed-feedback/" + revisionUrl));

        $timeout(function() {
          var iframe = angular.element(document.querySelector('#rev-' + scope.revisionId));
          iframe.on('load', function() {
            win = this.contentWindow || this.contentDocument;
            scope.api = win.TrinketApp;

            win.TrinketApp.on('trinket.code.change',   scope.setRevisionMade.bind(null, true));
            win.TrinketApp.on('trinket.draft.discard', scope.setRevisionMade.bind(null, false));

            if (win.TrinketApp.viewingDraft()) {
              scope.revisionMade = true;
            }

            scope.canUpdate = true;
            scope.$apply();
          });
        });
      }

      scope.cancelEdit = function() {
        scope.state = "completed";
      }

      scope.toggleSubmission = function(submission) {
        if (scope.showSubmission[submission.id]) {
          scope.showSubmission[submission.id] = false;
        }
        else {
          scope.showSubmission[submission.id] = true;

          if (!scope.submissionSrc[submission.id]) {
            scope.submissionSrc[submission.id]  = $sce.trustAsResourceUrl(trinketConfig.getUrl("/assignment-embed-viewonly/" + submission.lang + "/" + submission.shortCode));
          }
        }
      }
    }

    return {
        restrict : 'E'
      , link     : link
      , scope    : {
            submission      : '='
          , material        : '='
          , cancel          : '='
          , canSendFeedback : '='
        }
    };
  }]);
})(window.angular);
