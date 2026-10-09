// Kurs-Export als ZIP (Lernix): Abgaben aller SuS mit Code, Python (Blöcke), Rückmeldungen, lernstand.csv
var Boom      = require('@hapi/boom'),
    bearer    = require('../auth/bearer'),
    lernstand = require('../services/lernstand'),
    kursexport = require('../services/kursexport'),
    mongoose  = require('mongoose');

function logger() {
  return global.log || console;
}

function send(reply, result) {
  return reply(result.buffer)
    .type('application/zip')
    .header('Content-Disposition', 'attachment; filename="' + result.filename + '"')
    .header('Cache-Control', 'no-store');
}

async function build(user, course, via) {
  lernstand.assertCourseAccess(user, course);
  var result = await kursexport.exportCourse(course);
  logger().info('Kurs-Export (' + via + '): ' + user.username + ' / ' + course.slug + ' – ' + result.count + ' Arbeiten');
  return result;
}

module.exports = {
  // Oberfläche: /{userSlug}/courses/{courseSlug}/abgaben.zip (Dashboard)
  download : async function(request, reply) {
    try {
      return send(reply, await build(request.user, request.pre.course, 'Oberfläche'));
    } catch (err) {
      if (err && err.isBoom) return err;
      logger().error('Kurs-Export: ' + (err && err.stack || err));
      return Boom.badImplementation('Der Export ist fehlgeschlagen.');
    }
  },

  // Token-API: GET /api/v1/courses/{courseId}/export.zip (submissions:read)
  api : async function(request, reply) {
    var denied = bearer.missingScope(request, 'submissions:read');
    if (denied) return denied;
    try {
      if (!/^[0-9a-f]{24}$/i.test(request.params.courseId)) return Boom.notFound('Kurs nicht gefunden.');
      var course = await mongoose.model('Course').findById(request.params.courseId);
      if (!course) return Boom.notFound('Kurs nicht gefunden.');
      return send(reply, await build(request.user, course, 'API'));
    } catch (err) {
      if (err && err.isBoom) return err;
      logger().error('Kurs-Export (API): ' + (err && err.stack || err));
      return Boom.badImplementation('Interner Fehler.');
    }
  }
};
