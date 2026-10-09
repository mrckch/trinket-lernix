var groups = require('../auth/groups');

module.exports = {
  // IServ-Gruppen der angemeldeten Person (aus der Session, nicht aus der Datenbank)
  groups : function(request, reply) {
    return request.success({ groups : groups.fromSession(request) });
  }
};
