// Anonyme Auswertung der Kursaufgaben (ADR 0008)
var should     = require('chai').should(),
    mongoose   = require('mongoose'),
    auswertung = require('../../../lib/services/auswertung'),
    accounts   = require('../../../lib/auth/accounts');

var MIN = 60 * 1000,
    DAY = 24 * 60 * MIN,
    NOW = new Date(2026, 10, 23, 12, 0, 0);

function at(minutesBeforeNow) { return new Date(NOW.getTime() - minutesBeforeNow * MIN); }

/** Minimal data set: one task in two courses. */
function fixture() {
  return {
    tasks : [
      { id : 'm1', name : 'Quadrat zeichnen', lang : 'python', code : 'import turtle\r\n' },
      { id : 'm2', name : '  Quadrat   zeichnen ', lang : 'python', code : 'import turtle\n' }
    ],
    trinkets : [],
    runs     : []
  };
}

/** A child with a submission: `runs` runs every 2 minutes, submitted right after the last one. */
function submitted(data, child, course, task, runs, extra) {
  var work = child + '-w', sub = child + '-s', start = 60 + 2 * runs;
  data.trinkets.push({ id : work, task : task, course : course, child : child, state : 'modified', lastUpdated : at(start) });
  data.trinkets.push(Object.assign({ id : sub, task : task, course : course, child : child, state : 'submitted',
    lastUpdated : at(50), submittedOn : at(50), feedbackAt : [], allowResubmit : false }, extra || {}));
  for (var i = 0; i < runs; i++) data.runs.push({ trinket : work, actor : child, at : at(start - 2 * i) });
}

function started(data, child, course, task, lastUpdated, runs) {
  var id = child + '-' + course + '-o';
  data.trinkets.push({ id : id, task : task, course : course, child : child,
    state : runs ? 'started' : 'modified', lastUpdated : lastUpdated });
  for (var i = 0; i < (runs || 0); i++) data.runs.push({ trinket : id, actor : child, at : lastUpdated });
}

describe('Anonyme Auswertung', function() {
  describe('Zuordnung und Schuljahr', function() {
    it('erkennt gleiche Aufgaben an Name, Sprache und Startcode', function() {
      auswertung.taskKey(' Quadrat  zeichnen', 'python', 'a\r\nb').should.eql(auswertung.taskKey('Quadrat zeichnen', 'python', 'a\nb'));
      auswertung.taskKey('Quadrat zeichnen', 'python', 'a').should.not.eql(auswertung.taskKey('Quadrat zeichnen', 'python', 'b'));
      auswertung.taskKey('Quadrat zeichnen', 'python', 'a').should.not.eql(auswertung.taskKey('Quadrat zeichnen', 'blocks', 'a'));
      auswertung.taskKey('Quadrat zeichnen', 'python', 'a').should.not.eql(auswertung.taskKey('Dreieck zeichnen', 'python', 'a'));
    });

    it('bestimmt das Schuljahr und seine Grenzen', function() {
      auswertung.currentSchoolYear(new Date(2026, 10, 23)).should.eql('2026/27');
      auswertung.currentSchoolYear(new Date(2027, 6, 31)).should.eql('2026/27');
      auswertung.currentSchoolYear(new Date(2027, 7, 1)).should.eql('2027/28');
      auswertung.currentSchoolYear(new Date(2099, 7, 1)).should.eql('2099/00');
      var bounds = auswertung.schoolYearBounds('2026/27');
      bounds.begin.getTime().should.eql(new Date(2026, 7, 1).getTime());
      bounds.end.getTime().should.eql(new Date(2027, 7, 1).getTime());
      (function() { auswertung.schoolYearBounds('2026/28'); }).should.throw(/2026\/27/);
      (function() { auswertung.schoolYearBounds('2026'); }).should.throw(/2026\/27/);
    });
  });

  describe('Kennzahlen', function() {
    it('rechnet Median und oberes Viertel wie Python (inclusive), erst ab 5 Werten', function() {
      auswertung.median([5, 1, 3, 2, 4]).should.eql(3);
      auswertung.upperQuartile([5, 1, 3, 2, 4]).should.eql(4);
      auswertung.upperQuartile([1, 2, 3, 4, 10, 20]).should.eql(8.5);
      should.not.exist(auswertung.median([1, 2, 3, 4]));
      should.not.exist(auswertung.upperQuartile([1, 2, 3, 4]));
    });

    it('schätzt die Arbeitszeit aus den Läufen, lange Pausen zählen nicht', function() {
      var t = function(m) { return new Date(m * MIN); };
      auswertung.workMinutes([t(0), t(5), t(9), t(60), t(62)]).should.eql(11);
      auswertung.workMinutes([t(0)]).should.eql(0);
      auswertung.workMinutes([]).should.eql(0);
    });

    it('zählt je Aufgabe über zwei Kurse, jedes Kind einmal', function() {
      var data = fixture();
      submitted(data, 'k1', 'c1', 'm1', 1);
      submitted(data, 'k2', 'c1', 'm1', 3, { feedbackAt : [at(55)] }); // Rückmeldung, danach erneut abgegeben
      submitted(data, 'k3', 'c2', 'm2', 5, { feedbackAt : [at(40)], allowResubmit : true, state : 'completed' });
      submitted(data, 'k4', 'c2', 'm2', 7, { feedbackAt : [at(40)], state : 'completed' });
      started(data, 'k5', 'c2', 'm2', new Date(NOW.getTime() - 20 * DAY));      // ausgestiegen
      started(data, 'k6', 'c1', 'm1', new Date(NOW.getTime() - 2 * DAY), 1);    // nur ausgeführt, nicht ausgestiegen
      data.trinkets.push({ id : 'k7-w', task : 'm1', course : 'c1', child : 'k7', state : 'started', lastUpdated : at(10) }); // nur geöffnet
      data.runs.push({ trinket : 'k7-w', actor : 'lehrkraft', at : at(5) });    // Lauf der Lehrkraft zählt nicht
      // k1 auch im zweiten Kurs, dort nur angefangen: zählt einmal, mit der Abgabe
      started(data, 'k1', 'c2', 'm2', at(5));

      var result = auswertung.evaluate(data, { now : NOW });
      result.schoolYear.should.eql('2026/27');
      result.tasks.length.should.eql(1);

      var t = result.tasks[0];
      t.name.should.eql('Quadrat zeichnen');
      t.worked.should.eql(6);
      t.submitted.should.eql({ part : 4, whole : 6 });
      t.runs.slice().sort().should.eql([1, 3, 5, 7]);
      t.minutes.slice().sort(function(a, b) { return a - b; }).should.eql([0, 4, 8, 12]);
      t.revision.should.eql({ part : 2, whole : 3 });
      t.resubmitted.should.eql({ part : 1, whole : 2 });
      t.gone.should.eql({ part : 1, whole : 6 });
    });

    it('wertet eine Aufgabe aus nur einem Kurs nicht aus', function() {
      var data = fixture();
      ['a', 'b', 'c', 'd', 'e', 'f'].forEach(function(k) { submitted(data, k, 'c1', 'm1', 2); });
      auswertung.evaluate(data, { now : NOW }).tasks.should.eql([]);
    });

    it('zählt Ausstieg in einem vergangenen Schuljahr ab 14 Tagen vor seinem Ende', function() {
      var data = fixture();
      started(data, 'a', 'c1', 'm1', new Date(2026, 6, 25));  // 6 Tage vor dem Ende
      started(data, 'b', 'c2', 'm2', new Date(2026, 6, 1));   // 30 Tage vor dem Ende
      var t = auswertung.evaluate(data, { now : NOW, schoolYear : '2025/26' }).tasks[0];
      t.gone.should.eql({ part : 1, whole : 2 });
    });
  });

  describe('Bericht', function() {
    it('schreibt eine Tabelle je Sprache und „zu wenige“ unter 5 Kindern', function() {
      var data = fixture();
      submitted(data, 'k1', 'c1', 'm1', 2);
      submitted(data, 'k2', 'c2', 'm2', 2);
      var text = auswertung.report(auswertung.evaluate(data, { now : NOW }));

      text.should.match(/^# Auswertung der Kursaufgaben in Trinket Lernix, Schuljahr 2026\/27/);
      text.should.contain('Stand: 23.11.2026');
      text.should.contain('## Python');
      text.should.contain('| Quadrat zeichnen | < 5 | zu wenige | zu wenige | zu wenige | zu wenige | zu wenige | zu wenige |');
      text.should.not.match(/k1|k2|c1|c2/);
    });

    it('zeigt Zahlen ab 5 Kindern und trennt gleichnamige Aufgaben', function() {
      var data = fixture();
      data.tasks.push({ id : 'm3', name : 'Quadrat zeichnen', lang : 'python', code : 'from turtle import *' });
      data.tasks.push({ id : 'm4', name : 'Quadrat zeichnen', lang : 'python', code : 'from turtle import *' });
      data.tasks.push({ id : 'm5', name : 'Ampel', lang : 'blocks', code : '<xml/>' });
      data.tasks.push({ id : 'm6', name : 'Ampel', lang : 'blocks', code : '<xml/>' });
      ['a', 'b', 'c'].forEach(function(k) { submitted(data, k, 'c1', 'm1', 2); });
      ['d', 'e'].forEach(function(k) { submitted(data, k, 'c2', 'm2', 4); });
      ['a', 'b'].forEach(function(k) { submitted(data, k + '3', 'c1', 'm3', 1); });
      ['c'].forEach(function(k) { submitted(data, k + '4', 'c3', 'm4', 1); });
      ['a', 'b'].forEach(function(k) { submitted(data, k + '5', 'c1', 'm5', 1); });
      ['c'].forEach(function(k) { submitted(data, k + '6', 'c4', 'm6', 1); });

      var text = auswertung.report(auswertung.evaluate(data, { now : NOW }));
      text.should.contain('## Blöcke');
      text.indexOf('## Blöcke').should.be.below(text.indexOf('## Python'));
      text.should.contain('| Ampel | < 5 |');
      text.should.contain('| Quadrat zeichnen · ' + auswertung.taskKey('Quadrat zeichnen', 'python', 'import turtle\n').slice(0, 6) +
        ' | 5 | 100 % | 2 / 4 | 2 | zu wenige | zu wenige | 0 % |');
      text.should.contain('| Quadrat zeichnen · ' + auswertung.taskKey('Quadrat zeichnen', 'python', 'from turtle import *').slice(0, 6) + ' | < 5 |');
    });

    it('sagt, wenn keine Aufgabe die Bedingungen erfüllt', function() {
      auswertung.report(auswertung.evaluate(fixture(), { now : NOW })).should.contain('Keine Aufgabe erfüllt die Bedingungen.');
    });
  });

  describe('Laden aus der Datenbank', function() {
    var NAME = 'Quadrat zeichnen (Auswertungstest)',
        teacher, children = [], materials = [], courses = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];

    function Snippets()     { return mongoose.model('Snippet'); }
    function Materials()    { return mongoose.model('Material'); }
    function Interactions() { return mongoose.model('Interaction'); }
    function Users()        { return mongoose.model('User'); }

    function snippet(data) { return new (Snippets())(Object.assign({ lang : 'python', name : 'a-' + Math.random() }, data)).save(); }

    before(async function() {
      teacher = await accounts.devLogin({ email : 'a-lehrkraft@schule.test', fullname : 'A Lehrkraft', role : 'teacher' });
      for (var i = 1; i <= 6; i++) {
        children.push(await accounts.devLogin({ email : 'a-sus' + i + '@schule.test', fullname : 'A SuS ' + i, role : 'student' }));
      }

      for (var c = 0; c < 2; c++) {
        var template = await snippet({ code : c ? 'import turtle\n' : 'import turtle\r\n', _owner : teacher._id, _creator : teacher._id }),
            material = new (Materials())({ name : NAME, type : 'assignment', trinket : { trinketId : template._id, lang : 'python' } });
        material.setOwner(teacher);
        materials.push(await material.save());
      }

      // SuS 1–3 im ersten Kurs, 4–5 im zweiten, alle mit Lauf und Abgabe; SuS 6 nur im Papierkorb
      for (var k = 0; k < 6; k++) {
        var course = k < 3 ? 0 : 1,
            base   = { materialId : materials[course]._id, courseId : courses[course], _creator : children[k]._id },
            work   = await snippet(Object.assign({ submissionState : 'modified', code : 'import turtle\nforward(10)' }, base));
        await new (Interactions())({ action : 'runs', _trinket : work._id, _actor : children[k]._id }).save();
        if (k === 0) await new (Interactions())({ action : 'runs', _trinket : work._id, _actor : children[k]._id }).save();
        var sub = await snippet(Object.assign({ submissionState : 'submitted', submittedOn : new Date(Date.now() + 1000),
          code : 'import turtle\nforward(10)' }, base));
        await new (Interactions())({ action : 'runs', _trinket : sub._id, _actor : teacher._id }).save();
        if (k === 5) await Snippets().updateMany({ _creator : children[k]._id }, { $set : { deletedAt : new Date() } });
      }
      // Trinket der Lehrkraft zur Aufgabe zählt nicht
      await snippet({ materialId : materials[0]._id, courseId : courses[0], _creator : teacher._id, submissionState : 'modified' });
    });

    after(async function() {
      var ids = [teacher._id].concat(children.map(function(c) { return c._id; }));
      var trinkets = await Snippets().find({ $or : [{ _creator : { $in : ids } }, { _owner : { $in : ids } }] }).select('_id').lean();
      await Interactions().deleteMany({ _trinket : { $in : trinkets.map(function(t) { return t._id; }) } });
      await Snippets().deleteMany({ _id : { $in : trinkets.map(function(t) { return t._id; }) } });
      await Materials().deleteMany({ _id : { $in : materials.map(function(m) { return m._id; }) } });
      await Users().deleteMany({ _id : { $in : ids } });
    });

    it('liest Abgaben, Läufe und Aufgaben und rechnet je Aufgabe', async function() {
      var result = await auswertung.run({ now : new Date() }),
          tasks  = result.tasks.filter(function(t) { return t.name === NAME; });

      tasks.length.should.eql(1);
      tasks[0].worked.should.eql(5);
      tasks[0].submitted.should.eql({ part : 5, whole : 5 });
      tasks[0].runs.slice().sort().should.eql([1, 1, 1, 1, 2]);
      auswertung.report(result).should.contain('| ' + NAME + ' | 5 | 100 % | 1 / 1 |');
    });

    it('findet im Vorjahr nichts', async function() {
      var now    = new Date(),
          year   = auswertung.currentSchoolYear(new Date(now.getFullYear() - 1, now.getMonth(), 1)),
          result = await auswertung.run({ now : now, schoolYear : year });
      result.tasks.filter(function(t) { return t.name === NAME; }).should.eql([]);
    });
  });
});
