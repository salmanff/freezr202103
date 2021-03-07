// freezr.info - dbApi_mongodb,js
// API for accessing nedb databases

// todo - add createDb to add db paramters (as per CEPS)

exports.version = '0.0.200'

const Datastore = require('../forked_modules/nedb-async/index.js')
const helpers = require('../helpers.js')

const ARBITRARY_FIND_COUNT_DEFAULT = 100

function NEDB_FOR_FREEZR (environment, ownerAppTable) {
  // Note: environment must have dbParams and fsParams - eg
  // fsParams: "type":"local","userRoot":null
  // fsParams: "fsParams":{"type":"aws","region":"eu-central-1","accessKeyId":"XXXXX","secretAccessKey":"XXXX","bucket":"XXX"}
  // dbParams: "type":"nedb","db_path":"userDB"
  // nedb make sure nedb takes a new userRoot to figure out directory to install in

  fdlog('NEDB_FOR_FREEZR ', { environment, ownerAppTable })
  fdlog('todo - need to do checks to make sure oat exists and env exists')

  this.env = environment
  this.oat = ownerAppTable
}

NEDB_FOR_FREEZR.prototype.initDB = function (callback) {
  // called after initiation at the user level. returns a db object if need be. (not all systems need it and not all return an object. Object is stored in userDS as unififedDb)
  const { dbParams, fsParams } = this.env
  let customFS = null
  if (fsParams.type !== 'local') {
    const CustomFS = require('../forked_modules/nedb-async/env/dbfs_' + fsParams.type + '.js')
    customFS = new CustomFS(fsParams, { doNotPersistOnLoad: true })
  }

  const filename = (dbParams.db_path ? (dbParams.db_path + '/') : '') + 'users_freezr/' + this.oat.owner + '/db/' + fullName(this.oat) + '.db'

  fdlog('NEDB_FOR_FREEZR ', { dbParams, fsParams, filename }, 'oat:', this.oat)

  this.db = new Datastore({ filename, customFS }, { doNotPersistOnLoad: true })
  this.db.loadDatabase()

  if (this.db.customFS.initFS) {
    this.db.customFS.initFS(callback)
  } else {
    callback(null)
  }
}
NEDB_FOR_FREEZR.prototype.read_by_id = function (id, callback) {
  // called after initiation for some systems. Drobox doesnt need This
  this.db.find({ _id: id }, (err, results) => {
    let object = null
    if (err) {
      // TO helpers.error
      felog('read_by_id', 'error getting object for ' + this.ownerAppTable.app_name + ' or ' + this.ownerAppTable.app_table + ' id:' + id + ' in read_by_id')
    } else if (results && results.length > 0) {
      object = results[0]
    }
    callback(err, object)
  })
}
NEDB_FOR_FREEZR.prototype.create = function (id, entity, options, cb) {
  // onsole.log('db_env_nedb Create entity',new Date().toLocaleTimeString() + " : " + new Date().getMilliseconds())
  if (id) entity._id = id
  this.db.insert(entity, function (err, newDoc) {
    // newDoc is the newly inserted document, including its _id
    if (err) {
      cb(err)
    } else {
      cb(null, { success: true, entity: newDoc })
    }
  })
}
NEDB_FOR_FREEZR.prototype.query = function (query, options = {}, cb) {
  fdlog('nedb query ', query)
  this.db.find(query)
    .sort(options.sort || null)
    .limit(options.count || ARBITRARY_FIND_COUNT_DEFAULT)
    .skip(options.skip || 0)
    .exec(cb)
}
NEDB_FOR_FREEZR.prototype.update_multi_records = function (idOrQuery, updatesToEntity, cb) {
  if (typeof idOrQuery === 'string') idOrQuery = { _id: idOrQuery }
  this.db.update(idOrQuery, { $set: updatesToEntity }, { safe: true, multi: true }, function (err, num) {
    // fdlog('new_db_nedb update results ', { err, num, updatesToEntity })
    cb(err, { nModified: num })
  })
}

NEDB_FOR_FREEZR.prototype.replace_record_by_id = function (entityId, updatedEntity, callback) {
  this.db.update({ _id: entityId }, updatedEntity, { safe: true, multi: false }, callback)
}

NEDB_FOR_FREEZR.prototype.delete_record = function (idOrQuery, options = {}, cb) {
  if (typeof idOrQuery === 'string') idOrQuery = { _id: idOrQuery }
  // fdlog('nedb for freezr - delete record')
  this.db.remove(idOrQuery, { multi: true }, cb)
}

NEDB_FOR_FREEZR.prototype.getAllCollectionNames = function (appOrTableNameOrNames, callback) {
  const userId = this.aoc.owner
  const dbPath = 'users_freezr/' + userId + '/db'
  // fdlog('revdoine without testing - todo - review')
  var list = []
  this.db.customFS.readdir(dbPath, (err, files) => {
    // fdlog('read fs ', { files, err })
    if (!err) {
      files.forEach(file => {
        var parts = file.split('/')
        parts.shift()
        parts.shift()
        parts.shift()
        file = parts.join('/')
        appOrTableNameOrNames.forEach(name => {
          if (helpers.startsWith(file, userId + '__' + name)) {
            list.push(file.slice(userId.length + 3))
          }
        })
      })
    }
    callback(null, list)
  })
}

NEDB_FOR_FREEZR.prototype.persistCachedDatabase = function (cb) {
  this.db.persistence.persistCachedDatabase(cb)
}

const fullName = function (ownerAppTable) {
  // fdlog("fullName ownerAppTable ", ownerAppTable)
  if (!ownerAppTable) throw helpers.error('NEDB collection failure - need ownerAppTable ')
  const appTable = ownerAppTable.app_table || (ownerAppTable.app_name + (ownerAppTable.collection_name ? ('_' + ownerAppTable.collection_name) : ''))
  if (!appTable || !ownerAppTable.owner) throw helpers.error('NEDB collection failure - need app name and an owner for ' + ownerAppTable.owner + '__' + ownerAppTable.app_name + '_' + ownerAppTable.collection_name)
  return (ownerAppTable.owner + '__' + appTable).replace(/\./g, '_')
}

// Logger
const LOG_ERRORS = true
const felog = function (...args) { if (LOG_ERRORS) helpers.warning('dbApi_nedb.js', exports.version, ...args) }
const LOG_DEBUGS = false
const fdlog = function (...args) { if (LOG_DEBUGS) console.log(...args) }

// Interface
module.exports = NEDB_FOR_FREEZR
