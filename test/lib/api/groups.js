// IServ-Gruppen → Kurse: Verknüpfung durch die Lehrkraft, automatische Zuordnung der SuS beim Login
var should = require('chai').should(),
    flow   = require('../../helpers/flow'),
    groups = require('../../../lib/auth/groups');

function users()   { return require('mongoose').model('User'); }
function courses() { return require('mongoose').model('Course'); }

var TEACHER = 'g-lehrkraft@schule.test',
    STUDENT = 'g-sus@schule.test';

function devLogin(who, body, cb) {
  flow.switchUser(who);
  flow.post('/auth/dev').send(body).end(flow.setLastResponse(function(err) { cb(err); }));
}

function json(req) {
  return req.set('Accept', 'application/json').set('Content-Type', 'application/json');
}

module.exports = function() {
  describe('IServ-Gruppen → Kurse', function() {
    var courseId, accessCode;

    before(function(done) {
      devLogin('gteacher', { email : TEACHER, fullname : 'G Lehrkraft', role : 'teacher', groups : 'klasse.9b:Klasse 9b, klasse.7a:Klasse 7a' }, done);
    });

    after(function(done) {
      courses().deleteMany({ name : /^Gruppen-Test/ })
        .then(function() { return users().deleteMany({ email : { $in : [TEACHER, STUDENT] } }); })
        .then(function() { done(); }).catch(done);
    });

    it('parst simulierte Gruppen', function() {
      groups.parseDevGroups('klasse.9b:Klasse 9b, ag, :leer,').should.eql([
        { act : 'klasse.9b', name : 'Klasse 9b' },
        { act : 'ag', name : 'ag' },
        { act : 'leer', name : 'leer' }
      ]);
      groups.parseDevGroups('').should.eql([]);
    });

    it('liefert die Gruppen der Lehrkraft aus der Session', function(done) {
      json(flow.get('/api/iserv/groups')).end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(200);
        res.body.groups.map(function(g) { return g.name; }).should.eql(['Klasse 9b', 'Klasse 7a']);
        done();
      }));
    });

    it('verknüpft einen neuen Kurs mit einer eigenen Gruppe', function(done) {
      json(flow.post('/api/courses')).send({ name : 'Gruppen-Test 9b', description : 'x', courseType : 'private', iservGroupAct : 'klasse.9b' })
        .end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(200);
          res.body.course.externalLink.should.eql({ source : 'iserv', sourceId : 'klasse.9b', name : 'Klasse 9b' });
          courseId = res.body.course.id;
          done();
        }));
    });

    it('lehnt fremde Gruppen ab', function(done) {
      json(flow.post('/api/courses')).send({ name : 'Gruppen-Test fremd', description : 'x', iservGroupAct : 'klasse.5x' })
        .end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(403);
          done();
        }));
    });

    it('trägt eine SuS beim Login mit passender Gruppe ein', function(done) {
      devLogin('gstudent', { email : STUDENT, fullname : 'G SuS', role : 'student', groups : 'klasse.9b:Klasse 9b' }, function(err) {
        if (err) return done(err);
        courses().findById(courseId).then(function(course) {
          var entry = course.users.filter(function(u) { return u.email === STUDENT; })[0];
          should.exist(entry);
          entry.joinedVia.should.eql('iserv');
          entry.roles.should.eql(['course-student']);
          return users().findOne({ email : STUDENT });
        }).then(function(student) {
          student.inCourse(courseId).should.be.true;
          done();
        }).catch(done);
      });
    });

    it('trägt sie nicht doppelt ein', function(done) {
      devLogin('gstudent', { email : STUDENT, fullname : 'G SuS', role : 'student', groups : 'klasse.9b:Klasse 9b' }, function(err) {
        if (err) return done(err);
        courses().findById(courseId).then(function(course) {
          course.users.filter(function(u) { return u.email === STUDENT; }).length.should.eql(1);
          done();
        }).catch(done);
      });
    });

    it('trägt sie wieder aus, wenn die Gruppe fehlt', function(done) {
      devLogin('gstudent', { email : STUDENT, fullname : 'G SuS', role : 'student', groups : 'klasse.7a:Klasse 7a' }, function(err) {
        if (err) return done(err);
        courses().findById(courseId).then(function(course) {
          course.users.filter(function(u) { return u.email === STUDENT; }).length.should.eql(0);
          return users().findOne({ email : STUDENT });
        }).then(function(student) {
          student.inCourse(courseId).should.be.false;
          done();
        }).catch(done);
      });
    });

    it('lässt per Access-Code beigetretene SuS in Ruhe', function(done) {
      flow.switchUser('gteacher');
      json(flow.post('/api/courses/' + courseId + '/accessCode')).end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(200);
        accessCode = res.body.accessCode;
        should.exist(accessCode);

        devLogin('gstudent', { email : STUDENT, fullname : 'G SuS', role : 'student', groups : '' }, function(err) {
          if (err) return done(err);
          json(flow.post('/api/courses/join')).send({ accessCode : accessCode }).end(flow.setLastResponse(function(err, res) {
            res.statusCode.should.eql(200);
            res.body.success.should.be.true;

            // erneuter Login ohne Gruppe → bleibt Mitglied (joinedVia 'code')
            devLogin('gstudent', { email : STUDENT, fullname : 'G SuS', role : 'student', groups : '' }, function(err) {
              if (err) return done(err);
              courses().findById(courseId).then(function(course) {
                var entry = course.users.filter(function(u) { return u.email === STUDENT; })[0];
                should.exist(entry);
                entry.joinedVia.should.eql('code');
                done();
              }).catch(done);
            });
          }));
        });
      }));
    });

    it('trägt Lehrkräfte nie automatisch ein', function(done) {
      devLogin('gteacher2', { email : 'g-lehrkraft2@schule.test', fullname : 'G Lehrkraft 2', role : 'teacher', groups : 'klasse.9b:Klasse 9b' }, function(err) {
        if (err) return done(err);
        courses().findById(courseId).then(function(course) {
          course.users.filter(function(u) { return u.email === 'g-lehrkraft2@schule.test'; }).length.should.eql(0);
          return users().deleteMany({ email : 'g-lehrkraft2@schule.test' });
        }).then(function() { done(); }).catch(done);
      });
    });

    it('löst und setzt die Verknüpfung über die API', function(done) {
      flow.switchUser('gteacher');
      json(flow.put('/api/courses/' + courseId + '/iserv-group')).send({ act : '' }).end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(200);
        should.not.exist(res.body.course.externalLink && res.body.course.externalLink.sourceId);

        json(flow.put('/api/courses/' + courseId + '/iserv-group')).send({ act : 'klasse.7a' }).end(flow.setLastResponse(function(err, res) {
          res.statusCode.should.eql(200);
          res.body.course.externalLink.name.should.eql('Klasse 7a');

          json(flow.put('/api/courses/' + courseId + '/iserv-group')).send({ act : 'klasse.5x' }).end(flow.setLastResponse(function(err, res) {
            res.statusCode.should.eql(403);
            done();
          }));
        }));
      }));
    });

    it('verweigert SuS das Verknüpfen', function(done) {
      flow.switchUser('gstudent');
      json(flow.put('/api/courses/' + courseId + '/iserv-group')).send({ act : 'klasse.7a' }).end(flow.setLastResponse(function(err, res) {
        res.statusCode.should.eql(403);
        done();
      }));
    });
  });
};
