// Login-Pflicht (ADR 0005): ohne Konto nur Start/Login/Hilfe, Einbettungen und Token-API
var should = require('chai').should(),
    config = require('config'),
    flow   = require('../../helpers/flow'),
    access = require('../../../lib/auth/access');

function users()    { return require('mongoose').model('User'); }
function snippets() { return require('mongoose').model('Snippet'); }

module.exports = function() {
  describe('Login-Pflicht', function() {
    var previous, trinketId, shortCode;

    before(function(done) {
      previous = config.app.auth.requireLogin;
      config.app.auth.requireLogin = true;
      // ein vorhandenes Trinket einer Lehrkraft für den Einbettungs-Test
      flow.switchUser('ateacher');
      flow.post('/auth/dev').send({ email : 'a-lehrkraft@schule.test', fullname : 'A Lehrkraft', role : 'teacher' })
        .end(flow.setLastResponse(function(err) {
          if (err) return done(err);
          flow.post('/api/trinkets').set('Accept', 'application/json').set('Content-Type', 'application/json')
            .send({ name : 'Embed-Test', lang : 'python', code : 'print(1)' })
            .end(flow.setLastResponse(function(err, res) {
              if (err) return done(err);
              res.statusCode.should.eql(200);
              var t = res.body.data || res.body.trinket || res.body;
              trinketId = t.id || t._id;
              shortCode = t.shortCode;
              flow.switchUser('');
              done();
            }));
        }));
    });

    after(function(done) {
      config.app.auth.requireLogin = previous;
      users().findOne({ email : 'a-lehrkraft@schule.test' }).then(function(u) {
        if (!u) return;
        return snippets().deleteMany({ _owner : u._id }).then(function() { return users().deleteMany({ _id : u._id }); });
      }).then(function() { done(); }).catch(done);
    });

    it('kennt die öffentlichen Pfade', function() {
      access.isPublic('GET', '/').should.be.true;
      access.isPublic('GET', '/login').should.be.true;
      access.isPublic('GET', '/auth/iserv').should.be.true;
      access.isPublic('GET', '/js/trinket.js').should.be.true;
      access.isPublic('GET', '/vendor/cdnjs/jquery/2.2.4/jquery.min.js').should.be.true;
      access.isPublic('GET', '/cache-prefix-123/css/base.css').should.be.true;
      access.isPublic('GET', '/assets/lato-latin-300-normal.woff2').should.be.true;
      access.isPublic('HEAD', '/').should.be.true;
      access.isPublic('head', '/healthz').should.be.true;
      access.isPublic('HEAD', '/python').should.be.false;
      access.isPublic('GET', '/embed/python/abc123').should.be.true;
      access.isPublic('GET', '/embed/blocks-iframe').should.be.true;
      access.isPublic('GET', '/embed/glowscript-blocks-iframe').should.be.true;
      access.isPublic('GET', '/api/trinkets/abc123').should.be.true;
      access.isPublic('GET', '/api/v1/courses').should.be.true;
      access.isPublic('GET', '/embed/python').should.be.false;
      access.isPublic('GET', '/home').should.be.false;
      access.isPublic('GET', '/python').should.be.false;
      access.isPublic('POST', '/api/trinkets').should.be.false;
      access.isPublic('GET', '/library/trinkets').should.be.false;
    });

    it('leitet Seiten ohne Anmeldung zum Login um', function(done) {
      flow.get('/python').end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(302);
        flow.lastRedirect.pathname.should.eql('/login');
        flow.lastRedirect.query.should.contain('next=');
        flow.get('/library/trinkets').end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(302);
          flow.lastRedirect.pathname.should.eql('/login');
          done();
        }));
      }));
    });

    it('merkt sich Unterressourcen nicht als Rücksprungziel', function(done) {
      flow.get('/python').set('Sec-Fetch-Dest', 'font').end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(302);
        flow.lastRedirect.pathname.should.eql('/login');
        String(flow.lastRedirect.query || '').should.not.contain('next=');
        done();
      }));
    });

    it('lässt Start-, Login- und Hilfeseite offen', function(done) {
      flow.get('/').end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(200);
        flow.get('/login').end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(200);
          done();
        }));
      }));
    });

    it('verweigert anonyme API-Aufrufe mit 401', function(done) {
      flow.post('/api/trinkets').set('Accept', 'application/json').set('Content-Type', 'application/json')
        .send({ name : 'x', lang : 'python', code : 'print(2)' })
        .end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(401);
          done();
        }));
    });

    it('zeigt vorhandene Trinkets als Einbettung weiterhin an', function(done) {
      flow.get('/embed/python/' + shortCode).end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(200);
        flow.get('/api/trinkets/' + trinketId).set('Accept', 'application/json').end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(200);
          done();
        }));
      }));
    });

    it('lässt angemeldete Nutzer wie gewohnt arbeiten', function(done) {
      flow.switchUser('ateacher');
      flow.get('/python').end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(200);
        flow.switchUser('');
        done();
      }));
    });

    it('lässt die Besitzerin ihr Trinket speichern', function(done) {
      flow.switchUser('ateacher');
      // wie der Editor: mit ?library=true angelegt → Besitzerin ist die angemeldete Lehrkraft
      flow.post('/api/trinkets?library=true').set('Accept', 'application/json').set('Content-Type', 'application/json')
        .send({ name : 'Eigenes', lang : 'python', code : 'print(1)' })
        .end(flow.setLastResponse(function(err, res) {
          if (err) return done(err);
          var t = res.body.data || res.body;
          flow.put('/api/trinkets/' + (t.id || t._id) + '/code').set('Accept', 'application/json').set('Content-Type', 'application/json')
            .send({ code : 'print(2)' })
            .end(flow.setLastResponse(function(err, res) {
              flow.switchUser('');
              res.statusCode.should.eql(200);
              done();
            }));
        }));
    });

    it('schickt Angemeldete von /login weiter nach /home', function(done) {
      flow.switchUser('ateacher');
      flow.get('/login').end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(302);
        flow.lastRedirect.pathname.should.eql('/home');
        flow.switchUser('');
        done();
      }));
    });

    it('ist abschaltbar', function(done) {
      config.app.auth.requireLogin = false;
      flow.get('/python').end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(200);
        config.app.auth.requireLogin = true;
        done();
      }));
    });
  });
};
