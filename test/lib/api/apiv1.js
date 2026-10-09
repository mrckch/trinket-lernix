// Lernstand-API: Token-Verwaltung und /api/v1 (Bearer)
var should = require('chai').should(),
    flow   = require('../../helpers/flow');

function users()    { return require('mongoose').model('User'); }
function courses()  { return require('mongoose').model('Course'); }
function snippets() { return require('mongoose').model('Snippet'); }
function tokens()   { return require('mongoose').model('ApiToken'); }

var TEACHER  = 't-lehrkraft@schule.test',
    TEACHER2 = 't-lehrkraft2@schule.test',
    STUDENT  = 't-sus@schule.test';

function devLogin(who, body, cb) {
  flow.switchUser(who);
  flow.post('/auth/dev').send(body).end(flow.setLastResponse(function(err) { cb(err); }));
}

function json(req) {
  return req.set('Accept', 'application/json').set('Content-Type', 'application/json');
}

function api(method, url, secret) {
  flow.switchUser('nocookie');
  var req = flow[method](url).set('Accept', 'application/json');
  if (secret) req.set('Authorization', 'Bearer ' + secret);
  return req;
}

module.exports = function() {
  describe('Lernstand-API', function() {
    var courseId, lessonId, materialId, blankTrinketId, studentId, secret, tokenId, limitedSecret, foreignSecret;

    before(function(done) {
      devLogin('tteacher', { email : TEACHER, fullname : 'T Lehrkraft', role : 'teacher', groups : 'klasse.8c:Klasse 8c' }, function(err) {
        if (err) return done(err);
        json(flow.post('/api/courses')).send({ name : 'Token-Test 8c', description : 'x', courseType : 'private', iservGroupAct : 'klasse.8c' })
          .end(flow.setLastResponse(function(err, res) {
            if (err) return done(err);
            courseId = res.body.course.id;
            json(flow.post('/api/courses/' + courseId + '/lessons')).send({ name : 'Lektion 1' })
              .end(flow.setLastResponse(function(err, res) {
                if (err) return done(err);
                lessonId = res.body.data.id;
                json(flow.post('/api/courses/' + courseId + '/lessons/' + lessonId + '/materials'))
                  .send({ name : 'Aufgabe 1', type : 'assignment', trinketId : '_blank_', lang : 'python' })
                  .end(flow.setLastResponse(function(err, res) {
                    if (err) return done(err);
                    materialId     = res.body.data.id;
                    blankTrinketId = res.body.data.trinket.trinketId;
                    devLogin('tstudent', { email : STUDENT, fullname : 'T SuS', role : 'student', groups : 'klasse.8c:Klasse 8c' }, function(err) {
                      if (err) return done(err);
                      json(flow.post('/api/courses/' + courseId + '/lessons/' + lessonId + '/materials/' + materialId + '/startAssignment'))
                        .send({ parent : blankTrinketId })
                        .end(flow.setLastResponse(function(err, res) {
                          if (err) return done(err);
                          res.statusCode.should.eql(200);
                          users().findOne({ email : STUDENT }).then(function(u) { studentId = String(u._id); done(); }).catch(done);
                        }));
                    });
                  }));
              }));
          }));
      });
    });

    after(function(done) {
      users().find({ email : { $in : [TEACHER, TEACHER2, STUDENT] } }).select('_id').lean().then(function(docs) {
        var ids = docs.map(function(d) { return d._id; });
        return Promise.all([
          tokens().deleteMany({ _owner : { $in : ids } }),
          snippets().deleteMany({ $or : [{ _owner : { $in : ids } }, { _creator : { $in : ids } }] }),
          courses().deleteMany({ name : 'Token-Test 8c' }),
          users().deleteMany({ _id : { $in : ids } })
        ]);
      }).then(function() { done(); }).catch(done);
    });

    it('lässt SuS keine Token anlegen', function(done) {
      flow.switchUser('tstudent');
      json(flow.post('/api/tokens')).send({ name : 'x', scopes : ['courses:read'] }).end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(403);
        done();
      }));
    });

    it('legt ein Token für die Lehrkraft an und zeigt das Geheimnis einmal', function(done) {
      flow.switchUser('tteacher');
      json(flow.post('/api/tokens')).send({ name : 'SchulAssistent', scopes : ['courses:read', 'submissions:read', 'trinkets:read'] })
        .end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(200);
          res.body.secret.should.match(/^tl_[0-9a-f]{48}$/);
          res.body.token.prefix.should.eql(res.body.secret.substring(0, 11));
          res.body.token.active.should.be.true;
          secret  = res.body.secret;
          tokenId = res.body.token.id;

          json(flow.get('/api/tokens')).end(flow.setLastResponse(function(err, res) {
            res.statusCode.should.eql(200);
            res.body.tokens.length.should.eql(1);
            should.not.exist(res.body.tokens[0].secret);
            should.not.exist(res.body.tokens[0].hash);
            done();
          }));
        }));
    });

    it('lehnt unbekannte Scopes ab', function(done) {
      flow.switchUser('tteacher');
      json(flow.post('/api/tokens')).send({ name : 'x', scopes : ['admin:write'] }).end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(400);
        done();
      }));
    });

    it('verlangt ein Bearer-Token (kein Cookie)', function(done) {
      api('get', '/api/v1/me').end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(401);
        flow.switchUser('tteacher');
        flow.get('/api/v1/me').set('Accept', 'application/json').end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(401);
          api('get', '/api/v1/me', 'tl_falsch').end(flow.setLastResponse(function(err, res) {
            res.statusCode.should.eql(401);
            done();
          }));
        }));
      }));
    });

    it('GET /api/v1/me', function(done) {
      api('get', '/api/v1/me', secret).end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(200);
        res.body.email.should.eql(TEACHER);
        res.body.roles.should.include('teacher');
        res.body.token.scopes.should.eql(['courses:read', 'submissions:read', 'trinkets:read']);
        done();
      }));
    });

    it('GET /api/v1/courses', function(done) {
      api('get', '/api/v1/courses', secret).end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(200);
        var course = res.body.courses.filter(function(c) { return c.id === courseId; })[0];
        should.exist(course);
        course.studentCount.should.eql(1);
        course.iservGroup.should.eql({ act : 'klasse.8c', name : 'Klasse 8c' });
        done();
      }));
    });

    it('GET /api/v1/courses/{id} mit Gliederung', function(done) {
      api('get', '/api/v1/courses/' + courseId, secret).end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(200);
        res.body.lessons.length.should.eql(1);
        var material = res.body.lessons[0].materials[0];
        material.type.should.eql('assignment');
        material.assignment.lang.should.eql('python');
        material.assignment.submissionsDue.enabled.should.be.false;
        done();
      }));
    });

    it('GET /api/v1/courses/{id}/students', function(done) {
      api('get', '/api/v1/courses/' + courseId + '/students', secret).end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(200);
        res.body.students.length.should.eql(1);
        res.body.students[0].email.should.eql(STUDENT);
        res.body.students[0].joinedVia.should.eql('iserv');
        done();
      }));
    });

    it('GET /api/v1/courses/{id}/lernstand', function(done) {
      api('get', '/api/v1/courses/' + courseId + '/lernstand', secret).end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(200);
        res.body.assignments.length.should.eql(1);
        res.body.students.length.should.eql(1);
        res.body.submissions.length.should.eql(1);
        res.body.submissions[0].state.should.eql('started');
        res.body.submissions[0].studentId.should.eql(studentId);
        res.body.byAssignment[0].started.should.eql(1);
        res.body.byAssignment[0].notStarted.should.eql(0);
        res.body.byStudent[0].started.should.eql(1);
        done();
      }));
    });

    it('GET /api/v1/courses/{id}/students/{userId}/submissions und das Trinket', function(done) {
      api('get', '/api/v1/courses/' + courseId + '/students/' + studentId + '/submissions', secret).end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(200);
        res.body.submissions.length.should.eql(1);
        var trinketId = res.body.submissions[0].id;
        api('get', '/api/v1/trinkets/' + trinketId, secret).end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(200);
          res.body.trinket.id.should.eql(trinketId);
          res.body.trinket.should.have.property('code');
          res.body.trinket.state.should.eql('started');
          done();
        }));
      }));
    });

    it('verweigert ohne passenden Scope (403)', function(done) {
      flow.switchUser('tteacher');
      json(flow.post('/api/tokens')).send({ name : 'nur Kurse', scopes : ['courses:read'] }).end(flow.setLastResponse(function(err, res) {
        limitedSecret = res.body.secret;
        api('get', '/api/v1/courses/' + courseId + '/lernstand', limitedSecret).end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(403);
          api('get', '/api/v1/courses', limitedSecret).end(flow.setLastResponse(function(err, res) {
            res.statusCode.should.eql(200);
            done();
          }));
        }));
      }));
    });

    it('verweigert fremde Kurse (403)', function(done) {
      devLogin('tteacher2', { email : TEACHER2, fullname : 'T Lehrkraft 2', role : 'teacher' }, function(err) {
        if (err) return done(err);
        json(flow.post('/api/tokens')).send({ name : 'fremd', scopes : ['courses:read', 'submissions:read'] }).end(flow.setLastResponse(function(err, res) {
          foreignSecret = res.body.secret;
          api('get', '/api/v1/courses/' + courseId + '/lernstand', foreignSecret).end(flow.setLastResponse(function(err, res) {
            res.statusCode.should.eql(403);
            api('get', '/api/v1/courses', foreignSecret).end(flow.setLastResponse(function(err, res) {
              res.body.courses.filter(function(c) { return c.id === courseId; }).length.should.eql(0);
              done();
            }));
          }));
        }));
      });
    });

    it('widerruft ein Token (danach 401)', function(done) {
      flow.switchUser('tteacher');
      flow.del('/api/tokens/' + tokenId).set('Accept', 'application/json').end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(200);
        res.body.token.active.should.be.false;
        api('get', '/api/v1/me', secret).end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(401);
          done();
        }));
      }));
    });

    it('zeigt die Token-Seite nur Lehrkräften', function(done) {
      flow.switchUser('tteacher');
      flow.get('/account/tokens').end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(200);
        res.text.should.contain('Token anlegen');
        flow.switchUser('tstudent');
        flow.get('/account/tokens').end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(403);
          done();
        }));
      }));
    });
  });
};
