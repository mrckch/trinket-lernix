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
 * Die Gruppen selbst werden nicht gespeichert, nur in der Session gehalten (ADR 0002).
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
  isStudent             : isStudent,
  parseDevGroups        : parseDevGroups,
  syncStudentMembership : syncStudentMembership
};
