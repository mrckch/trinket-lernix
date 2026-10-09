// Aufbewahrung: Schuljahresende, Papierkorb, Wartungslauf (ADR 0003)
var should    = require('chai').should(),
    config    = require('config'),
    mongoose  = require('mongoose'),
    retention = require('../../../lib/util/retention'),
    accounts  = require('../../../lib/auth/accounts');

function Users()   { return mongoose.model('User'); }
function Courses() { return mongoose.model('Course'); }
function Snippets() { return mongoose.model('Snippet'); }

describe('Aufbewahrung', function() {
  it('bestimmt das letzte Schuljahresende', function() {
    retention.lastSchoolYearEnd(new Date(2026, 9, 9)).toISOString().slice(0, 10).should.eql('2026-07-31');
    retention.lastSchoolYearEnd(new Date(2026, 4, 1)).toISOString().slice(0, 10).should.eql('2025-07-31');
    retention.lastSchoolYearEnd(new Date(2026, 6, 31, 12)).toISOString().slice(0, 10).should.eql('2025-07-31');
  });

  describe('Wartungslauf', function() {
    var teacher, student, course, oldStudent, newStudent, oldTeacher, longDeleted;
    var NOW = new Date(2026, 9, 9, 3, 0, 0);

    function makeTrinket(owner, created, deletedAt) {
      var t = new (Snippets())({ code : 'print(1)', lang : 'python', name : 'r-' + Math.random(), _owner : owner._id, _creator : owner._id });
      return t.save().then(function(saved) {
        return Snippets().updateOne({ _id : saved._id }, { $set : { created : created, deletedAt : deletedAt || null } }).then(function() { return saved; });
      });
    }

    before(async function() {
      teacher = await accounts.devLogin({ email : 'r-lehrkraft@schule.test', fullname : 'R Lehrkraft', role : 'teacher' });
      student = await accounts.devLogin({ email : 'r-sus@schule.test', fullname : 'R SuS', role : 'student' });

      course = new (Courses())({ name : 'Aufbewahrung 9b', ownerSlug : teacher.username, _owner : teacher._id,
        externalLink : { source : 'iserv', sourceId : 'r.klasse.9b', name : 'Klasse 9b' } });
      await course.save();
      await Courses().updateOne({ _id : course._id }, { $set : { created : new Date(2026, 2, 1) } });

      oldStudent  = await makeTrinket(student, new Date(2026, 2, 1));
      newStudent  = await makeTrinket(student, new Date(2026, 8, 1));
      oldTeacher  = await makeTrinket(teacher, new Date(2026, 2, 1));
      longDeleted = await makeTrinket(student, new Date(2026, 1, 1), new Date(2026, 5, 1));
    });

    after(async function() {
      await Snippets().deleteMany({ _owner : { $in : [teacher._id, student._id] } });
      await Courses().deleteMany({ name : 'Aufbewahrung 9b' });
      await Users().deleteMany({ email : { $in : ['r-lehrkraft@schule.test', 'r-sus@schule.test'] } });
    });

    it('zählt im Probelauf, ändert aber nichts', async function() {
      var result = await retention.run({ now : NOW, dryRun : true });
      result.archivedCourses.should.eql(1);
      result.trashedTrinkets.should.eql(1);
      result.purgedTrinkets.should.eql(1);

      (await Courses().findById(course._id)).archived.should.be.false;
      should.not.exist((await Snippets().findById(oldStudent._id)).deletedAt);
      should.exist(await Snippets().findById(longDeleted._id));
    });

    it('archiviert, legt in den Papierkorb und leert ihn', async function() {
      var result = await retention.run({ now : NOW });
      result.archivedCourses.should.eql(1);
      result.trashedTrinkets.should.eql(1);
      result.purgedTrinkets.should.eql(1);

      (await Courses().findById(course._id)).archived.should.be.true;
      should.exist((await Snippets().findById(oldStudent._id)).deletedAt);
      should.not.exist((await Snippets().findById(newStudent._id)).deletedAt);
      should.not.exist((await Snippets().findById(oldTeacher._id)).deletedAt);
      should.not.exist(await Snippets().findById(longDeleted._id));
    });

    it('ist wiederholbar', async function() {
      var result = await retention.run({ now : NOW });
      result.archivedCourses.should.eql(0);
      result.trashedTrinkets.should.eql(0);
      result.purgedTrinkets.should.eql(0);
    });

    it('lässt sich abschalten', async function() {
      var previous = config.app.retention.enabled;
      config.app.retention.enabled = false;
      var result = await retention.run({ now : NOW });
      config.app.retention.enabled = previous;
      result.enabled.should.be.false;
    });
  });

  describe('Interaktions-Log', function() {
    it('speichert ohne Freigabe weder IP noch Referer', function(done) {
      var Interaction = mongoose.model('Interaction');
      var doc = new Interaction({ action : 'test', address : '203.0.113.9', referer : 'https://x.example' });
      doc.save().then(function(saved) {
        should.not.exist(saved.address);
        should.not.exist(saved.referer);
        return Interaction.deleteOne({ _id : saved._id });
      }).then(function() { done(); }).catch(done);
    });
  });
});
