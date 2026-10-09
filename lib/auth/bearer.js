'use strict';

/**
 * Bearer-Token für die API /api/v1 (Trinket Lernix, Phase 3 / ADR 0004, Schreibrechte ADR 0006).
 *
 * - Token: "tl_" + 48 Hex-Zeichen, nur als SHA-256-Hash gespeichert.
 * - Wirksame Rechte = Token-Scopes ∩ Scopes, die die Rolle erlaubt (Muster Glossar ADR-0004).
 *   Verliert ein Konto die Lehrkraft-Rolle, verlieren seine Token damit sofort alle Rechte.
 * - Nur Lehrkräfte und Admins dürfen Token anlegen; SuS nicht.
 * - Die Hapi-Strategie "bearer" setzt request.user, request.apiToken und request.apiScopes.
 */

var crypto   = require('crypto'),
    Boom     = require('@hapi/boom'),
    mongoose = require('mongoose');

var SCOPES = {
  'courses:read'      : 'Kurse, Lektionen, Seiten, Aufgaben und Teilnehmende lesen',
  'submissions:read'  : 'Lernstand und Abgaben lesen',
  'trinkets:read'     : 'Code und Rückmeldungen einzelner Trinkets und Abgaben lesen (Blöcke auch als Python)',
  // Schreibrechte (ADR 0006)
  'courses:write'     : 'Kurse anlegen, ändern, kopieren, archivieren und löschen; IServ-Gruppe und Zugangscode verwalten',
  'content:write'     : 'Lektionen, Seiten und Aufgaben anlegen, ändern, sortieren, veröffentlichen/verbergen und löschen',
  'submissions:write' : 'Abgaben zurückgeben: Rückmeldungen schreiben, Entwürfe vorbereiten, verspätete Abgaben annehmen',
  'trinkets:write'    : 'Trinkets in deiner eigenen Bibliothek anlegen, ändern und löschen',
  'students:manage'   : 'Teilnehmende hinzufügen und entfernen, im Dashboard aus-/einblenden, Kursrollen ändern'
};

var WRITE_SCOPES = ['courses:write', 'content:write', 'submissions:write', 'trinkets:write', 'students:manage'];

var TOKEN_PREFIX       = 'tl_',
    PREFIX_LENGTH      = 11,               // "tl_" + 8 Zeichen zur Wiedererkennung
    LAST_USED_INTERVAL = 60 * 1000,        // lastUsedAt höchstens einmal pro Minute schreiben
    WRITE_WINDOW       = 60 * 1000,
    WRITE_LIMIT        = 120;              // Schreibzugriffe je Token und Minute (app.api.writeLimitPerMinute)

var writeCounters = new Map();

function ApiToken() {
  return global.ApiToken || require('../models/apiToken');
}

function RawToken() {
  ApiToken();
  return mongoose.model('ApiToken');
}

function hashOf(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function allowedScopesFor(user) {
  if (user && user.hasRole && (user.hasRole('teacher') || user.hasRole('admin'))) {
    return Object.keys(SCOPES);
  }
  return [];
}

function effectiveScopes(user, scopes) {
  var allowed = allowedScopesFor(user);
  return (scopes || []).filter(function(s) { return allowed.indexOf(s) >= 0; });
}

function canManage(user) {
  return allowedScopesFor(user).length > 0;
}

function serialize(doc) {
  return {
    id         : doc.id,
    name       : doc.name,
    prefix     : doc.prefix,
    scopes     : doc.scopes || [],
    created    : doc.created,
    lastUsedAt : doc.lastUsedAt || null,
    revokedAt  : doc.revokedAt || null,
    active     : !doc.revokedAt
  };
}

async function createToken(user, name, scopes) {
  if (!canManage(user)) {
    throw Boom.forbidden('API-Token können nur Lehrkräfte und Admins anlegen.');
  }

  scopes = Array.isArray(scopes) ? scopes : [];
  var unknown = scopes.filter(function(s) { return !SCOPES[s]; });
  if (unknown.length) {
    throw Boom.badRequest('Unbekannte Scopes: ' + unknown.join(', '));
  }
  if (!scopes.length) {
    throw Boom.badRequest('Mindestens ein Scope ist nötig.');
  }
  var allowed   = allowedScopesFor(user),
      forbidden = scopes.filter(function(s) { return allowed.indexOf(s) < 0; });
  if (forbidden.length) {
    throw Boom.forbidden('Diese Rechte hat deine Rolle nicht: ' + forbidden.join(', '));
  }

  var unique = scopes.filter(function(s, i) { return scopes.indexOf(s) === i; }),
      secret = TOKEN_PREFIX + crypto.randomBytes(24).toString('hex'),
      doc    = new (ApiToken())({
        _owner : user._id,
        name   : String(name).trim(),
        prefix : secret.substring(0, PREFIX_LENGTH),
        hash   : hashOf(secret),
        scopes : unique
      });

  await doc.save();
  return { token : doc, secret : secret };
}

function listTokens(user) {
  return ApiToken().findForUser(user._id);
}

async function revokeToken(user, tokenId) {
  var doc;
  try {
    doc = await RawToken().findOne({ _id : tokenId, _owner : user._id });
  } catch (e) {
    doc = null;
  }
  if (!doc) throw Boom.notFound('Token nicht gefunden.');

  if (!doc.revokedAt) {
    doc.revokedAt = new Date();
    await doc.save();
  }
  return doc;
}

/** Geheimnis prüfen → { user, token, scopes } oder Boom.unauthorized. */
async function verify(secret) {
  if (!secret || secret.indexOf(TOKEN_PREFIX) !== 0) {
    throw Boom.unauthorized('Ungültiges Token.', 'Bearer');
  }

  var doc = await ApiToken().findActiveByHash(hashOf(secret));
  if (!doc) {
    throw Boom.unauthorized('Token unbekannt oder widerrufen.', 'Bearer');
  }

  var User = global.User || require('../models/user'),
      user = await User.findById(doc._owner);

  if (!user || (user.hasRole && user.hasRole('disabled'))) {
    throw Boom.unauthorized('Das Konto zu diesem Token ist nicht verfügbar.', 'Bearer');
  }

  if (!doc.lastUsedAt || (Date.now() - doc.lastUsedAt.getTime()) > LAST_USED_INTERVAL) {
    RawToken().updateOne({ _id : doc._id }, { $set : { lastUsedAt : new Date() } }).exec().catch(function() {});
  }

  return { user : user, token : doc, scopes : effectiveScopes(user, doc.scopes) };
}

/** Hapi-Auth-Scheme "bearer" */
function scheme() {
  return function() {
    return {
      authenticate : async function(request, h) {
        var match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization || '');
        if (!match) {
          return h.unauthenticated(Boom.unauthorized('Bearer-Token fehlt.', 'Bearer'));
        }

        var result;
        try {
          result = await verify(match[1]);
        } catch (err) {
          return h.unauthenticated(err && err.isBoom ? err : Boom.unauthorized('Token ungültig.', 'Bearer'));
        }

        request.user      = result.user;
        request.apiToken  = result.token;
        request.apiScopes = result.scopes;

        return h.authenticated({
          credentials : result.user,
          artifacts   : { tokenId : result.token.id, scopes : result.scopes }
        });
      }
    };
  };
}

/** Für die Token-Seite: Scopes gruppiert, Lesen vorausgewählt, Schreiben nicht. */
function scopeGroups() {
  var all = Object.keys(SCOPES);
  function entries(list, checked) {
    return list.map(function(s) { return { name : s, description : SCOPES[s], checked : checked }; });
  }
  return [
    { title : 'Lesen',     scopes : entries(all.filter(function(s) { return WRITE_SCOPES.indexOf(s) < 0; }), true) },
    { title : 'Schreiben', scopes : entries(WRITE_SCOPES, false) }
  ];
}

function writeLimit() {
  var config = require('config'),
      value  = config.app && config.app.api && config.app.api.writeLimitPerMinute;
  return value > 0 ? value : WRITE_LIMIT;
}

/** Einfache Bremse je Token (im Speicher, pro Prozess); null oder Boom 429. */
function checkWriteRate(tokenId, now) {
  now = now || Date.now();
  var entry = writeCounters.get(tokenId);
  if (!entry || now - entry.start >= WRITE_WINDOW) {
    entry = { start : now, count : 0 };
    writeCounters.set(tokenId, entry);
  }
  if (++entry.count > writeLimit()) {
    var err = Boom.tooManyRequests('Zu viele Schreibzugriffe mit diesem Token. Bitte kurz warten.');
    err.output.headers['Retry-After'] = String(Math.ceil((entry.start + WRITE_WINDOW - now) / 1000));
    return err;
  }
  if (writeCounters.size > 10000) {
    writeCounters.forEach(function(v, k) { if (now - v.start >= WRITE_WINDOW) writeCounters.delete(k); });
  }
  return null;
}

/** Liefert null oder einen Boom-Fehler (Handler geben ihn zurück). */
function missingScope(request, scope) {
  if (!request.apiScopes || request.apiScopes.indexOf(scope) < 0) {
    return Boom.forbidden('Das Token hat den Scope "' + scope + '" nicht.');
  }
  return null;
}

module.exports = {
  SCOPES           : SCOPES,
  WRITE_SCOPES     : WRITE_SCOPES,
  scopeGroups      : scopeGroups,
  checkWriteRate   : checkWriteRate,
  TOKEN_PREFIX     : TOKEN_PREFIX,
  hashOf           : hashOf,
  allowedScopesFor : allowedScopesFor,
  effectiveScopes  : effectiveScopes,
  canManage        : canManage,
  serialize        : serialize,
  createToken      : createToken,
  listTokens       : listTokens,
  revokeToken      : revokeToken,
  verify           : verify,
  scheme           : scheme,
  missingScope     : missingScope
};
