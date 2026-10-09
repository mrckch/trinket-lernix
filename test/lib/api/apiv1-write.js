// Token-API mit Schreibrechten (ADR 0006): Token-Trennung je Lehrkraft, alle schreibenden
// Endpunkte, Rechte (Scope, fremder Kurs, SuS-Token, widerrufenes Token), Gleichlauf mit der Oberfläche.
var should   = require('chai').should(),
    fs       = require('fs'),
    path     = require('path'),
    sinon    = require('sinon'),
    config   = require('config'),
    mongoose = require('mongoose'),
    flow     = require('../../helpers/flow'),
    bearer   = require('../../../lib/auth/bearer'),
    blocks   = require('../../../lib/services/blocks');

function users()     { return mongoose.model('User'); }
function courses()   { return mongoose.model('Course'); }
function lessons()   { return mongoose.model('Lesson'); }
function materials() { return mongoose.model('Material'); }
function snippets()  { return mongoose.model('Snippet'); }
function tokens()    { return mongoose.model('ApiToken'); }

var A = 'w-lehrkraft-a@schule.test',
    B = 'w-lehrkraft-b@schule.test',
    C = 'w-lehrkraft-c@schule.test',
    S = 'w-sus@schule.test',
    S2 = 'w-sus2@schule.test',
    ALL_SCOPES = Object.keys(bearer.SCOPES);

var BLOCKS_DIR = path.join(__dirname, '..', '..', 'data', 'blocks');

function result(req) {
  return new Promise(function(resolve, reject) {
    req.end(flow.setLastResponse(function(err, res) { return res ? resolve(res) : reject(err); }));
  });
}

/** Aufruf der Token-API ohne Cookie */
function api(method, url, secret, body) {
  flow.switchUser('nocookie');
  var req = flow[method](url).set('Accept', 'application/json');
  if (secret) req.set('Authorization', 'Bearer ' + secret);
  if (body !== undefined) req.set('Content-Type', 'application/json').send(body);
  return result(req);
}

/** Aufruf der Session-API (Oberfläche) als angemeldete Person */
function session(who, method, url, body) {
  flow.switchUser(who);
  var req = flow[method](url).set('Accept', 'application/json');
  if (body !== undefined) req.set('Content-Type', 'application/json').send(body);
  return result(req);
}

/** Seite der Oberfläche als HTML */
function page(who, url) {
  flow.switchUser(who);
  return result(flow.get(url).set('Accept', 'text/html'));
}

function devLogin(who, body) {
  flow.switchUser(who);
  return result(flow.post('/auth/dev').send(body));
}

async function newToken(who, name, scopes) {
  var res = await session(who, 'post', '/api/tokens', { name : name, scopes : scopes });
  res.statusCode.should.eql(200, JSON.stringify(res.body));
  return { secret : res.body.secret, id : res.body.token.id, prefix : res.body.token.prefix };
}

function expectStatus(res, status) {
  res.statusCode.should.eql(status, res.req ? res.req.method + ' ' + res.req.path + ': ' + JSON.stringify(res.body) : '');
  return res;
}

module.exports = function() {
  describe('Token-API mit Schreibrechten', function() {
    var tokA, tokARead, tokB, tokRevoked, tokStudent, tokC,
        idA, idB, idS,
        courseId, lesson1, lesson2, pageId, pyId, pyStarter, blocksId, blocksStarter, lateId, lateStarter,
        startedId, submissionId, blocksSubmissionId, lateSubmissionId, libraryId,
        previousBlocks, previousApi, logSpy;

    before(async function() {
      previousBlocks = config.features.trinkets.blocks;
      config.features.trinkets.blocks = true;
      previousApi = config.app.api;
      logSpy = sinon.spy(global.log || console, 'info');

      await devLogin('wa', { email : A, fullname : 'W Lehrkraft A', role : 'teacher', groups : 'klasse.9a:Klasse 9a, klasse.9b:Klasse 9b' });
      await devLogin('wb', { email : B, fullname : 'W Lehrkraft B', role : 'teacher', groups : 'klasse.7a:Klasse 7a' });
      await devLogin('wc', { email : C, fullname : 'W Lehrkraft C', role : 'teacher' });

      var docs = await users().find({ email : { $in : [A, B] } });
      docs.forEach(function(u) { if (u.email === A) idA = String(u._id); else idB = String(u._id); });

      tokA       = await newToken('wa', 'A-SchulAssistent-geheim', ALL_SCOPES);
      tokARead   = await newToken('wa', 'A-nur-lesen', ['courses:read', 'submissions:read', 'trinkets:read']);
      tokRevoked = await newToken('wa', 'A-widerrufen', ALL_SCOPES);
      tokB       = await newToken('wb', 'B-eigenes-Token', ALL_SCOPES);
      tokC       = await newToken('wc', 'C-Token', ['courses:read', 'courses:write']);
    });

    after(async function() {
      config.features.trinkets.blocks = previousBlocks;
      config.app.api = previousApi;
      logSpy.restore();
      var docs = await users().find({ email : { $in : [A, B, C, S, S2] } }).select('_id').lean(),
          ids  = docs.map(function(d) { return d._id; });
      await Promise.all([
        tokens().deleteMany({ _owner : { $in : ids } }),
        snippets().deleteMany({ $or : [{ _owner : { $in : ids } }, { _creator : { $in : ids } }] }),
        lessons().deleteMany({ _owner : { $in : ids } }),
        materials().deleteMany({ _owner : { $in : ids } }),
        courses().deleteMany({ _owner : { $in : ids } }),
        users().deleteMany({ _id : { $in : ids } })
      ]);
    });

    describe('Jede Lehrkraft verwaltet nur ihre eigenen Token', function() {
      it('B sieht die Token von A weder in der Liste noch auf der Token-Seite', async function() {
        var res = expectStatus(await session('wb', 'get', '/api/tokens'), 200);
        res.body.tokens.map(function(t) { return t.id; }).should.not.include(tokA.id);
        res.body.tokens.map(function(t) { return t.name; }).should.eql(['B-eigenes-Token']);

        var tokenPage = expectStatus(await page('wb', '/account/tokens'), 200);
        tokenPage.text.should.contain('<html');
        tokenPage.text.should.contain('B-eigenes-Token');
        tokenPage.text.should.not.contain('A-SchulAssistent-geheim');
        tokenPage.text.should.not.contain(tokA.prefix);
      });

      it('B kann A\'s Token nicht widerrufen (404), A\'s Token funktioniert weiter', async function() {
        expectStatus(await session('wb', 'del', '/api/tokens/' + tokA.id), 404);
        expectStatus(await session('wb', 'del', '/api/tokens/kaputt'), 404);
        var me = expectStatus(await api('get', '/api/v1/me', tokA.secret), 200);
        me.body.email.should.eql(A);
        (await tokens().findById(tokA.id)).should.have.property('revokedAt', null);
      });

      it('lehnt Scopes ab, die es nicht gibt oder die die Rolle nicht hat', async function() {
        expectStatus(await session('wb', 'post', '/api/tokens', { name : 'x', scopes : ['admin:all'] }), 400);
        expectStatus(await session('wb', 'post', '/api/tokens', { name : 'x', scopes : ['courses:write', 'root'] }), 400);
        var student = { hasRole : function() { return false; } };
        await bearer.createToken(student, 'x', ['courses:read']).should.be.rejected;
      });

      it('nimmt einer Lehrkraft ohne Lehrkraft-Rolle alle Token-Rechte', async function() {
        expectStatus(await api('post', '/api/v1/courses', tokC.secret, { name : 'C-Kurs' }), 201);
        await devLogin('wc', { email : C, fullname : 'W Lehrkraft C', role : 'student' });
        expectStatus(await api('get', '/api/v1/courses', tokC.secret), 403);
        expectStatus(await api('post', '/api/v1/courses', tokC.secret, { name : 'C-Kurs 2' }), 403);
        expectStatus(await session('wc', 'post', '/api/tokens', { name : 'neu', scopes : ['courses:read'] }), 403);
      });

      it('zeigt die Token-Seite im Menü und die Schreibrechte auf Deutsch', async function() {
        var profile = expectStatus(await page('wa', '/account/profile'), 200);
        profile.text.should.contain('href="/account/tokens"');
        profile.text.should.contain('API-Tokens');

        var tokensPage = expectStatus(await page('wa', '/account/tokens'), 200);
        bearer.WRITE_SCOPES.forEach(function(scope) {
          tokensPage.text.should.contain(scope);
          tokensPage.text.should.contain(bearer.SCOPES[scope]);
        });
        tokensPage.text.should.contain('Schreiben');

        var studentPage = expectStatus(await page('wc', '/account/profile'), 200);
        studentPage.text.should.not.contain('href="/account/tokens"');
      });

      it('widerrufene Token und Token ohne Lehrkraft-Rolle haben keinen Zugriff', async function() {
        expectStatus(await session('wa', 'del', '/api/tokens/' + tokRevoked.id), 200);
        expectStatus(await api('post', '/api/v1/courses', tokRevoked.secret, { name : 'x' }), 401);
      });
    });

    describe('Kurse (courses:write)', function() {
      it('legt einen Kurs mit eigener IServ-Gruppe an', async function() {
        var res = expectStatus(await api('post', '/api/v1/courses', tokA.secret, {
          name : 'API-Kurs 9a', description : 'per Token', courseType : 'private', iservGroup : { act : 'klasse.9a' }
        }), 201);
        courseId = res.body.course.id;
        res.body.course.iservGroup.should.eql({ act : 'klasse.9a', name : 'Klasse 9a' });
        res.body.course.courseType.should.eql('private');

        // dieselben Daten wie in der Oberfläche
        var ui = expectStatus(await session('wa', 'get', '/api/courses/' + courseId), 200);
        ui.body.data.name.should.eql('API-Kurs 9a');
        ui.body.data.externalLink.sourceId.should.eql('klasse.9a');
        var listed = expectStatus(await api('get', '/api/v1/courses', tokA.secret), 200);
        listed.body.courses.map(function(c) { return c.id; }).should.include(courseId);
      });

      it('verweigert fremde IServ-Gruppen, falsche Scopes und ungültige Eingaben', async function() {
        expectStatus(await api('post', '/api/v1/courses', tokA.secret, { name : 'Fremd', iservGroup : { act : 'klasse.7a' } }), 403);
        expectStatus(await api('post', '/api/v1/courses', tokARead.secret, { name : 'Nur lesen' }), 403);
        var bad = expectStatus(await api('post', '/api/v1/courses', tokA.secret, { name : '', _owner : idB }), 400);
        bad.body.message.should.contain('Ungültige Eingabe');
        bad.body.details.map(function(d) { return d.path; }).should.include('_owner');
      });

      it('zeigt die gespeicherten IServ-Gruppen der Lehrkraft', async function() {
        var res = expectStatus(await api('get', '/api/v1/iserv/groups', tokA.secret), 200);
        res.body.groups.map(function(g) { return g.act; }).should.eql(['klasse.9a', 'klasse.9b']);
        var formerTeacher = await users().findOne({ email : C });
        ((formerTeacher.iserv && formerTeacher.iserv.groups) || []).length.should.eql(0);
      });

      it('ändert, archiviert und reaktiviert einen Kurs', async function() {
        var res = expectStatus(await api('patch', '/api/v1/courses/' + courseId, tokA.secret, { description : 'Neu', contentDefault : 'publish' }), 200);
        res.body.course.description.should.eql('Neu');
        res.body.course.courseType.should.eql('private');      // nicht auf den Default zurückgesetzt
        expectStatus(await api('patch', '/api/v1/courses/' + courseId, tokA.secret, { archived : true }), 200).body.course.archived.should.be.true;
        expectStatus(await api('patch', '/api/v1/courses/' + courseId, tokA.secret, { archived : false }), 200).body.course.archived.should.be.false;
        expectStatus(await api('patch', '/api/v1/courses/' + courseId, tokA.secret, {}), 400);
        expectStatus(await api('patch', '/api/v1/courses/aaaaaaaaaaaaaaaaaaaaaaaa', tokA.secret, { name : 'x' }), 404);
        expectStatus(await api('patch', '/api/v1/courses/kaputt', tokA.secret, { name : 'x' }), 404);
      });

      it('verknüpft und löst die IServ-Gruppe', async function() {
        expectStatus(await api('put', '/api/v1/courses/' + courseId + '/iserv-group', tokA.secret, { act : 'klasse.9b' }), 200)
          .body.course.iservGroup.act.should.eql('klasse.9b');
        expectStatus(await api('put', '/api/v1/courses/' + courseId + '/iserv-group', tokA.secret, { act : 'klasse.7a' }), 403);
        var off = expectStatus(await api('del', '/api/v1/courses/' + courseId + '/iserv-group', tokA.secret), 200);
        should.not.exist(off.body.course.iservGroup);
        expectStatus(await api('put', '/api/v1/courses/' + courseId + '/iserv-group', tokA.secret, { act : 'klasse.9a', name : 'Klasse 9a' }), 200);
      });

      it('erneuert den Zugangscode', async function() {
        var res = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/access-code', tokA.secret), 200);
        res.body.accessCode.should.match(/^[A-Za-z0-9]{6}$/);
        expectStatus(await api('get', '/api/v1/courses/' + courseId + '/access-code', tokA.secret), 200).body.accessCode.should.eql(res.body.accessCode);
        expectStatus(await session('wa', 'get', '/api/courses/' + courseId + '/accessCode'), 200).body.accessCode.should.eql(res.body.accessCode);
      });
    });

    describe('Inhalte (content:write)', function() {
      it('legt Lektionen, eine Seite und Aufgaben (Python, Blöcke) an', async function() {
        lesson1 = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/lessons', tokA.secret, { name : 'Lektion 1' }), 201).body.lesson.id;
        lesson2 = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/lessons', tokA.secret, { name : 'Lektion 2' }), 201).body.lesson.id;

        var page = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/lessons/' + lesson1 + '/materials', tokA.secret, {
          type : 'page', name : 'Einstieg', content : '# Schleifen\n\nWiederholen mit `for`.'
        }), 201);
        pageId = page.body.material.id;
        page.body.material.content.should.contain('# Schleifen');

        var past = new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
            soon = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

        var py = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/lessons/' + lesson1 + '/materials', tokA.secret, {
          type : 'assignment', name : 'Quadrat in Python', content : 'Zeichne ein Quadrat.',
          starter : { lang : 'python', code : 'import turtle\n' },
          availableOn : past, hideAfter : soon, submissionsDue : soon
        }), 201);
        pyId      = py.body.material.id;
        pyStarter = py.body.material.assignment.trinketId;
        py.body.material.assignment.availableOn.enabled.should.be.true;
        py.body.material.assignment.submissionsDue.enabled.should.be.true;
        py.body.material.assignment.starter.files.should.eql([{ name : 'main.py', content : 'import turtle\n' }]);

        var bl = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/lessons/' + lesson2 + '/materials', tokA.secret, {
          type : 'assignment', name : 'Quadrat mit Blöcken', starter : { lang : 'blocks', code : '<xml xmlns="http://www.w3.org/1999/xhtml"></xml>' }
        }), 201);
        blocksId      = bl.body.material.id;
        blocksStarter = bl.body.material.assignment.trinketId;
        bl.body.material.assignment.lang.should.eql('blocks');

        var late = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/lessons/' + lesson2 + '/materials', tokA.secret, {
          type : 'assignment', name : 'Schon fällig', starter : { lang : 'python' }, submissionsDue : past
        }), 201);
        lateId      = late.body.material.id;
        lateStarter = late.body.material.assignment.trinketId;

        // gespeichert wie von der Oberfläche: Material mit Vorlage, Vorlage in der Bibliothek der Lehrkraft
        var doc = await materials().findById(pyId),
            starterDoc = await snippets().findById(pyStarter);
        doc.trinket.lang.should.eql('python');
        doc.trinket.shortCode.should.eql(starterDoc.shortCode);
        String(starterDoc._owner).should.eql(idA);
        starterDoc.name.should.eql('Quadrat in Python – Trinket');
        JSON.parse(starterDoc.code).should.eql([{ name : 'main.py', content : 'import turtle\n' }]);
      });

      it('prüft Aufgabenfelder und Daten', async function() {
        var base = '/api/v1/courses/' + courseId + '/lessons/' + lesson1 + '/materials';
        expectStatus(await api('post', base, tokA.secret, { type : 'page', name : 'x', starter : { lang : 'python' } }), 400);
        expectStatus(await api('post', base, tokA.secret, { type : 'assignment', name : 'x', submissionsCutoff : new Date().toISOString() }), 400);
        expectStatus(await api('post', base, tokA.secret, { type : 'assignment', name : 'x', starter : { lang : 'blocks', code : '<xml><block' } }), 400);
        expectStatus(await api('post', base, tokA.secret, { type : 'assignment', name : 'x', starter : { lang : 'java' } }), 400);
        expectStatus(await api('post', base, tokA.secret, { type : 'quiz', name : 'x' }), 400);
        expectStatus(await api('post', '/api/v1/courses/' + courseId + '/lessons/aaaaaaaaaaaaaaaaaaaaaaaa/materials', tokA.secret, { type : 'page', name : 'x' }), 404);
      });

      it('liest eine Aufgabe mit Vorlage', async function() {
        var res = expectStatus(await api('get', '/api/v1/courses/' + courseId + '/materials/' + pyId, tokA.secret), 200);
        res.body.material.content.should.eql('Zeichne ein Quadrat.');
        res.body.material.assignment.starter.lang.should.eql('python');
      });

      it('ändert Startcode, Sichtbarkeit und Entwurf wie die Oberfläche', async function() {
        var xmlText = fs.readFileSync(path.join(BLOCKS_DIR, 'quadrat.xml'), 'utf8');
        var res = expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/materials/' + blocksId, tokA.secret, {
          starter : { code : xmlText }, content : 'Nutze eine Wiederholung.'
        }), 200);
        res.body.material.assignment.trinketId.should.eql(blocksStarter);
        res.body.material.assignment.starter.code.should.eql(xmlText);
        should.not.exist(res.body.material.assignment.starter.pythonCode);   // nur auf Wunsch
        if (blocks.isAvailable()) {
          var withPy = expectStatus(await api('get', '/api/v1/courses/' + courseId + '/materials/' + blocksId + '?python=true', tokA.secret), 200);
          withPy.body.material.assignment.starter.pythonCode.should.eql(fs.readFileSync(path.join(BLOCKS_DIR, 'quadrat.py'), 'utf8'));
        }

        // Seite als Entwurf: SuS sehen sie nicht, die Lehrkraft schon
        expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/materials/' + pageId, tokA.secret, { isDraft : true }), 200);
        var outline = expectStatus(await session('wa', 'get', '/api/courses/' + courseId + '?outline=true&withDraft=true'), 200);
        var l1 = outline.body.data.lessons.filter(function(l) { return l.id === lesson1; })[0];
        l1.materials.filter(function(m) { return m.id === pageId; })[0].isDraft.should.be.true;
        expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/materials/' + pageId, tokA.secret, { isDraft : false }), 200);

        // Fälligkeit verschieben, Rest bleibt erhalten
        var later = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
        var moved = expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/materials/' + pyId, tokA.secret, { submissionsDue : later }), 200);
        new Date(moved.body.material.assignment.submissionsDue.at).toISOString().should.eql(later);
        moved.body.material.assignment.availableOn.enabled.should.be.true;
        moved.body.material.assignment.hideAfter.enabled.should.be.true;

        expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/materials/' + pageId, tokA.secret, { submissionsDue : later }), 400);
      });

      it('versteckt eine Aufgabe bis „Sichtbar ab“ (wie in der Oberfläche)', async function() {
        var future = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
        expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/materials/' + lateId, tokA.secret, { availableOn : future, hideAfter : null }), 200);
        var outline = expectStatus(await session('wb', 'get', '/api/courses/' + courseId + '?outline=true'), 200);
        var ids = [];
        outline.body.data.lessons.forEach(function(l) { l.materials.forEach(function(m) { ids.push(m.id); }); });
        ids.should.not.include(lateId);
        ids.should.include(blocksId);
        expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/materials/' + lateId, tokA.secret, { availableOn : null }), 200);
      });

      it('sortiert Lektionen und verschiebt Material zwischen Lektionen', async function() {
        expectStatus(await api('put', '/api/v1/courses/' + courseId + '/lessons/order', tokA.secret, { lessonIds : [lesson1] }), 400);
        expectStatus(await api('put', '/api/v1/courses/' + courseId + '/lessons/order', tokA.secret, { lessonIds : [lesson2, lesson1] }), 200)
          .body.lessonIds.should.eql([lesson2, lesson1]);

        var res = expectStatus(await api('put', '/api/v1/courses/' + courseId + '/lessons/' + lesson2 + '/materials/order', tokA.secret, {
          materialIds : [pageId, blocksId, lateId]
        }), 200);
        res.body.lesson.materialIds.should.eql([pageId, blocksId, lateId]);
        var l1 = await lessons().findById(lesson1);
        l1.materials.map(String).should.eql([pyId]);
        expectStatus(await api('put', '/api/v1/courses/' + courseId + '/lessons/' + lesson2 + '/materials/order', tokA.secret, { materialIds : [pageId] }), 400);

        var outline = expectStatus(await api('get', '/api/v1/courses/' + courseId, tokA.secret), 200);
        outline.body.lessons.map(function(l) { return l.name; }).should.eql(['Lektion 2', 'Lektion 1']);
        outline.body.lessons[0].materials.map(function(m) { return m.id; }).should.eql([pageId, blocksId, lateId]);
      });

      it('importiert eine ganze Reihe und benennt/löscht Lektionen', async function() {
        var res = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/import', tokA.secret, {
          lessons : [
            { name : 'Reihe: Variablen', materials : [
              { type : 'page', name : 'Was ist eine Variable?', content : 'Text' },
              { type : 'assignment', name : 'Tausche Werte', starter : { lang : 'python', files : [{ name : 'main.py', content : 'a = 1\nb = 2\n' }, { name : 'hilfe.py', content : '', hidden : true }] } }
            ] },
            { name : 'Reihe: Leer', isDraft : true }
          ]
        }), 201);
        res.body.lessons.length.should.eql(2);
        res.body.lessons[0].materials.map(function(m) { return m.type; }).should.eql(['page', 'assignment']);

        var renamed = expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/lessons/' + res.body.lessons[1].id, tokA.secret, { name : 'Reihe: Später', isDraft : false }), 200);
        renamed.body.lesson.name.should.eql('Reihe: Später');
        expectStatus(await api('del', '/api/v1/courses/' + courseId + '/lessons/' + res.body.lessons[1].id, tokA.secret), 204);
        expectStatus(await api('del', '/api/v1/courses/' + courseId + '/materials/' + res.body.lessons[0].materials[0].id, tokA.secret), 204);
        expectStatus(await api('get', '/api/v1/courses/' + courseId + '/materials/' + res.body.lessons[0].materials[0].id, tokA.secret), 404);

        var outline = expectStatus(await api('get', '/api/v1/courses/' + courseId, tokA.secret), 200);
        outline.body.lessons.map(function(l) { return l.name; }).should.eql(['Lektion 2', 'Lektion 1', 'Reihe: Variablen']);

        expectStatus(await api('post', '/api/v1/courses/' + courseId + '/import', tokA.secret, { lessons : [] }), 400);
      });

      it('importiert nichts, wenn eine Vorlage ungültig ist (kein Halbzustand)', async function() {
        var before = (await courses().findById(courseId)).lessons.length;
        var foreign = expectStatus(await api('post', '/api/v1/trinkets', tokB.secret, { lang : 'python', name : 'B-Vorlage' }), 201).body.trinket.id;
        var cases = [
          [{ type : 'assignment', name : 'Java', starter : { lang : 'java' } }, 400],
          [{ type : 'assignment', name : 'XML', starter : { lang : 'blocks', code : '<xml><block' } }, 400],
          [{ type : 'assignment', name : 'Fremd', starter : { trinketId : foreign } }, 403],
          [{ type : 'assignment', name : 'Daten', submissionsCutoff : new Date().toISOString() }, 400]
        ];
        for (var i = 0; i < cases.length; i++) {
          var res = await api('post', '/api/v1/courses/' + courseId + '/import', tokA.secret, {
            lessons : [{ name : 'Gut', materials : [{ type : 'page', name : 'ok' }] }, { name : 'Schlecht', materials : [cases[i][0]] }]
          });
          res.statusCode.should.eql(cases[i][1], JSON.stringify(res.body));
          res.body.message.should.contain('Lektion 2');
        }
        (await courses().findById(courseId)).lessons.length.should.eql(before);
        (await lessons().countDocuments({ name : { $in : ['Gut', 'Schlecht'] } })).should.eql(0);
      });

      it('findet Lektion, Material und Aufgabe eines anderen eigenen Kurses nicht über diesen Kurs (404)', async function() {
        var other = expectStatus(await api('post', '/api/v1/courses', tokA.secret, { name : 'API-Kurs Y' }), 201).body.course.id;
        var yLesson = expectStatus(await api('post', '/api/v1/courses/' + other + '/lessons', tokA.secret, { name : 'Y-Lektion' }), 201).body.lesson.id;
        var yTask = expectStatus(await api('post', '/api/v1/courses/' + other + '/lessons/' + yLesson + '/materials', tokA.secret, { type : 'assignment', name : 'Y-Aufgabe' }), 201).body.material.id;
        var x = '/api/v1/courses/' + courseId;

        expectStatus(await api('get', x + '/materials/' + yTask, tokA.secret), 404);
        expectStatus(await api('patch', x + '/materials/' + yTask, tokA.secret, { name : 'kaputt' }), 404);
        expectStatus(await api('del', x + '/materials/' + yTask + '?confirm=true', tokA.secret), 404);
        expectStatus(await api('get', x + '/assignments/' + yTask + '/submissions', tokA.secret), 404);
        expectStatus(await api('patch', x + '/lessons/' + yLesson, tokA.secret, { name : 'kaputt' }), 404);
        expectStatus(await api('del', x + '/lessons/' + yLesson + '?confirm=true', tokA.secret), 404);
        expectStatus(await api('post', x + '/lessons/' + yLesson + '/materials', tokA.secret, { type : 'page', name : 'x' }), 404);
        var l1 = await lessons().findById(lesson1);
        expectStatus(await api('put', x + '/lessons/' + lesson1 + '/materials/order', tokA.secret, { materialIds : l1.materials.map(String).concat([yTask]) }), 400);
        expectStatus(await api('put', x + '/lessons/order', tokA.secret, { lessonIds : (await courses().findById(courseId)).lessons.map(String).concat([yLesson]) }), 400);

        (await materials().findById(yTask)).name.should.eql('Y-Aufgabe');
        (await lessons().findById(yLesson)).name.should.eql('Y-Lektion');
        expectStatus(await api('del', '/api/v1/courses/' + other + '?confirm=true', tokA.secret), 204);
      });

      it('kopiert einen eigenen Kurs samt Inhalten', async function() {
        var res = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/copy', tokA.secret, { name : 'API-Kurs 9a (Kopie)' }), 201);
        res.body.course.id.should.not.eql(courseId);
        should.not.exist(res.body.course.iservGroup);
        var outline = expectStatus(await api('get', '/api/v1/courses/' + res.body.course.id, tokA.secret), 200);
        outline.body.lessons.length.should.eql(3);
        expectStatus(await api('del', '/api/v1/courses/' + res.body.course.id, tokA.secret), 400);   // ohne confirm
        expectStatus(await api('del', '/api/v1/courses/' + res.body.course.id + '?confirm=true', tokA.secret), 204);
        expectStatus(await api('get', '/api/v1/courses/' + res.body.course.id + '/members', tokA.secret), 404);
      });
    });

    describe('Unterricht: SuS arbeiten, Lehrkraft wertet aus und gibt zurück', function() {
      before(async function() {
        // SuS kommt über die IServ-Gruppe in den Kurs
        await devLogin('ws', { email : S, fullname : 'W SuS', role : 'student', groups : 'klasse.9a:Klasse 9a' });
        idS = String((await users().findOne({ email : S }))._id);

        var start = expectStatus(await session('ws', 'post', '/api/courses/' + courseId + '/lessons/' + lesson1 + '/materials/' + pyId + '/startAssignment', { parent : pyStarter }), 200);
        startedId = start.body.assignment.id;
        expectStatus(await session('ws', 'post', '/api/trinkets/' + startedId + '/autosave', { code : JSON.stringify([{ name : 'main.py', content : 'import turtle\nturtle.forward(10)\n' }]) }), 200);
      });

      it('zeigt die angefangene Arbeit mit aktuellem Code', async function() {
        var res = expectStatus(await api('get', '/api/v1/courses/' + courseId + '/assignments/' + pyId + '/submissions?includeCode=true', tokA.secret), 200);
        var mine = res.body.submissions.filter(function(s) { return s.student.id === idS; })[0];
        mine.state.should.eql('started');
        mine.trinket.id.should.eql(startedId);
        mine.trinket.files[0].content.should.contain('turtle.forward(10)');

        var noCode = expectStatus(await api('get', '/api/v1/courses/' + courseId + '/assignments/' + pyId + '/submissions', tokA.secret), 200);
        should.not.exist(noCode.body.submissions.filter(function(s) { return s.student.id === idS; })[0].trinket.code);
        expectStatus(await api('get', '/api/v1/courses/' + courseId + '/assignments/' + pageId + '/submissions', tokA.secret), 404);
      });

      it('lehnt Rückmeldungen zu nicht abgegebener Arbeit ab (409)', async function() {
        expectStatus(await api('post', '/api/v1/trinkets/' + startedId + '/feedback', tokA.secret, { comment : 'zu früh' }), 409);
        expectStatus(await api('post', '/api/v1/trinkets/' + pyStarter + '/feedback', tokA.secret, { comment : 'keine Abgabe' }), 404);
      });

      it('wertet Abgaben aus – Python und Blöcke als Python', async function() {
        var sub = expectStatus(await session('ws', 'post', '/api/courses/' + courseId + '/lessons/' + lesson1 + '/materials/' + pyId + '/submissions', {
          code : { code : JSON.stringify([{ name : 'main.py', content : 'import turtle\nfor i in range(4):\n  turtle.forward(50)\n  turtle.left(90)\n' }]) },
          comments : 'Fertig!', parent : pyStarter
        }), 200);
        submissionId = sub.body.submission.id;

        var xmlText = fs.readFileSync(path.join(BLOCKS_DIR, 'quadrat.xml'), 'utf8');
        var bsub = expectStatus(await session('ws', 'post', '/api/courses/' + courseId + '/lessons/' + lesson2 + '/materials/' + blocksId + '/submissions', {
          code : { code : xmlText }, comments : '', parent : blocksStarter
        }), 200);
        blocksSubmissionId = bsub.body.submission.id;

        var res = expectStatus(await api('get', '/api/v1/courses/' + courseId + '/assignments/' + pyId + '/submissions?includeCode=true', tokA.secret), 200);
        var mine = res.body.submissions.filter(function(s) { return s.student.id === idS; })[0];
        mine.state.should.eql('submitted');
        mine.attempts.should.eql(2);
        mine.trinket.id.should.eql(submissionId);
        mine.trinket.feedback.studentComment.should.eql('Fertig!');
        mine.trinket.files[0].content.should.contain('turtle.left(90)');

        var bres = expectStatus(await api('get', '/api/v1/courses/' + courseId + '/assignments/' + blocksId + '/submissions?includeCode=true', tokA.secret), 200);
        var bmine = bres.body.submissions.filter(function(s) { return s.student.id === idS; })[0];
        bmine.trinket.code.should.eql(xmlText);

        if (blocks.isAvailable()) {
          var expected = fs.readFileSync(path.join(BLOCKS_DIR, 'quadrat.py'), 'utf8');
          bmine.trinket.pythonCode.should.eql(expected);
          var plain = expectStatus(await api('get', '/api/v1/trinkets/' + blocksSubmissionId, tokA.secret), 200);
          should.not.exist(plain.body.trinket.pythonCode);   // keine Umwandlung ohne Wunsch
          var detail = expectStatus(await api('get', '/api/v1/trinkets/' + blocksSubmissionId + '?python=true', tokA.secret), 200);
          detail.body.trinket.pythonCode.should.eql(expected);
          var text = expectStatus(await api('get', '/api/v1/trinkets/' + blocksSubmissionId + '?format=python', tokA.secret), 200);
          text.headers['content-type'].should.contain('text/x-python');
          text.text.should.eql(expected);
        }
        var pyText = expectStatus(await api('get', '/api/v1/trinkets/' + submissionId + '?format=python', tokA.secret), 200);
        pyText.text.should.contain('turtle.left(90)');
        expectStatus(await api('get', '/api/v1/trinkets/' + submissionId + '?format=zip', tokA.secret), 400);

        var matrix = expectStatus(await api('get', '/api/v1/courses/' + courseId + '/lernstand', tokA.secret), 200);
        matrix.body.byStudent.filter(function(s) { return s.studentId === idS; })[0].submitted.should.eql(2);
      });

      it('bereitet einen Entwurf vor, den die Oberfläche anzeigt', async function() {
        var res = expectStatus(await api('put', '/api/v1/trinkets/' + submissionId + '/feedback-draft', tokA.secret, { comment : 'Entwurf: gut gemacht' }), 200);
        res.body.trinket.feedback.draft.should.eql('Entwurf: gut gemacht');
        res.body.trinket.state.should.eql('submitted');
        expectStatus(await api('put', '/api/v1/trinkets/' + submissionId + '/feedback-draft', tokA.secret, { comment : 'Entwurf 2' }), 200)
          .body.trinket.comments.filter(function(c) { return c.type === 'feedback-draft'; }).length.should.eql(1);

        var ui = expectStatus(await session('wa', 'get', '/api/courses/' + courseId + '/lessons/' + lesson1 + '/materials/' + pyId + '/submissions'), 200);
        var row = ui.body.data.filter(function(u) { return u.userId === idS; })[0];
        row.comments.filter(function(c) { return c.commentType === 'feedback-draft'; })[0].commentText.should.eql('Entwurf 2');
      });

      it('gibt eine Abgabe mit Rückmeldung zurück (wie „Rückmeldung senden“)', async function() {
        var res = expectStatus(await api('post', '/api/v1/trinkets/' + submissionId + '/feedback', tokA.secret, {
          comment : 'Sehr schön! Nutze noch eine Variable für die Länge.', allowResubmit : true
        }), 200);
        res.body.trinket.state.should.eql('completed');
        res.body.trinket.feedback.text.should.contain('Variable');
        res.body.trinket.feedback.allowResubmit.should.be.true;
        res.body.trinket.feedback.includeRevision.should.be.false;
        var revisionId = res.body.trinket.feedback.revisionTrinketId;
        should.exist(revisionId);

        // erneut senden ändert dieselbe Rückmeldung, jetzt mit Überarbeitung
        var again = expectStatus(await api('post', '/api/v1/trinkets/' + submissionId + '/feedback', tokA.secret, {
          comment : 'Korrigiert, siehe Überarbeitung.', revision : { code : 'laenge = 50\n' }
        }), 200);
        again.body.trinket.comments.filter(function(c) { return c.type === 'feedback'; }).length.should.eql(1);
        again.body.trinket.feedback.revisionTrinketId.should.eql(revisionId);
        again.body.trinket.feedback.includeRevision.should.be.true;
        again.body.trinket.feedback.allowResubmit.should.be.true;
        var revision = await snippets().findById(revisionId);
        JSON.parse(revision.code).should.eql([{ name : 'main.py', content : 'laenge = 50\n' }]);
        String(revision._parent).should.eql(submissionId);

        // nur den Text ändern: Überarbeitung und includeRevision bleiben
        var third = expectStatus(await api('post', '/api/v1/trinkets/' + submissionId + '/feedback', tokA.secret, {
          comment : 'Korrigiert, siehe Überarbeitung.'
        }), 200);
        third.body.trinket.feedback.includeRevision.should.be.true;
        third.body.trinket.feedback.revisionTrinketId.should.eql(revisionId);
        JSON.parse((await snippets().findById(revisionId)).code).should.eql([{ name : 'main.py', content : 'laenge = 50\n' }]);

        // dieselben Daten in der Oberfläche (Dashboard der Aufgabe)
        var ui = expectStatus(await session('wa', 'get', '/api/courses/' + courseId + '/lessons/' + lesson1 + '/materials/' + pyId + '/submissions'), 200);
        var row = ui.body.data.filter(function(u) { return u.userId === idS; })[0];
        row.state.should.eql('completed');
        row.allowResubmit.should.be.true;
        row.comments.filter(function(c) { return c.commentType === 'feedback'; })[0].commentText.should.eql('Korrigiert, siehe Überarbeitung.');

        // SuS sieht die Rückmeldung bei ihren Abgaben
        var own = expectStatus(await session('ws', 'get', '/api/submissions/' + pyId), 200);
        own.body.data.filter(function(t) { return t.id === submissionId; })[0].submissionState.should.eql('completed');
      });

      it('Rückmeldung über die Oberfläche läuft weiter (gemeinsamer Service)', async function() {
        var res = expectStatus(await session('wa', 'post', '/api/courses/' + courseId + '/lessons/' + lesson2 + '/materials/' + blocksId + '/feedback', {
          code : { code : '<xml></xml>' }, trinketId : blocksSubmissionId, comments : 'Aus der Oberfläche', includeRevision : true, allowResubmit : false
        }), 200);
        res.body.data.submissionState.should.eql('completed');
        res.body.data.includeRevision.should.be.true;
        var detail = expectStatus(await api('get', '/api/v1/trinkets/' + blocksSubmissionId, tokA.secret), 200);
        detail.body.trinket.feedback.text.should.eql('Aus der Oberfläche');
      });

      it('nimmt eine verspätete Abgabe an und gibt sie dann zurück', async function() {
        var sub = expectStatus(await session('ws', 'post', '/api/courses/' + courseId + '/lessons/' + lesson2 + '/materials/' + lateId + '/submissions', {
          code : { code : '[]' }, comments : 'sorry', parent : lateStarter
        }), 200);
        lateSubmissionId = sub.body.submission.id;
        sub.body.submission.submissionState.should.eql('submittedLate');

        expectStatus(await api('post', '/api/v1/trinkets/' + lateSubmissionId + '/feedback', tokA.secret, { comment : 'x' }), 409);
        expectStatus(await api('post', '/api/v1/trinkets/' + lateSubmissionId + '/accept', tokARead.secret), 403);
        expectStatus(await api('post', '/api/v1/trinkets/' + lateSubmissionId + '/accept', tokA.secret), 200).body.trinket.state.should.eql('submitted');
        expectStatus(await api('post', '/api/v1/trinkets/' + lateSubmissionId + '/accept', tokA.secret), 409);
        expectStatus(await api('post', '/api/v1/trinkets/' + lateSubmissionId + '/feedback', tokA.secret, { comment : 'Danke' }), 200);
      });

      it('verwaltet Teilnehmende: ausblenden, Rolle, hinzufügen, entfernen', async function() {
        var list = expectStatus(await api('get', '/api/v1/courses/' + courseId + '/members', tokA.secret), 200);
        list.body.members.filter(function(m) { return m.id === idS; })[0].joinedVia.should.eql('iserv');
        list.body.members.filter(function(m) { return m.id === idA; })[0].role.should.eql('owner');

        var hidden = expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/members/' + idS, tokA.secret, { onDashboard : false }), 200);
        hidden.body.member.onDashboard.should.be.false;
        var students = expectStatus(await api('get', '/api/v1/courses/' + courseId + '/students', tokA.secret), 200);
        students.body.students.filter(function(s) { return s.id === idS; })[0].onDashboard.should.be.false;
        expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/members/' + idS, tokA.secret, { onDashboard : true }), 200).body.member.onDashboard.should.be.true;

        await devLogin('ws2', { email : S2, fullname : 'W SuS Zwei', role : 'student' });
        var idS2 = String((await users().findOne({ email : S2 }))._id);
        var added = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/students', tokA.secret, { login : S2 }), 201);
        added.body.member.id.should.eql(idS2);
        added.body.member.role.should.eql('student');
        should.not.exist(added.body.member.email);
        expectStatus(await api('post', '/api/v1/courses/' + courseId + '/students', tokA.secret, { login : S2 }), 200).body.alreadyListed.should.be.true;

        // unbekannt und Nicht-SuS: dieselbe Antwort
        var unknown = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/students', tokA.secret, { login : 'gibt-es-nicht' }), 404);
        var teacher = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/students', tokA.secret, { login : B }), 404);
        teacher.body.message.should.eql(unknown.body.message);

        // SuS lassen sich nicht befördern, Lehrkräfte schon (B kommt über die Oberfläche in den Kurs)
        expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/members/' + idS2, tokA.secret, { role : 'collaborator' }), 403);
        expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/members/' + idS2, tokA.secret, { role : 'admin' }), 403);
        expectStatus(await session('wa', 'post', '/api/courses/' + courseId + '/userLookup', { user : B }), 200);
        expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/members/' + idB, tokA.secret, { role : 'collaborator' }), 200).body.member.role.should.eql('collaborator');
        expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/members/' + idB, tokA.secret, { role : 'owner' }), 400);
        expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/members/' + idA, tokA.secret, { role : 'student' }), 409);
        expectStatus(await api('del', '/api/v1/courses/' + courseId + '/members/' + idA, tokA.secret), 409);
        expectStatus(await api('del', '/api/v1/courses/' + courseId + '/members/' + idB, tokA.secret), 204);
        expectStatus(await api('del', '/api/v1/courses/' + courseId + '/members/' + idS2, tokA.secret), 204);
        (await users().findById(idB)).roles.filter(function(r) { return r.context === 'course:' + courseId; }).length.should.eql(0);
      });

      it('löscht Material/Lektion mit Abgaben nur mit confirm=true', async function() {
        var lesson = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/lessons', tokA.secret, { name : 'Zum Löschen' }), 201).body.lesson.id;
        var task = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/lessons/' + lesson + '/materials', tokA.secret, {
          type : 'assignment', name : 'Wird gelöscht', starter : { lang : 'python' }
        }), 201).body.material;
        var other = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/lessons/' + lesson + '/materials', tokA.secret, {
          type : 'assignment', name : 'Auch weg', starter : { lang : 'python' }
        }), 201).body.material;
        expectStatus(await session('ws', 'post', '/api/courses/' + courseId + '/lessons/' + lesson + '/materials/' + task.id + '/startAssignment', { parent : task.assignment.trinketId }), 200);

        var refused = expectStatus(await api('del', '/api/v1/courses/' + courseId + '/materials/' + task.id, tokA.secret), 409);
        refused.body.message.should.contain('confirm=true');
        expectStatus(await api('del', '/api/v1/courses/' + courseId + '/lessons/' + lesson, tokA.secret), 409);
        expectStatus(await api('get', '/api/v1/courses/' + courseId + '/materials/' + task.id, tokA.secret), 200);

        expectStatus(await api('del', '/api/v1/courses/' + courseId + '/lessons/' + lesson + '?confirm=true', tokA.secret), 204);
        should.not.exist(await materials().findById(task.id));
        should.not.exist(await materials().findById(other.id));
        // die verwaiste Vorlage blockiert das Löschen nicht mehr
        expectStatus(await api('del', '/api/v1/trinkets/' + other.assignment.trinketId, tokA.secret), 204);
      });
    });

    describe('Bibliothek (trinkets:write)', function() {
      it('legt Trinkets an, ändert und löscht sie', async function() {
        var res = expectStatus(await api('post', '/api/v1/trinkets', tokA.secret, { lang : 'python', name : 'Vorlage Schleifen', code : 'print(1)\n' }), 201);
        libraryId = res.body.trinket.id;
        res.body.trinket.files.should.eql([{ name : 'main.py', content : 'print(1)\n' }]);

        var list = expectStatus(await api('get', '/api/v1/trinkets?lang=python', tokA.secret), 200);
        list.body.trinkets.map(function(t) { return t.id; }).should.include(libraryId);
        list.body.trinkets.map(function(t) { return t.id; }).should.include(pyStarter);

        var changed = expectStatus(await api('patch', '/api/v1/trinkets/' + libraryId, tokA.secret, { files : [{ name : 'main.py', content : 'print(2)\n' }, { name : 'daten.txt', content : 'x' }] }), 200);
        changed.body.trinket.files.length.should.eql(2);
        expectStatus(await api('patch', '/api/v1/trinkets/' + libraryId, tokA.secret, { code : 'a', files : [{ name : 'a.py', content : '' }] }), 400);

        // als Vorlage einer Aufgabe nutzen, dann ist Löschen gesperrt
        var task = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/lessons/' + lesson1 + '/materials', tokA.secret, {
          type : 'assignment', name : 'Mit Bibliotheks-Vorlage', starter : { trinketId : libraryId }
        }), 201);
        task.body.material.assignment.trinketId.should.eql(libraryId);
        var task2 = expectStatus(await api('post', '/api/v1/courses/' + courseId + '/lessons/' + lesson1 + '/materials', tokA.secret, {
          type : 'assignment', name : 'Zweite Aufgabe, gleiche Vorlage', starter : { trinketId : libraryId }
        }), 201);
        expectStatus(await api('del', '/api/v1/trinkets/' + libraryId, tokA.secret), 409);

        // Startcode einer gemeinsam genutzten Vorlage ändern → eigene Kopie, Vorlage bleibt
        var cow = expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/materials/' + task2.body.material.id, tokA.secret, {
          starter : { code : 'print(3)\n' }
        }), 200);
        cow.body.material.assignment.trinketId.should.not.eql(libraryId);
        cow.body.material.assignment.starter.files[0].content.should.eql('print(3)\n');
        JSON.parse((await snippets().findById(libraryId)).code)[0].content.should.eql('print(2)\n');

        expectStatus(await api('del', '/api/v1/courses/' + courseId + '/materials/' + task2.body.material.id, tokA.secret), 204);
        expectStatus(await api('del', '/api/v1/courses/' + courseId + '/materials/' + task.body.material.id, tokA.secret), 204);
        expectStatus(await api('del', '/api/v1/trinkets/' + libraryId, tokA.secret), 204);
        expectStatus(await api('get', '/api/v1/trinkets/' + libraryId, tokA.secret), 404);

        // Abgaben von SuS sind kein Bibliotheks-Trinket
        expectStatus(await api('patch', '/api/v1/trinkets/' + submissionId, tokA.secret, { name : 'x' }), 403);
        expectStatus(await api('post', '/api/v1/trinkets', tokARead.secret, { lang : 'python' }), 403);
      });

      it('legt Block-Trinkets an und liefert Python dazu', async function() {
        var xmlText = fs.readFileSync(path.join(BLOCKS_DIR, 'gerade-zufall.xml'), 'utf8');
        var res = expectStatus(await api('post', '/api/v1/trinkets', tokA.secret, { lang : 'blocks', name : 'Würfel', code : xmlText }), 201);
        res.body.trinket.code.should.eql(xmlText);
        if (blocks.isAvailable()) {
          var withPy = expectStatus(await api('get', '/api/v1/trinkets/' + res.body.trinket.id + '?python=true', tokA.secret), 200);
          withPy.body.trinket.pythonCode.should.eql(fs.readFileSync(path.join(BLOCKS_DIR, 'gerade-zufall.py'), 'utf8'));
        }
        expectStatus(await api('post', '/api/v1/trinkets', tokA.secret, { lang : 'blocks', files : [{ name : 'a', content : '' }] }), 400);
      });
    });

    describe('Fremde Kurse, fremde Token, SuS-Token', function() {
      before(async function() {
        // ein (eigentlich unmögliches) Token für ein SuS-Konto direkt in der Datenbank
        var secret = 'tl_' + new Array(49).join('5'),
            sus    = await users().findOne({ email : S });
        await new (tokens())({ _owner : sus._id, name : 'SuS', prefix : secret.substring(0, 11), hash : bearer.hashOf(secret), scopes : ALL_SCOPES }).save();
        tokStudent = secret;
      });

      function writes() {
        var c = '/api/v1/courses/' + courseId;
        return [
          ['patch', c, { name : 'gekapert' }],
          ['patch', c, { archived : true }],
          ['del',   c + '?confirm=true'],
          ['post',  c + '/copy', { name : 'Kopie von A' }],
          ['put',   c + '/iserv-group', { act : 'klasse.7a' }],
          ['del',   c + '/iserv-group'],
          ['post',  c + '/access-code'],
          ['post',  c + '/lessons', { name : 'fremd' }],
          ['put',   c + '/lessons/order', { lessonIds : [] }],
          ['patch', c + '/lessons/' + lesson1, { name : 'fremd' }],
          ['del',   c + '/lessons/' + lesson1],
          ['post',  c + '/lessons/' + lesson1 + '/materials', { type : 'page', name : 'fremd' }],
          ['put',   c + '/lessons/' + lesson1 + '/materials/order', { materialIds : [] }],
          ['patch', c + '/materials/' + pyId, { name : 'fremd' }],
          ['del',   c + '/materials/' + pyId],
          ['post',  c + '/import', { lessons : [{ name : 'fremd' }] }],
          ['post',  c + '/students', { login : B }],
          ['patch', c + '/members/' + idS, { onDashboard : false }],
          ['del',   c + '/members/' + idS],
          ['post',  '/api/v1/trinkets/' + submissionId + '/feedback', { comment : 'fremd' }],
          ['put',   '/api/v1/trinkets/' + submissionId + '/feedback-draft', { comment : 'fremd' }],
          ['post',  '/api/v1/trinkets/' + lateSubmissionId + '/accept'],
          ['patch', '/api/v1/trinkets/' + pyStarter, { name : 'fremd' }],
          ['del',   '/api/v1/trinkets/' + pyStarter]
        ];
      }

      function reads() {
        var c = '/api/v1/courses/' + courseId;
        return [
          ['get', c],
          ['get', c + '/members'],
          ['get', c + '/access-code'],
          ['get', c + '/materials/' + pyId],
          ['get', c + '/lernstand'],
          ['get', c + '/assignments/' + pyId + '/submissions?includeCode=true'],
          ['get', '/api/v1/trinkets/' + submissionId]
        ];
      }

      it('B\'s Token kann A\'s Kurse weder lesen noch ändern (403)', async function() {
        var all = writes().concat(reads());
        for (var i = 0; i < all.length; i++) {
          var res = await api(all[i][0], all[i][1], tokB.secret, all[i][2]);
          res.statusCode.should.eql(403, all[i][0].toUpperCase() + ' ' + all[i][1] + ': ' + JSON.stringify(res.body));
        }
        // nichts wurde verändert
        var course = await courses().findById(courseId);
        course.name.should.eql('API-Kurs 9a');
        course.archived.should.be.false;
        course.externalLink.sourceId.should.eql('klasse.9a');
        (await materials().findById(pyId)).name.should.eql('Quadrat in Python');
      });

      it('B\'s Bibliothek enthält A\'s Trinkets nicht', async function() {
        var list = expectStatus(await api('get', '/api/v1/trinkets', tokB.secret), 200);
        list.body.trinkets.map(function(t) { return t.id; }).should.not.include(pyStarter);
      });

      it('ein SuS-Token hat keine Rechte (403)', async function() {
        var all = writes().concat([['post', '/api/v1/courses', { name : 'SuS-Kurs' }], ['post', '/api/v1/trinkets', { lang : 'python' }]]);
        for (var i = 0; i < all.length; i++) {
          var res = await api(all[i][0], all[i][1], tokStudent, all[i][2]);
          res.statusCode.should.eql(403, all[i][0].toUpperCase() + ' ' + all[i][1]);
        }
      });

      it('Token ohne Schreib-Scope bekommt bei jedem Schreibzugriff 403', async function() {
        var all = writes();
        for (var i = 0; i < all.length; i++) {
          var res = await api(all[i][0], all[i][1], tokARead.secret, all[i][2]);
          res.statusCode.should.eql(403, all[i][0].toUpperCase() + ' ' + all[i][1]);
          res.body.message.should.match(/Scope/);
        }
      });

      it('widerrufenes Token und fehlendes Token: 401', async function() {
        var all = writes().slice(0, 5);
        for (var i = 0; i < all.length; i++) {
          (await api(all[i][0], all[i][1], tokRevoked.secret, all[i][2])).statusCode.should.eql(401);
          (await api(all[i][0], all[i][1], null, all[i][2])).statusCode.should.eql(401);
        }
      });

      it('ignoriert Session-Cookies auf /api/v1 (kein CSRF)', async function() {
        var res = await session('wa', 'post', '/api/v1/courses', { name : 'per Cookie' });
        res.statusCode.should.eql(401);
      });
    });

    describe('Schutz', function() {
      it('protokolliert jeden Schreibzugriff mit Person und Token', function() {
        var lines = logSpy.getCalls().map(function(c) { return String(c.args[0]); }).filter(function(l) { return /^API-Schreibzugriff/.test(l); });
        lines.some(function(l) { return /POST \/api\/v1\/courses → 201 von .* \(Token tl_.*A-SchulAssistent-geheim/.test(l) && /angelegt/.test(l); }).should.be.true;
        lines.some(function(l) { return / → 403 /.test(l) && /B-eigenes-Token/.test(l); }).should.be.true;
      });

      it('bremst zu viele Schreibzugriffe je Token (429)', async function() {
        var tok = await newToken('wa', 'A-Bremse', ['content:write']);
        config.app.api = { writeLimitPerMinute : 2 };
        try {
          expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/lessons/' + lesson1, tok.secret, { name : 'Lektion 1' }), 200);
          expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/lessons/' + lesson1, tok.secret, { name : 'Lektion 1' }), 200);
          var res = expectStatus(await api('patch', '/api/v1/courses/' + courseId + '/lessons/' + lesson1, tok.secret, { name : 'Lektion 1' }), 429);
          should.exist(res.headers['retry-after']);
        } finally {
          config.app.api = previousApi;
        }
      });

      it('begrenzt die Größe von Anfragen', async function() {
        var big = new Array(3 * 1024 * 1024).join('x');
        var res = await api('post', '/api/v1/trinkets', tokA.secret, { lang : 'python', code : big });
        res.statusCode.should.eql(413);
      });

      it('löscht den Kurs nur mit confirm=true', async function() {
        expectStatus(await api('del', '/api/v1/courses/' + courseId, tokA.secret), 400);
        expectStatus(await api('del', '/api/v1/courses/' + courseId + '?confirm=true', tokA.secret), 204);
        expectStatus(await api('get', '/api/v1/courses/' + courseId + '/members', tokA.secret), 404);
      });
    });
  });
};
