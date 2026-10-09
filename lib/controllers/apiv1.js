// Lernstand-API /api/v1 (nur Bearer-Token, nur lesend) – siehe docs/lernix/openapi.yaml
var Boom      = require('@hapi/boom'),
    bearer    = require('../auth/bearer'),
    lernstand = require('../services/lernstand');

function logger() {
  return global.log || console;
}

/** Fehler als Boom zurückgeben (der Route-Parser würde geworfene Fehler zu 500 machen). */
function guard(scope, fn) {
  return async function(request, reply) {
    var denied = bearer.missingScope(request, scope);
    if (denied) return denied;

    try {
      return await fn(request);
    } catch (err) {
      if (err && err.isBoom) return err;
      logger().error('/api/v1: ' + (err && err.stack || err));
      return Boom.badImplementation('Interner Fehler.');
    }
  };
}

function siteRoles(user) {
  var site = user.getByContext ? user.getByContext('site') : null;
  return site ? site.roles : [];
}

module.exports = {
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

  trinket : guard('trinkets:read', async function(request) {
    var trinket = request.pre.trinket;
    if (!lernstand.canViewTrinket(request.user, trinket)) {
      return Boom.forbidden('Kein Zugriff auf dieses Trinket.');
    }
    return { trinket : lernstand.trinketDetail(trinket) };
  })
};
