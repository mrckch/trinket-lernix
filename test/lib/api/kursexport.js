// Kurs-Export als ZIP: Oberfläche (/…/abgaben.zip) und Token-API (/api/v1/courses/{id}/export.zip)
var should   = require('chai').should(),
    config   = require('config'),
    mongoose = require('mongoose'),
    JSZip    = require('jszip'),
    flow     = require('../../helpers/flow'),
    blocks   = require('../../../lib/services/blocks'),
    kursexport = require('../../../lib/services/kursexport');

function users()     { return mongoose.model('User'); }
function courses()   { return mongoose.model('Course'); }
function lessons()   { return mongoose.model('Lesson'); }
function materials() { return mongoose.model('Material'); }
function snippets()  { return mongoose.model('Snippet'); }
function tokens()    { return mongoose.model('ApiToken'); }

var T = 'x-lehrkraft@schule.test', F = 'x-fremd@schule.test', S = 'x-sus@schule.test';

var QUADRAT = '<xml xmlns="http://www.w3.org/1999/xhtml"><block type="controls_repeat_ext" x="20" y="20"><value name="TIMES"><shadow type="math_number"><field name="NUM">4</field></shadow></value><statement name="DO"><block type="draw_move"><field name="DIR">forward</field><value name="VALUE"><shadow type="math_number"><field name="NUM">100</field></shadow></value><next><block type="draw_turn"><field name="DIR">right</field><value name="VALUE"><shadow type="math_number"><field name="NUM">90</field></shadow></value></block></next></block></statement></block></xml>';

function result(req) {
  return new Promise(function(resolve, reject) {
    req.end(flow.setLastResponse(function(err, res) { return res ? resolve(res) : reject(err); }));
  });
}

function binary(req) {
  return req.buffer(true).parse(function(res, cb) {
    var chunks = [];
    res.on('data', function(c) { chunks.push(c); });
    res.on('end', function() { cb(null, Buffer.concat(chunks)); });
  });
}

function api(method, url, secret, body, raw) {
  flow.switchUser('nocookie');
  var req = flow[method](url).set('Accept', raw ? '*/*' : 'application/json');
  if (secret) req.set('Authorization', 'Bearer ' + secret);
  if (body !== undefined) req.set('Content-Type', 'application/json').send(body);
  return result(raw ? binary(req) : req);
}

function session(who, method, url, body, raw) {
  flow.switchUser(who);
  var req = flow[method](url).set('Accept', raw ? '*/*' : 'application/json');
  if (body !== undefined) req.set('Content-Type', 'application/json').send(body);
  return result(raw ? binary(req) : req);
}

function devLogin(who, body) {
  flow.switchUser(who);
  return result(flow.post('/auth/dev').send(body));
}

function expectStatus(res, status) {
  res.statusCode.should.eql(status, res.req ? res.req.method + ' ' + res.req.path + ': ' + (Buffer.isBuffer(res.body) ? res.body.toString().slice(0, 200) : JSON.stringify(res.body)) : '');
  return res;
}

async function newToken(who, name, scopes) {
  var res = expectStatus(await session(who, 'post', '/api/tokens', { name : name, scopes : scopes }), 200);
  return res.body.secret;
}

module.exports = function() {
  describe('Kurs-Export (ZIP)', function() {
    var tok, tokFremd, tokOhneScope, course, lessonId, pyId, blId, pyStarter, blStarter, previousBlocks;

    before(async function() {
      previousBlocks = config.features.trinkets.blocks;
      config.features.trinkets.blocks = true;

      await devLogin('xa', { email : T, fullname : 'X Lehrkraft', role : 'teacher', groups : 'klasse.5a:Klasse 5a' });
      await devLogin('xf', { email : F, fullname : 'X Fremd', role : 'teacher' });
      tok          = await newToken('xa', 'Export', ['courses:read', 'courses:write', 'content:write', 'submissions:read', 'submissions:write']);
      tokOhneScope = await newToken('xa', 'Nur Kurse', ['courses:read']);
      tokFremd     = await newToken('xf', 'Fremd', ['courses:read', 'submissions:read']);

      var c = expectStatus(await api('post', '/api/v1/courses', tok, { name : 'Export 5a', courseType : 'private', iservGroup : { act : 'klasse.5a' } }), 201);
      course = c.body.course || c.body;
      var imp = expectStatus(await api('post', '/api/v1/courses/' + course.id + '/import', tok, { lessons : [{ name : 'Stunde 1', materials : [
        { type : 'assignment', name : 'Python: Begrüßung', content : 'Gib Hallo aus.', starter : { lang : 'python', code : 'print("")\n' } },
        { type : 'assignment', name : 'Blöcke: Quadrat / Haus?', content : 'Zeichne ein Quadrat.', starter : { lang : 'blocks', code : '<xml xmlns="http://www.w3.org/1999/xhtml"></xml>' } }
      ] }] }), 201);
      lessonId = imp.body.lessons[0].id;
      pyId = imp.body.lessons[0].materials[0].id;
      blId = imp.body.lessons[0].materials[1].id;
      pyStarter = expectStatus(await api('get', '/api/v1/courses/' + course.id + '/materials/' + pyId, tok), 200).body.material.assignment.starter.id;
      blStarter = expectStatus(await api('get', '/api/v1/courses/' + course.id + '/materials/' + blId, tok), 200).body.material.assignment.starter.id;

      // SuS kommt über die IServ-Gruppe in den Kurs und gibt beide Aufgaben ab
      await devLogin('xs', { email : S, fullname : 'X SuS', role : 'student', groups : 'klasse.5a:Klasse 5a' });
      expectStatus(await session('xs', 'post', '/api/courses/' + course.id + '/lessons/' + lessonId + '/materials/' + pyId + '/submissions', {
        code : { code : JSON.stringify([{ name : 'main.py', content : 'print("Hallo Welt")\n' }]) }, comments : 'Fertig!', parent : pyStarter
      }), 200);
      expectStatus(await session('xs', 'post', '/api/courses/' + course.id + '/lessons/' + lessonId + '/materials/' + blId + '/submissions', {
        code : { code : QUADRAT }, comments : '', parent : blStarter
      }), 200);

      // Rückmeldung zur Python-Abgabe
      var subs = expectStatus(await api('get', '/api/v1/courses/' + course.id + '/assignments/' + pyId + '/submissions', tok), 200);
      var tid = subs.body.submissions[0].trinket.id;
      expectStatus(await api('post', '/api/v1/trinkets/' + tid + '/feedback', tok, { comment : 'Gut gemacht; =SUMME(A1) bleibt Text.' }), 200);
    });

    after(async function() {
      config.features.trinkets.blocks = previousBlocks;
      var ids = (await users().find({ email : { $in : [T, F, S] } }).select('_id').lean()).map(function(d) { return d._id; });
      await Promise.all([
        tokens().deleteMany({ _owner : { $in : ids } }),
        snippets().deleteMany({ $or : [{ _owner : { $in : ids } }, { _creator : { $in : ids } }] }),
        lessons().deleteMany({ _owner : { $in : ids } }),
        materials().deleteMany({ _owner : { $in : ids } }),
        courses().deleteMany({ _owner : { $in : ids } }),
        users().deleteMany({ _id : { $in : ids } })
      ]);
    });

    it('liefert alle Abgaben mit Code, Python, Kommentar, Rückmeldung und Lernstand', async function() {
      var res = expectStatus(await api('get', '/api/v1/courses/' + course.id + '/export.zip', tok, undefined, true), 200);
      res.headers['content-type'].should.contain('application/zip');
      res.headers['content-disposition'].should.contain('abgaben-export-5a-');

      var zip   = await JSZip.loadAsync(res.body),
          names = Object.keys(zip.files);
      names.should.include('LIESMICH.txt');
      names.should.include('lernstand.csv');

      var csv = await zip.file('lernstand.csv').async('string');
      csv.charCodeAt(0).should.eql(0xfeff);
      csv.should.contain('Name;Benutzername;Python: Begrüßung;Blöcke: Quadrat / Haus?');
      csv.should.contain('X SuS;');
      csv.should.contain('zurückgegeben;abgegeben');

      var py = names.filter(function(n) { return /01 Python- Begrüßung\/main\.py$/.test(n); })[0];
      should.exist(py, names.join('\n'));
      (await zip.file(py).async('string')).should.contain('Hallo Welt');
      var info = await zip.file(py.replace('main.py', 'info.txt')).async('string');
      info.should.contain('Status:       zurückgegeben');
      info.should.contain('Fertig!');
      info.should.contain('Gut gemacht');

      // „/“ und „?“ im Aufgabennamen werden zu „-“
      var bl = names.filter(function(n) { return /02 Blöcke- Quadrat - Haus-\/bloecke\.xml$/.test(n); })[0];
      should.exist(bl, names.join('\n'));
      (await zip.file(bl).async('string')).should.contain('controls_repeat_ext');
      if (blocks.isAvailable()) {
        (await zip.file(bl.replace('bloecke.xml', 'programm.py')).async('string')).should.contain('turtle.forward(100)');
      }
    });

    it('steht im Dashboard der Lehrkraft zum Herunterladen bereit', async function() {
      var res = expectStatus(await session('xa', 'get', '/' + course.owner + '/courses/' + course.slug + '/abgaben.zip', undefined, true), 200);
      res.headers['content-type'].should.contain('application/zip');
      var zip = await JSZip.loadAsync(res.body);
      should.exist(zip.file('lernstand.csv'));
    });

    it('verweigert SuS, fremden Lehrkräften und Token ohne submissions:read', async function() {
      expectStatus(await session('xs', 'get', '/' + course.owner + '/courses/' + course.slug + '/abgaben.zip'), 403);
      expectStatus(await api('get', '/api/v1/courses/' + course.id + '/export.zip', tokFremd), 403);
      expectStatus(await api('get', '/api/v1/courses/' + course.id + '/export.zip', tokOhneScope), 403);
      expectStatus(await api('get', '/api/v1/courses/' + course.id + '/export.zip', null), 401);
      expectStatus(await api('get', '/api/v1/courses/0123456789abcdef01234567/export.zip', tok), 404);
    });

    it('macht Namen und CSV-Zellen unbedenklich', function() {
      kursexport.safeName('a/b\\c:d*e?f"g<h>i|j', 'x').should.eql('a-b-c-d-e-f-g-h-i-j');
      kursexport.safeName('  ..  ', 'leer').should.eql('leer');
      kursexport.csvCell('=SUMME(A1)').should.eql("'=SUMME(A1)");
      kursexport.csvCell('a;b').should.eql('"a;b"');
    });
  });
};
