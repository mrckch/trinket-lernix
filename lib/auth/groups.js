'use strict';

/**
 * IServ-Gruppen → Kurse (Trinket Lernix, Phase 2).
 *
 * Eine Lehrkraft verknüpft einen Kurs mit einer ihrer IServ-Gruppen
 * (course.externalLink = { source: 'iserv', sourceId: <act>, name }). Schülerinnen und Schüler
 * werden bei jedem Login anhand ihrer Gruppen-Claims eingetragen (joinedVia 'iserv') und wieder
 * ausgetragen, wenn die Gruppe weg ist. Wer über Access-Code, Einladung oder von Hand in einen
 * Kurs kam, bleibt davon unberührt. Lehrkräfte und Admins werden nie automatisch eingetragen.
 *
 * Die Gruppen der SuS werden nie gespeichert, nur in der Session gehalten (ADR 0002). Ausnahme
 * für die Token-API (ADR 0006): Lehrkräfte und Admins behalten die eigene Liste (nur act + name)
 * vom letzten Login am Konto; bei allen anderen wird sie beim Login entfernt ($unset).
 */

var mongoose = require('mongoose');

var SESSION_KEY = 'iservGroups';

function RawCourse() {
  if (!global.Course) require('../models/course');
  return mongoose.model('Course');
}

function logger() {
  return global.log || console;
}

function fromSession(request) {
  var groups = request.yar ? request.yar.get(SESSION_KEY) : null;
  return Array.isArray(groups) ? groups : [];
}

function storeInSession(request, groups) {
  request.yar.set(SESSION_KEY, Array.isArray(groups) ? groups : []);
}

function acts(groups) {
  return (groups || []).map(function(g) { return g && g.act; }).filter(Boolean);
}

function findInSession(request, act) {
  return fromSession(request).filter(function(g) { return g.act === act; })[0] || null;
}

/** Darf diese Person einen Kurs mit der Gruppe verknüpfen? Admins immer, sonst nur eigene Gruppen. */
function canLink(request, act) {
  if (request.user && request.user.hasRole('admin')) return true;
  return !!findInSession(request, act);
}

/** Nur reine SuS-Konten werden automatisch zugeordnet. */
function isStudent(user) {
  return user.hasRole('student') && !user.hasRole('teacher') && !user.hasRole('admin');
}

function isTeacherOrAdmin(user) {
  return !!(user && user.hasRole && (user.hasRole('teacher') || user.hasRole('admin')));
}

function RawUser() {
  if (!global.User) require('../models/user');
  return mongoose.model('User');
}

/**
 * Token-API (ADR 0006): Die Token-API hat keine Session. Damit Lehrkräfte auch per Token Kurse
 * mit ihren Gruppen verknüpfen können, merkt sich das Konto einer Lehrkraft (nur Kennung + Name)
 * die Gruppen vom letzten Login. SuS-Konten speichern nie Gruppen; wer keine Lehrkraft mehr ist,
 * verliert die Liste beim nächsten Login.
 */
async function rememberTeacherGroups(user, groups) {
  if (!user || !user._id) return;
  var update = isTeacherOrAdmin(user)
    ? { $set : { 'iserv.groups' : (groups || []).filter(function(g) { return g && g.act; }).map(function(g) { return { act : String(g.act), name : String(g.name || g.act) }; }), 'iserv.groupsAt' : new Date() } }
    : { $unset : { 'iserv.groups' : '', 'iserv.groupsAt' : '' } };
  await RawUser().updateOne({ _id : user._id }, update).exec();
  if (user.iserv && update.$set) {
    user.iserv.groups   = update.$set['iserv.groups'];
    user.iserv.groupsAt = update.$set['iserv.groupsAt'];
  }
}

/** Gespeicherte Gruppen einer Lehrkraft (für Token-Zugriffe). */
function storedGroups(user) {
  if (!isTeacherOrAdmin(user)) return [];
  var list = user.iserv && user.iserv.groups;
  return (list || []).map(function(g) { return { act : g.act, name : g.name || g.act }; });
}

/** Wie canLink, aber ohne Session: Admins immer, Lehrkräfte nur eigene (gespeicherte) Gruppen. */
function canLinkStored(user, act) {
  if (user && user.hasRole && user.hasRole('admin')) return true;
  return storedGroups(user).some(function(g) { return g.act === act; });
}

/**
 * Dev-Login: "klasse.9b:Klasse 9b, ag.robotik:AG Robotik" → [{ act, name }]
 */
function parseDevGroups(text) {
  return String(text || '')
    .split(',')
    .map(function(part) { return part.trim(); })
    .filter(Boolean)
    .map(function(part) {
      var idx  = part.indexOf(':'),
          act  = (idx >= 0 ? part.substring(0, idx) : part).trim(),
          name = (idx >= 0 ? part.substring(idx + 1) : part).trim();
      return { act : act || name, name : name || act };
    });
}

/**
 * Kursmitgliedschaften einer SuS anhand der aktuellen IServ-Gruppen angleichen.
 * @returns {Promise<{joined: string[], left: string[]}>} Kursnamen
 */
async function syncStudentMembership(user, groups) {
  var result = { joined : [], left : [] };

  if (!user || !isStudent(user)) return result;

  var myActs = acts(groups),
      Course = RawCourse();

  if (myActs.length) {
    var toJoin = await Course.find({
      'externalLink.source'   : 'iserv',
      'externalLink.sourceId' : { $in : myActs },
      archived                : { $ne : true }
    });

    for (var i = 0; i < toJoin.length; i++) {
      var course = toJoin[i];
      if (user.inCourse(course.id)) continue;
      var added = await course.addUser(user, ['course-student'], { via : 'iserv' });
      if (added && added.success) result.joined.push(course.name);
    }
  }

  var current = await Course.find({
    'externalLink.source' : 'iserv',
    users : { $elemMatch : { userId : user._id, joinedVia : 'iserv' } }
  });

  for (var j = 0; j < current.length; j++) {
    var member = current[j];
    if (myActs.indexOf(member.externalLink.sourceId) < 0) {
      await member.removeUser(user);
      result.left.push(member.name);
    }
  }

  if (result.joined.length || result.left.length) {
    logger().info('IServ-Gruppen: ' + user.username
      + (result.joined.length ? ' eingetragen in ' + result.joined.join(', ') : '')
      + (result.left.length ? ' ausgetragen aus ' + result.left.join(', ') : ''));
  }

  return result;
}

module.exports = {
  SESSION_KEY           : SESSION_KEY,
  fromSession           : fromSession,
  storeInSession        : storeInSession,
  findInSession         : findInSession,
  canLink               : canLink,
  rememberTeacherGroups : rememberTeacherGroups,
  storedGroups          : storedGroups,
  canLinkStored         : canLinkStored,
  isStudent             : isStudent,
  parseDevGroups        : parseDevGroups,
  syncStudentMembership : syncStudentMembership
};
