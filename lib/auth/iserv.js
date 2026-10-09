'use strict';

/**
 * OpenID-Connect-Anbindung an IServ (Trinket Lernix, Phase 1).
 *
 * Portiert aus den erprobten Python-Anbindungen (HTML_Share, Glossar, Learning-Apps).
 * Drei Dinge daran sind nicht offensichtlich und haben je einen eigenen Grund:
 *
 * 1. Discovery statt fester Pfade: Die Endpunkte kommen aus
 *    <issuer>/.well-known/openid-configuration. Fest verdrahtete Pfade treffen bei IServ nicht zu.
 * 2. UserInfo abfragen, nicht nur das id_token lesen: Rollen und Gruppen liefert IServ
 *    in der Regel nicht im Token. Wer nur das Token auswertet, sieht nie eine Lehrkraft.
 * 3. Claim-Namen in mehreren Schreibweisen: IServ dokumentiert die Scopes, aber nicht die
 *    Claim-Namen der Antwort (`groups` oder `iserv:groups`).
 *
 * Dieses Modul kennt kein Datenmodell: Es holt Claims und beantwortet Fragen über Claims.
 * Die Kontoanlage steht in lib/auth/accounts.js.
 */

var config = require('config'),
    oidc   = require('openid-client'),
    Issuer = oidc.Issuer,
    generators = oidc.generators;

// Genau diese Scopes müssen im IServ-Client unter "Beschränkungen → Auf Scopes einschränken"
// freigegeben sein.
var SCOPES = ['openid', 'profile', 'email', 'iserv:uuid', 'iserv:groups', 'iserv:roles'];

var CLAIM_ALIASES = {
  uuid   : ['uuid', 'iserv:uuid', 'iserv_uuid'],
  roles  : ['roles', 'iserv:roles', 'iserv_roles'],
  groups : ['groups', 'iserv:groups', 'iserv_groups']
};

var FLOW_KEY     = 'iservFlow';      // Session-Schlüssel für state + PKCE-Verifier
var FLOW_MAX_AGE = 10 * 60 * 1000;   // Anmeldeversuch muss binnen 10 Minuten abgeschlossen sein
var CLIENT_TTL   = 10 * 60 * 1000;   // Discovery alle 10 Minuten erneuern

var clientPromise  = null,
    clientCreated  = 0;

/** Fehler der IServ-Anbindung – die Meldung ist für Nutzer bzw. Admins verständlich (Deutsch). */
function IServError(message, reason) {
  Error.call(this, message);
  this.name    = 'IServError';
  this.message = message;
  this.reason  = reason || 'iserv_fehler';
  if (Error.captureStackTrace) Error.captureStackTrace(this, IServError);
}
IServError.prototype = Object.create(Error.prototype);
IServError.prototype.constructor = IServError;

function settings() {
  return (config.app && config.app.auth && config.app.auth.iserv) || {};
}

function isEnabled() {
  var s = settings();
  return !!(s.issuer && s.clientID && s.clientSecret);
}

/** Redirect-URI ausschließlich aus PUBLIC_BASE_URL (config.url) – nie aus dem Host-Header. */
function redirectUri() {
  return config.url + '/auth/iserv/callback';
}

function teacherMarkers() {
  return String(settings().teacherMarkers || 'lehrer,teacher,kollegium')
    .split(',')
    .map(function(m) { return m.trim().toLowerCase(); })
    .filter(Boolean);
}

function resetClient() {
  clientPromise = null;
  clientCreated = 0;
}

async function getClient() {
  if (!isEnabled()) {
    throw new IServError('Die IServ-Anmeldung ist nicht konfiguriert (ISERV_ISSUER, ISERV_CLIENT_ID, ISERV_CLIENT_SECRET).', 'nicht_konfiguriert');
  }
  if (clientPromise && (Date.now() - clientCreated) < CLIENT_TTL) {
    return clientPromise;
  }

  var s = settings();
  clientCreated = Date.now();
  clientPromise = Issuer.discover(s.issuer.replace(/\/+$/, ''))
    .then(function(issuer) {
      if (!issuer.metadata.jwks_uri) {
        throw new IServError('IServ nennt keinen JWKS-Endpunkt – die Echtheit der Anmeldung ist nicht prüfbar.');
      }
      return new issuer.Client({
        client_id                  : s.clientID,
        client_secret              : s.clientSecret,
        redirect_uris              : [redirectUri()],
        response_types             : ['code'],
        // IServ erwartet die Client-Zugangsdaten im Body (wie in den Python-Anbindungen)
        token_endpoint_auth_method : 'client_secret_post'
      });
    })
    .catch(function(err) {
      resetClient();
      if (err instanceof IServError) throw err;
      throw new IServError('Keine Verbindung zu IServ (' + s.issuer + '/.well-known/openid-configuration): ' + err.message, 'iserv_nicht_erreichbar');
    });

  return clientPromise;
}

/**
 * Anmeldung starten: state und PKCE-Verifier in die Session, Weiterleitungs-URL zurück.
 * @param session request.yar
 */
async function beginLogin(session) {
  var client    = await getClient(),
      state     = generators.state(),
      verifier  = generators.codeVerifier(),
      challenge = generators.codeChallenge(verifier);

  session.set(FLOW_KEY, { state : state, verifier : verifier, started : Date.now() });

  return client.authorizationUrl({
    scope                 : SCOPES.join(' '),
    state                 : state,
    code_challenge        : challenge,
    code_challenge_method : 'S256'
  });
}

function tokenErrorMessage(err) {
  var code = err && err.error, description = err && err.error_description;
  var explanation = {
    invalid_client  : 'ISERV_CLIENT_ID oder ISERV_CLIENT_SECRET stimmen nicht.',
    invalid_grant   : 'Der Anmeldecode war abgelaufen oder wurde bereits benutzt.',
    invalid_request : 'IServ lehnt die Anfrage ab. Stimmt die Redirect-URI exakt mit IServ überein?'
  }[code];
  var parts = [];
  if (explanation) parts.push(explanation);
  if (description) parts.push('IServ meldet: ' + description);
  if (!parts.length) parts.push('IServ hat den Anmeldecode abgelehnt' + (err && err.message ? ' (' + err.message + ')' : '') + '.');
  return parts.join(' ');
}

/**
 * Rücksprung von IServ: Code gegen Token tauschen, id_token prüfen (Signatur, Aussteller,
 * Audience – macht openid-client), UserInfo holen. Liefert die zusammengeführten Claims
 * (UserInfo hat Vorrang).
 * @param session request.yar
 * @param query   request.query (code, state, error)
 */
async function completeLogin(session, query) {
  var flow = session.get(FLOW_KEY);
  session.clear(FLOW_KEY);

  if (query.error) {
    throw new IServError('Die Anmeldung bei IServ wurde abgebrochen (' + query.error + ').', 'abgebrochen');
  }
  if (!flow || !query.code || !query.state || query.state !== flow.state
      || (Date.now() - (flow.started || 0)) > FLOW_MAX_AGE) {
    throw new IServError('Die Anmeldesitzung ist abgelaufen. Bitte erneut anmelden.', 'sitzung_abgelaufen');
  }

  var client = await getClient(), tokenSet;

  try {
    tokenSet = await client.callback(
      redirectUri(),
      { code : query.code, state : query.state },
      { state : flow.state, code_verifier : flow.verifier }
    );
  } catch (err) {
    throw new IServError(tokenErrorMessage(err), 'token');
  }

  if (!tokenSet.id_token) {
    throw new IServError('IServ hat kein id_token geliefert.');
  }

  var claims = Object.assign({}, tokenSet.claims());

  try {
    var info = await client.userinfo(tokenSet);
    Object.assign(claims, info);
  } catch (err) {
    // Ohne UserInfo fehlen Rollen/Gruppen → die Person landet als SuS (die vorsichtige Richtung).
    (global.log || console).warn('IServ-UserInfo nicht abrufbar; Rollen/Gruppen fehlen: ' + err.message);
  }

  return claims;
}

// --- Claim-Auswertung ----------------------------------------------------------------------

/** Einen Claim unter allen bekannten Schreibweisen suchen. */
function claim(claims, name, fallback) {
  var keys = CLAIM_ALIASES[name] || [name];
  for (var i = 0; i < keys.length; i++) {
    if (claims && Object.prototype.hasOwnProperty.call(claims, keys[i])) {
      return claims[keys[i]];
    }
  }
  return fallback;
}

/** Nur die Namen der Claims – für Fehlersuche im Log, bewusst ohne personenbezogene Werte. */
function claimKeys(claims) {
  return Object.keys(claims || {}).sort().join(', ') || '(keine)';
}

/** Bezeichnungen aus Rollen/Gruppen ziehen – IServ liefert mal Strings, mal Objekte, mal Mappings. */
function labels(value) {
  var out = [];
  if (typeof value === 'string') {
    out.push(value);
  }
  else if (Array.isArray(value)) {
    value.forEach(function(item) { out = out.concat(labels(item)); });
  }
  else if (value && typeof value === 'object') {
    Object.keys(value).forEach(function(key) {
      out.push(String(key));
      out = out.concat(labels(value[key]));
    });
  }
  return out;
}

/** Rollen UND Gruppen prüfen – manche Schulen führen eine Rolle "Lehrer/in", andere nur eine Gruppe "Kollegium". */
function looksLikeTeacher(claims, markers) {
  markers = markers || teacherMarkers();
  if (!markers.length) return false;

  var haystack = labels(claim(claims, 'roles', []))
    .concat(labels(claim(claims, 'groups', [])))
    .map(function(label) { return label.toLowerCase(); });

  return haystack.some(function(label) {
    return markers.some(function(marker) { return label.indexOf(marker) >= 0; });
  });
}

/**
 * IServ-Gruppen als [{ act, name }]. `act` ist die stabile Kennung (Umbenennungen in IServ
 * ändern sie nicht), `name` die Bezeichnung für die Anzeige. Wer die Objekte flach klopft,
 * bekommt auch interne IDs und Feldnamen als vermeintliche Gruppen – deshalb gezielt.
 */
function groupEntries(claims) {
  var raw = claim(claims, 'groups', []), entries = [];

  function add(act, name) {
    act  = String(act  || '').trim();
    name = String(name || '').trim();
    if (!act && !name) return;
    entries.push({ act : act || name, name : name || act });
  }

  if (Array.isArray(raw)) {
    raw.forEach(function(item) {
      if (item && typeof item === 'object') add(item.act || item.id, item.name);
      else if (typeof item === 'string') add(item, item);
    });
  }
  else if (raw && typeof raw === 'object') {
    Object.keys(raw).forEach(function(key) {
      var value = raw[key];
      if (value && typeof value === 'object') add(value.act || key, value.name);
      else add(key, value);
    });
  }
  else if (typeof raw === 'string') {
    add(raw, raw);
  }

  var byAct = {};
  entries.forEach(function(entry) {
    if (!byAct[entry.act]) byAct[entry.act] = entry;
  });

  return Object.keys(byAct).map(function(act) { return byAct[act]; })
    .sort(function(a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'de'); });
}

/** Stabile Kennung: bevorzugt die IServ-UUID, Rückfall auf `sub`. */
function subjectOf(claims) {
  var value = claim(claims, 'uuid');
  if (typeof value === 'string' && value) return value;
  return claims && claims.sub ? String(claims.sub) : null;
}

function displayNameOf(claims) {
  var given  = String((claims && claims.given_name)  || '').trim(),
      family = String((claims && claims.family_name) || '').trim();
  if (given || family) return (given + ' ' + family).trim();
  return String((claims && claims.name) || '').trim() || accountOf(claims) || 'IServ-Konto';
}

function emailOf(claims) {
  return String((claims && claims.email) || '').trim().toLowerCase();
}

/** IServ-Benutzername (Account), Rückfall auf den lokalen Teil der E-Mail. */
function accountOf(claims) {
  var account = (claims && (claims.preferred_username || claims.username || claims.account)) || '';
  account = String(account).trim();
  if (account) return account.toLowerCase();
  var email = emailOf(claims);
  return email ? email.split('@')[0] : '';
}

module.exports = {
  SCOPES         : SCOPES,
  IServError     : IServError,
  isEnabled      : isEnabled,
  redirectUri    : redirectUri,
  teacherMarkers : teacherMarkers,
  beginLogin     : beginLogin,
  completeLogin  : completeLogin,
  claim          : claim,
  claimKeys      : claimKeys,
  looksLikeTeacher : looksLikeTeacher,
  groupEntries   : groupEntries,
  subjectOf      : subjectOf,
  displayNameOf  : displayNameOf,
  emailOf        : emailOf,
  accountOf      : accountOf,
  _resetClient   : resetClient
};
