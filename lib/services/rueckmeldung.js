'use strict';

/**
 * Rückmeldungen zu Abgaben (Trinket Lernix, ADR 0006) – gemeinsam für Oberfläche
 * (lib/controllers/course.js sendFeedback/acceptSubmission/autosaveFeedbackComments) und Token-API.
 *
 * Ablauf wie im Dashboard (public/partials/directives/trinket-feedback.js):
 * - „submittedLate“ → „Verspätete Abgabe annehmen“ → „submitted“
 * - „submitted“ → „Rückmeldung senden“ → „completed“: Kommentar vom Typ „feedback“ mit
 *   Überarbeitung (eigenes Trinket, _parent = Abgabe) und submissionOpts
 *   { includeRevision, allowResubmit }; erneutes Senden bei „completed“ ändert beides.
 * - Entwurf der Rückmeldung als Kommentar „feedback-draft“ (füllt das Formular in der Oberfläche).
 */

var Boom = require('@hapi/boom');

var FEEDBACK_PERMISSION = 'send-submission-feedback';

function TrinketModel() { return global.Trinket || require('../models/trinket'); }

function assertCanGiveFeedback(user, course, submission) {
  if (!user.hasPermission(FEEDBACK_PERMISSION, 'course', { id : String(course._id) })) {
    throw Boom.forbidden('Du darfst in diesem Kurs keine Rückmeldungen geben.');
  }
  if (!submission || !submission.courseId || String(submission.courseId) !== String(course._id)) {
    throw Boom.notFound('Diese Abgabe gehört nicht zu diesem Kurs.');
  }
}

function lastFeedbackIndex(submission) {
  var comments = submission.comments || [];
  if (comments.length && comments[comments.length - 1].commentType === 'feedback') {
    return comments.length - 1;
  }
  return -1;
}

/**
 * Rückmeldung senden.
 * @param opts { comments, includeRevision, allowResubmit, revision: { code, assets, settings } | null }
 *             Ohne revision wird der Code der Abgabe unverändert als Überarbeitung abgelegt
 *             (so wie die Oberfläche, wenn die Lehrkraft nichts ändert).
 */
async function sendFeedback(user, course, submission, opts) {
  assertCanGiveFeedback(user, course, submission);

  var Trinket       = TrinketModel(),
      feedbackIndex = lastFeedbackIndex(submission),
      source        = opts.revision || { code : submission.code, assets : submission.assets, settings : submission.settings },
      revision      = null;

  if (submission.submissionState === 'completed' && feedbackIndex >= 0 && submission.comments[feedbackIndex].trinketId) {
    revision = await Trinket.findById(submission.comments[feedbackIndex].trinketId);
  }

  if (revision) {
    revision.code     = source.code;
    revision.assets   = source.assets;
    revision.settings = source.settings;
  } else {
    revision = new Trinket({
      code     : source.code,
      assets   : source.assets,
      settings : source.settings,
      _parent  : submission.id,
      _creator : user,
      lang     : submission.lang
    });
  }
  revision = await revision.save();

  submission.submissionState = 'completed';
  submission.submissionOpts  = {
    includeRevision : opts.includeRevision,
    allowResubmit   : opts.allowResubmit
  };

  if (feedbackIndex >= 0) {
    submission.comments[feedbackIndex].commentText      = opts.comments;
    submission.comments[feedbackIndex].trinketId        = revision.id;
    submission.comments[feedbackIndex].trinketLang      = revision.lang;
    submission.comments[feedbackIndex].trinketShortCode = revision.shortCode;
  } else {
    submission.comments.push({
      userId           : user.id,
      username         : user.username,
      displayName      : user.name,
      email            : user.email,
      avatar           : user.normalizeAvatar(),
      commentText      : opts.comments,
      commentType      : 'feedback',
      trinketId        : revision.id,
      trinketLang      : revision.lang,
      trinketShortCode : revision.shortCode
    });
  }

  return submission.save();
}

/** Verspätete Abgabe annehmen (submittedLate → submitted). strict: nur aus submittedLate. */
async function acceptSubmission(user, course, submission, options) {
  assertCanGiveFeedback(user, course, submission);
  if (options && options.strict && submission.submissionState !== 'submittedLate') {
    throw Boom.conflict('Nur verspätete Abgaben (submittedLate) können angenommen werden.');
  }
  submission.submissionState = 'submitted';
  return submission.save();
}

/** Entwurf der Rückmeldung speichern (wie das Autosave im Dashboard). */
async function saveFeedbackDraft(user, course, submission, text) {
  assertCanGiveFeedback(user, course, submission);

  var draft = (submission.comments || []).filter(function(c) { return c.commentType === 'feedback-draft'; })[0];
  if (draft) {
    draft.commentText = text;
  } else {
    submission.comments.push({ commentText : text, commentType : 'feedback-draft' });
  }
  return submission.save();
}

/** Rückmeldungsoptionen einzeln setzen (wie die Checkboxen im Dashboard). */
async function setSubmissionOpts(user, course, submission, opts) {
  assertCanGiveFeedback(user, course, submission);
  if (!submission.submissionOpts) submission.submissionOpts = {};
  ['includeRevision', 'allowResubmit'].forEach(function(key) {
    if (typeof opts[key] === 'boolean') submission.submissionOpts[key] = opts[key];
  });
  return submission.save();
}

module.exports = {
  FEEDBACK_PERMISSION   : FEEDBACK_PERMISSION,
  assertCanGiveFeedback : assertCanGiveFeedback,
  sendFeedback          : sendFeedback,
  acceptSubmission      : acceptSubmission,
  saveFeedbackDraft     : saveFeedbackDraft,
  setSubmissionOpts     : setSubmissionOpts
};
