// Verwaltung der API-Token (Session-Login, nur Lehrkräfte/Admins) – /account/tokens
var Boom   = require('@hapi/boom'),
    bearer = require('../auth/bearer');

function guard(fn) {
  return async function(request, reply) {
    if (!bearer.canManage(request.user)) {
      return Boom.forbidden('API-Token können nur Lehrkräfte und Admins verwalten.');
    }
    try {
      return await fn(request);
    } catch (err) {
      if (err && err.isBoom) return err;
      (global.log || console).error('Token-Verwaltung: ' + (err && err.stack || err));
      return Boom.badImplementation('Interner Fehler.');
    }
  };
}

module.exports = {
  list : guard(async function(request) {
    var tokens = await bearer.listTokens(request.user);
    return { tokens : tokens.map(bearer.serialize), scopes : bearer.SCOPES };
  }),

  create : guard(async function(request) {
    var result = await bearer.createToken(request.user, request.payload.name, request.payload.scopes);
    (global.log || console).info('API-Token angelegt: ' + request.user.username + ' / ' + result.token.name);
    // Das Geheimnis wird genau einmal ausgeliefert.
    return { token : bearer.serialize(result.token), secret : result.secret };
  }),

  revoke : guard(async function(request) {
    var doc = await bearer.revokeToken(request.user, request.params.tokenId);
    return { token : bearer.serialize(doc) };
  })
};
