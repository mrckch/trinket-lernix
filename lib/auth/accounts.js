'use strict';

/**
 * Konten und Site-Rollen für Trinket Lernix (Phase 1).
 *
 * Site-Rollen (Kontext "site"):
 *   student  – IServ-Konto, nicht als Lehrkraft erkannt (Default, die vorsichtige Richtung)
 *   teacher  – IServ-Konto mit Lehrkraft-Marker in Rollen oder Gruppen
 *   admin    – nur in der App vergeben, nie aus IServ; bleibt bei jedem Login erhalten
 *
 * Die Grundrolle (student/teacher) wird bei JEDEM IServ-Login neu bestimmt, damit ein
 * Wechsel in IServ sofort greift. Kursrollen (course-owner, course-student …) bleiben unberührt.
 */

var config   = require('config'),
    bcrypt   = require('bcrypt'),
    userUtil = require('../util/user'),
    Roles    = require('../models/roles'),
    iserv    = require('./iserv');

var BASE_ROLES = ['student', 'teacher', 'user'];   // 'user' = Altbestand aus trinket-oss
var USERNAME_MAX = 20;

function logger() {
  return global.log || console;
}

function authMode() {
  return (config.app && config.app.auth && config.app.auth.mode) || 'iserv';
}

function userModel() {
  // Öffentliches Modell (Konstruktor + Klassenmethoden), wie im restlichen Code
  return global.User || require('../models/user');
}

function RawUser() {
  // Rohes Mongoose-Modell für Abfragen (findOne, deleteMany …) – das öffentliche
  // Modell aus lib/models/model.js stellt nur findById und Klassenmethoden bereit.
  userModel();
  return require('mongoose').model('User');
}

/** Gültigen, freien Benutzernamen aus einer Vorlage (IServ-Account, E-Mail-Teil) bilden. */
async function uniqueUsername(base) {
  var User = RawUser();
  var name = userUtil.generate_username(String(base || 'nutzer'))
    .replace(/^[-_]+|[-_]+$/g, '');

  if (!/^[a-z]/.test(name)) name = 'u' + name;
  if (name.length < 3) name = name + '-user';
  name = name.substring(0, USERNAME_MAX);

  if (!(await User.findOne({ username : name }).select('_id').lean())) {
    return name;
  }

  var stem = name.substring(0, USERNAME_MAX - 5);
  for (var i = 0; i < 10; i++) {
    var candidate = userUtil.generate_username_with_suffix(stem);
    if (!(await User.findOne({ username : candidate }).select('_id').lean())) {
      return candidate;
    }
  }
  throw new Error('Kein freier Benutzername für "' + base + '" gefunden.');
}

/**
 * Site-Kontext komplett neu setzen (Rollen + daraus abgeleitete Rechte).
 * Umgeht grant()/revoke() aus dem Rollen-Plugin, die auf Abo-Laufzeiten (thru/limits)
 * ausgelegt sind und bei fehlenden Rechten falsche Einträge entfernen.
 */
async function setSiteRoles(user, roles) {
  var unique = [], permissions = [];

  for (var i = 0; i < roles.length; i++) {
    if (unique.indexOf(roles[i]) < 0) unique.push(roles[i]);
  }
  for (var j = 0; j < unique.length; j++) {
    var perms = await Roles.getPermissions(unique[j]);
    perms.forEach(function(p) { if (permissions.indexOf(p) < 0) permissions.push(p); });
  }

  var entry = { context : 'site', roles : unique, permissions : permissions, thru : {}, limits : {} };
  var index = -1;
  for (var k = 0; k < user.roles.length; k++) {
    if (user.roles[k].context === 'site') { index = k; break; }
  }
  if (index >= 0) user.roles[index] = entry;
  else user.roles.push(entry);

  user.markModified('roles');
  return user;
}

/** Grundrolle setzen, in der App vergebene Zusatzrollen (admin) behalten. */
async function applyBaseRole(user, base) {
  var site = user.getByContext('site');
  var keep = site ? site.roles.filter(function(r) { return BASE_ROLES.indexOf(r) < 0; }) : [];
  return setSiteRoles(user, keep.concat([base]));
}

/** Rolle aus den IServ-Claims: Lehrkraft nur mit Marker, sonst SuS. */
function baseRoleFromClaims(claims) {
  return iserv.looksLikeTeacher(claims, iserv.teacherMarkers()) ? 'teacher' : 'student';
}

/**
 * Konto beim ersten IServ-Login anlegen, sonst aktualisieren. Verknüpfung über die
 * IServ-UUID; ein Altkonto mit gleicher E-Mail wird einmalig übernommen.
 * @returns {Promise<{user, role, created}>}
 */
async function upsertFromClaims(claims) {
  var User    = userModel(),
      subject = iserv.subjectOf(claims);

  if (!subject) {
    throw new iserv.IServError(
      'IServ hat keine Kennung übermittelt (gelieferte Angaben: ' + iserv.claimKeys(claims) + '). Fehlt der Scope iserv:uuid?',
      'iserv_daten'
    );
  }

  var base     = baseRoleFromClaims(claims),
      email    = iserv.emailOf(claims),
      account  = iserv.accountOf(claims),
      fullname = iserv.displayNameOf(claims),
      created  = false;

  var user = await RawUser().findOne({ 'iserv.uuid' : subject });

  if (!user && email) {
    user = await RawUser().findOne({ email : email });
  }

  if (!user) {
    user = new User({
      email    : email || (account || subject) + '@iserv.invalid',
      fullname : fullname,
      name     : fullname,
      username : await uniqueUsername(account || (email ? email.split('@')[0] : 'nutzer')),
      source   : 'iserv',
      verified : true,
      iserv    : { uuid : subject, account : account }
    });
    created = true;
  }
  else {
    user.iserv    = { uuid : subject, account : account || (user.iserv && user.iserv.account) || '' };
    user.source   = 'iserv';
    user.verified = true;
    if (fullname) {
      user.fullname = fullname;
      user.name     = fullname;
    }
    if (email && email !== user.email) {
      var other = await RawUser().findOne({ email : email }).select('_id').lean();
      if (!other) user.email = email;
      else logger().warn('IServ-Login: E-Mail ' + email + ' gehört bereits einem anderen Konto; bleibt bei ' + user.email);
    }
  }

  await applyBaseRole(user, base);
  await user.save();

  return { user : user, role : base, created : created };
}

/** Test-Anmeldung ohne IServ (nur AUTH_MODE=dev). */
async function devLogin(payload) {
  var User  = userModel(),
      email = String(payload.email || '').trim().toLowerCase(),
      role  = payload.role || 'student',
      user  = await RawUser().findOne({ email : email });

  if (!user) {
    user = new User({
      email    : email,
      fullname : payload.fullname,
      name     : payload.fullname,
      username : await uniqueUsername(email.split('@')[0]),
      source   : 'dev',
      verified : true
    });
  }
  else if (payload.fullname) {
    user.fullname = payload.fullname;
    user.name     = payload.fullname;
  }

  await setSiteRoles(user, role === 'admin' ? ['admin', 'teacher'] : [role]);
  await user.save();
  return user;
}

function isBreakglass(user) {
  return !!(user && user.source === 'breakglass');
}

function comparePassword(user, password) {
  return new Promise(function(resolve) {
    if (!user.password) return resolve(false);
    bcrypt.compare(password, user.password, function(err, match) { resolve(!err && match); });
  });
}

/**
 * Lokalen Notfall-Admin aus BREAKGLASS_EMAIL/BREAKGLASS_PASSWORD anlegen oder aktualisieren.
 * Wird beim Start aufgerufen; ohne Konfiguration passiert nichts.
 */
async function ensureBreakglass() {
  var bg = (config.app && config.app.auth && config.app.auth.breakglass) || {};
  if (!bg.email || !bg.password) return null;

  var User  = userModel(),
      email = String(bg.email).trim().toLowerCase(),
      user  = await RawUser().findOne({ email : email }),
      changed = false;

  if (!user) {
    user = new User({
      email    : email,
      fullname : 'Notfall-Admin',
      name     : 'Notfall-Admin',
      username : await uniqueUsername('notfall-admin'),
      password : bg.password,
      source   : 'breakglass',
      verified : true
    });
    await setSiteRoles(user, ['admin', 'teacher']);
    await user.save();
    logger().info('Notfall-Admin angelegt: ' + email);
    return user;
  }

  if (user.source !== 'breakglass') { user.source = 'breakglass'; changed = true; }
  if (!user.hasRole('admin')) {
    var site = user.getByContext('site');
    await setSiteRoles(user, (site ? site.roles : []).concat(['admin', 'teacher']));
    changed = true;
  }
  if (!(await comparePassword(user, bg.password))) { user.password = bg.password; changed = true; }

  if (changed) {
    await user.save();
    logger().info('Notfall-Admin aktualisiert: ' + email);
  }
  return user;
}

module.exports = {
  authMode           : authMode,
  uniqueUsername     : uniqueUsername,
  setSiteRoles       : setSiteRoles,
  applyBaseRole      : applyBaseRole,
  baseRoleFromClaims : baseRoleFromClaims,
  upsertFromClaims   : upsertFromClaims,
  devLogin           : devLogin,
  isBreakglass       : isBreakglass,
  ensureBreakglass   : ensureBreakglass
};
