var sinon  = require('sinon'),
    queues = require('../../lib/util/queues'),
    // Die Snapshot-Queue gibt es in trinket-oss nicht mehr (nur noch "exports");
    // der Helfer bleibt für ältere Tests tolerant.
    snapshotQueue = typeof queues.snapshots === 'function' ? queues.snapshots() : null;

module.exports = {
  snapshotQueue : snapshotQueue,
  stub : function() {
    if (!snapshotQueue) return;

    before(function() {
      sinon.stub(snapshotQueue, 'add').callsFake(function(data) {
        return {
          then : function(f) {
            f();
          }
        };
      });
    });

    after(function() {
      snapshotQueue.add.restore();
    });
  }
};
