// Token-API /api/v1 (nur Bearer-Token) – lesend seit ADR 0004, schreibend seit ADR 0006.
// Beschreibung aller Endpunkte: docs/lernix/openapi.yaml. Die Fachlogik liegt in lib/services/*,
// hier nur Scope-Prüfung, Eingabeprüfung (Joi), Schreibbremse und Protokoll.
var Boom           = require('@hapi/boom'),
    Joi            = require('joi'),
    bearer         = require('../auth/bearer'),
    groups         = require('../auth/groups'),
    lernstand      = require('../services/lernstand'),
    kursverwaltung = require('../services/kursverwaltung'),
    rueckmeldung   = require('../services/rueckmeldung'),
    trinkets       = require('../services/trinkets'),
    constants      = require('../../config/constants');

function logger() {
  return global.log || console;
}

// --- Eingabeschemas (unbekannte Felder werden abgelehnt: keine Mass Assignment) ---

var id         = Joi.string().pattern(/^[0-9a-fA-F]{24}$/),
    trinketRef = Joi.string().pattern(/^[0-9a-zA-Z]{6,24}$/),
    lang       = Joi.string().valid(...constants.trinketLangs),
    name       = Joi.string().trim().min(1).max(140),
    content    = Joi.string().allow('').max(200000),
    code       = Joi.string().allow('').max(500000),
    date       = Joi.date().iso().allow(null),
    files      = Joi.array().min(1).max(20).items(Joi.object({
      name    : Joi.string().trim().min(1).max(100).pattern(/^[^\/\\]+$/).required(),
      content : code.required(),
      hidden  : Joi.boolean()
    })),
    codeInput  = { code : code, files : files };

var starter = Joi.object({
  trinketId : trinketRef,
  lang      : lang,
  code      : code,
  files     : files
}).oxor('code', 'files').without('trinketId', ['lang', 'code', 'files']);

function onlyForAssignments(schema) {
  return schema.when('type', { is : 'page', then : Joi.forbidden() });
}

var materialFields = {
  type              : Joi.string().valid('page', 'assignment').required(),
  name              : name.required(),
  content           : content,
  isDraft           : Joi.boolean(),
  starter           : onlyForAssignments(starter),
  submissionsDue    : onlyForAssignments(date),
  submissionsCutoff : onlyForAssignments(date),
  availableOn       : onlyForAssignments(date),
  hideAfter         : onlyForAssignments(date)
};

var SCHEMAS = {
  courseCreate : Joi.object({
    name           : name.required(),
    description    : Joi.string().allow('').max(500),
    courseType     : Joi.string().valid('public', 'private', 'open'),
    contentDefault : Joi.string().valid('publish', 'draft'),
    iservGroup     : Joi.object({ act : Joi.string().max(200).required(), name : Joi.string().max(200).allow('') })
  }),
  coursePatch : Joi.object({
    name           : name,
    description    : Joi.string().allow('').max(500),
    courseType     : Joi.string().valid('public', 'private', 'open'),
    contentDefault : Joi.string().valid('publish', 'draft'),
    archived       : Joi.boolean()
  }).min(1),
  courseDelete : Joi.object({ confirm : Joi.boolean().valid(true).required().messages({ 'any.required' : 'Zum Löschen ist ?confirm=true nötig.' }) }),
  courseCopy   : Joi.object({ name : name.required() }),
  iservGroup   : Joi.object({ act : Joi.string().max(200).required(), name : Joi.string().max(200).allow('') }),
  lessonCreate : Joi.object({ name : name.required(), isDraft : Joi.boolean(), index : Joi.number().integer().min(0) }),
  lessonPatch  : Joi.object({ name : name, isDraft : Joi.boolean() }).min(1),
  lessonOrder  : Joi.object({ lessonIds : Joi.array().items(id).unique().max(500).required() }),
  materialOrder : Joi.object({ materialIds : Joi.array().items(id).unique().max(500).required() }),
  materialCreate : Joi.object(Object.assign({ index : Joi.number().integer().min(0) }, materialFields)),
  materialPatch : Joi.object({
    name              : name,
    content           : content,
    isDraft           : Joi.boolean(),
    starter           : starter,
    submissionsDue    : date,
    submissionsCutoff : date,
    availableOn       : date,
    hideAfter         : date
  }).min(1),
  importSeries : Joi.object({
    lessons : Joi.array().min(1).max(50).required().items(Joi.object({
      name      : name.required(),
      isDraft   : Joi.boolean(),
      materials : Joi.array().max(100).items(Joi.object(materialFields))
    }))
  }),
  studentAdd   : Joi.object({ login : Joi.string().trim().min(1).max(200).required() }),
  memberPatch  : Joi.object({
    onDashboard : Joi.boolean(),
    role        : Joi.string().valid(...kursverwaltung.MEMBER_ROLES)
  }).min(1),
  feedback : Joi.object({
    comment         : Joi.string().allow('').max(20000).required(),
    allowResubmit   : Joi.boolean(),
    includeRevision : Joi.boolean(),
    revision        : Joi.object(codeInput).oxor('code', 'files').or('code', 'files')
  }),
  feedbackDraft : Joi.object({ comment : Joi.string().allow('').max(20000).required() }),
  trinketCreate : Joi.object(Object.assign({
    lang        : lang.required(),
    name        : Joi.string().allow('').max(50),
    description : Joi.string().allow('').max(10000)
  }, codeInput)).oxor('code', 'files'),
  trinketPatch : Joi.object(Object.assign({
    name        : Joi.string().allow('').max(50),
    description : Joi.string().allow('').max(10000)
  }, codeInput)).min(1).oxor('code', 'files'),
  trinketQuery     : Joi.object({ format : Joi.string().valid('json', 'python'), python : Joi.boolean() }),
  materialQuery    : Joi.object({ python : Joi.boolean() }),
  confirmQuery     : Joi.object({ confirm : Joi.boolean() }),
  libraryQuery     : Joi.object({ lang : lang }),
  submissionsQuery : Joi.object({ includeCode : Joi.boolean() })
};

function validate(schema, value) {
  var result = schema.validate(value === null || value === undefined ? {} : value, { abortEarly : false, convert : true });
  if (result.error) {
    var err = Boom.badRequest('Ungültige Eingabe: ' + result.error.details.map(function(d) { return d.message; }).join('; '));
    err.output.payload.details = result.error.details.map(function(d) { return { path : d.path.join('.'), message : d.message }; });
    throw err;
  }
  return result.value;
}

function auditLine(request, status, notes) {
  var token = request.apiToken || {};
  return 'API-Schreibzugriff ' + request.method.toUpperCase() + ' ' + request.path + ' → ' + status
    + ' von ' + (request.user ? request.user.username : '?')
    + ' (Token ' + (token.prefix || '?') + '… „' + (token.name || '') + '“)'
    + (notes.length ? ': ' + notes.join('; ') : '');
}

/**
 * Handler mit Scope, optionaler Eingabeprüfung und – bei write – Bremse und Protokoll.
 * fn(request, input, audit) mit this.reply liefert die Antwort; spec.status setzt z. B. 201, undefined → 204.
 * Fehler als Boom zurückgeben (der Route-Parser würde geworfene Fehler zu 500 machen).
 */
function endpoint(spec, fn) {
  return async function(request, reply) {
    var denied = bearer.missingScope(request, spec.scope),
        notes  = [];

    if (!denied && spec.write) denied = bearer.checkWriteRate(request.apiToken.id);
    if (denied) {
      if (spec.write) logger().info(auditLine(request, denied.output.statusCode, ['abgelehnt: ' + denied.message]));
      return denied;
    }

    try {
      var input = {
        payload : spec.payload ? validate(SCHEMAS[spec.payload], request.payload) : undefined,
        query   : spec.query ? validate(SCHEMAS[spec.query], request.query) : undefined
      };
      var result = await fn.call({ reply : reply }, request, input, function(note) { notes.push(note); });
      if (spec.write) logger().info(auditLine(request, spec.status || (result === undefined ? 204 : 200), notes));

      if (result === undefined) return reply().code(204);
      if (result && result.isBoom) return result;
      if (spec.status) return reply(result).code(spec.status);
      return result;
    } catch (err) {
      if (err && err.isBoom) {
        if (spec.write) logger().info(auditLine(request, err.output.statusCode, ['abgelehnt: ' + err.message]));
        return err;
      }
      logger().error('/api/v1: ' + (err && err.stack || err));
      return Boom.badImplementation('Interner Fehler.');
    }
  };
}

// Abwärtskompatibel für die lesenden Handler aus ADR 0004
function guard(scope, fn) {
  return endpoint({ scope : scope }, function(request) { return fn(request); });
}

function siteRoles(user) {
  var site = user.getByContext ? user.getByContext('site') : null;
  return site ? site.roles : [];
}

async function courseFor(request, permission) {
  var course = await kursverwaltung.loadCourse(request.params.courseId);
  if (permission) {
    kursverwaltung.requirePermission(request.user, permission, course);
  } else {
    lernstand.assertCourseAccess(request.user, course);
  }
  return course;
}

/** Abgabe-Trinket mit Kurs laden (für Rückmeldungen). */
async function submissionFor(request) {
  var submission = await trinkets.loadTrinket(request.params.trinketId);
  if (!submission.courseId || !submission.materialId) {
    throw Boom.notFound('Dieses Trinket ist keine Abgabe zu einer Aufgabe.');
  }
  var course = await kursverwaltung.loadCourse(submission.courseId);
  rueckmeldung.assertCanGiveFeedback(request.user, course, submission);
  return { course : course, submission : submission };
}

function lessonOut(lesson) {
  return { id : lesson.id, name : lesson.name, isDraft : !!lesson.isDraft, materialIds : (lesson.materials || []).map(String) };
}

function mainFileContent(trinket) {
  var list = trinkets.filesOf(trinket),
      main = list.filter(function(f) { return f.name === (trinkets.MAIN_FILES[trinket.lang] || 'main.py'); })[0] || list[0];
  return main ? main.content : '';
}

module.exports = {
  // --- lesend (ADR 0004) ---------------------------------------------------------------

  me : async function(request, reply) {
    var user = request.user;
    return {
      id       : user.id,
      username : user.username,
      name     : user.name || user.fullname,
      email    : user.email,
      roles    : siteRoles(user),
      token    : {
        id     : request.apiToken.id,
        name   : request.apiToken.name,
        scopes : request.apiScopes
      }
    };
  },

  courses : guard('courses:read', async function(request) {
    return { courses : await lernstand.coursesForUser(request.user) };
  }),

  course : guard('courses:read', async function(request) {
    var course = request.pre.course;
    lernstand.assertCourseAccess(request.user, course);
    return Object.assign({ course : lernstand.courseSummary(course) }, await lernstand.outline(course));
  }),

  students : guard('courses:read', async function(request) {
    var course = request.pre.course;
    lernstand.assertCourseAccess(request.user, course);
    return { course : lernstand.courseSummary(course), students : lernstand.studentList(course) };
  }),

  lernstand : guard('submissions:read', async function(request) {
    var course = request.pre.course;
    lernstand.assertCourseAccess(request.user, course);
    return await lernstand.lernstand(course);
  }),

  studentSubmissions : guard('submissions:read', async function(request) {
    var course = request.pre.course;
    lernstand.assertCourseAccess(request.user, course);
    return await lernstand.studentSubmissions(course, request.params.userId);
  }),

  trinket : endpoint({ scope : 'trinkets:read', query : 'trinketQuery' }, async function(request, input, audit) {
    var trinket = request.pre.trinket;
    if (!lernstand.canViewTrinket(request.user, trinket)) {
      return Boom.forbidden('Kein Zugriff auf dieses Trinket.');
    }
    if (input.query.format !== 'python') {
      return { trinket : lernstand.trinketDetail(trinket, { python : !!input.query.python }) };
    }

    var text;
    if (trinket.lang === 'blocks') {
      var py = trinkets.pythonOf(trinket);
      if (py.pythonError) return Boom.badData(py.pythonError);
      text = py.pythonCode;
    } else if (/^(python|python3|pygame|glowscript|console)$/.test(trinket.lang)) {
      text = mainFileContent(trinket);
    } else {
      return Boom.badRequest('format=python gibt es nur für Python- und Block-Trinkets.');
    }
    return this.reply(text).type('text/x-python; charset=utf-8').header('Content-Disposition', 'inline; filename="' + (trinket.shortCode || 'trinket') + '.py"');
  }),

  // --- lesend (ADR 0006) ---------------------------------------------------------------

  iservGroups : guard('courses:read', async function(request) {
    var user = request.user;
    return { groups : groups.storedGroups(user), updatedAt : (user.iserv && user.iserv.groupsAt) || null };
  }),

  members : guard('courses:read', async function(request) {
    var course = await courseFor(request, 'manage-course-access');
    return { course : lernstand.courseSummary(course), members : kursverwaltung.members(request.user, course) };
  }),

  getAccessCode : guard('courses:read', async function(request) {
    var course = await courseFor(request, 'manage-course-access');
    return { accessCode : kursverwaltung.accessCode(request.user, course) || null };
  }),

  material : endpoint({ scope : 'courses:read', query : 'materialQuery' }, async function(request, input) {
    var course = await courseFor(request),
        found  = await kursverwaltung.loadMaterial(course, request.params.materialId);
    return { material : await lernstand.materialDetail(course, found.lesson, found.material, { python : !!input.query.python }) };
  }),

  assignmentSubmissions : endpoint({ scope : 'submissions:read', query : 'submissionsQuery' }, async function(request, input) {
    var course = await courseFor(request),
        found  = await kursverwaltung.loadMaterial(course, request.params.materialId);
    if (found.material.type !== 'assignment') throw Boom.notFound('Das Material ist keine Aufgabe.');
    return await lernstand.assignmentSubmissions(course, found.material, { includeCode : !!input.query.includeCode });
  }),

  library : endpoint({ scope : 'trinkets:read', query : 'libraryQuery' }, async function(request, input) {
    return { trinkets : await trinkets.listLibrary(request.user, input.query.lang) };
  }),

  // --- Kurse (courses:write) -----------------------------------------------------------

  createCourse : endpoint({ scope : 'courses:write', write : true, payload : 'courseCreate', status : 201 }, async function(request, input, audit) {
    var course = await kursverwaltung.createCourse(request.user, input.payload);
    audit('Kurs ' + course.id + ' „' + course.name + '“ angelegt');
    return { course : lernstand.courseSummary(course) };
  }),

  updateCourse : endpoint({ scope : 'courses:write', write : true, payload : 'coursePatch' }, async function(request, input, audit) {
    var course = await kursverwaltung.updateCourse(request.user, await kursverwaltung.loadCourse(request.params.courseId), input.payload);
    audit('Kurs ' + course.id + ' geändert (' + Object.keys(input.payload).join(', ') + ')');
    return { course : lernstand.courseSummary(course) };
  }),

  deleteCourse : endpoint({ scope : 'courses:write', write : true, query : 'courseDelete' }, async function(request, input, audit) {
    var course = await kursverwaltung.loadCourse(request.params.courseId);
    await kursverwaltung.deleteCourse(request.user, course);
    audit('Kurs ' + course.id + ' „' + course.name + '“ gelöscht');
  }),

  copyCourse : endpoint({ scope : 'courses:write', write : true, payload : 'courseCopy', status : 201 }, async function(request, input, audit) {
    var source = await kursverwaltung.loadCourse(request.params.courseId),
        copy   = await kursverwaltung.copyCourse(request.user, source, input.payload.name);
    audit('Kurs ' + source.id + ' kopiert nach ' + copy.id);
    return { course : lernstand.courseSummary(copy) };
  }),

  setIservGroup : endpoint({ scope : 'courses:write', write : true, payload : 'iservGroup' }, async function(request, input, audit) {
    var course = await kursverwaltung.setIservGroup(request.user, await kursverwaltung.loadCourse(request.params.courseId), input.payload);
    audit('Kurs ' + course.id + ' mit IServ-Gruppe ' + input.payload.act + ' verknüpft');
    return { course : lernstand.courseSummary(course) };
  }),

  removeIservGroup : endpoint({ scope : 'courses:write', write : true }, async function(request, input, audit) {
    var course = await kursverwaltung.setIservGroup(request.user, await kursverwaltung.loadCourse(request.params.courseId), null);
    audit('Kurs ' + course.id + ' von IServ-Gruppe gelöst');
    return { course : lernstand.courseSummary(course) };
  }),

  rotateAccessCode : endpoint({ scope : 'courses:write', write : true }, async function(request, input, audit) {
    var course = await kursverwaltung.loadCourse(request.params.courseId),
        codeValue = await kursverwaltung.rotateAccessCode(request.user, course);
    audit('Kurs ' + course.id + ': neuer Zugangscode');
    return { accessCode : codeValue };
  }),

  // --- Inhalte (content:write) ---------------------------------------------------------

  createLesson : endpoint({ scope : 'content:write', write : true, payload : 'lessonCreate', status : 201 }, async function(request, input, audit) {
    var course = await kursverwaltung.loadCourse(request.params.courseId),
        lesson = await kursverwaltung.addLesson(request.user, course, input.payload);
    audit('Kurs ' + course.id + ': Lektion ' + lesson.id + ' „' + lesson.name + '“ angelegt');
    return { lesson : lessonOut(lesson) };
  }),

  updateLesson : endpoint({ scope : 'content:write', write : true, payload : 'lessonPatch' }, async function(request, input, audit) {
    var course = await kursverwaltung.loadCourse(request.params.courseId),
        lesson = await kursverwaltung.loadLesson(course, request.params.lessonId);
    kursverwaltung.requirePermission(request.user, 'manage-course-content', course);
    lesson = await kursverwaltung.updateLesson(request.user, course, lesson, input.payload);
    audit('Kurs ' + course.id + ': Lektion ' + lesson.id + ' geändert (' + Object.keys(input.payload).join(', ') + ')');
    return { lesson : lessonOut(lesson) };
  }),

  deleteLesson : endpoint({ scope : 'content:write', write : true, query : 'confirmQuery' }, async function(request, input, audit) {
    var course = await kursverwaltung.loadCourse(request.params.courseId);
    kursverwaltung.requirePermission(request.user, 'manage-course-content', course);
    var lesson = await kursverwaltung.loadLesson(course, request.params.lessonId);
    await kursverwaltung.deleteLesson(request.user, course, lesson, { confirm : !!input.query.confirm });
    audit('Kurs ' + course.id + ': Lektion ' + lesson.id + ' „' + lesson.name + '“ gelöscht');
  }),

  reorderLessons : endpoint({ scope : 'content:write', write : true, payload : 'lessonOrder' }, async function(request, input, audit) {
    var course = await kursverwaltung.reorderLessons(request.user, await kursverwaltung.loadCourse(request.params.courseId), input.payload.lessonIds);
    audit('Kurs ' + course.id + ': Lektionen neu sortiert');
    return { lessonIds : course.lessons.map(String) };
  }),

  createMaterial : endpoint({ scope : 'content:write', write : true, payload : 'materialCreate', status : 201 }, async function(request, input, audit) {
    var course = await kursverwaltung.loadCourse(request.params.courseId);
    kursverwaltung.requirePermission(request.user, 'manage-course-content', course);
    var lesson   = await kursverwaltung.loadLesson(course, request.params.lessonId),
        material = await kursverwaltung.createMaterial(request.user, course, lesson, input.payload);
    audit('Kurs ' + course.id + ': ' + (material.type === 'assignment' ? 'Aufgabe ' : 'Seite ') + material.id + ' „' + material.name + '“ angelegt');
    return { material : await lernstand.materialDetail(course, lesson, material) };
  }),

  reorderMaterials : endpoint({ scope : 'content:write', write : true, payload : 'materialOrder' }, async function(request, input, audit) {
    var course = await kursverwaltung.loadCourse(request.params.courseId);
    kursverwaltung.requirePermission(request.user, 'manage-course-content', course);
    var lesson = await kursverwaltung.loadLesson(course, request.params.lessonId);
    lesson = await kursverwaltung.reorderMaterials(request.user, course, lesson, input.payload.materialIds);
    audit('Kurs ' + course.id + ': Materialien der Lektion ' + lesson.id + ' neu sortiert');
    return { lesson : lessonOut(lesson) };
  }),

  updateMaterial : endpoint({ scope : 'content:write', write : true, payload : 'materialPatch' }, async function(request, input, audit) {
    var course = await kursverwaltung.loadCourse(request.params.courseId);
    kursverwaltung.requirePermission(request.user, 'manage-course-content', course);
    var found    = await kursverwaltung.loadMaterial(course, request.params.materialId),
        material = await kursverwaltung.updateMaterial(request.user, course, found.material, input.payload);
    audit('Kurs ' + course.id + ': Material ' + material.id + ' geändert (' + Object.keys(input.payload).join(', ') + ')');
    return { material : await lernstand.materialDetail(course, found.lesson, material) };
  }),

  deleteMaterial : endpoint({ scope : 'content:write', write : true, query : 'confirmQuery' }, async function(request, input, audit) {
    var course = await kursverwaltung.loadCourse(request.params.courseId);
    kursverwaltung.requirePermission(request.user, 'manage-course-content', course);
    var found = await kursverwaltung.loadMaterial(course, request.params.materialId);
    await kursverwaltung.deleteMaterial(request.user, course, found.lesson, found.material, { confirm : !!input.query.confirm });
    audit('Kurs ' + course.id + ': Material ' + found.material.id + ' „' + found.material.name + '“ gelöscht');
  }),

  importSeries : endpoint({ scope : 'content:write', write : true, payload : 'importSeries', status : 201 }, async function(request, input, audit) {
    var course  = await kursverwaltung.loadCourse(request.params.courseId),
        created = await kursverwaltung.importSeries(request.user, course, input.payload);
    audit('Kurs ' + course.id + ': Reihe importiert (' + created.length + ' Lektionen)');
    return { lessons : created };
  }),

  // --- Teilnehmende (students:manage) --------------------------------------------------

  addStudent : endpoint({ scope : 'students:manage', write : true, payload : 'studentAdd' }, async function(request, input, audit) {
    var course = await kursverwaltung.loadCourse(request.params.courseId),
        result = await kursverwaltung.addStudent(request.user, course, input.payload.login);
    audit('Kurs ' + course.id + ': ' + (result.alreadyListed ? 'schon Mitglied ' : 'aufgenommen ') + (result.member ? result.member.username : input.payload.login));
    return result.alreadyListed ? result : this.reply(result).code(201);
  }),

  updateMember : endpoint({ scope : 'students:manage', write : true, payload : 'memberPatch' }, async function(request, input, audit) {
    var course = await kursverwaltung.loadCourse(request.params.courseId),
        member;
    kursverwaltung.requirePermission(request.user, 'manage-course-access', course);
    if (input.payload.role !== undefined) {
      member = await kursverwaltung.setRole(request.user, course, request.params.userId, input.payload.role);
      course = await kursverwaltung.loadCourse(course.id);
    }
    if (input.payload.onDashboard !== undefined) {
      member = await kursverwaltung.setOnDashboard(request.user, course, request.params.userId, input.payload.onDashboard);
    }
    audit('Kurs ' + course.id + ': Mitglied ' + request.params.userId + ' geändert (' + Object.keys(input.payload).join(', ') + ')');
    return { member : member };
  }),

  removeMember : endpoint({ scope : 'students:manage', write : true }, async function(request, input, audit) {
    var course = await kursverwaltung.loadCourse(request.params.courseId);
    await kursverwaltung.removeMember(request.user, course, request.params.userId);
    audit('Kurs ' + course.id + ': Mitglied ' + request.params.userId + ' entfernt');
  }),

  // --- Rückmeldungen (submissions:write) -----------------------------------------------

  sendFeedback : endpoint({ scope : 'submissions:write', write : true, payload : 'feedback' }, async function(request, input, audit) {
    var found      = await submissionFor(request),
        submission = found.submission,
        data       = input.payload;

    if (submission.submissionState === 'submittedLate') {
      throw Boom.conflict('Verspätete Abgabe: zuerst annehmen (POST /api/v1/trinkets/{id}/accept).');
    }
    if (['submitted', 'completed'].indexOf(submission.submissionState) < 0) {
      throw Boom.conflict('Diese Arbeit ist noch nicht abgegeben.');
    }

    // Ohne neue Überarbeitung bleiben eine vorhandene Überarbeitung und includeRevision erhalten
    // (umschalten nur, wenn es schon eine Überarbeitung gibt).
    var opts        = submission.submissionOpts || {},
        hasRevision = submission.submissionState === 'completed',
        include     = data.revision
          ? data.includeRevision !== false
          : (hasRevision ? (typeof data.includeRevision === 'boolean' ? data.includeRevision : !!opts.includeRevision) : false),
        saved = await rueckmeldung.sendFeedback(request.user, found.course, submission, {
          comments        : data.comment,
          allowResubmit   : typeof data.allowResubmit === 'boolean' ? data.allowResubmit : !!opts.allowResubmit,
          includeRevision : include,
          revision        : data.revision
            ? { code : trinkets.storedCode(submission.lang, data.revision), assets : submission.assets, settings : submission.settings }
            : null
        });
    audit('Rückmeldung zu Abgabe ' + saved.id + ' (Kurs ' + found.course.id + ')');
    return { trinket : lernstand.trinketDetail(saved) };
  }),

  saveFeedbackDraft : endpoint({ scope : 'submissions:write', write : true, payload : 'feedbackDraft' }, async function(request, input, audit) {
    var found = await submissionFor(request),
        saved = await rueckmeldung.saveFeedbackDraft(request.user, found.course, found.submission, input.payload.comment);
    audit('Entwurf der Rückmeldung zu Abgabe ' + saved.id);
    return { trinket : lernstand.trinketDetail(saved) };
  }),

  acceptSubmission : endpoint({ scope : 'submissions:write', write : true }, async function(request, input, audit) {
    var found = await submissionFor(request),
        saved = await rueckmeldung.acceptSubmission(request.user, found.course, found.submission, { strict : true });
    audit('Verspätete Abgabe ' + saved.id + ' angenommen');
    return { trinket : lernstand.trinketDetail(saved) };
  }),

  // --- Bibliothek (trinkets:write) -----------------------------------------------------

  createTrinket : endpoint({ scope : 'trinkets:write', write : true, payload : 'trinketCreate', status : 201 }, async function(request, input, audit) {
    var trinket = await trinkets.createLibraryTrinket(request.user, input.payload);
    audit('Trinket ' + trinket.id + ' (' + trinket.lang + ') angelegt');
    return { trinket : lernstand.trinketDetail(trinket) };
  }),

  updateTrinket : endpoint({ scope : 'trinkets:write', write : true, payload : 'trinketPatch' }, async function(request, input, audit) {
    var trinket = await trinkets.loadOwnTrinket(request.user, request.params.trinketId);
    trinket = await trinkets.updateLibraryTrinket(request.user, trinket, input.payload);
    audit('Trinket ' + trinket.id + ' geändert (' + Object.keys(input.payload).join(', ') + ')');
    return { trinket : lernstand.trinketDetail(trinket) };
  }),

  deleteTrinket : endpoint({ scope : 'trinkets:write', write : true }, async function(request, input, audit) {
    var trinket = await trinkets.loadOwnTrinket(request.user, request.params.trinketId);
    await trinkets.deleteLibraryTrinket(request.user, trinket);
    audit('Trinket ' + trinket.id + ' in den Papierkorb gelegt');
  })
};

module.exports.SCHEMAS = SCHEMAS;
