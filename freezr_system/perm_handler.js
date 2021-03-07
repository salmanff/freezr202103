// freezr.info - nodejs system files - perm_handler

exports.version = '0.0.200'

/* global User */

const helpers = require('./helpers.js')
const async = require('async')

// dsManager.getorInitDb({app_table: 'info.freezr.account.app_list', owner: freezrAttributes.requestee_user_id}, {}, function(err, requesteeAppListDB) {})

exports.readWriteUserData = function (req, res, dsManager, next) {
  // assume token info in in req.freezrTokenInfo => {userId, appName, loggedIn}
  fdlog('readWriteUserData ')

  var freezrAttributes = {
    permission_name: null,
    requestee_user_id: null,
    requestor_app: null,
    requestor_user_id: null,
    own_record: false, // ie not permitted
    record_is_permitted: false,
    grantedPerms: []
  }

  freezrAttributes.requestor_app = req.freezrTokenInfo.app_name
  freezrAttributes.requestor_user_id = req.freezrTokenInfo.user_id

  if (!req.params) req.params = {}
  if (!req.query) req.query = {}
  freezrAttributes.permission_name = req.params.permission_name || req.query.permission_name // params in file get and query for ceps

  freezrAttributes.requestee_user_id = req.params.requestee_user_id

  const requestFile = helpers.startsWith(req.path, '/feps/getuserfiletoken')
  if (requestFile) {
    req.params.app_table = req.params.requestee_app_name + '.files'
    freezrAttributes.requestee_user_id = req.params.requestee_user_id
  }

  if (!freezrAttributes.requestee_user_id) freezrAttributes.requestee_user_id = freezrAttributes.requestor_user_id

  // for admin
  if (req.body.appName === 'info.freezr.admin' && req.session.logged_in_as_admin && helpers.SYSTEM_ADMIN_APPTABLES.indexOf(req.params.app_table) > -1) freezrAttributes.requestor_user_id = 'fradmin'

  const getDbTobeRead = function () {
    dsManager.getorInitDb({ app_table: req.params.app_table, owner: freezrAttributes.requestee_user_id }, {}, function (err, freezrRequesteeDB) {
      if (err) {
        helpers.error('Could not access main user AOC db - read_by_id_perms')
        res.sendStatus(401)
      } else {
        req.freezrRequesteeDB = freezrRequesteeDB
        req.freezrAttributes = freezrAttributes
        next()
      }
    })
  }

  fdlog('req.params.app_table ' + req.params.app_table + ' freezrAttributes.requestor_app :', freezrAttributes.requestor_app)
  if (!req.params.app_table || !freezrAttributes.requestor_app || !freezrAttributes.requestor_user_id) {
    helpers.error('Missing parameters for permissions - read_by_id_perms')
    felog('perm_handler.js', 'Missing parameters', { freezrAttributes })
    res.sendStatus(401)
  } else if (helpers.startsWith(req.params.app_table, freezrAttributes.requestor_app) && freezrAttributes.requestor_user_id === freezrAttributes.requestee_user_id) {
    freezrAttributes.own_record = true
    freezrAttributes.record_is_permitted = true
    getDbTobeRead()
  } else if ((helpers.startsWith(req.path, '/ceps/query') || helpers.startsWith(req.path, '/feps/query')) &&
    req.freezrTokenInfo.app_name === 'info.freezr.account' && req.session.logged_in_user_id === freezrAttributes.requestee_user_id && req.body.appName) {
    // backuprequest: special case for query from accounts folder for "view or backup data"
    freezrAttributes.requestor_app = req.body.appName
    freezrAttributes.own_record = true
    freezrAttributes.record_is_permitted = true
    getDbTobeRead()
  } else {
    dsManager.getUserPerms(freezrAttributes.requestee_user_id, function (err, permDB) {
      if (err) {
        helpers.error('Error in getting perms - getUserPerms')
        res.sendStatus(401)
      }
      const dbQuery = {
        requestee_app_table: req.params.app_table,
        requestor_app: freezrAttributes.requestor_app,
        granted: true,
        outDated: false
      }
      if (freezrAttributes.permission_name) {
        dbQuery.permission_name = freezrAttributes.permission_name
      }

      permDB.query(dbQuery, {}, function (err, grantedPerms) {
        if (err) {
          helpers.error('Error doing query -  read_by_id_perms')
          res.sendStatus(401)
        } else {
          fdlog('todo - here check for each requestee or the groups they are in... also see if permission name will be used')
          freezrAttributes.grantedPerms = grantedPerms
          getDbTobeRead()
        }
      })
    })
  }
}

exports.addUserAppsAndPermDBs = function (req, res, dsManager, next) {
  // user_apps - used for account APIs
  dsManager.getorInitDb({ app_table: 'info.freezr.account.app_list', owner: req.session.logged_in_user_id }, {}, function (err, freezrUserAppListDB) {
    if (err) {
      felog('addUserAppsAndPermDBs', 'Could not access main freezrUserAppListDB - addUserAppsAndPermDBs - redirect', err)
      res.redirect('/admin/public/starterror?err=couldNotAccessADb&Errsource=userAppList')
    } else {
      req.freezrUserAppListDB = freezrUserAppListDB
      dsManager.getorInitDb({ app_table: 'info.freezr.account.permissions', owner: req.session.logged_in_user_id }, {}, function (err, freezrUserPermsDB) {
        if (err) {
          felog('addUserAppsAndPermDBs', 'Could not access main freezrUserPermsDB - addUserAppsAndPermDBs - 401', err)
          res.sendStatus(401)
        } else {
          req.freezrUserPermsDB = freezrUserPermsDB
          req.freezrUserDS = dsManager.users[req.session.logged_in_user_id] // nb no need for callback as already got db
          next()
        }
      })
    }
  })
}
exports.addUserPermDBs = function (req, res, dsManager, next) {
  // used for getall permission /v1/permissions/getall/:app_name and /v1/permissions/gethtml/:app_name'
  dsManager.getorInitDb({ app_table: 'info.freezr.account.permissions', owner: req.freezrTokenInfo.user_id }, {}, function (err, freezrUserPermsDB) {
    if (err) {
      helpers.state_error('Could not access main freezrUserPermsDB - addUserAppsAndPermDBs')
      res.sendStatus(401)
    } else {
      req.freezrUserPermsDB = freezrUserPermsDB
      next()
    }
  })
}
const APP_TOKEN_OAC = {
  app_name: 'info.freezr.admin',
  collection_name: 'app_tokens',
  owner: 'fradmin'
}
exports.addAppTokenDB = function (req, res, dsManager, next) {
  // used for getall permission /v1/permissions/getall/:app_name and /v1/permissions/gethtml/:app_name'
  dsManager.getorInitDb(APP_TOKEN_OAC, {}, function (err, freezrAppTokenDB) {
    if (err) {
      helpers.state_error('Could not access main freezrAppTokenDB - addAppTokenDB')
      res.sendStatus(401)
    } else {
      req.freezrAppTokenDB = freezrAppTokenDB
      next()
    }
  })
}

exports.addUserPermsAndRequesteeDB = function (req, res, dsManager, next) {
  // For changeNamedPermissions and setObjectAccess

  var requesteeAppTable, owner
  if (req.path.indexOf('permissions/change') > 0) {
    fdlog('req.body.changeList[0] ', req.body.changeList[0])
    requesteeAppTable = req.body.changeList[0].table_id
    owner = req.session.logged_in_user_id
  } else if (req.path.indexOf('permissions/setobjectaccess') > 0) {
    requesteeAppTable = req.body.table_id
    owner = req.freezrTokenInfo.user_id
  }

  fdlog('addUserPermsAndRequesteeDB ', { requesteeAppTable, owner })
  dsManager.getorInitDb({ app_table: requesteeAppTable, owner }, {}, function (err, freezrRequesteeDB) {
    if (err) {
      felog('addUserPermsAndRequesteeDB', 'Could not access main freezrRequesteeDB  - addUserPermsAndRequesteeDB', err)
      res.sendStatus(401)
    } else {
      req.freezrRequesteeDB = freezrRequesteeDB

      dsManager.getorInitDb({ app_table: 'info.freezr.account.permissions', owner }, {}, function (err, freezrUserPermsDB) {
        if (err) {
          felog('addUserPermsAndRequesteeDB', 'Could not access main freezrUserPermsDB db - addUserPermsAndRequesteeDB', err)
          res.sendStatus(401)
        } else {
          req.freezrUserPermsDB = freezrUserPermsDB

          dsManager.getorInitDb({ app_table: 'info.freezr.account.acl', owner }, {}, function (err, freezrRequestorACL) {
            if (err) {
              felog('addUserPermsAndRequesteeDB', 'Could not access main freezrRequestorACL  - addUserPermsAndRequesteeDB', err)
              res.sendStatus(401)
            } else {
              req.freezrRequestorACL = freezrRequestorACL
              next()
            }
          })
        }
      })
    }
  })
}

exports.addUserDs = function (req, res, dsManager, next) {
  const owner = req.freezrTokenInfo.user_id

  dsManager.getOrSetUserDS(owner, function (err, userDS) {
    if (err) felog('addUserDs', 'addUserOrAdmin err for ' + owner, err)
    req.freezrUserDS = userDS
    req.freezrAttributes = { requesting_owner_id: owner }
    next()
  })
}
exports.addFradminDs = function (req, res, dsManager, next) {
  const userId = req.session.logged_in_user_id
  if (req.session.logged_in_as_admin && userId && userId === req.freezrTokenInfo.user_id) {
    // todo recheck user list to make sure owner is actually an admin
    const owner = 'fradmin'

    const userDb = dsManager.getDB(USER_DB_OAC)

    async.waterfall([
      // 1. get userId
      function (cb) {
        userDb.query({ user_id: userId }, null, cb)
      },

      // 2. check the password
      function (results, cb) {
        var u = new User(results[0])
        // fdlog('got user ', u)
        if (!results || results.length === 0 || results.length > 1) {
          cb(helpers.auth_failure('perm_handler.js', exports.version, 'addFradminDs', 'funky error'))
        } else if (!u.isAdmin) {
          felog('addFradminDs', 'non admin user tryong to access admin tasks user ' + userId)
          cb(helpers.auth_failure('perm_handler.js', exports.version, 'addFradminDs', 'non admin trying to conduct admin tasks'))
        } else {
          cb(null)
        }
      },
      function (cb) {
        dsManager.getOrSetUserDS(owner, cb)
      }
    ], function (err, userDS) {
      if (err) {
        felog('addFradminDs', 'err for ' + owner, err)
      } else {
        req.freezrFradminDS = userDS
        req.freezrAttributes = { requesting_owner_id: req.freezrTokenInfo.user_id }
        next()
      }
    })
  } else {
    res.sendStatus(401)
  }
}
const USER_DB_OAC = {
  app_name: 'info.freezr.admin',
  collection_name: 'users',
  owner: 'fradmin'
}
exports.addAllUsersDb = function (req, res, dsManager, next) {
  req.allUsersDb = dsManager.getDB(USER_DB_OAC)
  next()
}

exports.addPublicRecordsDB = function (req, res, dsManager, next) {
  // used by setObjectAccess in which case req.body.grantees.includes("public")
  // or /v1/permissions/change
  fdlog('addPublicRecordsDB for adding freezrPublicPermDB ', req.originalUrl)
  dsManager.getorInitDb({ app_table: 'info.freezr.admin.public_records', owner: 'fradmin' }, {}, function (err, freezrPublicRecordsDB) {
    if (err) {
      helpers.state_error('Could not access main freezrPublicRecordsDB db - addPublicRecordsDB')
      res.sendStatus(401)
    } else {
      req.freezrPublicRecordsDB = freezrPublicRecordsDB
      dsManager.getorInitDb({ app_table: 'info.freezr.admin.public_manifests', owner: 'fradmin' }, {}, function (err, freezrPublicManifestsDB) {
        if (err) {
          helpers.state_error('Could not access main freezrPublicPermDB db - addPublicRecordsDB')
          res.sendStatus(401)
        } else {
          // got and added freezrPublicPermDB
          // 'NOW add from manifest: meta, public pages and cards
          // this will also be used to okay accessing public files
          req.freezrPublicManifestsDb = freezrPublicManifestsDB
          if (req.path.indexOf('permissions/change') > 0) {
            dsManager.getOrInitUserAppFS(req.session.logged_in_user_id, req.freezrRequestorAppConfig.meta.app_name, {}, (err, appFs) => {
              if (err || !appFs) {
                felog('addPublicRecordsDB', 'handle error getting appFs for user ', req.session.logged_in_user_id, ' and app: ', req.freezrRequestorAppConfig.meta.app_name, { err })
                next()
              } else {
                var permlist = []
                var cards = {}
                for (const [permName, permObj] of Object.entries(req.freezrRequestorAppConfig.permissions)) {
                  // fdlog(`${permName}: ${permObj}`)
                  if (permObj.pcard) {
                    permObj.name = permName
                    permlist.push(permObj)
                  }
                }
                // fdlog(permlist)
                async.forEach(permlist, function (aPerm, cb2) {
                  appFs.readAppFile(aPerm.pcard, null, (err, theCard) => {
                    if (err) {
                      felog('addPublicRecordsDB', 'handle error reading card for ', { aPerm, err })
                    } else {
                      cards[aPerm.name] = theCard
                    }
                    cb2(null)
                  })
                },
                function (err) {
                  if (err) {
                    felog('addPublicRecordsDB', 'need to handle err in creating freezrPublicManifestsDb: ' + err)
                  }
                  // fdlog('cards got, ', { cards })
                  req.freezrPublicCards = cards
                  next()
                })
              }
            })
          } else { //   'permissions/change'
            next()
          }
        }
      })
    }
  })
}
exports.addoAuthers = function (req, res, dsManager, next) {
  // used by setObjectAccess in which case req.body.grantees.includes("public")
  // or /v1/permissions/change
  fdlog('addoAuthers ', req.originalUrl)
  dsManager.getorInitDb({ app_table: 'info.freezr.admin.oauthors', owner: 'fradmin' }, {}, function (err, oAuthorDb) {
    if (err) {
      helpers.state_error('Could not access main oAuthorDb db - addoAuthers')
      res.sendStatus(401)
    } else {
      req.freezrOauthorDb = oAuthorDb
      next()
    }
  })
}
exports.addPublicUserFs = function (req, res, dsManager, next) {
  fdlog('addPublicUserFs - todo - review this - not checked')
  req.freezrPublicManifestsDb.query({ user_id: req.params.user_id, app_name: req.params.app_name }, null, (err, results) => {
    if (err || !results || results.length === 0) { // fdlog todo - also add results[0].granted??
      res.sendStatus(401)
    } else {
      req.freezrPublicAppConfig = results[0]
      dsManager.getOrSetUserDS(req.params.user_id, function (err, userDS) {
        if (err) {
          res.sendStatus(401)
        } else {
          userDS.getorInitAppFS(req.params.app_name, {}, function (err, appFS) {
            if (err) {
              felog('addPublicUserFs', 'err get-setting app-fs', err)
              res.sendStatus(401)
            } else {
              req.freezrAppFS = appFS
              next()
            }
          })
        }
      })
    }
  })
}
exports.addUserFilesDb = function (req, res, dsManager, next) {
  fdlog('addUserFilesDb', 'todo - review this - not checked')

  const oat = {
    owner: req.params.user_id,
    app_name: req.params.requestee_app,
    collection_name: 'files'
  }
  dsManager.getorInitDb(oat, null, function (err, userFilesDb) {
    if (err) {
      res.sendStatus(401)
    } else {
      req.freezruserFilesDb = userFilesDb
    }
  })
}

exports.selfRegAdds = function (req, res, dsManager, next) {
  fdlog('selfRegAdds ', req.body)
  if (req.body && req.body.action === 'checkresource') {
    next()
  } else if (dsManager.freezrIsSetup) {
    req.freezrAllUsersDb = dsManager.getDB(USER_DB_OAC)
    req.freezrIsSetup = dsManager.freezrIsSetup
    next()
  } else { // first setup
    req.freezrDsManager = dsManager
    next()
    // add fradmin => users
  }
}

// Loggers
const LOG_ERRORS = true
const felog = function (...args) { if (LOG_ERRORS) helpers.warning('perm_handler.js', exports.version, ...args) }
const LOG_DEBUGS = false
const fdlog = function (...args) { if (LOG_DEBUGS) console.log(...args) }
