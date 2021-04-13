// freezr.info - dbApi_mongodb,js
// API for accessing mongodb databases

// todo - add createDb to add db paramters (as per CEPS)

exports.version = '0.0.200'

const helpers = require('../helpers.js')
const MongoClient = require('mongodb').MongoClient
const ObjectID = require('mongodb').ObjectID
const async = require('async')

const ARBITRARY_FIND_COUNT_DEFAULT = 100

function MONGO_FOR_FREEZR (environment, ownerAppTable) {
  // Note: environment must have dbParams
  fdlog('MONGO_FOR_FREEZR ', { environment, ownerAppTable })
  fdlog('todo - need to do checks to make sure oat exists and env exists')

  this.env = environment
  this.oat = ownerAppTable

  this.dbname = fullOACName(ownerAppTable) + '.db'
}

MONGO_FOR_FREEZR.prototype.initDB = function (callback) {
  fdlog('in mongo db', this.env)
  const mongoFreezr = this
  const dbName = fullOACName(this.oat)
  async.waterfall([
    // open database connection
    function (cb) {
      MongoClient.connect(dbConnectionString(mongoFreezr.env), cb)
    },
    // create collections for users user_installed_app_list, user_devices, permissions.
    function (theclient, cb) {
      const unifiedDb = theclient.db(theclient.s.options.dbName)
      unifiedDb.collection(dbName, cb)
    }
  ], function (err, collection) {
    if (err) felog('initDB', 'error getting ' + dbName + ' in initDb for mongo', err)
    mongoFreezr.db = collection
    callback(err)
  })
}
MONGO_FOR_FREEZR.prototype.read_by_id = function (id, callback) {
  this.db.find({ _id: getRealObjectId(id) }).toArray((err, results) => {
    let object = null
    if (err) {
      felog('read_by_id', 'error getting object for ' + this.ownerAppTable.app_name + ' or ' + this.ownerAppTable.app_table + ' id:' + id + ' in read_by_id')
      helpers.state_error('db_env_nedb', exports.version, 'read_by_id', err, 'error getting object for ' + this.oat.app_name + ' / ' + this.oat.app_table + ' id:' + id + ' in read_by_id')
    } else if (results && results.length > 0) {
      object = results[0]
    }
    fdlog('mongo read by id results ', { results, object })
    callback(err, object)
  })
}
MONGO_FOR_FREEZR.prototype.create = function (id, entity, options, cb) {
  fdlog('db_env_nedb Create entity')
  if (id) entity._id = getRealObjectId(id)
  this.db.insert(entity, { w: 1, safe: true }, (err, newDoc) => {
    // newDoc is the newly inserted document, including its _id
    console.warn('todo - MONGO INSERTERD, NEED TO REDO NEWDOC = GOT RETURNS OF ', { newDoc })
    if (err) {
      cb(err)
    } else {
      cb(null, { success: true, entity: newDoc })
    }
  })
}
MONGO_FOR_FREEZR.prototype.query = function (query, options = {}, cb) {
  fdlog('mongo query ', query)
  if (query._id && typeof (query._id) === 'string') query._id = getRealObjectId(query._id)
  this.db.find(query)
    .sort(options.sort || null)
    .limit(options.count || ARBITRARY_FIND_COUNT_DEFAULT)
    .skip(options.skip || 0)
    .toArray(cb)
}
MONGO_FOR_FREEZR.prototype.update_multi_records = function (idOrQuery, updatesToEntity, cb) {
  if (typeof idOrQuery === 'string') idOrQuery = { _id: getRealObjectId(idOrQuery) }
  this.db.update(idOrQuery, { $set: updatesToEntity }, { safe: true, multi: true }, function (err, num) {
    fdlog('Mongo update results - todo - REVIEW FOR REDO? ', { err, num, updatesToEntity })
    cb(err, { nModified: num })
  })
}
MONGO_FOR_FREEZR.prototype.replace_record_by_id = function (id, updatedEntity, callback) {
  this.db.update({ _id: getRealObjectId(id) }, updatedEntity, { safe: true, multi: false }, callback)
}

MONGO_FOR_FREEZR.prototype.delete_record = function (idOrQuery, options = {}, cb) {
  if (typeof idOrQuery === 'string') idOrQuery = { _id: getRealObjectId(idOrQuery) }
  this.db.remove(idOrQuery, { multi: true }, cb)
}

MONGO_FOR_FREEZR.prototype.getAllCollectionNames = function (appOrTableNameOrNames, callback) {
  fdlog('todo - mongo - need to make this consistent across mongo and nedb')
  const userId = this.oat.owner
  const appName = this.oat.app_name

  this.db.listCollections().toArray(function (err, nameObjList) {
    if (err) {
      // fdlog('IN MONGO REVIEW ERR FOR NO COLLECTIONS - ', { err })
      callback(null, null)
    } else if (nameObjList && nameObjList.length > 0) {
      var collectionNames = []
      const collNamePrefix = (userId + '__' + appName).replace(/\./g, '_')
      if (nameObjList && nameObjList.length > 0) {
        nameObjList.forEach(function (nameObj) {
          const aName = nameObj.name
          if (aName && aName !== 'system' && helpers.startsWith(aName, collNamePrefix)) collectionNames.push(aName.slice(userId.length + appName.length + 3))
        })
      }
      callback(null, collectionNames)
    } else {
      callback(null, [])
    }
  })
}

MONGO_FOR_FREEZR.prototype.persistCachedDatabase = function (cb) {
  cb(null)
}

const fullOACName = function (ownerAppTable) {
  fdlog('mongo - fullOACName ownerAppTable ', ownerAppTable)

  if (!ownerAppTable) throw felog('fullOACName', 'NEDB collection failure - need ownerAppTable')
  const appTable = ownerAppTable.app_table || (ownerAppTable.app_name + (ownerAppTable.collection_name ? ('_' + ownerAppTable.collection_name) : ''))
  if (!appTable || !ownerAppTable.owner) throw helpers.error('NEDB collection failure - need app name and an owner for ' + ownerAppTable.owner + '__' + ownerAppTable.app_name + '_' + ownerAppTable.collection_name)
  return (ownerAppTable.owner + '__' + appTable).replace(/\./g, '_')
}

const dbConnectionString = function (envParams) {
  fdlog('mongo - dbConnectionString envParams ', envParams)
  if (envParams.dbParams.choice === 'mongoLocal') {
    envParams.dbParams = {
      type: 'mongoLocal',
      port: '27017',
      host: 'localhost',
      pass: null,
      user: null,
      notAddAuth: true,
      unifiedDbName: null
    }
  }
  const DEFAULT_UNIFIED_DB_NAME = 'freezrdb'
  const unfiedDbName = envParams.dbParams.unifiedDbName || DEFAULT_UNIFIED_DB_NAME

  if (envParams.dbParams.connectionString) {
    return envParams.dbParams.connectionString + '&authSource=admin&useUnifiedTopology=true'
  } else if (envParams.dbParams.mongoString) {
    fdlog('mogno - temp fix todo - check consistency')
    return envParams.dbParams.mongoString + '&authSource=admin&useUnifiedTopology=true'
  } else {
    let connectionString = 'mongodb://'
    if (envParams.dbParams.user) connectionString += envParams.dbParams.user + ':' + envParams.dbParams.pass + '@'
    connectionString += envParams.dbParams.host + ':' + (envParams.dbParams.host === 'localhost' ? '' : envParams.dbParams.port)
    connectionString += '/' + unfiedDbName + (envParams.dbParams.notAddAuth ? '' : '?authSource=admin')
    return connectionString
  }
}
const getRealObjectId = function (objectId) {
  // called after initiation for some systems. neb doesnt need This
  var realId = objectId
  if (typeof objectId === 'string') {
    try {
      realId = new ObjectID(objectId)
    } catch (e) {
      fdlog('getRealObjectId', 'Could not get mongo real_id - using text id for ' + objectId)
    }
  }
  return realId
}

// Logger
const LOG_ERRORS = true
const felog = function (...args) { if (LOG_ERRORS) helpers.warning('dbApi_mongodb.js', exports.version, ...args) }
const LOG_DEBUGS = false
const fdlog = function (...args) { if (LOG_DEBUGS) console.log(...args) }

// Interface
module.exports = MONGO_FOR_FREEZR
