// freezr.info - nodejs system files - app_handler.js

/* to do
  - create_file_record -> file_handler
  - sendUserFile -> file_handler
 */

exports.version = '0.0.200'

const helpers = require('./helpers.js')
const async = require('async')
const fileHandler = require('./file_handler.js')

exports.generatePage = function (req, res) {
  // '/apps/:app_name' and '/apps/:app_name/:page' (and generateDataPage above)
  fdlog('generatePage NEW: ' + req.url)
  const appConfig = req.freezrRequestorAppConfig

  if (!req.params.page) req.params.page = 'index'
  if (helpers.endsWith(req.params.page, '.html')) req.params.page = req.params.page.slice(0, -5)

  const pageName = req.params.page

  if (!appConfig.pages) appConfig.pages = { pageName: {} }
  if (!appConfig.pages[pageName]) {
    appConfig.pages[pageName] = {
      // todo - check if the files exist first?
      html_file: pageName + '.html',
      css_files: pageName + '.css',
      script_files: [pageName + '.js']
    }
  }
  if (!appConfig.pages[pageName].page_title) appConfig.pages[pageName].page_title = pageName

  req.params.internal_query_token = req.freezrTokenInfo.app_token // internal query request

  if (appConfig.pages[pageName].initial_query) {
    // Only takes type: db_query at this time
    const queryParams = appConfig.pages[pageName].initial_query
    const appConfigPermissionSchema = (appConfig.permissions && queryParams.permission_name) ? appConfig.permissions[queryParams.permission_name] : null

    if (appConfigPermissionSchema) {
      req.body.permission_name = queryParams.permission_name
      req.params.app_table = req.params.app_name + (appConfigPermissionSchema.collection_name ? ('.' + appConfigPermissionSchema.collection_name) : '')
      if (queryParams.collection_name && appConfigPermissionSchema.collection_name !== queryParams.collection_name) helpers.warning('app_handler', exports.version, 'generatePage', 'permission schema collections inconsistent with requested collction ' + queryParams.collection_name + ' for app: ' + req.params.app_name)
    } else if (queryParams.collection_name) {
      req.params.app_table = req.params.app_name + (queryParams.collection_name ? ('.' + queryParams.collection_name) : '')
    } else {
      felog('generatePage ', 'Have to define either permission_name or collection_name (for own collections) in initial_query of app_config')
    }

    req.internalcallfwd = function (err, results) {
      if (err) console.warn('State Error ' + err)
      req.params.queryresults = { results: results }
      generatePageWithAppConfig(req, res, appConfig)
    }
    exports.db_query(req, res)
  } else {
    generatePageWithAppConfig(req, res, appConfig)
  }
}

var generatePageWithAppConfig = function (req, res, appConfig) {
  fdlog('generatePageWithAppConfig', { appConfig })

  const pageParams = appConfig.pages[req.params.page]

  var options = {
    page_title: pageParams.page_title + ' - freezr.info',
    page_url: pageParams.html_file ? pageParams.html_file : './info.freezr.public/fileNotFound.html',
    css_files: [],
    queryresults: (req.params.queryresults || null),
    script_files: [], // pageParams.script_files, //[],
    messages: { showOnStart: false },
    user_id: req.session.logged_in_user_id,
    user_is_admin: req.session.logged_in_as_admin,
    app_name: req.params.app_name,
    app_display_name: ((appConfig && appConfig.meta && appConfig.meta.app_display_name) ? appConfig.meta.app_display_name : req.params.app_name),
    app_version: (appConfig && appConfig.meta && appConfig.meta.app_version) ? appConfig.meta.app_version : 'N/A',
    other_variables: null,
    freezr_server_version: req.freezr_server_version,
    server_name: req.protocol + '://' + req.get('host')
  }

  if (!req.params.internal_query_token) {
    helpers.send_internal_err_page(res, 'app_handler', exports.version, 'generatePage', 'app_token missing in generatePageWithAppConfig')
  } else {
    res.cookie('app_token_' + req.session.logged_in_user_id, req.params.internal_query_token, { path: '/apps/' + req.params.app_name })

    // options.messages.showOnStart = (results.newCode && appConfig && appConfig.permissions && Object.keys(appConfig.permissions).length > 0);
    if (pageParams.css_files) {
      if (typeof pageParams.css_files === 'string') pageParams.css_files = [pageParams.css_files]
      pageParams.css_files.forEach(function (cssFile) {
        if (helpers.startsWith(cssFile, 'http')) {
          helpers.app_data_error(exports.version, 'generatePage', req.params.app_name, 'Cannot have css files referring to other hosts')
        } else {
          if (fileHandler.fileExt(cssFile) === 'css') {
            options.css_files.push(cssFile)
          } else {
            helpers.app_data_error(exports.version, 'generatePage', req.params.app_name, 'Cannot have non js file used as css ' + pageParams.css_files)
          }
        }
      })
    }
    var outsideScripts = []
    if (pageParams.script_files) {
      if (typeof pageParams.script_files === 'string') pageParams.script_files = [pageParams.script_files]
      pageParams.script_files.forEach(function (jsFile) {
        if (helpers.startsWith(jsFile, 'http')) {
          outsideScripts.push(jsFile)
        } else {
          // Check if exists? - todo and review - err if file doesn't exist?
          if (fileHandler.fileExt(jsFile) === 'js') {
            options.script_files.push(jsFile)
          } else {
            helpers.app_data_error(exports.version, 'generatePage', req.params.app_name, 'Cannot have non js file used as js.')
          }
        }
      })
    }

    if (outsideScripts.length > 0) {
      fdlog('todo? re-implement outside-scripts permission??')
    }
    fileHandler.load_data_html_and_page(req, res, options)
  }
}

// ceps operations
// each of these are perviously handled by access_handler and perm_handler which add the following to req:
/*
From userAPIRights in access_handler
freezrTokenInfo (related to requestor):
  {userId, appName, loggedIn:}

From readWritePerms in perm_handler
freezrAttributes : {
  permission_name: null,
  requestee_user_id:null,
  requestor_app:null,
  requestor_user_id: null,
  own_record: false, //ie not permitted
  record_is_permitted: false,
  grantedPerms: [] // If not own_record, list of permissions granted by the requestee related to the app_table being queried
}

*/
exports.write_record = function (req, res) { // create update or upsert
  // app.post('/ceps/write/:app_table', userDataAccessRights, app_handler.write_record);
  // app.put('/ceps/update/:app_table/:data_object_id', userDataAccessRights, app_handler.write_record)
  // app.post('/feps/write/:app_table', userDataAccessRights, app_handler.write_record);
  // app.post('/feps/write/:app_table/:data_object_id', userDataAccessRights, app_handler.write_record);
  // app.post('/feps/upsert/:app_table', userDataAccessRights, app_handler.write_record);

  fdlog('write_record', 'ceps writeData at ' + req.url) // req.query , req.body

  const isUpsert = (req.query.upsert === 'true')
  fdlog('req.query ', req.query, { isUpsert })
  const isUpdate = helpers.startsWith(req.url, '/ceps/update') || helpers.startsWith(req.url, '/feps/update')
  const replaceAllFields = isUpdate && (req.query.replaceAllFields || helpers.startsWith(req.url, '/ceps/update'))
  const isCeps = helpers.startsWith(req.url, '/ceps/')
  const isQueryBasedUpdate = (!isCeps && isUpdate && !req.params.data_object_id && req.body.q && req.body.d)

  const write = req.body || {}
  const dataObjectId = (isUpsert || isUpdate) ? req.params.data_object_id : (req.body._id ? (req.body._id + '') : null)

  const [granted] = checkWritePermission(req)

  const appErr = function (message) { return helpers.app_data_error(exports.version, 'write_record', req.freezrAttributes.requestor_app, message) }
  const authErr = function (message) { return helpers.auth_failure('app_handler', exports.version, 'write_record', req.freezrAttributes.requestor_app + ': ' + message) }

  fdlog('req.freezrAttributes.requestor_app, req.params.app_name', req.freezrAttributes.requestor_app, req.params.app_name)
  async.waterfall([
    // 1. check basics
    function (cb) {
      if (!granted) {
        cb(authErr('unauthorized write access'))
      } else if (!isUpsert && !isUpdate && Object.keys(write).length <= 0) {
        cb(appErr('Missing data parameters.'))
      } else if (helpers.is_system_app(req.freezrAttributes.requestor_app)) {
        cb(helpers.invalid_data('app name not allowed: ' + req.freezrAttributes.requestor_app, 'account_handler', exports.version, 'write_record'))
      } else if (isCeps && (isUpsert || (isUpdate && !dataObjectId))) {
        cb(appErr('CEPs is not yet able to do upsert, and key only updates and query based updates.'))
      } else if (!dataObjectId && !isUpsert && !isUpdate) { // Simple create object with no id
        cb(null, null)
      } else if (dataObjectId && (isUpsert || isUpdate)) { // isUpsert or update
        req.freezrRequesteeDB.read_by_id(dataObjectId, function (err, results) {
          cb((isUpsert ? null : err), results)
        })
      } else if (isUpdate && isQueryBasedUpdate) { // just to mass update
        cb(null, null)
      } else {
        cb(appErr('Malformed path body combo '))
      }
    },

    // 4. write
    function (results, cb) {
      if (isQueryBasedUpdate) { // no results needed
        req.freezrRequesteeDB.update(write.q, write.d, { replaceAllFields: false /* redundant */ }, cb)
      } else if (results) {
        if ((isUpsert || isUpdate) && results._date_modified /* ie is non empty record */) { // one entity
          req.freezrRequesteeDB.update(dataObjectId, write, { replaceAllFields: replaceAllFields, old_entity: results }, cb)
        } else {
          const errmsg = isUpsert ? 'internal err in old record' : 'Record exists - use "update" to update existing records'
          cb(helpers.auth_failure('app_handler', exports.version, 'write_record', req.freezrAttributes.requestor_app, errmsg))
        }
      } else if (isUpdate) { // should have gotten results
        cb(appErr('record not found'))
      } else { // upsert / create - new document - should not have gotten results
        req.freezrRequesteeDB.create(dataObjectId, write, { restoreRecord: false }, cb)
      }
    }
  ],
  function (err, writeConfirm) {
    // onsole.log("write err",err,"writeConfirm",writeConfirm)
    if (err) {
      helpers.send_failure(res, err, 'app_handler', exports.version, 'write_record')
    } else if (!writeConfirm) {
      helpers.send_failure(res, new Error('unknown write error'), 'app_handler', exports.version, 'write_record')
    } else if (isUpdate || isUpsert) {
      helpers.send_success(res, writeConfirm)
    } else {
      const { theId, dateCreated, dateModified } = writeConfirm.entity
      helpers.send_success(res, { _id: theId, _date_created: dateCreated, _date_modified: dateModified })
    }
  })
}
exports.read_record_by_id = function (req, res) {
  // app.get('/ceps/read/:app_table/:data_object_id', userDataAccessRights, app_handler.read_record_by_id);
  // app.get('/feps/read/:app_table/:data_object_id/:requestee_user_id', userDataAccessRights, app_handler.read_record_by_id);
  //   feps option: "?"+(requestee_app==freezr_app_name? "":("requestor_app="+freezr_app_name)) + (permission_name? ("permission_name="+permission_name):"")

  //  app.get('/feps/userfileGetToken/:permission_name/:requestee_app_name/:requestee_user_id/*', userDataAccessRights, app_handler.read_record_by_id); // collection_name is files
  //    collection name is 'files'

  let dataObjectId
  let permittedRecord
  const requestFile = helpers.startsWith(req.path, '/feps/getuserfiletoken')

  if (requestFile) {
    const parts = req.originalUrl.split('/')
    dataObjectId = parts[5] + '/' + unescape(parts.slice(6))
    if (dataObjectId.indexOf('?') > -1) {
      const parts2 = dataObjectId.split('?')
      dataObjectId = parts2[0]
    }
  } else {
    dataObjectId = req.params.data_object_id
  }

  const [granted, readAll] = checkReadPermission(req)

  const appErr = function (message) { return helpers.app_data_error(exports.version, 'read_record_by_id', req.freezrAttributes.requestor_app, message) }
  const authErr = function (message) { return helpers.auth_failure('app_handler', exports.version, 'read_record_by_id', req.freezrAttributes.requestor_app + ': ' + message) }

  async.waterfall([
    // 1. get item.. if own_record, go to end. if not, get all record permissions
    function (cb) {
      if (!granted) {
        cb(authErr('unauthorised read access'))
      } else if (!dataObjectId) {
        cb(appErr('cannot read with out a data_object_id'))
      } else if (!req.freezrRequesteeDB) {
        cb(appErr('internal error getting db'))
      } else {
        req.freezrRequesteeDB.read_by_id(dataObjectId, cb)
      }
    },

    // 2. get permissions if needbe
    function (fetchedRecord, cb) {
      if (!fetchedRecord) {
        cb(appErr('no related records'))
      } else if (req.freezrAttributes.own_record || readAll) { // ie own_record or has read_all
        permittedRecord = fetchedRecord
        delete permittedRecord._accessible
        cb(null)
      } else if (!req.freezrAttributes.grantedPerms || req.freezrAttributes.grantedPerms.length === 0) {
        cb(authErr('No granted permissions exist'))
      } else {
        // TEMP _accessible: accessible[grantee][fullPermName] = {granted:true}
        let accessToRecord = false
        let relevantPerm = null

        req.freezrAttributes.grantedPerms.forEach(aPerm => {
          if (fetchedRecord._accessible && fetchedRecord._accessible[req.freezrAttributes.requestee_user_id] &&
            fetchedRecord._accessible[req.freezrAttributes.requestee_user_id][aPerm.permission_name] &&
            fetchedRecord._accessible[req.freezrAttributes.requestee_user_id][aPerm.permission_name].granted
          ) {
            accessToRecord = true
            if (!req.freezrAttributes.permission_name || aPerm.permission_name === req.freezrAttributes.permission_name) {
              // nb treating permisiion_name as optional. If we want to force having a permission_name then first or expression should eb removed
              relevantPerm = aPerm
            }
          }
        })

        if (accessToRecord && relevantPerm) {
          if (!requestFile && relevantPerm.return_fields && relevantPerm.return_fields.length > 0) {
            permittedRecord = {}
            relevantPerm.return_fields.forEach(key => {
              permittedRecord[key] = fetchedRecord[key]
            })
          } else {
            permittedRecord = fetchedRecord
          }
        } else {
          cb(authErr('No matching permissions exist'))
        }
      }
    }
  ],
  function (err) {
    // fdlog("got to end of read_record_by_id");
    if (err) {
      helpers.send_failure(res, err, 'app_handler', exports.version, 'read_record_by_id')
    } else if (requestFile) {
      helpers.send_success(res, { fileToken: getOrSetFileToken(req.freezrAttributes.requestee_user_id, req.params.requestee_app_name, dataObjectId) })
    } else {
      helpers.send_success(res, permittedRecord)
    }
  })
}

exports.db_query = function (req, res) {
  fdlog('db_query in app_hanlder: ' + req.url + ' body ' + JSON.stringify(req.body) + ' req.params.app_table', req.params.app_table)
  // app.get('/ceps/query/:app_table', userDataAccessRights, app_handler.db_query); (req.params contain query)
  // app.get('/feps/query/:app_table', userDataAccessRights, app_handler.db_query); (same as ceps)
  // app.post('/feps/query/:app_table', userDataAccessRights, app_handler.db_query);
  //   body: permission_name, user_id (ie requestee id), q (query params), only_others, sort

  if (helpers.startsWith(req.params.app_table, 'info.freezr.admin') || req.freezrAttributes.requestor_app === 'info.freezr.admin' || helpers.startsWith(req.params.app_table, 'info.freezr.account')) {
    fdlog('should db_query used to make admin queries???')
  }

  const permissionName = req.body.permission_name

  const authErr = function (message) { return helpers.auth_failure('app_handler', exports.version, 'db_query', message + ' ' + req.params.app_table) }

  if ((!req.body || helpers.isEmpty(req.body)) && req.query && !helpers.isEmpty(req.query)) req.body = { q: req.query } // in case of a GET statement (ie move query to body)

  let gotErr = null

  // fdlog('going to checkReadPermission for ', req.freezrAttributes)
  const [granted, , relevantAndGrantedPerms] = checkReadPermission(req)
  const thePerm = relevantAndGrantedPerms[0]

  if (relevantAndGrantedPerms.lnegth > 1) fdlog('todo - deal with multiple permissions - forcePermName??')
  if (!req.freezrAttributes.own_record && !permissionName) console.log("todo review - Need a persmission name to access others' apps and records? if so permissionName needs to be compulsory for perm_handler too")

  if (req.freezrAttributes.own_record) {
    // all good
  } else if (!granted) {
    gotErr = authErr('unauthorized access to query - no permissions')
  } else if (thePerm.type === 'db_query') {
    // for db_queries make sure query fits the intended schema
    fdlog('todo future functionality')

    if (req.freezrAttributes.grantedPerms.length > 1) gotErr = authErr('develper error - more than one auth')

    if (thePerm.permitted_fields && thePerm.permitted_fields.length > 0 && Object.keys(req.body.q).length > 0) {
      const checkQueryParamsPermitted = function (queryParams, permittedFields) {
        let err = null
        if (Array.isArray(queryParams)) {
          queryParams.forEach(function (item) {
            err = err || checkQueryParamsPermitted(item, permittedFields)
          })
        } else {
          for (const key in queryParams) {
            if (key === '$and' || key === '$or') {
              return checkQueryParamsPermitted(queryParams[key], permittedFields)
            } else if (['$lt', '$gt', '_date_modified'].indexOf(key) > -1) {
              // do nothing
            } else if (permittedFields.indexOf(key) < 0) {
              return (new Error('field not permitted ' + key))
            }
          }
        }
        return (err)
      }
      gotErr = checkQueryParamsPermitted(req.body.q, thePerm.permitted_fields)
    }
  } else if (thePerm.type === 'object_delegate') {
    // TEMP _accessible: accessible[grantee][fullPermName] = {granted:true}
    fdlog('todo - add groups - done?? ')
    req.body.q['_accessible.' + req.freezrAttributes.requestor_user_id] = { $exists: true }
  }

  if (gotErr) {
    helpers.send_failure(res, gotErr, 'app_handler', exports.version, 'db_query')
  } else {
    console.log('todo - if type is not db_query then add relevant criteria to query')

    const skip = req.body.skip ? parseInt(req.body.skip) : 0
    let count = req.body.count ? parseInt(req.body.count) : (req.params.max_count ? req.params.max_count : 50)
    if (thePerm && thePerm.max_count && count + skip > thePerm.max_count) {
      count = Math.max(0, thePerm.max_count - skip)
    }
    let sort = (thePerm && thePerm.sort_fields) ? thePerm.sort_fields : req.body.sort
    if (!sort) sort = { _date_modified: -1 } // default
    if (!req.body.q) req.body.q = {}
    if (req.body.q._modified_before) {
      req.body.q._date_modified = { $lt: parseInt(req.body.q._modified_before) }
      delete req.body.q._modified_before
    }
    if (req.body.q._modified_after) {
      req.body.q._date_modified = { $gt: parseInt(req.body.q._modified_after) }
      delete req.body.q._modified_after
    }
    fdlog('In query to find', JSON.stringify(req.body.q), { sort }, 'count: ', req.body.count)
    let returnFields = null

    if (thePerm && thePerm.return_fields && thePerm.return_fields.length > 0) {
      returnFields = thePerm.return_fields
      returnFields.push('_date_modified')
    }

    const reduceToPermittedFields = function (record, returnFields) {
      if (record._accessible_By) delete record._accessible_By
      if (!returnFields) return record

      if (returnFields._accessible_By) delete returnFields._accessible_By
      var returnObj = {}
      returnFields.forEach((aField) => { returnObj[aField] = record[aField] })
      return returnObj
    }

    // fdlog("usersWhoGrantedAppPermission", usersWhoGrantedAppPermission)
    req.freezrRequesteeDB.query(req.body.q,
      { sort: sort, count: count, skip: skip }, function (err, results) {
        if (err) {
          helpers.send_failure(res, err, 'app_handler', exports.version, 'do_db_query')
        } else {
          if (results && results.length > 0) {
            if (thePerm) results.map(anitem => { anitem._owner = req.freezrAttributes.requestee_user_id })
            if (thePerm && thePerm.return_fields) results = results.map(record => { return reduceToPermittedFields(record, returnFields) })
            const sorter = function (sortParam) {
              const key = Object.keys(sortParam)[0]
              return function (obj1, obj2) {
                return sortParam[key] > 0 ? (obj1[key] > obj2[key]) : obj1[key] < obj2[key]
              }
            }
            results.sort(sorter(sort))
          }

          // if (app_config_permission_schema.max_count && all_permitted_records.length>app_config_permission_schema.max_count)  all_permitted_records.length=app_config_permission_schema.max_count
          if (req.internalcallfwd) {
            req.internalcallfwd(err, results)
          } else {
            helpers.send_success(res, results)
          }
        }
      })
  }
}
exports.delete_record = function (req, res) {
  fdlog('app_handler delete_record ' + req.url)

  // const appErr = function (message) { return helpers.app_data_error(exports.version, 'delete_record', req.freezrAttributes.requestor_app, message) }
  const authErr = function (message) { return helpers.auth_failure('app_handler', exports.version, 'delete_record', req.freezrAttributes.requestor_app + ': ' + message) }

  const [granted] = checkWritePermission(req)

  if (!granted) {
    helpers.send_failure(res, authErr('unauthorized write access'), 'app_handler', exports.version, 'delete_record')
  } else {
    req.freezrRequesteeDB.delete_record(req.params.data_object_id, null, function (err, deleteConfirm) {
      // fdlog("err",err,"deleteConfirm",deleteConfirm)
      if (err) {
        helpers.send_failure(res, err, 'app_handler', exports.version, 'delete_record')
      } else if (!deleteConfirm) {
        helpers.send_failure(res, new Error('unknown write error'), 'app_handler', exports.version, 'delete_record')
      } else {
        helpers.send_success(res, { success: true })
      }
    })
  }
}
exports.restore_record = function (req, res) {
  // app.post('/feps/restore/:app_table', userDataAccessRights, app_handler.restore_record)
  // body has record and options: password, KeepUpdateIds, updateRecord, data_object_id

  fdlog('feps restore_record at ' + req.url + ' body:' + JSON.stringify((req.body) ? req.body : ' none'))

  const write = req.body.record
  const options = req.body.options || { KeepUpdateIds: false }
  const dataObjectId = options.data_object_id
  const isUpdate = dataObjectId && options.updateRecord

  const appErr = function (message) { return helpers.app_data_error(exports.version, 'restore_record', (options.app_name || req.params.app_table), message) }
  const authErr = function (message) { return helpers.auth_failure('app_handler', exports.version, 'restore_record', req.params.app_table + ': ' + message) }

  const permissionRestore = (req.params.app_table === 'info.freezr.admin.public_records')

  async.waterfall([
    // 1. check app token .. and set user_id based on record if not a param...
    function (cb) {
      if (!req.session.user_id || req.session.user_id !== req.freezrAttributes.requestee_user_id || req.freezrAttributes.requestor_app !== 'info.freezr.account') {
        cb(authErr('need to be logged in and requesting proper permissions'))
      } else if (Object.keys(write).length <= 0) {
        cb(appErr('No data to write'))
        // todo - also check if app_table starts with system app names
      } else if (permissionRestore) {
        if (req.session.logged_in_as_admin) {
          cb(null)
        } else {
          cb(authErr('need to be admin to restore records'))
        }
      } else {
        cb(null)
      }
    },

    function (cb) {
      if (!dataObjectId && !isUpdate) { // Simple create object with no id
        cb(null, null)
      } else if (dataObjectId) { // isUpsert or update
        req.freezrRequesteeDB.read_by_id(dataObjectId, function (err, results) {
          cb(err, results)
        })
      } else {
        cb(appErr('Malformed path body combo '))
      }
    },

    // 4. write
    function (results, cb) {
      if (results && isUpdate && results._date_created /* ie is non empty record */) {
        req.freezrRequesteeDB.update(dataObjectId, write, { old_entity: results }, cb)
      } else if (results && !isUpdate) { // should have gotten results
        cb(appErr('Existing record found when this should not be an update '))
      } else if (isUpdate) { // should have gotten results
        cb(appErr('record not found for an update restore'))
      } else { // new document - should not have gotten results
        if (write._id) delete write._id
        req.freezrRequesteeDB.create(dataObjectId, write, { restore_record: true }, cb)
      }
    }
  ],
  function (err, writeConfirm) {
    // fdlog("write err",err,"writeConfirm",writeConfirm)
    if (err) {
      helpers.send_failure(res, err, 'app_handler', exports.version, 'restore_record')
    } else if (!writeConfirm) {
      helpers.send_failure(res, new Error('unknown write error'), 'app_handler', exports.version, 'restore_record')
    } else if (isUpdate) {
      helpers.send_success(res, writeConfirm)
    } else {
      helpers.send_success(res, {
        _id: writeConfirm.entity._id,
        _date_created: writeConfirm.entity._date_created,
        _date_modified: writeConfirm.entity._date_modified
      })
    }
  })
}

exports.create_file_record = function (req, res) {
  fdlog(req, ' create_file_record at ' + req.url + 'body:' + JSON.stringify((req.body && req.body.options) ? req.body.options : ' none'))

  const write = req.body.data || {}

  if (req.body.options && (typeof req.body.options === 'string')) req.body.options = JSON.parse(req.body.options) // needed when upload file
  if (req.body.data && (typeof req.body.data === 'string')) req.body.data = JSON.parse(req.body.data) // needed when upload file

  const isUpdate = false // re-revie for doing updates
  const userId = req.session.logged_in_user_id

  const appErr = function (message) { return helpers.app_data_error(exports.version, 'create_file_record', req.freezrAttributes.requestor_app, message) }
  // const authErr = function (message) {return helpers.auth_failure("app_handler", exports.version, "create_file_record", req.freezrAttributes.requestor_app + ": "+message);}

  var fileParams = {
    dir: (req.body.options && req.body.options.targetFolder) ? req.body.options.targetFolder : '',
    name: (req.body.options && req.body.options.fileName) ? req.body.options.fileName : req.file.originalname,
    duplicated_file: false
  }
  if (req.file) fileParams.is_attached = true
  fileParams.dir = fileHandler.normUrl(fileHandler.removeStartAndEndSlashes(helpers.FREEZR_USER_FILES_DIR + '/' + userId + '/files/' + req.params.app_name + '/' + fileHandler.removeStartAndEndSlashes('' + fileParams.dir)))
  let dataObjectId = fileHandler.removeStartAndEndSlashes(userId + '/' + fileHandler.removeStartAndEndSlashes('' + fileParams.dir))

  async.waterfall([
    // 1. check stuff ...
    function (cb) {
      if (!fileParams.is_attached) {
        cb(appErr('Missing file'))
      } else if (helpers.is_system_app(req.freezrAttributes.requestor_app)) {
        cb(helpers.invalid_data('app name not allowed: ' + req.freezrAttributes.requestor_app, 'account_handler', exports.version, 'create_file_record'))
      } else if (!helpers.valid_filename(fileParams.name)) {
        cb(appErr('Invalid file name'))
      } else if (!fileHandler.valid_path_extension(fileParams.dir)) {
        cb(appErr('invalid folder name'))
      } else {
        dataObjectId = dataObjectId + '/' + fileParams.name
        throw new Error('create_file_record - todo - writeUserFile needs to be implemented')
        // old: file_handler.writeUserFile(fileParams.dir, fileParams.name, req.body.options, data_model, req, cb);
      }
    },

    // 4. write
    function (newFileName, cb) {
      if (newFileName !== fileParams.name) {
        var last = dataObjectId.lastIndexOf(fileParams.name)
        if (last > 0) {
          dataObjectId = dataObjectId.substring(0, last) + newFileName
        } else {
          cb(appErr('SNBH - no file name in obejct id'))
        }
      }
      req.freezrRequesteeDB.create(dataObjectId, write, { restoreRecord: false }, cb)
    }
  ],
  function (err, writeConfirm) {
    // fdlog("err",err,"writeConfirm",writeConfirm)
    if (err) {
      helpers.send_failure(res, err, 'app_handler', exports.version, 'create_file_record')
    } else if (!writeConfirm) {
      helpers.send_failure(res, new Error('unknown write error'), 'app_handler', exports.version, 'create_file_record')
    } else if (isUpdate) {
      helpers.send_success(res, writeConfirm)
    } else {
      helpers.send_success(res, {
        _id: writeConfirm.entity._id,
        _date_created: writeConfirm.entity._date_created,
        _date_modified: writeConfirm.entity._date_modified
      })
    }
  })
}
exports.getFileToken = exports.read_record_by_id

// fdlog todo - FILE_TOKEN_CACHE needs to be moved to dsManager
var FILE_TOKEN_CACHE = {}
const FILE_TOKEN_EXPIRY = 24 * 3600 * 1000 // expiry of 24 hours
const FILE_TOKEN_KEEP = 18 * 3600 * 1000 // time before a new token is issued so it stays valid
let cleanFilecacheTimer = null
const getOrSetFileToken = function (userId, requesteeApp, dataObjectId) {
  const key = FileTokenkeyFromRecord(requesteeApp, dataObjectId)
  const nowTime = new Date().getTime()
  if (cleanFilecacheTimer) clearTimeout(cleanFilecacheTimer)
  cleanFilecacheTimer = setTimeout(cleanFileTokens, 10 * 1000)
  if (!FILE_TOKEN_CACHE[key]) {
    FILE_TOKEN_CACHE[key] = {}
    const newtoken = helpers.randomText(20)
    FILE_TOKEN_CACHE[key][newtoken] = nowTime
    return newtoken
  } else {
    let gotToken = null
    for (const [aToken, aDate] of Object.entries(FILE_TOKEN_CACHE[key])) {
      if (nowTime - aDate < FILE_TOKEN_KEEP) gotToken = aToken
      if (nowTime - aDate > FILE_TOKEN_EXPIRY) delete FILE_TOKEN_CACHE[key][aToken]
    }
    if (gotToken) {
      return gotToken
    } else {
      const newtoken = helpers.randomText(20)
      FILE_TOKEN_CACHE[key][newtoken] = nowTime
      return newtoken
    }
  }
}
const FileTokenkeyFromRecord = function (requesteeApp, dataObjectId) {
  return requesteeApp + '/' + dataObjectId
}
const cleanFileTokens = function () {
  // fdlog('cleanFileTokens')
  const nowTime = new Date().getTime()
  for (const [key, keyObj] of Object.entries(FILE_TOKEN_CACHE)) {
    for (const [aToken, aDate] of Object.entries(keyObj)) {
      if (nowTime - aDate > FILE_TOKEN_EXPIRY) { delete FILE_TOKEN_CACHE[key][aToken] }
    }
    if (Object.keys(keyObj).length === 0) delete FILE_TOKEN_CACHE[key]
  }
}
exports.sendUserFile = function (req, res) {
  // /v1/userfiles/info.freezr.demo.clickOnCheese4.YourCheese/salman/logo.1.png?fileToken=Kn8DkrfgMUwCaVCMkKZa&permission_name=self
  const parts = req.path.split('/').slice(3)
  const key = decodeURI(parts.join('/'))
  // const newpath = helpers.FREEZR_USER_FILES_DIR + parts[1] + '/files/' + parts[0] + '/' + decodeURI(parts[2])
  if (!FILE_TOKEN_CACHE[key] || !FILE_TOKEN_CACHE[key][req.query.fileToken] || (new Date().getTime - FILE_TOKEN_CACHE[key][req.query.fileToken] > FILE_TOKEN_EXPIRY)) {
    if (!FILE_TOKEN_CACHE[key]) {
      felog('NO KEY', req.url)
    }
    // , FILE_TOKEN_CACHE
    // if ( !FILE_TOKEN_CACHE[key][req.query.fileToken]  ) //onsole.warn("NO TOKEN ",req.query.fileToken,"cache is ",FILE_TOKEN_CACHE[key])
    // if ((new Date().getTime - FILE_TOKEN_CACHE[key][req.query.fileToken] >FILE_TOKEN_EXPIRY)) //onsole.warn("EXPIRED TOKEN")
    res.sendStatus(401)
  } else {
    throw new Error('create_file_record - todo - sendUserFile needs to be implemented')
    // ?? old: file_handler.sendUserFile(res, newpath, req.freezr_environment );
  }
}

// have user_perms and app_table
// check perm is granted...
// if add -> _accessible:salman{granted:true, apps:[requestor_app/perm]}
// in perm - add accessors: [salman]
// when remove perm... find accessors from perm, then search

// permission access operations
exports.setObjectAccess = function (req, res) {
  // After app-permission has been given, this sets or updates permission to access a record
  // app.put('/v1/permissions/setobjectaccess', userLoggedInRights, app_handler.setObjectAccess);

  // 'grant' true, or false for 'deny'
  /*
  {   name: “link_share”,
      table_id: “com.salmanff.vulog.marks”,
      data_object_id: “randomRecordId123” (Can be string, id, or list of id's or a query)
      requestor_app: “com.salmanff.vulog”,
      grant: true,
      grantees: [‘Dixon @ personium’]
  */

  fdlog('setObjectAccess, req.body: ', req.body)

  const queryFromBody = function (rec) {
    if (!rec) return null
    if (typeof rec === 'string') return { _id: rec }
    if (Array.isArray(rec)) return { $or: rec.map(arec => { return ({ _id: (typeof arec === 'string') ? arec : '' }) }) }
    if (typeof rec === 'object') return rec
    return null
  }
  const recordQuery = queryFromBody(req.body.data_object_id)
  var datePublished = req.body.grant ? (req.body.pubDate ? req.body.pubDate : new Date().getTime()) : null

  const userId = req.freezrTokenInfo.user_id // requestor and requestee are the same
  const requestorApp = req.freezrTokenInfo.app_name

  let grantedPermission = null

  var allowedGrantees = []
  var granteesNotAllowed = []
  var recordsToChange = []

  fdlog('setObjectAccess by ' + userId + 'for requestor app ' + requestorApp + ' query:' + JSON.stringify(recordQuery) + ' action' + JSON.stringify(req.body.grant) + ' perm: ' + req.body.name)

  function appErr (message) { return helpers.app_data_error(exports.version, 'setObjectAccess', req.freezrTokenInfo.appName + '- ' + message) }

  async.waterfall([
    // 0 make basic checks and get the perm
    function (cb) {
      if (!recordQuery) {
        cb(appErr('Missing query to set access'))
      } else if (req.body.action === undefined) {
        cb(appErr('Missing action (grant or deny)'))
      } else if (typeof req.body.data_object_id !== 'string' && req.body.publicid && req.body.grantees.includes('_public')) {
        cb(appErr('input error - cannot assign a public id to more than one entity - please include ine record if under data_object_id'))
      } else if (!req.body.name) {
        cb(appErr('error - need permission name to set access'))
      } else if (!req.body.table_id) {
        cb(appErr('error - need requested table_id to work on permission'))
      } else {
        req.freezrUserPermsDB.query({ name: req.body.name, requestor_app: requestorApp }, {}, cb)
      }
    },
    function (results, cb) {
      if (!results || results.length === 0) {
        cb(helpers.error('PermissionMissing', 'permission does not exist - try re-installing app'))
      } else if (!results[0].granted) {
        cb(helpers.error('PermissionNotGranted', 'permission not granted yet'))
      } else if (results[0].table_id !== req.body.table_id) {
        cb(helpers.error('TableMissing', 'The table being read needs does not correspond to the permission '))
      } else {
        grantedPermission = results[0]
        // fdlog({ grantedPermission })
        cb(null)
      }
    },

    // make sure grantees are in ACL - assign them to allowedGrantees
    function (cb) {
      allowedGrantees = []
      async.forEach(req.body.grantees, function (grantee, cb2) {
        if (grantee === '_public') {
          // if (grantedPermission.allowPublic) {
          felog('grantedPermission.allowPublic not yet operational')
          allowedGrantees.push(grantee)
          cb2(null)
          /*
          } else {
            felog('need to allow_public in permission definition to share publcily')
            cb(helpers.error('need to allow_public in permission definition to share publcily'))
          }
          */
        } else {
          req.freezrRequestorACL.query({ name: grantee }, null, function (err, results) {
            if (results && results.length > 0) {
              allowedGrantees.push(grantee)
            } else {
              granteesNotAllowed.push(grantee)
            }
            cb2(err)
          })
        }
      }, function (err) {
        if (allowedGrantees.length > 0) {
          cb(err)
        } else {
          cb(new Error('No grantees are in your acl'))
        }
      })
    },

    // get the records and add the grantees in _accessible (or remvoe them)
    function (cb) {
      req.freezrRequesteeDB.query(recordQuery, null, cb)
    },
    function (records, cb) {
      if (!records || records.length === 0) {
        cb(new Error('no records found to add'))
      } else {
        recordsToChange = records
        async.forEach(recordsToChange, function (rec, cb2) {
          var accessible = rec._accessible || {}
          const fullPermName = (requestorApp + '/' + req.body.name).replace(/\./g, '_')
          if (req.body.grant) {
            req.body.grantees.forEach((grantee) => {
              if (!accessible[grantee]) accessible[grantee] = {}
              if (!accessible[grantee][fullPermName]) accessible[grantee][fullPermName] = { granted: true }
              if (allowedGrantees.includes('_public')) {
                const publicid = (req.body.publicid || (userId + '/' + req.body.table_id + '/' + rec._id)).replace(/\./g, '_')
                accessible[grantee][fullPermName].publicid = publicid
              }
            })
          } else { // revoke
            req.body.grantees.forEach((grantee) => {
              // future - could keep all public id's and then use those to delete them later
              if (accessible[grantee] && accessible[grantee][fullPermName]) delete accessible[grantee][fullPermName]
              if (helpers.isEmpty(accessible[grantee])) delete accessible[grantee]
            })
          }
          // fdlog('updating freezrRequesteeDB ',rec._id,'with',{accessible})
          req.freezrRequesteeDB.update(rec._id, { _accessible: accessible }, { newSystemParams: true }, function (err, results) {
            cb2(err)
          })
        }, cb)
      }
    },

    // add the grantees to the permission record
    function (cb) {
      if (req.body.grant) {
        let granteeList = grantedPermission.grantees || []
        allowedGrantees.forEach((grantee) => { granteeList = helpers.addToListAsUnique(granteeList, grantee) })
        req.freezrUserPermsDB.update(grantedPermission._id, { grantees: granteeList }, { replaceAllFields: false }, function (err, results) {
          cb(err)
        })
        // note that the above live is cumulative.. it could be cleaned if it bloats
      } else { cb(null) }
    },

    // for public records, add them to the public db
    function (cb) {
      if (allowedGrantees.includes('_public')) {
        async.forEach(recordsToChange, function (rec, cb2) {
          const publicid = (req.body.publicid || (userId + '/' + req.body.table_id + '/' + rec._id)).replace(/\./g, '_')
          let searchWords = []
          if (grantedPermission.searchFields && grantedPermission.searchFields.length > 0) {
            searchWords = helpers.getUniqueWords(rec, grantedPermission.searchFields)
          }
          let originalRecord = {}
          if (grantedPermission.returnFields && grantedPermission.returnFields.length > 0) {
            grantedPermission.returnFields.forEach(item => {
              originalRecord[item] = rec[item]
            });
            ['_date_created', '_date_modified', '_id'].forEach(item => {
              originalRecord[item] = rec[item]
            })
          } else {
            originalRecord = rec
          }
          req.freezrPublicRecordsDB.query({ data_owner: userId, original_record_id: rec._id, original_app_table: req.body.table_id, permission_name: req.body.name }, {}, function (err, results) {
            var accessiblesObject = {
              data_owner: userId,
              original_app_table: req.body.table_id,
              requestor_app: requestorApp,
              permission_name: req.body.name,
              original_record_id: rec._id,
              original_record: originalRecord,
              search_words: searchWords,
              datePublished: datePublished
            }
            fdlog('freezrPublicRecordsDB query', { results }, 'body: ', req.body)
            if (err) {
              cb(err)
            } else if (!results || results.length === 0) {
              // write new permission
              if (req.body.grant) {
                req.freezrPublicRecordsDB.create(publicid, accessiblesObject, {}, cb)
              } else {
                cb(helpers.state_error('cannot ungrant a non-existent public record'))
              }
            } else if (results.length > 1) {
              helpers.state_error('app_handler', exports.version, 'setObjectAccess', 'multiple_permissions', new Error('Retrieved moRe than one permission where there should only be one ' + JSON.stringify(results)), null)
              // todo delete other ones?
            } else { // update existing perm
              if (req.body.grant) {
                req.freezrPublicRecordsDB.update(publicid, accessiblesObject, {}, cb)
              } else {
                req.freezrPublicRecordsDB.delete(publicid, cb)
              }
            }
          })
        })
      } else {
        cb(null)
      }
    }
  ],
  function (err, results) {
    if (err) {
      console.warn(err, results)
      helpers.send_failure(res, err, 'app_handler', exports.version, 'setObjectAccess')
    } else if (req.body.publicid) { // sending back data_object_id
      helpers.send_success(res, { data_object_id: req.body.data_object_id, _publicid: (req.body.grant ? results._id : null), grant: req.body.grant, recordsChanged: (recordsToChange.length) })
    } else { // sending back data_object_id
      fdlog('issues should be used')
      helpers.send_success(res, { success: true, recordsChanged: (recordsToChange.length) })
    }
  })
}

const checkWritePermission = function (req, forcePermName) {
  // console.log todo note using groups, we should also pass on all the groups user is part of and check them
  if (req.freezrAttributes.own_record && helpers.startsWith(req.params.app_table, req.freezrAttributes.requestor_app)) return [true, []]
  let granted = false
  var relevantAndGrantedPerms = []
  req.freezrAttributes.grantedPerms.forEach(perm => {
    if (perm.type === 'write_all' && perm.grantees.includes(req.freezrAttributes.requestor_user_id)) {
      if (!forcePermName || perm.name === forcePermName) {
        granted = true
        relevantAndGrantedPerms.push(perm)
      }
    }
    if (perm.type === 'write_all') console.log('todo - method of assigning write_all grantees  for writing needs to be defined - not implmented yet')
  })
  return [granted, relevantAndGrantedPerms]
}
const checkReadPermission = function (req, forcePermName) {
  // console.log todo note using groups, we should also pass on all the groups user is part of and check them
  if (req.freezrAttributes.own_record && helpers.startsWith(req.params.app_table, req.freezrAttributes.requestor_app)) return [true, true, []]
  let granted = false
  let readAll = false
  var relevantAndGrantedPerms = []
  req.freezrAttributes.grantedPerms.forEach(perm => {
    if (['write_all', 'read_all', 'object_access'].includes(perm.type) && perm.grantees.includes(req.freezrAttributes.requestor_user_id)) {
      if (!forcePermName || perm.name === forcePermName) {
        granted = true
        relevantAndGrantedPerms.push(perm)
      }
    }
    readAll = readAll || ['write_all', 'read_all'].includes(perm.type)
    if (perm.type === 'write_all') console.log('todo - method of assigning write_all grantees for reading needs to be defined - not implmented yet')
    if (perm.type === 'read_all') console.log('todo - method of assigning read_all grantees for reading needs to be defined - not implmented yet')
  })
  return [granted, readAll, relevantAndGrantedPerms]
}

// developer utilities
exports.getConfig = function (req, res) {
  // app.get('/v1/developer/config/:app_name'
  // getAllCollectionNames
  felog('NOT TESTED - NOT WROKING - REVIEW')
  function endCB (err, appConfig = null, collections = []) {
    if (err) console.warn('got err in getting appconfig ', err)
    if (appConfig) {
      helpers.send_success(res, { app_config: req.freezrRequestorAppConfig, collection_names: collections })
    } else {
      helpers.send_failure(res, err, 'app_handler', exports.version, 'getConfig')
    }
  }

  if (!req.freezrRequestorAppConfig) {
    endCB(new Error('no appConfig found'))
  } else {
    if (req.params.app_name === 'infor.freezr.admin') console.log('todo - neeed to separate our config of fradmin')
    req.freezrUserDS.getorInitDb({ owner: this.owner, app_table: req.params.app_name }, null, function (err, topdb) {
      if (err) {
        endCB(err, req.freezrRequestorAppConfig)
      } else {
        topdb.getAllCollectionNames(req.params.app_name, function (err, collections) {
          endCB(err, req.freezrRequestorAppConfig, collections)
        })
      }
    })
  }
}
// Loggers
const LOG_ERRORS = true
const felog = function (...args) { if (LOG_ERRORS) helpers.warning('app_handler.js', exports.version, ...args) }
const LOG_DEBUGS = false
const fdlog = function (...args) { if (LOG_DEBUGS) console.log(...args) }
