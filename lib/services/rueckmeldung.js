'use strict';

/**
 * Rückmeldungen zu Abgaben (Trinket Lernix, ADR 0006 und 0007) – gemeinsam für Oberfläche
 * (lib/controllers/course.js sendFeedback/acceptSubmission/autosaveFeedbackComments) und Token-API.
 *
 * Ablauf wie im Dashboard (public/partials/directives/trinket-feedback.js):
 * - „submittedLate“ → „Verspätete Abgabe annehmen“ → „submitted“
 * - „submitted“ → „Rückmeldung senden“ → „completed“: Kommentar vom Typ „feedback“ mit
 *   Überarbeitung (eigenes Trinket, _parent = Abgabe) und submissionOpts
 *   { includeRevision, allowResubmit }.
 * - Verlauf statt Ändern (ADR 0007): Jede weitere Rückmeldung wird angehängt, gesendete bleiben
 *   stehen. Eine geänderte Überarbeitung wird als neues Trinket abgelegt.
 * - Ein Entwurf je Abgabe als Kommentar „feedback-draft“ (füllt das Formular in der Oberfläche);
 *   Senden verbraucht ihn, ein leerer Text löscht ihn. SuS bekommen ihn nie (commentsForStudent).
 * - Herkunft je Rückmeldung (source): „manual“ in der Oberfläche geschrieben, „token“ per Token
 *   gesendet, „token_draft“ per Token vorbereitet und von der Lehrkraft gesendet.
 */

var Boom = require('@hapi/boom');

var FEEDBACK_PERMISSION = 'send-submission-feedback';

var SOURCE = { MANUAL : 'manual', TOKEN : 'token', TOKEN_DRAFT : 'token_draft' };

function TrinketModel() { return global.Trinket || require('../models/trinket'); }

function assertCanGiveFeedback(user, course, submission) {
  if (!user.hasPermission(FEEDBACK_PERMISSION, 'course', { id : String(course._id) })) {
    throw Boom.forbidden('Du darfst in diesem Kurs keine Rückmeldungen geben.');
  }
  if (!submission || !submission.courseId || String(submission.courseId) !== String(course._id)) {
    throw Boom.notFound('Diese Abgabe gehört nicht zu diesem Kurs.');
  }
}

function ofType(submission, type) {
  return (submission.comments || []).filter(function(c) { return c.commentType === type; });
}

function draftOf(submission) {
  return ofType(submission, 'feedback-draft')[0] || null;
}

function authorFields(user) {
  return {
    userId      : user.id,
    username    : user.username,
    displayName : user.name,
    email       : user.email,
    avatar      : user.normalizeAvatar()
  };
}

/**
 * Rückmeldung senden (wird angehängt).
 * @param opts { comments, includeRevision, allowResubmit, viaToken,
 *               revision: { code, assets, settings } | null }
 *             Ohne revision bleibt eine vorhandene Überarbeitung gültig; gibt es noch keine,
 *             wird der Code der Abgabe abgelegt (so wie die Oberfläche, wenn die Lehrkraft nichts ändert).
 */
async function sendFeedback(user, course, submission, opts) {
  assertCanGiveFeedback(user, course, submission);

  var Trinket  = TrinketModel(),
      sent     = ofType(submission, 'feedback'),
      previous = sent.length ? sent[sent.length - 1] : null,
      draft    = draftOf(submission),
      revision = previous && previous.trinketId ? await Trinket.findById(previous.trinketId) : null,
      source   = opts.revision || (revision ? null : { code : submission.code, assets : submission.assets, settings : submission.settings });

  if (source && !(revision && revision.code === source.code)) {
    revision = await new Trinket({
      code     : source.code,
      assets   : source.assets,
      settings : source.settings,
      _parent  : submission.id,
      _creator : user,
      lang     : submission.lang
    }).save();
  }

  submission.submissionState = 'completed';
  submission.submissionOpts  = {
    includeRevision : opts.includeRevision,
    allowResubmit   : opts.allowResubmit
  };

  var origin = opts.viaToken ? SOURCE.TOKEN : (draft && draft.viaToken ? SOURCE.TOKEN_DRAFT : SOURCE.MANUAL);

  // Der Entwurf ist verbraucht. Die Liste wird als Ganzes gesetzt, weil MongoDB Entfernen und
  // Anhängen am selben Feld nicht in einer Änderung erlaubt.
  var kept = submission.comments.filter(function(c) { return c.commentType !== 'feedback-draft'; })
    .map(function(c) { return c.toObject ? c.toObject() : c; });
  kept.push(Object.assign(authorFields(user), {
    commentText      : opts.comments,
    commentType      : 'feedback',
    source           : origin,
    trinketId        : revision.id,
    trinketLang      : revision.lang,
    trinketShortCode : revision.shortCode
  }));
  submission.comments = kept;

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

/**
 * Entwurf der Rückmeldung speichern (wie das Autosave im Dashboard); leer löscht ihn.
 * Ein per Token angelegter Entwurf behält diese Kennzeichnung, wenn ihn die Lehrkraft in der
 * Oberfläche bearbeitet.
 */
async function saveFeedbackDraft(user, course, submission, text, options) {
  assertCanGiveFeedback(user, course, submission);

  var draft    = draftOf(submission),
      viaToken = !!(options && options.viaToken);

  if (!text || !text.trim()) {
    if (!draft) return submission;
    submission.comments.pull(draft._id);
  } else if (draft) {
    Object.assign(draft, authorFields(user), {
      commentText : text,
      commented   : new Date(),
      viaToken    : viaToken || !!draft.viaToken
    });
  } else {
    submission.comments.push(Object.assign(authorFields(user), {
      commentText : text,
      commentType : 'feedback-draft',
      viaToken    : viaToken
    }));
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

/**
 * Kommentare so, wie SuS sie sehen dürfen: ohne den Entwurf der Lehrkraft und ohne die Herkunft
 * der Rückmeldungen. Erwartet einfache Objekte (z. B. nach JSON.parse(JSON.stringify(…))).
 */
function commentsForStudent(comments) {
  return (comments || [])
    .filter(function(c) { return c.commentType !== 'feedback-draft'; })
    .map(function(c) {
      var copy = Object.assign({}, c);
      delete copy.source;
      delete copy.viaToken;
      return copy;
    });
}

module.exports = {
  FEEDBACK_PERMISSION   : FEEDBACK_PERMISSION,
  SOURCE                : SOURCE,
  assertCanGiveFeedback : assertCanGiveFeedback,
  sendFeedback          : sendFeedback,
  acceptSubmission      : acceptSubmission,
  saveFeedbackDraft     : saveFeedbackDraft,
  setSubmissionOpts     : setSubmissionOpts,
  commentsForStudent    : commentsForStudent
};
