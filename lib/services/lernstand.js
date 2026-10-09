'use strict';

/**
 * Lernstand-Service (Trinket Lernix, Phase 3): liest Kurse, Aufgaben, Teilnehmende und
 * Abgaben so auf, wie die /api/v1-Endpunkte sie liefern. Enthält keine HTTP-Logik; die
 * Rechteprüfung passiert hier (view-assignment-submissions auf dem Kurs), damit Session- und
 * Token-Zugriffe identisch behandelt werden.
 */

var mongoose = require('mongoose'),
    Boom     = require('@hapi/boom'),
    trinkets = require('./trinkets');

var VIEW_PERMISSION = 'view-assignment-submissions';

function Raw(name) { return mongoose.model(name); }

function canViewCourse(user, courseId) {
  return !!(user && user.hasPermission && user.hasPermission(VIEW_PERMISSION, 'course', { id : String(courseId) }));
}

function assertCourseAccess(user, course) {
  if (!canViewCourse(user, course.id)) {
    throw Boom.forbidden('Kein Zugriff auf die Abgaben dieses Kurses.');
  }
}

function iservGroupOf(course) {
  var link = course.externalLink;
  return link && link.source === 'iserv' && link.sourceId ? { act : link.sourceId, name : link.name || link.sourceId } : null;
}

function isStudentEntry(entry) {
  return !entry.deleted && (entry.roles || []).indexOf('course-student') >= 0;
}

function courseSummary(course) {
  return {
    id           : course.id,
    name         : course.name,
    slug         : course.slug,
    description  : course.description || '',
    owner        : course.ownerSlug,
    archived     : !!course.archived,
    courseType   : course.globalSettings ? course.globalSettings.courseType : undefined,
    iservGroup   : iservGroupOf(course),
    studentCount : (course.users || []).filter(isStudentEntry).length,
    created      : course.created,
    lastUpdated  : course.lastUpdated
  };
}

/** Kurse, in denen die Person Abgaben sehen darf (Owner, Kurs-Admin). */
async function coursesForUser(user) {
  var ids = (user.roles || [])
    .filter(function(r) { return /^course:/.test(r.context) && (r.permissions || []).indexOf(VIEW_PERMISSION) >= 0; })
    .map(function(r) { return r.context.split(':')[1]; });

  if (!ids.length) return [];

  var courses = await Raw('Course').find({ _id : { $in : ids } }).sort({ name : 1 });
  return courses.map(courseSummary);
}

function dateField(block) {
  return block && block.enabled && block.dateValue
    ? { enabled : true, at : block.dateValue }
    : { enabled : false, at : null };
}

function materialSummary(material, lesson) {
  var out = {
    id         : material.id,
    name       : material.name,
    slug       : material.slug,
    type       : material.type,
    isDraft    : !!material.isDraft,
    lessonId   : lesson.id,
    lessonName : lesson.name
  };

  if (material.type === 'assignment') {
    var t = material.trinket || {};
    out.assignment = {
      trinketId         : t.trinketId ? String(t.trinketId) : null,
      lang              : t.lang || null,
      shortCode         : t.shortCode || null,
      submissionsDue    : dateField(t.submissionsDue),
      submissionsCutoff : dateField(t.submissionsCutoff),
      availableOn       : dateField(t.availableOn),
      hideAfter         : dateField(t.hideAfter)
    };
  }
  return out;
}

function orderBy(ids, docs) {
  var byId = {};
  docs.forEach(function(d) { byId[String(d._id)] = d; });
  return ids.map(function(id) { return byId[String(id)]; }).filter(Boolean);
}

/** Lektionen und Materialien in Kursreihenfolge. */
async function outline(course) {
  var lessons = orderBy(course.lessons || [], await Raw('Lesson').find({ _id : { $in : course.lessons || [] } })),
      result  = [];

  for (var i = 0; i < lessons.length; i++) {
    var lesson    = lessons[i],
        materials = orderBy(lesson.materials || [], await Raw('Material').find({ _id : { $in : lesson.materials || [] } }));

    result.push({
      id        : lesson.id,
      name      : lesson.name,
      isDraft   : !!lesson.isDraft,
      materials : materials.map(function(m) { return materialSummary(m, lesson); })
    });
  }
  return { lessons : result };
}

function studentList(course) {
  return (course.users || []).filter(isStudentEntry).map(function(u) {
    return {
      id          : String(u.userId),
      username    : u.username,
      name        : u.displayName,
      email       : u.email,
      joinedVia   : u.joinedVia || null,
      onDashboard : !course.userHiddenFromDashboard(u)
    };
  });
}

/** Zustand aus allen Trinkets eines Paares (SuS, Aufgabe), Priorität wie im Dashboard. */
function stateFrom(states) {
  states = states || [];
  if (states.indexOf('submitted') >= 0 || states.indexOf('submittedLate') >= 0) return 'submitted';
  if (states.indexOf('completed') >= 0) return 'completed';
  if (states.indexOf('started') >= 0 || states.indexOf('modified') >= 0) return 'started';
  return 'not-started';
}

function normalizeState(state) {
  return stateFrom(state ? [state] : []);
}

function emptyCounts() {
  return { notStarted : 0, started : 0, submitted : 0, completed : 0 };
}

/** Matrix SuS × Aufgabe mit Zusammenfassungen. */
async function lernstand(course) {
  var out         = await outline(course),
      assignments = [],
      students    = studentList(course),
      studentIds  = {},
      assignmentIds = {};

  out.lessons.forEach(function(l) {
    l.materials.forEach(function(m) { if (m.type === 'assignment') assignments.push(m); });
  });
  students.forEach(function(s) { studentIds[s.id] = s; });
  assignments.forEach(function(a) { assignmentIds[a.id] = a; });

  var rows = await Raw('Snippet').aggregate([
    { $match : { courseId : course._id, materialId : { $ne : null }, deletedAt : null } },
    { $sort  : { lastUpdated : -1 } },
    { $group : {
        _id         : { user : '$_creator', material : '$materialId' },
        trinketId   : { $first : '$_id' },
        startedOn   : { $first : '$startedOn' },
        submittedOn : { $first : '$submittedOn' },
        lastUpdated : { $first : '$lastUpdated' },
        states      : { $addToSet : '$submissionState' }
      }
    }
  ]);

  var byAssignment = {}, byStudent = {};
  assignments.forEach(function(a) { byAssignment[a.id] = Object.assign({ assignmentId : a.id, name : a.name, notStarted : students.length }, emptyCounts(), { notStarted : students.length }); });
  students.forEach(function(s) { byStudent[s.id] = Object.assign({ studentId : s.id, username : s.username, name : s.name, assignmentCount : assignments.length }, emptyCounts(), { notStarted : assignments.length }); });

  var submissions = [];
  rows.forEach(function(row) {
    var sid = row._id.user ? String(row._id.user) : '',
        aid = row._id.material ? String(row._id.material) : '';

    if (!studentIds[sid] || !assignmentIds[aid]) return;   // ehemalige SuS oder gelöschte Aufgaben

    var state = stateFrom(row.states);
    submissions.push({
      studentId    : sid,
      assignmentId : aid,
      state        : state,
      late         : row.states.indexOf('submittedLate') >= 0 && row.states.indexOf('submitted') < 0,
      trinketId    : String(row.trinketId),
      startedOn    : row.startedOn || null,
      submittedOn  : row.submittedOn || null,
      lastUpdated  : row.lastUpdated || null
    });

    var key = state === 'not-started' ? 'notStarted' : state;
    byAssignment[aid][key]++; byAssignment[aid].notStarted--;
    byStudent[sid][key]++;    byStudent[sid].notStarted--;
  });

  return {
    course       : courseSummary(course),
    generatedAt  : new Date(),
    assignments  : assignments,
    students     : students,
    submissions  : submissions,
    byAssignment : assignments.map(function(a) { return byAssignment[a.id]; }),
    byStudent    : students.map(function(s) { return byStudent[s.id]; })
  };
}

function trinketSummary(t) {
  return {
    id            : t.id,
    shortCode     : t.shortCode,
    name          : t.name,
    lang          : t.lang,
    courseId      : t.courseId ? String(t.courseId) : null,
    assignmentId  : t.materialId ? String(t.materialId) : null,
    creatorId     : t._creator ? String(t._creator) : null,
    state         : normalizeState(t.submissionState),
    rawState      : t.submissionState || null,
    late          : t.submissionState === 'submittedLate',
    startedOn     : t.startedOn || null,
    submittedOn   : t.submittedOn || null,
    created       : t.created,
    lastUpdated   : t.lastUpdated,
    feedbackCount : (t.comments || []).length
  };
}

function commentDetail(c) {
  var out = { id : c._id ? String(c._id) : null, author : c.displayName || c.username || null, type : c.commentType || null, text : c.commentText || '', at : c.commented || null };
  if (c.trinketId) {
    out.revisionTrinketId = String(c.trinketId);
    out.revisionShortCode = c.trinketShortCode || null;
  }
  return out;
}

/** Letzte gesendete Rückmeldung, Entwurf und Kommentar der SuS (Typen wie in der Oberfläche). */
function feedbackOf(t) {
  var comments = t.comments || [],
      sent     = comments.filter(function(c) { return c.commentType === 'feedback'; }).pop(),
      draft    = comments.filter(function(c) { return c.commentType === 'feedback-draft'; })[0],
      student  = comments.filter(function(c) { return c.commentType === 'student'; })[0];
  return {
    text              : sent ? sent.commentText || '' : null,
    at                : sent ? sent.commented || null : null,
    author            : sent ? sent.displayName || sent.username || null : null,
    revisionTrinketId : sent && sent.trinketId ? String(sent.trinketId) : null,
    draft             : draft ? draft.commentText || '' : null,
    studentComment    : student ? student.commentText || '' : null,
    includeRevision   : !!(t.submissionOpts && t.submissionOpts.includeRevision),
    allowResubmit     : !!(t.submissionOpts && t.submissionOpts.allowResubmit)
  };
}

function codeFields(t) {
  var out = { code : t.code || '', files : trinkets.filesOf(t) },
      py  = trinkets.pythonOf(t);
  if (py) {
    out.pythonCode  = py.pythonCode;
    out.pythonError = py.pythonError;
  }
  return out;
}

function trinketDetail(t) {
  return Object.assign(trinketSummary(t), codeFields(t), {
    description : t.description || '',
    feedback    : feedbackOf(t),
    comments    : (t.comments || []).map(commentDetail)
  });
}

/** Rangfolge wie getMaterialSubmissionsForAllUsers (Dashboard je Aufgabe). */
var STATE_RANK = { submittedLate : 5, submitted : 4, completed : 3, started : 2, modified : 1 };

/**
 * Je SuS des Kurses das maßgebliche Trinket zu einer Aufgabe (wie das Dashboard der Aufgabe),
 * auf Wunsch mit Code (bei Blöcken auch Python).
 */
async function assignmentSubmissions(course, material, options) {
  options = options || {};
  var students = studentList(course),
      rows     = await Raw('Snippet').find({ courseId : course._id, materialId : material._id, deletedAt : null }).sort({ lastUpdated : -1 }),
      byUser   = {};

  rows.forEach(function(t) {
    var uid = String(t._creator), list = byUser[uid] || (byUser[uid] = []);
    list.push(t);
  });

  return {
    course      : courseSummary(course),
    assignment  : { id : material.id, name : material.name },
    submissions : students.map(function(s) {
      var list = byUser[s.id] || [];
      if (!list.length) return { student : s, state : 'not-started', attempts : 0, trinket : null };

      var best = list.slice().sort(function(a, b) {
        var r = (STATE_RANK[b.submissionState] || 0) - (STATE_RANK[a.submissionState] || 0);
        return r || (b.lastUpdated - a.lastUpdated);
      })[0];

      var trinket = Object.assign(trinketSummary(best), { feedback : feedbackOf(best) });
      if (options.includeCode) Object.assign(trinket, codeFields(best));

      return { student : s, state : stateFrom(list.map(function(t) { return t.submissionState; })), attempts : list.length, trinket : trinket };
    })
  };
}

/** Eine Seite oder Aufgabe mit Inhalt (Markdown) und – bei Aufgaben – Vorlage samt Code. */
async function materialDetail(course, lesson, material) {
  var out = Object.assign(materialSummary(material, lesson), { content : material.content || '' });
  if (material.type === 'assignment' && material.trinket && material.trinket.trinketId) {
    var starter = await Raw('Snippet').findById(material.trinket.trinketId);
    out.assignment.starter = starter ? Object.assign({ id : starter.id, shortCode : starter.shortCode, lang : starter.lang, name : starter.name || '' }, codeFields(starter)) : null;
  }
  return out;
}

async function studentSubmissions(course, userId) {
  var student = studentList(course).filter(function(s) { return s.id === String(userId); })[0];
  if (!student) throw Boom.notFound('Diese Person ist nicht im Kurs.');

  var rows = await Raw('Snippet').find({
    courseId   : course._id,
    _creator   : student.id,
    materialId : { $ne : null },
    deletedAt  : null
  }).sort({ lastUpdated : -1 });

  return { student : student, submissions : rows.map(trinketSummary) };
}

function canViewTrinket(user, trinket) {
  var uid = String(user._id);
  if (String(trinket._owner) === uid || String(trinket._creator) === uid) return true;
  return !!trinket.courseId && canViewCourse(user, trinket.courseId);
}

module.exports = {
  VIEW_PERMISSION     : VIEW_PERMISSION,
  canViewCourse       : canViewCourse,
  assertCourseAccess  : assertCourseAccess,
  courseSummary       : courseSummary,
  coursesForUser      : coursesForUser,
  outline             : outline,
  studentList         : studentList,
  stateFrom           : stateFrom,
  lernstand           : lernstand,
  studentSubmissions  : studentSubmissions,
  trinketSummary      : trinketSummary,
  trinketDetail       : trinketDetail,
  feedbackOf          : feedbackOf,
  materialSummary     : materialSummary,
  materialDetail      : materialDetail,
  assignmentSubmissions : assignmentSubmissions,
  canViewTrinket      : canViewTrinket
};
