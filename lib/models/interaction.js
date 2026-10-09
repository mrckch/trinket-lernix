var model    = require('./model'),
    config   = require('config'),
    mongoose = require('mongoose'),
    ObjectId = mongoose.SchemaTypes.ObjectId,
    schema   = {
      _trinket : { type: ObjectId, ref: 'Snippet', index: true },
      _owner   : { type: ObjectId, ref: 'User', index: true },
      lang     : { type: String },
      action   : { type: String },
      _actor   : { type: ObjectId, ref: 'User' },
      referer  : { type: String },
      address  : { type: String },
      info     : {} // arbitrary data flavored by action
    };

function findByTrinketId(trinketId) {
  var query = {_trinket:trinketId};
  return this.model.find(query).exec();
}

// Trinket Lernix: IP-Adresse und Referer nur speichern, wenn ausdrücklich erlaubt
// (features.storeClientAddress, Default false – Datensparsamkeit, ADR 0003).
function stripClientData(next) {
  if (!(config.features && config.features.storeClientAddress)) {
    this.address = undefined;
    this.referer = undefined;
  }
  next();
}

var Interaction = model.create('Interaction', {
  schema       : schema,
  timestamps   : false,
  hooks        : {
    pre : {
      save : {
        stripClientData : stripClientData
      }
    }
  },
  classMethods : {
    findByTrinketId : findByTrinketId
  },
  publicSpec : {
    id       : 1,
    _trinket : 1,
    _owner   : 1,
    lang     : 1,
    action   : 1,
    _actor   : 1,
    referer  : 1,
    address  : 1,
    info     : 1
  }
}).publicModel;

module.exports = Interaction;
