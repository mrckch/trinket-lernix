'use strict';

/**
 * Kursverwaltung für die Token-API (Trinket Lernix, ADR 0006).
 *
 * Schreibt dieselben Daten wie die Kurs-Oberfläche (lib/controllers/course.js): gleiche Modelle,
 * gleiche Modellmethoden (addUser, setGlobalSettings, setDates, copy, updateView, updateRole …),
 * gleiche Kursrechte (update-course-details, manage-course-content, manage-course-access,
 * delete-course, Rolle course-owner fürs Archivieren). Keine HTTP-Logik; Fehler als Boom.
 */

var mongoose = require('mongoose'),
    Boom     = require('@hapi/boom'),
    groups   = require('../auth/groups'),
    trinkets = require('./trinkets');

var DATE_FIELDS  = ['submissionsDue', 'submissionsCutoff', 'availableOn', 'hideAfter'],
    MEMBER_ROLES = ['student', 'collaborator', 'admin', 'associate'];

function Raw(name) { return mongoose.model(name); }
function Model(name, file) { return global[name] || require('../models/' + file); }

var isId = trinkets.isId;

function same(a, b) { return String(a) === String(b); }

function can(user, permission, course) {
  return !!user.hasPermission(permission, 'course', { id : String(course._id) });
}

function requirePermission(user, permission, course, message) {
  if (!can(user, permission, course)) throw Boom.forbidden(message || 'Dafür fehlt dir das Recht in diesem Kurs.');
}

function duplicateName(err) {
  if (err && err.code === 11000) return Boom.conflict('Du hast schon einen Kurs mit diesem Namen. Bitte wähle einen anderen.');
  return err;
}

/** Zugangscode wie in der Oberfläche (6 Zeichen ohne verwechselbare Zeichen). */
function generateAccessCode() {
  var code = [], possible = 'ABCDEFGHJKLMNPRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  for (var i = 0; i < 6; i++) code.push(possible.charAt(Math.floor(Math.random() * possible.length)));
  return code.join('');
}

// --- Laden mit sauberem 404 (statt CastError → 500) ---

async function loadCourse(id) {
  var course = isId(id) ? await Raw('Course').findById(id) : null;
  if (!course) throw Boom.notFound('Kurs nicht gefunden.');
  return course;
}

async function loadLesson(course, lessonId) {
  if (!isId(lessonId) || !(course.lessons || []).some(function(id) { return same(id, lessonId); })) {
    throw Boom.notFound('Lektion nicht in diesem Kurs.');
  }
  var lesson = await Raw('Lesson').findById(lessonId);
  if (!lesson) throw Boom.notFound('Lektion nicht gefunden.');
  return lesson;
}

/** Material samt Lektion, in der es liegt (nur Lektionen dieses Kurses). */
async function loadMaterial(course, materialId) {
  if (!isId(materialId)) throw Boom.notFound('Material nicht gefunden.');
  var lesson = await Raw('Lesson').findOne({ _id : { $in : course.lessons || [] }, materials : materialId });
  if (!lesson) throw Boom.notFound('Material nicht in diesem Kurs.');
  var material = await Raw('Material').findById(materialId);
  if (!material) throw Boom.notFound('Material nicht gefunden.');
  return { lesson : lesson, material : material };
}

// --- Kurse ---

async function createCourse(user, data) {
  var courseType = data.courseType || 'public',
      needed     = courseType === 'private' ? 'create-private-course' : 'create-public-course';
  if (!user.hasPermission(needed) && !user.hasPermission('create-private-course')) {
    throw Boom.forbidden('Kurse können nur Lehrkräfte anlegen.');
  }

  var Course = Model('Course', 'course'),
      course = new Course({ name : data.name, description : data.description });

  course.setOwner(user);
  course.ownerSlug = user.username;
  course.setGlobalSettings({ courseType : data.courseType, contentDefault : data.contentDefault });

  if (data.iservGroup) {
    course.setIservGroup(linkableGroup(user, data.iservGroup));
  }

  try {
    await course.save();
  } catch (err) {
    throw duplicateName(err);
  }
  await course.addUser(user, ['course-owner']);
  return Raw('Course').findById(course._id);
}

function linkableGroup(user, group) {
  if (!groups.canLinkStored(user, group.act)) {
    throw Boom.forbidden('Du bist in IServ nicht Mitglied dieser Gruppe (oder hast dich seit dem Update nicht neu angemeldet).');
  }
  var known = groups.storedGroups(user).filter(function(g) { return g.act === group.act; })[0];
  return { act : group.act, name : group.name || (known && known.name) || group.act };
}

async function updateCourse(user, course, patch) {
  var details = ['name', 'description', 'courseType', 'contentDefault'].filter(function(k) { return patch[k] !== undefined; });

  if (details.length) {
    requirePermission(user, 'update-course-details', course);
    if (patch.name !== undefined) course.name = patch.name;
    if (patch.description !== undefined) course.description = patch.description;
    var current = course.globalSettings || {};
    course.setGlobalSettings({
      courseType     : patch.courseType !== undefined ? patch.courseType : current.courseType,
      contentDefault : patch.contentDefault !== undefined ? patch.contentDefault : current.contentDefault,
      copyable       : current.copyable
    });
  }

  if (patch.archived !== undefined) {
    if (!user.hasRole('course-owner', 'course', { id : String(course._id) })) {
      throw Boom.forbidden('Archivieren darf nur die Kursleitung.');
    }
    course.archived = patch.archived;
  }

  try {
    return await course.save();
  } catch (err) {
    throw duplicateName(err);
  }
}

async function deleteCourse(user, course) {
  requirePermission(user, 'delete-course', course, 'Löschen darf nur die Kursleitung.');
  await course.deleteCourse();
}

/**
 * Kopie wie „Kurs kopieren“ (course.copy). Strenger als die Oberfläche: per Token nur Kurse, deren
 * Inhalte die Person bearbeiten darf (oder mit Kopierrecht), nie fremde Kurse (ADR 0006).
 */
async function copyCourse(user, course, name) {
  if (!can(user, 'manage-course-content', course) && !can(user, 'make-course-copy', course)) {
    throw Boom.forbidden('Diesen Kurs darfst du per Token nicht kopieren.');
  }
  if (!user.hasPermission('create-private-course') && !user.hasPermission('create-public-course')) {
    throw Boom.forbidden('Kurse können nur Lehrkräfte anlegen.');
  }

  course.name = name;
  var copy = await new Promise(function(resolve, reject) {
    var timer = setTimeout(function() { reject(Boom.badImplementation('Kopieren dauert zu lange.')); }, 120 * 1000);
    course.copy(user, function(err, doc) {
      clearTimeout(timer);
      if (err) return reject(duplicateName(err));
      resolve(doc);
    });
  });
  await copy.addUser(user, ['course-owner']);
  return Raw('Course').findById(copy._id);
}

async function setIservGroup(user, course, group) {
  requirePermission(user, 'manage-course-access', course);
  course.setIservGroup(group && group.act ? linkableGroup(user, group) : null);
  return course.save();
}

function accessCode(user, course) {
  requirePermission(user, 'manage-course-access', course);
  return course.accessCode || '';
}

async function rotateAccessCode(user, course) {
  requirePermission(user, 'manage-course-access', course);
  course.accessCode = generateAccessCode();
  await course.save();
  return course.accessCode;
}

// --- Lektionen ---

function clampIndex(index, length) {
  return Math.max(0, Math.min(length, typeof index === 'number' ? index : length));
}

async function addLesson(user, course, data) {
  requirePermission(user, 'manage-course-content', course);

  var Lesson = Model('Lesson', 'lesson'),
      lesson = new Lesson({ name : data.name });

  lesson.setOwner(user);
  if (course.globalSettings && course.globalSettings.contentDefault === 'draft') lesson.isDraft = true;
  if (typeof data.isDraft === 'boolean') lesson.isDraft = data.isDraft;

  lesson = await lesson.save();
  course.lessons.splice(clampIndex(data.index, course.lessons.length), 0, lesson._id);
  await course.save();
  return lesson;
}

async function updateLesson(user, course, lesson, patch) {
  requirePermission(user, 'manage-course-content', course);
  if (patch.name !== undefined) lesson.name = patch.name;
  if (patch.isDraft !== undefined) lesson.isDraft = patch.isDraft;
  return lesson.save();
}

async function deleteLesson(user, course, lesson) {
  requirePermission(user, 'manage-course-content', course);
  await lesson.remove();
  course.lessons.pull(lesson._id);
  await course.save();
}

function assertPermutation(current, wanted, what) {
  var a = current.map(String).sort(), b = wanted.map(String).sort();
  if (a.length !== b.length || a.some(function(id, i) { return id !== b[i]; })) {
    throw Boom.badRequest('Die Liste muss genau die ' + what + ' enthalten (jede einmal).');
  }
}

async function reorderLessons(user, course, lessonIds) {
  requirePermission(user, 'manage-course-content', course);
  assertPermutation(course.lessons || [], lessonIds, 'Lektionen des Kurses');
  course.lessons = lessonIds;
  await course.save();
  return course;
}

// --- Seiten und Aufgaben ---

/** API-Datum (ISO-Text oder null) + vorhandene Werte → Eingabe für material.setDates() */
function mergedDates(material, patch) {
  var out = {};
  DATE_FIELDS.forEach(function(field) {
    var current = material.trinket && material.trinket[field];
    if (patch[field] !== undefined) {
      out[field + 'Enabled'] = patch[field] !== null;
      out[field]             = patch[field] !== null ? new Date(patch[field]) : undefined;
    } else {
      out[field + 'Enabled'] = !!(current && current.enabled);
      out[field]             = current && current.dateValue ? current.dateValue : undefined;
    }
  });
  return out;
}

function checkDates(dates) {
  function at(field) { return dates[field + 'Enabled'] && dates[field] ? new Date(dates[field]).getTime() : null; }
  if (dates.submissionsCutoffEnabled && !dates.submissionsDueEnabled) {
    throw Boom.badRequest('Ein Abgabeschluss (submissionsCutoff) braucht eine Fälligkeit (submissionsDue).');
  }
  if (at('submissionsCutoff') !== null && at('submissionsDue') !== null && at('submissionsCutoff') < at('submissionsDue')) {
    throw Boom.badRequest('Der Abgabeschluss liegt vor der Fälligkeit.');
  }
  if (at('hideAfter') !== null && at('availableOn') !== null && at('hideAfter') <= at('availableOn')) {
    throw Boom.badRequest('„Verstecken nach“ muss nach „Sichtbar ab“ liegen.');
  }
}

function setTrinketMeta(material, trinket) {
  material.trinket = {
    trinketId : trinket._id,
    name      : trinket.name,
    lang      : trinket.lang,
    shortCode : trinket.shortCode
  };
}

/** Vorlage einer Aufgabe: eigenes Bibliotheks-Trinket oder neues leeres mit Startcode. */
async function starterTrinket(user, name, starter, current) {
  if (starter.trinketId) {
    return trinkets.loadOwnTrinket(user, starter.trinketId);
  }

  var lang = starter.lang || (current && current.lang);
  if (!lang) throw Boom.badRequest('Für die Vorlage fehlt „lang“.');
  trinkets.assertLang(user, lang);

  if (current && current.lang === lang && trinkets.ownsTrinket(user, current)) {
    if (starter.code !== undefined || starter.files !== undefined) {
      current.code = trinkets.storedCode(lang, starter);
      await current.save();
    }
    return current;
  }

  var blank = Model('Trinket', 'trinket').createBlankForAssignment(user, name, lang);
  blank.code = trinkets.storedCode(lang, starter);
  return blank.save();
}

async function createMaterial(user, course, lesson, data) {
  requirePermission(user, 'manage-course-content', course);

  var Material = Model('Material', 'material'),
      material = new Material({ name : data.name, type : data.type, content : data.content });

  material.setOwner(user);

  if (data.type === 'assignment') {
    var dates = mergedDates({}, data);
    checkDates(dates);
    var trinket = await starterTrinket(user, data.name, data.starter || { lang : 'python' }, null);
    setTrinketMeta(material, trinket);
    material.setDates(dates);
  }

  if (course.globalSettings && course.globalSettings.contentDefault === 'draft') material.isDraft = true;
  if (typeof data.isDraft === 'boolean') material.isDraft = data.isDraft;

  material = await material.save();
  lesson.materials.splice(clampIndex(data.index, lesson.materials.length), 0, material._id);
  await lesson.save();
  return material;
}

async function updateMaterial(user, course, material, patch) {
  requirePermission(user, 'manage-course-content', course);

  if (material.type !== 'assignment') {
    var assignmentOnly = DATE_FIELDS.concat(['starter']).filter(function(k) { return patch[k] !== undefined; });
    if (assignmentOnly.length) throw Boom.badRequest('Nur Aufgaben haben ' + assignmentOnly.join(', ') + '.');
  }

  if (patch.name !== undefined) material.name = patch.name;
  if (patch.content !== undefined) material.content = patch.content;
  if (patch.isDraft !== undefined) material.isDraft = patch.isDraft;

  if (material.type === 'assignment') {
    var dates = mergedDates(material, patch);
    checkDates(dates);

    if (patch.starter) {
      var current = material.trinket && material.trinket.trinketId
            ? await Raw('Snippet').findOne({ _id : material.trinket.trinketId, deletedAt : null })
            : null,
          trinket = await starterTrinket(user, material.name, patch.starter, current);
      setTrinketMeta(material, trinket);
    }
    material.setDates(dates);
    material.markModified('trinket');
  }

  return material.save();
}

async function deleteMaterial(user, course, lesson, material) {
  requirePermission(user, 'manage-course-content', course);
  await material.remove();
  lesson.materials.pull(material._id);
  await lesson.save();
}

/** Reihenfolge einer Lektion setzen; Materialien anderer Lektionen desselben Kurses werden verschoben. */
async function reorderMaterials(user, course, lesson, materialIds) {
  requirePermission(user, 'manage-course-content', course);

  var wanted = materialIds.map(String);
  if (wanted.some(function(id, i) { return wanted.indexOf(id) !== i; })) {
    throw Boom.badRequest('Material doppelt in der Liste.');
  }
  var missing = (lesson.materials || []).map(String).filter(function(id) { return wanted.indexOf(id) < 0; });
  if (missing.length) {
    throw Boom.badRequest('Die Liste muss alle Materialien der Lektion enthalten (fehlend: ' + missing.join(', ') + ').');
  }

  var foreign = wanted.filter(function(id) { return !(lesson.materials || []).some(function(m) { return same(m, id); }); }),
      others  = foreign.length
        ? await Raw('Lesson').find({ _id : { $in : course.lessons, $ne : lesson._id }, materials : { $in : foreign } })
        : [];

  foreign.forEach(function(id) {
    if (!others.some(function(l) { return l.materials.some(function(m) { return same(m, id); }); })) {
      throw Boom.badRequest('Material ' + id + ' gehört nicht zu diesem Kurs.');
    }
  });

  for (var i = 0; i < others.length; i++) {
    foreign.forEach(function(id) { others[i].materials.pull(id); });
    await others[i].save();
  }
  lesson.materials = wanted;
  return lesson.save();
}

/** Ganze Reihe importieren: Lektionen mit Seiten und Aufgaben nacheinander anlegen. */
async function importSeries(user, course, data) {
  requirePermission(user, 'manage-course-content', course);

  var created = [];
  for (var i = 0; i < data.lessons.length; i++) {
    var spec   = data.lessons[i],
        lesson = await addLesson(user, course, { name : spec.name, isDraft : spec.isDraft }),
        entry  = { id : lesson.id, name : lesson.name, materials : [] };

    created.push(entry);
    for (var j = 0; j < (spec.materials || []).length; j++) {
      var material = await createMaterial(user, course, lesson, spec.materials[j]);
      entry.materials.push({ id : material.id, name : material.name, type : material.type });
    }
  }
  return created;
}

// --- Teilnehmende ---

function memberEntry(course, userId) {
  return (course.users || []).filter(function(u) { return same(u.userId, userId); })[0] || null;
}

function isOwnerEntry(entry) {
  return (entry.roles || []).indexOf('course-owner') >= 0;
}

function memberSummary(course, u) {
  var role = (u.roles || [])[0] || '';
  return {
    id          : String(u.userId),
    username    : u.username,
    name        : u.displayName,
    email       : u.email,
    role        : role.replace(/^course-/, ''),
    joinedVia   : u.joinedVia || null,
    onDashboard : !course.userHiddenFromDashboard(u),
    deleted     : !!u.deleted
  };
}

function members(user, course) {
  requirePermission(user, 'manage-course-access', course);
  return (course.users || []).map(function(u) { return memberSummary(course, u); });
}

async function addStudent(user, course, login) {
  requirePermission(user, 'manage-course-access', course);

  var User   = Model('User', 'user'),
      person = await User.findByLogin(String(login).trim());
  if (!person) throw Boom.notFound('Kein Konto mit diesem Benutzernamen oder dieser E-Mail-Adresse.');

  var result = await course.addUser(person, ['course-student'], { via : 'manual' }),
      fresh  = await Raw('Course').findById(course._id),
      entry  = memberEntry(fresh, person._id);

  return { member : entry ? memberSummary(fresh, entry) : null, alreadyListed : !!result.alreadyListed };
}

function assertManageable(user, course, userId) {
  var entry = memberEntry(course, userId);
  if (!entry) throw Boom.notFound('Diese Person ist nicht im Kurs.');
  if (same(userId, user._id)) throw Boom.conflict('Dich selbst kannst du so nicht ändern.');
  if (isOwnerEntry(entry)) throw Boom.conflict('Die Kursleitung kann so nicht geändert werden.');
  return entry;
}

async function removeMember(user, course, userId) {
  requirePermission(user, 'manage-course-access', course);
  assertManageable(user, course, userId);

  var person = await Model('User', 'user').findById(userId);
  if (person) {
    await course.removeUser(person);
  } else {
    await course.removeDeletedUser(userId);
  }
}

async function setOnDashboard(user, course, userId, onDashboard) {
  requirePermission(user, 'manage-course-access', course);
  var entry = memberEntry(course, userId);
  if (!entry) throw Boom.notFound('Diese Person ist nicht im Kurs.');

  var hidden = (entry.hideFrom || []).indexOf('dashboard') >= 0;
  if (onDashboard && hidden) await course.updateView(userId, 'dashboard', 'show');
  if (!onDashboard && !hidden) await course.updateView(userId, 'dashboard', 'hide');

  var fresh = await Raw('Course').findById(course._id);
  return memberSummary(fresh, memberEntry(fresh, userId));
}

async function setRole(user, course, userId, role) {
  requirePermission(user, 'manage-course-access', course);
  if (MEMBER_ROLES.indexOf(role) < 0) throw Boom.badRequest('Unbekannte Rolle.');
  assertManageable(user, course, userId);

  var person = await Model('User', 'user').findById(userId);
  if (!person) throw Boom.notFound('Das Konto gibt es nicht mehr.');
  await course.updateRole(person, 'course-' + role);

  var fresh = await Raw('Course').findById(course._id);
  return memberSummary(fresh, memberEntry(fresh, userId));
}

module.exports = {
  DATE_FIELDS        : DATE_FIELDS,
  MEMBER_ROLES       : MEMBER_ROLES,
  generateAccessCode : generateAccessCode,
  can                : can,
  requirePermission  : requirePermission,
  loadCourse         : loadCourse,
  loadLesson         : loadLesson,
  loadMaterial       : loadMaterial,
  createCourse       : createCourse,
  updateCourse       : updateCourse,
  deleteCourse       : deleteCourse,
  copyCourse         : copyCourse,
  setIservGroup      : setIservGroup,
  accessCode         : accessCode,
  rotateAccessCode   : rotateAccessCode,
  addLesson          : addLesson,
  updateLesson       : updateLesson,
  deleteLesson       : deleteLesson,
  reorderLessons     : reorderLessons,
  createMaterial     : createMaterial,
  updateMaterial     : updateMaterial,
  deleteMaterial     : deleteMaterial,
  reorderMaterials   : reorderMaterials,
  importSeries       : importSeries,
  memberSummary      : memberSummary,
  members            : members,
  addStudent         : addStudent,
  removeMember       : removeMember,
  setOnDashboard     : setOnDashboard,
  setRole            : setRole
};
