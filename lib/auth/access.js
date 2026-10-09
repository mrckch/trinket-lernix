'use strict';

/**
 * Login-Pflicht (Trinket Lernix, Phase 4 / ADR 0005).
 *
 * Mit app.auth.requireLogin = true ist die App nur angemeldet nutzbar. Ohne Anmeldung
 * erreichbar bleiben: Start-, Login- und Hilfeseiten, statische Dateien, die
 * Anmelde-Routen, die Token-API (eigene Auth) sowie das Ansehen/Ausführen bereits
 * vorhandener Trinkets als Einbettung (z. B. in IServ-Seiten) mit den wenigen
 * API-Aufrufen, die der Embed dafür braucht. Alles andere – vor allem Anlegen, Speichern,
 * Remixen, Kurse – verlangt ein Konto.
 *
 * HTML-Anfragen werden zum Login umgeleitet (mit Rücksprung), API-Anfragen bekommen 401.
 */

var config = require('config'),
    Boom   = require('@hapi/boom');

var PUBLIC_EXACT = {
  'GET /'            : true,
  'GET /login'       : true,
  'POST /login'      : true,
  'GET /logout'      : true,
  'GET /healthz'     : true,
  'GET /about'       : true,
  'GET /help'        : true,
  'GET /robots.txt'  : true,
  'GET /favicon.ico' : true
};

var PUBLIC_PATTERNS = [
  /^GET \/auth\//,                                   // IServ-/Dev-Login
  /^POST \/auth\//,
  /^GET \/(js|css|img|fonts|components|partials|vendor|skulpt|models)\//,
  /^GET \/cache-prefix-[0-9]+\//,                    // statische Dateien mit Cache-Präfix
  /^GET \/embed\/[a-zA-Z0-9-]+\/[A-Za-z0-9]+$/,      // vorhandenes Trinket als Einbettung ansehen/ausführen
  /^GET \/api\/trinkets\/[A-Za-z0-9]+$/,             // … dafür den Code laden
  /^GET \/api\/trinkets\/[A-Za-z0-9]+\/interactions$/,
  /^PUT \/api\/trinkets\/[A-Za-z0-9]+\/metrics$/,    // … und Nutzung zählen
  /^POST \/api\/trinkets\/(codeerror|clientmetric)$/,
  /^GET \/api\/files\/[A-Za-z0-9]+\//,               // Dateien eines eingebetteten Trinkets
  /^[A-Z]+ \/api\/v1\//                              // Token-API hat eigene Authentifizierung
];

function isEnabled() {
  return !!(config.app && config.app.auth && config.app.auth.requireLogin);
}

function isPublic(method, path) {
  var key = method.toUpperCase() + ' ' + path;
  if (PUBLIC_EXACT[key]) return true;
  return PUBLIC_PATTERNS.some(function(re) { return re.test(key); });
}

function wantsHtml(request) {
  var accept = request.headers.accept || '';
  if (request.path.indexOf('/api/') === 0) return false;
  return accept.indexOf('text/html') >= 0 || accept.indexOf('application/json') < 0;
}

/** Hapi-Erweiterung (onPostAuth): Anmeldung erzwingen. */
function enforce(request, h) {
  if (!isEnabled()) return h.continue;
  if (request.auth && request.auth.isAuthenticated) return h.continue;

  var settings = request.route && request.route.settings;
  if (settings && settings.auth === false) return h.continue;          // Route ist ausdrücklich öffentlich
  if (isPublic(request.method, request.path)) return h.continue;

  if (wantsHtml(request)) {
    var next = request.url.pathname + (request.url.search || '');
    return h.redirect('/login?next=' + encodeURIComponent(next)).takeover();
  }
  throw Boom.unauthorized('Anmeldung erforderlich.');
}

module.exports = {
  isEnabled : isEnabled,
  isPublic  : isPublic,
  enforce   : enforce
};
