var Boom     = require('@hapi/boom'),
    iserv    = require('../auth/iserv'),
    accounts = require('../auth/accounts'),
    groups   = require('../auth/groups');

/** IServ-Gruppen in die Session legen und SuS-Kurse angleichen (Fehler brechen den Login nicht ab). */
async function applyGroups(request, user, entries) {
  groups.storeInSession(request, entries);
  try {
    await groups.syncStudentMembership(user, entries);
  } catch (err) {
    logger().error('Kurszuordnung nach IServ-Gruppen fehlgeschlagen für ' + user.username + ': ' + (err.stack || err));
  }
}

function logger() {
  return global.log || console;
}

/**
 * Nutzer in die Session eintragen. Neue Session-ID gegen Session-Fixation; das in
 * pages.login/auth.iserv gemerkte Ziel (`next`) überlebt den Wechsel.
 * @returns Weiterleitungsziel
 */
function finishLogin(request, user, loggedInWith) {
  var next = request.yar.get('next');

  request.yar.reset();
  request.yar.set('loggedInWith', loggedInWith);
  request.yar.set('userId', user.id);
  request.user = user;

  return (next && /^\/[^\/]/.test(next)) ? next : '/home';
}

module.exports = {
  // Anmeldung über IServ starten (OIDC Authorization Code Flow mit PKCE)
  iserv : async function(request, reply) {
    if (!iserv.isEnabled()) {
      return request.fail({ message : 'Die IServ-Anmeldung ist nicht konfiguriert. Bitte an die Administration wenden.' });
    }
    if (request.query.next) {
      request.yar.set('next', request.query.next);
    }

    try {
      var url = await iserv.beginLogin(request.yar);
      return reply().redirect(url);
    } catch (err) {
      logger().error('IServ-Anmeldung nicht startbar: ' + err.message);
      return request.fail({ message : 'IServ ist gerade nicht erreichbar. Bitte später erneut versuchen.' });
    }
  },

  // Rücksprung von IServ
  iservCallback : async function(request, reply) {
    var claims, result;

    try {
      claims = await iserv.completeLogin(request.yar, request.query);
    } catch (err) {
      logger().error('IServ-Anmeldung fehlgeschlagen: ' + err.message);
      return request.fail({ message : err instanceof iserv.IServError ? err.message : 'Anmeldung über IServ fehlgeschlagen.' });
    }

    try {
      result = await accounts.upsertFromClaims(claims);
    } catch (err) {
      // Nur Claim-Namen protokollieren, keine Werte (Datensparsamkeit).
      logger().error('IServ-Konto konnte nicht angelegt werden: ' + err.message + ' (Claims: ' + iserv.claimKeys(claims) + ')');
      return request.fail({ message : err instanceof iserv.IServError ? err.message : 'Das IServ-Konto konnte nicht übernommen werden.' });
    }

    var redirectTo = finishLogin(request, result.user, 'iserv');

    // IServ-Gruppen nur in der Session – nicht dauerhaft gespeichert; SuS werden in verknüpfte Kurse eingetragen.
    await applyGroups(request, result.user, iserv.groupEntries(claims));

    logger().info('IServ-Login: ' + result.user.username + ' als ' + result.role + (result.created ? ' (neu)' : ''));

    return request.success({ redirectTo : redirectTo });
  },

  // Test-Anmeldung ohne IServ – nur mit AUTH_MODE=dev erreichbar
  devForm : function(request, reply) {
    if (accounts.authMode() !== 'dev') {
      return reply(Boom.notFound());
    }
    if (request.auth.isAuthenticated) {
      return reply().redirect('/home');
    }
    return request.success({ roles : ['student', 'teacher', 'admin'] });
  },

  devLogin : async function(request, reply) {
    if (accounts.authMode() !== 'dev') {
      return reply(Boom.notFound());
    }

    try {
      var user       = await accounts.devLogin(request.payload);
      var redirectTo = finishLogin(request, user, 'dev');
      await applyGroups(request, user, groups.parseDevGroups(request.payload.groups));
      return request.success({ redirectTo : redirectTo });
    } catch (err) {
      logger().error('Dev-Login fehlgeschlagen: ' + err.message);
      return request.fail({ message : err.message });
    }
  }
};
