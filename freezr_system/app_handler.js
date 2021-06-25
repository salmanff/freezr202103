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
  const manifest = req.freezrRequestorManifest

  if (!req.params.page) req.params.page = 'index'
  if (helpers.endsWith(req.params.page, '.html')) req.params.page = req.params.page.slice(0, -5)

  const pageName = req.params.page

  if (!manifest.pages) manifest.pages = { pageName: {} }
  if (!manifest.pages[pageName]) {
    manifest.pages[pageName] = {
      // todo - check if the files exist first?
      html_file: pageName + '.html',
      css_files: pageName + '.css',
      script_files: [pageName + '.js']
    }
  }
  if (!manifest.pages[pageName].page_title) manifest.pages[pageName].page_title = pageName

  req.params.internal_query_token = req.freezrTokenInfo.app_token // internal query request

  if (manifest.pages[pageName].initial_query) {
    // Only takes type: db_query at this time
    const queryParams = manifest.pages[pageName].initial_query
    const manifestPermissionSchema = (manifest.permissions && queryParams.permission_name) ? manifest.permissions[queryParams.permission_name] : null

    if (manifestPermissionSchema) {
      req.body.permission_name = queryParams.permission_name
      req.params.app_table = req.params.app_name + (manifestPermissionSchema.collection_name ? ('.' + manifestPermissionSchema.collection_name) : '')
      if (queryParams.collection_name && manifestPermissionSchema.collection_name !== queryParams.collection_name) helpers.warning('app_handler', exports.version, 'generatePage', 'permission schema collection inconsistent with requested collction ' + queryParams.collection_name + ' for app: ' + req.params.app_name)
    } else if (queryParams.collection_name) {
      req.params.app_table = req.params.app_name + (queryParams.collection_name ? ('.' + queryParams.collection_name) : '')
    } else {
      felog('generatePage ', 'Have to define either permission_name or collection_name (for own collection) in initial_query of manifest')
    }

    req.internalcallfwd = function (err, results) {
      if (err) felog('State Error ' + err)
      req.params.queryresults = { results: results }
      generatePageWithManifest(req, res, manifest)
    }
    exports.db_query(req, res)
  } else {
    generatePageWithManifest(req, res, manifest)
  }
}

var generatePageWithManifest = function (req, res, manifest) {
  fdlog('generatePageWithManifest', { manifest })

  const pageParams = manifest.pages[req.params.page]

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
    app_display_name: ((manifest && manifest.display_name) ? manifest.display_name : req.params.app_name),
    app_version: (manifest && manifest.version) ? manifest.version : 'N/A',
    other_variables: null,
    freezr_server_version: req.freezr_server_version,
    server_name: req.protocol + '://' + req.get('host')
  }

  if (!req.params.internal_query_token) {
    helpers.send_internal_err_page(res, 'app_handler', exports.version, 'generatePage', 'app_token missing in generatePageWithManifest')
  } else {
    res.cookie('app_token_' + req.session.logged_in_user_id, req.params.internal_query_token, { path: '/apps/' + req.params.app_name })

    // options.messages.showOnStart = (results.newCode && manifest && manifest.permissions && Object.keys(manifest.permissions).length > 0);
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
  owner_user_id:null,
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
  const isUpdate = helpers.startsWith(req.url, '/ceps/update') || helpers.startsWith(req.url, '/feps/update') || (helpers.startsWith(req.url, '/feps/write') && req.query.upsert === 'true')
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
      } else if (helpers.startsWith(req.params.app_table, 'info.freezr')) {
        // to write into any info,freezr table, must go through addount_handler or admin_handler
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
    // onsole.log('write err', err, 'writeConfirm', { writeConfirm, isUpdate, isQueryBasedUpdate })
    if (err) {
      helpers.send_failure(res, err, 'app_handler', exports.version, 'write_record')
    } else if (isQueryBasedUpdate) {
      helpers.send_success(res, writeConfirm)
    } else if (!writeConfirm || !writeConfirm._id) {
      felog('snbh - unknown error writing one recvord at a time ', { write, writeConfirm })
      helpers.send_failure(res, new Error('unknown write error'), 'app_handler', exports.version, 'write_record')
    } else if (isUpdate || isUpsert) {
      helpers.send_success(res, writeConfirm)
    } else { // write new (CEPS)
      helpers.send_success(res, writeConfirm)
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

    // 2. get permissions if needbe, and remove fields that shouldnt be sent
    function (fetchedRecord, cb) {
      if (!fetchedRecord) {
        cb(appErr('no related records'))
      } else if (req.freezrAttributes.own_record || readAll) { // ie own_record or has read_all.. redundant? own_record always gets readall
        permittedRecord = fetchedRecord
        // todo - should have a flag for admin / account operations to get the _accessible too
        delete permittedRecord._accessible
        cb(null)
      } else if (!req.freezrAttributes.grantedPerms || req.freezrAttributes.grantedPerms.length === 0) {
        cb(authErr('No granted permissions exist'))
      } else {
        // TEMP _accessible: accessible[grantee][fullPermName] = {granted:true}
        let accessToRecord = false
        let relevantPerm = null

        const requestee = req.freezrAttributes.owner_user_id.replace(/\./g, '_')

        req.freezrAttributes.grantedPerms.forEach(aPerm => {
          if (fetchedRecord._accessible && fetchedRecord._accessible[requestee] &&
            fetchedRecord._accessible[requestee][aPerm.permission_name].granted
          ) {
            accessToRecord = true
            if (fetchedRecord._accessible[requestee][aPerm.permission_name].granted &&
               (!req.freezrAttributes.permission_name || aPerm.permission_name === req.freezrAttributes.permission_name)
            ) {
              // nb treating permisiion_name as optional. If we want to force having a permission_name then expression should eb removed
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
      helpers.send_success(res, { fileToken: getOrSetFileToken(req.freezrAttributes.owner_user_id, req.params.requestee_app_name, dataObjectId) })
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

  const [granted, canReadAllTable, relevantAndGrantedPerms] = checkReadPermission(req)
  fdlog('checkReadPermission results for req.freezrAttributes: ', req.freezrAttributes, { granted, canReadAllTable, relevantAndGrantedPerms })
  const thePerm = relevantAndGrantedPerms[0]

  if (relevantAndGrantedPerms.length > 1) fdlog('todo - deal with multiple permissions - forcePermName??')
  if (!req.freezrAttributes.own_record && !permissionName) console.log("todo review - Need a persmission name to access others' apps and records? if so permissionName needs to be compulsory for perm_handler too")
  fdlog('todo - not granted reason???', {granted}, req.params.app_table, ' req.path:', req.path, ' body:' , req.body, ' query: ', req.query)

  if (!granted) {
    gotErr = authErr('unauthorized access to query - no permissions')
  } else if (canReadAllTable) { // includes read_all / write_all prems and req.freezrAttributes.own_record
    // all good
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
    gotErr = new Error('todo - dg_query permission type NOT yet functional')
  } else if (thePerm.type === 'share_records') {
    // TEMP _accessible: accessible[grantee][fullPermName] = {granted:true}
    fdlog('todo - add groups - done?? ')
    if (!req.body.q) req.body.q = {}
    req.body.q['_accessible.' + req.freezrAttributes.requestor_user_id + '.granted'] = true // old { $exists: true }
  }

  if (gotErr) {
    helpers.send_failure(res, gotErr, 'app_handler', exports.version, 'db_query')
  } else {
    felog('todo - if type is not db_query then add relevant criteria to query')

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
      if (record._accessible) delete record._accessible
      if (!returnFields) return record

      if (returnFields._accessible) delete returnFields._accessible
      var returnObj = {}
      returnFields.forEach((aField) => { returnObj[aField] = record[aField] })
      return returnObj
    }

    fdlog('will query ', req.body.q)
    // fdlog("usersWhoGrantedAppPermission", usersWhoGrantedAppPermission)
    req.freezrRequesteeDB.query(req.body.q,
      { sort: sort, count: count, skip: skip }, function (err, results) {
        if (err) {
          helpers.send_failure(res, err, 'app_handler', exports.version, 'do_db_query')
        } else {
          if (results && results.length > 0) {
            if (thePerm) results.map(anitem => { anitem._owner = req.freezrAttributes.owner_user_id })
            if (thePerm && thePerm.return_fields) results = results.map(record => { return reduceToPermittedFields(record, returnFields) })
            const sorter = function (sortParam) {
              const key = Object.keys(sortParam)[0]
              return function (obj1, obj2) {
                return sortParam[key] > 0 ? (obj1[key] > obj2[key]) : obj1[key] < obj2[key]
              }
            }
            results.sort(sorter(sort))
          }

          // if (manifest_permission_schema.max_count && all_permitted_records.length>manifest_permission_schema.max_count)  all_permitted_records.length=manifest_permission_schema.max_count
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
      if (!req.session.logged_in_user_id || req.session.logged_in_user_id !== req.freezrAttributes.owner_user_id || req.freezrAttributes.requestor_app !== 'info.freezr.account') {
        cb(authErr('need to be logged in and requesting proper permissions ' + req.session.logged_in_user_id + ' vs ' + req.freezrAttributes.owner_user_id + ' app ' + req.freezrAttributes.requestor_app))
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
    fdlog('end restore rec ', { err, writeConfirm })
    if (err) {
      helpers.send_failure(res, err, 'app_handler', exports.version, 'restore_record')
    } else if (!writeConfirm) {
      helpers.send_failure(res, new Error('unknown write error'), 'app_handler', exports.version, 'restore_record')
    } else if (isUpdate) {
      helpers.send_success(res, writeConfirm)
    } else {
      helpers.send_success(res, {
        _id: writeConfirm._id,
        _date_created: writeConfirm._date_created,
        _date_modified: writeConfirm._date_modified
      })
    }
  })
}

exports.messageActions = function (req, res) {
  fdlog('received messageActions at', req.utl, req.body)
  switch (req.params.action) {
    case 'initiate': {
      console.log('share initiate')
      // make sure app has sharing permission and conctact permission
      // record message in 'messages sent'
      // communicate it to the other person's server
      // ceps/messages/transmit
      /*
      {
        type: ‘share-records’, // based on permission type
        recipient_host : ‘https://data-vault.eu’,
        recipient_id : ‘christoph’,
        message_permission : ‘link_share’,
        contact_permission : ‘friends’,
        table_id : ‘com.salmanff.vulog.marks’,
        record_id : ‘randomRecordId123’,
        app_id :
        sender_id :
        sender_host :
      }
      */
      let grantedPermission = null
      let permittedRecord = null
      var params = req.body
      const recipientFullName = (params.recipient_id + '@' + params.recipient_host).replace(/\./g, '_')

      async.waterfall([
        // 1 basic checks
        function (cb) {
          if (params.type !== 'share-records') {
            cb(helpers.error(null, 'only share-records type messaging currently allowed'))
          } else if (params.sender_id !== req.freezrTokenInfo.requestor_id) {
            cb(helpers.error(null, 'requestor id mismatch'))
          } else if (params.app_id !== req.freezrTokenInfo.app_name) {
            cb(helpers.error(null, 'app id mismatch'))
          } else {
            cb(null)
          }
        },
        // 2 check message permision
        function (cb) {
          req.freezrUserPermsDB.query({ name: params.message_permission, requestor_app: req.freezrTokenInfo.app_name }, {}, cb)
        },
        function (results, cb) {
          if (!results || results.length === 0) {
            cb(helpers.error('Message Permission Missing', 'Sharing Permissions missing - internal'))
          } else if (!results[0].granted) {
            cb(helpers.error('Message PermissionNotGranted', 'permission not granted yet'))
          } else if (results[0].table_id !== params.table_id) {
            cb(helpers.error('Message TableMissing', 'The table being granted permission to does not correspond to the permission '))
          } else {
            // todo - can also check if it is a grantee here
            if (results.length > 1) felog('Two permissions found where one was expected ' + JSON.stringify(results))
            grantedPermission = results[0]
            cb(null)
          }
        },
        // 3 check reciipent is a contact
        function (cb) {
          fdlog('fund contacts ', { username: params.recipient_id, serverurl: params.recipient_host })
          req.freezrCepsContacts.query({ username: params.recipient_id, serverurl: params.recipient_host }, {}, cb)
        },
        function (results, cb) {
          if (!results || results.length === 0) {
            cb(helpers.error('contact  missing', 'contact does not exist - please add the contact to your conmtacts and then continue'))
          } else {
            if (results.length > 1) felog('two contacts found where one was expected ' + JSON.stringify(results))
            cb(null)
          }
        },
        // get record and make sure grantee is in it.. keep a copy
        function (cb) {
          req.freezrRequesteeDB.read_by_id(params.record_id, cb)
        },
        function (fetchedRecord, cb) {
          if (!fetchedRecord) {
            cb(helpers.error(null, 'no related records'))
          } else if (!fetchedRecord._accessible || !fetchedRecord._accessible[recipientFullName] || !fetchedRecord._accessible[recipientFullName].granted) {
            cb(helpers.error(null, 'permission not granted'))
          } else {
            if (grantedPermission.return_fields && grantedPermission.return_fields.length > 0) {
              permittedRecord = {}
              grantedPermission.return_fields.forEach(key => {
                permittedRecord[key] = fetchedRecord[key]
              })
            } else {
              permittedRecord = fetchedRecord
            }
            delete permittedRecord._accessible

            // update the record to show it has been messaged. (This really should be done after the 'verify' step)
            var messageUpdate = fetchedRecord._accessible
            messageUpdate[recipientFullName].messaged = true
            req.freezrRequesteeDB.update(params.record_id, { _accessible: messageUpdate }, { replaceAllFields: false, newSystemParams: true }, cb)
          }
        },
        function (ret, cb) {
          cb(null)
        },
        function (cb) {
          var options = {}
          if (params.recipient_host === params.sender_host) {
            options.recipientGotMessages = req.freezrOtherPersonGotMsgs
            options.recipientContacts = req.freezrOtherPersonContacts
            sameHostMessageExchange(req, permittedRecord, params, cb)
          } else {
            createAndTransmitMessage(req.freezrSentMessages, permittedRecord, params, cb)
          }
        }
      ], function (err, returns) {
        if (returns) returns = returns.toString()
        if (err) {
          helpers.send_failure(res, err, 'app_handler', exports.version, 'messageActions transmit')
        } else {
          helpers.send_success(res, { success: true })
        }
      })
    }
      break
    case 'transmit':
      {
          console.log('share transmit')
        // see if is in contact db and if so can get the details - verify it and then record
        // see if sender is in contacts - decide to keep it or not and to verify or not
        // record message in 'messages got' and then do a verify
        var receivedParams = req.body
        let storedmessageId = null
        async.waterfall([
          // check that recipient has sender as contact
          function (cb) {
            req.freezrCepsContacts.query({ username: receivedParams.sender_id, serverurl: receivedParams.sender_host }, {}, cb)
          },
          function (results, cb) {
            if (!results || results.length === 0) {
              cb(helpers.error('contact PermissionMissing', 'contact does not exist - try re-installing app'))
            } else {
              if (results.length > 1) felog('two contacts found where one was expected ' + JSON.stringify(results))
              cb(null)
            }
          },
          // store message
          function (cb) {
            delete receivedParams._id
            req.freezrGotMessages.create(null, receivedParams, null, cb)
          },
          // confirm message receipt
          function (confirmed, cb) {
            storedmessageId = confirmed._id
            // helpers.send_success(res, { success: true })
            cb(null)
          },
          // verify the nonce and get the record and update the record on the db
          function (cb) {
            const isLocalhost = helpers.startsWith(receivedParams.sender_host, 'http://localhost')
            const https = isLocalhost ? require('http') : require('https')

            const options = {
              hostname: isLocalhost ? 'localhost' : receivedParams.sender_host.slice(8),
              path: '/ceps/message/verify',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': JSON.stringify(receivedParams).length
              }
            }
            if (isLocalhost) options.port = receivedParams.sender_host.slice(17)
            const verifyReq = https.request(options, (verifyRes) => {
              var chunks = ''
              // var chunks = []
              verifyRes.on('data', function (chunk) {
                console.log('got chunk -' + chunk.toString('utf-8') + '- End Chunk')
                chunk = chunk.toString('utf-8')
                if (chunk.slice(-1) === '\n') console.log('going to slice chunk')
                if (chunk.slice(-1) === '\n') chunk = chunk.slice(0, -1)
                // chunks.push(chunk)
                chunks += chunk
              })

              verifyRes.on('end', function () {
                // let data = Buffer.concat(chunks).toString('utf-8')
                let data = chunks
                console.log('chunks now -' + chunks + '- end chunks')
                try {
                  data = JSON.parse(data)
                  cb(null, data)
                } catch (e) {
                  felog('error parsing message in transmit', e)
                  cb(e)
                }
              })

              /*
              let data = ''
              verifyRes.on('data', function (chunk) {
                if (typeof chunk !== 'string') chunk = chunk.toString() // meeded?
                data += chunk
              })

              verifyRes.on('end', function () {
                try {
                  data = JSON.parse(data)
                  cb(null, data)
                } catch (e) {
                  felog('error parsing message in transmit', e)
                  cb(e)
                }
              })

              verifyRes.on('data', (returns) => {
                let err = null
                if (returns) returns = returns.toString()
                if (typeof returns === 'string') {
                  try {
                    returns = JSON.parse(returns)
                  } catch (e) {
                    felog('error parsing message in transmit', e)
                    err = e
                  }
                }
                cb(err, (err ? null : returns))
              })
              */
            })
            verifyReq.on('error', (error) => {
              felog('error in transmit ', error)
              cb(helpers.error('message transmission error'))
            })
            verifyReq.write(JSON.stringify(receivedParams))
            verifyReq.end()
          },
          // update the record
          function (returns, cb) {
            if (returns.record) {
              req.freezrGotMessages.update(storedmessageId, { record: returns.record, status: 'verified' }, { replaceAllFields: false }, cb)
            } else {
              // records not sent could be due to internal problem at other server or choice of other server (in future) of not sendinfg record on 'verify' - ignore and deal with separately - app can fetch record_id
              cb(null)
            }
          }
        ],
        function (err) {
          if (err) console.error('todo check error message corresponds to eblow ', err.message, err)
          if (err && err.message === 'contact PermissionMissing') {
            console.warn('Unanswered message ', receivedParams)
            res.sendStatus(401)
          } else if (err) {
            helpers.send_failure(res, helpers.error('internal error in transmit'), 'app_handler', exports.version, 'messageActions')
          } else {
            helpers.send_success(res, { success: true })
          }
        })
      }
      break
    case 'verify':
      // verify by pinging the sender server of the nonce and getting the info
      // fetch record nonce - have a max time...
      // check other parameters?
      // responde with {record: xxxx}
      console.log('share verify')
      if (!req.body.nonce) {
        felog('nonce required to verify messages ', req.body)
        res.sendStatus(401)
      } else {
        req.freezrSentMessages.query({ nonce: req.body.nonce }, {}, function (err, results) {
          if (err) {
            felog('error getting nonce in message ', req.body)
            helpers.send_failure(res, helpers.error('internal error'), 'app_handler', exports.version, 'messageActions')
          } else if (!results || results.length === 0) {
            felog('no results from nonce in message ', req.body)
            res.sendStatus(401)
          } else {
            req.freezrSentMessages.update(results[0]._id, { status: 'verified', nonce: null }, { replaceAllFields: false }, function (err) {
              if (err) felog('error updating sent messages')
              helpers.send_success(res, { record: results[0].record, success: true })
            })
          }
        })
      }
      break
    case 'get':
      {
        console.log('share get')
        // get own messages
        const theQuery = {
          app_id: req.freezrTokenInfo.app_name
        }
        if (req.query._modified_after) {
          theQuery._date_modified = { $gt: req.query._modified_after }
        } else if (req.query._modified_before) {
          theQuery._date_modified = { $lt: req.query._modified_before }
        }
        req.freezrGotMessages.query(theQuery, {}, function (err, results) {
          if (err) {
            helpers.send_failure(res, helpers.error(null, 'internal error getting messages'), 'app_handler', exports.version, 'messageActions')
          } else {
            helpers.send_success(res, results)
          }
        })
      }
      break
    default:
      helpers.send_failure(res, helpers.error('invalid query'), 'app_handler', exports.version, 'messageActions')
  }
}
const createAndTransmitMessage = function (sentMessagesDb, permittedRecord, checkedParams, callback) {
  // receipientParams must have been checked for requestor and receipient being in contacts and persmissions having been granted
  /*
  {
    type: ‘share-records’, // based on permission type
    recipient_host : ‘https://data-vault.eu’,
    recipient_id : ‘christoph’,
    message_permission : ‘link_share’,
    contact_permission : ‘friends’,
    table_id : ‘com.salmanff.vulog.marks’,
    record_id : ‘randomRecordId123’,
    app_id :
    sender_id :
    sender_host :
  }
  */
  // create nonce and record the message - status:'not sent'
  checkedParams.nonce = helpers.randomText(50)
  const messageToKeep = { ...checkedParams }
  messageToKeep.record = permittedRecord
  messageToKeep.status = 'initiate'
  fdlog('creating a new message to send ', { checkedParams, messageToKeep })
  sentMessagesDb.create(null, messageToKeep, {}, function (err, ret) {
    if (err) {
      callback(err)
    } else {
      const isLocalhost = helpers.startsWith(checkedParams.recipient_host, 'http://localhost')
      const https = isLocalhost ? require('http') : require('https')

      const sendOptions = {
        hostname: isLocalhost ? 'localhost' : checkedParams.recipient_host.slice(8),
        path: '/ceps/message/transmit',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': JSON.stringify(checkedParams).length
        }
      }
      if (isLocalhost) sendOptions.port = Number(checkedParams.recipient_host.slice(17))
      const verifyReq = https.request(sendOptions, (verifyRes) => {
        verifyRes.on('data', (returns) => {
          if (returns) returns = returns.toString()
          callback(null, returns)
        })
      })
      verifyReq.on('error', (error) => {
        felog('error in transmit ', error)
        callback(helpers.error('message transmission error'))
      })
      verifyReq.write(JSON.stringify(checkedParams))
      verifyReq.end()
    }
  })
}
const sameHostMessageExchange = function (req, permittedRecord, checkedParams, callback) {
  // receipientParams must have been checked for requestor and receipient being in contacts and persmissions having been granted
  /*
  {
    type: ‘share-records’, // based on permission type
    recipient_host : ‘https://data-vault.eu’,
    recipient_id : ‘christoph’,
    message_permission : ‘link_share’,
    contact_permission : ‘friends’,
    table_id : ‘com.salmanff.vulog.marks’,
    record_id : ‘randomRecordId123’,
    app_id :
    sender_id :
    sender_host :
  }
  */

  const messageToKeep = { ...checkedParams }
  messageToKeep.record = permittedRecord
  messageToKeep.status = 'verified'
  fdlog('creating a new message INTERNAL MSG  ', { messageToKeep })
  async.waterfall([
    // check receipient to make sure has sender as contact
    function (cb) {
      req.freezrOtherPersonContacts.query({ username: checkedParams.sender_id, serverurl: checkedParams.sender_host }, {}, cb)
    },
    function (results, cb) {
      if (!results || results.length === 0) {
        cb(helpers.error(null, 'contact  missing - ask the receipient to add you as a contact'))
      } else {
        if (results.length > 1) felog('two contacts found where one was expected ' + JSON.stringify(results))
        cb(null)
      }
    },
    // add the sender's message queue
    function (cb) {
      req.freezrSentMessages.create(null, messageToKeep, {}, cb)
    },
    // add the recipient's message queue
    function (ret, cb) {
      req.freezrOtherPersonGotMsgs.create(null, messageToKeep, {}, cb)
    }

  ], function (err) {
    if (err) console.warn(err)
    callback(err)
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

// permission access operations
exports.shareRecords = function (req, res) {
  // After app-permission has been given, this sets or updates permission to access a record
  // app.post('/ceps/perms/share_records', userAPIRights, addUserPermsAndRequesteeDB, addPublicRecordsDB, appHandler.shareRecords)
  // app.post('/feps/perms/share_records', userAPIRights, addUserPermsAndRequesteeDB, addPublicRecordsDB, appHandler.shareRecords)
  /*
    NO requestorApp - this is automatically added on server side

    Options - CEPS
    name: permissionName - OBLOGATORY
    'table_id': app_name (defaults to app self) (Should be obligatory?)
    'action': 'grant' or 'deny' // default is grant
    grantee or list of 'grantees': people being granted access

    NON CEPS options
    publicid: sets a publid id instead of the automated accessible_id (nb old was pid)
    pubDate: sets the publish date
    unlisted - for public items that dont need to be lsited separately in the public_records database
    idOrQuery being query is NON-CEPS - ie query_criteria or object_id_list
  */
  fdlog('shareRecords, req.body: ', req.body)

  const queryFromBody = function (rec) {
    if (!rec) return null
    if (typeof rec === 'string') return { _id: rec }
    if (Array.isArray(rec)) return { $or: rec.map(arec => { return ({ _id: (typeof arec === 'string') ? arec : '' }) }) }
    if (typeof rec === 'object') return rec
    return null
  }
  const recordQuery = queryFromBody(req.body.record_id || req.body.object_id_list || req.body.query_criteria)
  var datePublished = req.body.grant ? (req.body.pubDate ? req.body.pubDate : new Date().getTime()) : null

  const userId = req.freezrTokenInfo.requestor_id // requestor and requestee are the same
  const requestorApp = req.freezrTokenInfo.app_name
  const proposedGrantees = req.body.grantees

  let grantedPermission = null

  var allowedGrantees = []
  var granteesNotAllowed = []
  var recordsToChange = []

  fdlog('shareRecords from ' + userId + 'for requestor app ' + requestorApp + ' query:' + JSON.stringify(recordQuery) + ' action' + JSON.stringify(req.body.grant) + ' perm: ' + req.body.name)

  function appErr (message) { return helpers.app_data_error(exports.version, 'shareRecords', req.freezrTokenInfo.appName + '- ' + message) }

  async.waterfall([
    // 0 make basic checks and get the perm
    function (cb) {
      if (!recordQuery) {
        cb(appErr('Missing query to set access'))
      } else if (typeof req.body.record_id !== 'string' && req.body.publicid && req.body.grantees.includes('_public')) {
        cb(appErr('input error - cannot assign a public id to more than one entity - please include ine record if under record_id'))
      } else if (!req.body.name) {
        cb(appErr('error - need permission name to set access'))
      } else if (!req.body.table_id) {
        cb(appErr('error - need requested table_id to work on permission'))
      } else if (!req.body.grantees || req.body.grantees.length < 1) {
        cb(appErr('error - need people or gorups to grant permissions to.'))
      } else if (!requestorApp) {
        cb(appErr('internal error getting requestor app'))
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
        cb(helpers.error('TableMissing', 'The table being granted permission to does not correspond to the permission '))
      } else {
        if (results.length > 1) felog('two permissions found where one was expected ' + JSON.stringify(results))
        grantedPermission = results[0]
        // fdlog({ grantedPermission })
        cb(null)
      }
    },

    // make sure grantees are in ACL - assign them to allowedGrantees
    function (cb) {
      allowedGrantees = []
      async.forEach(proposedGrantees, function (grantee, cb2) {
        grantee = grantee.replace(/\./g, '_')
        if (grantee === '_public') {
          // todo-later conside grantedPermission.allowPublic to explicitly allow sharing with public
          allowedGrantees.push(grantee)
          cb2(null)
        } else if (helpers.startsWith(grantee, 'group:')) {
          const name = grantee.substring(('group:'.length))
          req.freezrCepsGroups.query({ name }, null, function (err, results) {
            if (results && results.length > 0) {
              allowedGrantees.push(grantee)
            } else {
              granteesNotAllowed.push(grantee)
            }
            cb2(err)
          })
        } else if (grantee.indexOf('@') > 0) {
          // const granteeParts = grantee.split('@')
          fdlog('shareRecords - Considering grantee', grantee)
          req.freezrCepsContacts.query({ searchname: grantee }, null, function (err, results) {
          // req.freezrCepsContacts.query({ username: granteeParts[0], serverurl: granteeParts[1] }, null, function (err, results) {
            if (results && results.length > 0) {
              allowedGrantees.push(grantee)
            } else {
              granteesNotAllowed.push(grantee)
            }
            cb2(err)
          })
        } else { // unkown type
          granteesNotAllowed.push(grantee)
        }
      }, function (err) {
        if (allowedGrantees.length > 0) {
          cb(err)
        } else {
          cb(new Error('No grantees are in your contacts'))
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
          let publicid
          const fullPermName = (requestorApp + '/' + req.body.name).replace(/\./g, '_')
          if (req.body.grant) {
            allowedGrantees.forEach((grantee) => {
              grantee = grantee.replace(/\./g, '_')
              if (!accessible[grantee]) accessible[grantee] = {}
              accessible[grantee].granted = true
              if (!accessible[grantee][fullPermName]) accessible[grantee][fullPermName] = { granted: true }
              if (grantee === '_public') {
                publicid = (req.body.public_id || (userId + '/' + req.body.table_id + '/' + rec._id)).replace(/\./g, '_')
                accessible[grantee][fullPermName].public_id = publicid
                accessible[grantee][fullPermName]._date_published = req.body._date_published
              }
            })
          } else { // revoke
            req.body.grantees.forEach((grantee) => {
              grantee = grantee.replace(/\./g, '_')
              // future - could keep all public id's and then use those to delete them later
              if (accessible[grantee] && accessible[grantee][fullPermName]) {
                publicid = accessible[grantee][fullPermName].public_id
                delete accessible[grantee][fullPermName]
              }
              let isEmpty = true
              for (const perm in accessible[grantee]) if (perm !== 'granted' && perm !== 'messaged') isEmpty = false
              if (isEmpty) {
                if (accessible[grantee] && accessible[grantee].messaged) {
                  accessible[grantee].granted = false
                } else if (accessible[grantee]) {
                  delete accessible[grantee]
                }
              }
            })
          }
          // fdlog('updating freezrRequesteeDB ',rec._id,'with',{accessible})
          if (allowedGrantees.includes('_public')) {
            // console.log('todo? need to check uniqueness of id first (if granted)- and of not unique give error - and if removing grant, then remove public record')
            req.freezrRequesteeDB.update(rec._id, { _accessible: accessible }, { newSystemParams: true }, function (err, results) {
              cb2(err)
            })
          } else {
            req.freezrRequesteeDB.update(rec._id, { _accessible: accessible }, { newSystemParams: true }, function (err, results) {
              cb2(err)
            })
          }
        }, cb)
      }
    },

    // add the grantees to the permission record
    function (cb) {
      if (req.body.grant) {
        let granteeList = grantedPermission.grantees || []
        allowedGrantees.forEach((grantee) => {
          grantee = grantee.replace(/\./g, '_')
          granteeList = helpers.addToListAsUnique(granteeList, grantee)
        })
        req.freezrUserPermsDB.update(grantedPermission._id, { grantees: granteeList }, { replaceAllFields: false }, function (err, results) {
          cb(err)
        })
        // note that the above live is cumulative.. it could be cleaned if it bloats
      } else {
        // console.log - todo in future, create a more complex algorithm to check if all records shared with grantee have been removed and then remove the grantees
        // cirrently list contains all names of people with whome a record hasd been shared in the past, even if revoked later
        cb(null)
      }
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
                helpers.state_error('Internal error ungranting a non-existent public record - ignore')
                cb(null)
              }
            } else if (results.length > 1) {
              helpers.state_error('app_handler', exports.version, 'shareRecords', 'multiple_permissions', new Error('Retrieved moRe than one permission where there should only be one ' + JSON.stringify(results)), null)
              // todo delete other ones?
            } else { // update existing perm
              if (req.body.grant) {
                req.freezrPublicRecordsDB.update(publicid, accessiblesObject, {}, cb)
              } else {
                req.freezrPublicRecordsDB.delete_record(publicid, {}, cb)
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
      felog(err, results)
      helpers.send_failure(res, err, 'app_handler', exports.version, 'shareRecords')
    } else if (req.body.publicid) { // sending back record_id
      helpers.send_success(res, { record_id: req.body.record_id, _publicid: (req.body.grant ? results._id : null), grant: req.body.grant, recordsChanged: (recordsToChange.length) })
    } else { // sending back record_id
      helpers.send_success(res, { success: true, recordsChanged: (recordsToChange.length) })
    }
  })
}

const checkWritePermission = function (req, forcePermName) {
  // console.log todo note using groups, we should also pass on all the groups user is part of and check them
  if (req.freezrAttributes.own_record && helpers.startsWith(req.params.app_table, req.freezrAttributes.requestor_app)) return [true, []]
  // to do - review above - 2nd expression redundant?
  if (req.freezrAttributes.owner_user_id === req.freezrAttributes.requestor_user_id && ['dev.ceps.contacts', 'dev.ceps.groups'].indexOf(req.params.app_table) > -1 && req.freezrAttributes.requestor_app === 'info.freezr.account') return [true, []]

  let granted = false
  var relevantAndGrantedPerms = []
  req.freezrAttributes.grantedPerms.forEach(perm => {
    if (perm.type === 'write_all' &&
        (perm.grantees.includes(req.freezrAttributes.requestor_user_id) ||
         perm.grantees.includes('_public'))
        // console.log: todo: || includes valid group names [2021 - groups]
    ) {
      if (!forcePermName || perm.name === forcePermName) {
        granted = true
        relevantAndGrantedPerms.push(perm)
      }
    }
  })
  return [granted, relevantAndGrantedPerms]
}
const checkReadPermission = function (req, forcePermName) {
  if (req.freezrAttributes.own_record) return [true, true, []]
  if (req.freezrAttributes.owner_user_id === req.freezrAttributes.requestor_user_id && ['dev.ceps.contacts', 'dev.ceps.groups'].indexOf(req.freezrRequesteeDB.oac.app_table) > -1 && req.freezrAttributes.requestor_app === 'info.freezr.account') return [true, true, [{ type: 'db_query' }]]
  // console.log - todo - all system manifests and permissions shoul dbe separated out and created in config files and populated upom initiation

  let granted = false
  let readAll = false
  var relevantAndGrantedPerms = []
  req.freezrAttributes.grantedPerms.forEach(perm => {
    if (['write_all', 'read_all', 'share_records'].includes(perm.type) &&
      // above is reduncant as only these threee types ar allowed, but future types may differ
      (req.freezrAttributes.requestor_user_id === req.freezrAttributes.owner_user_id ||
       perm.grantees.includes(req.freezrAttributes.requestor_user_id) ||
       perm.grantees.includes('_public')) // console.log: todo: || includes valid group names [2021 - groups]
    ) {
      if (!forcePermName || perm.name === forcePermName) {
        granted = true
        relevantAndGrantedPerms.push(perm)
      }
    }
    readAll = readAll || ['write_all', 'read_all'].includes(perm.type)
  })
  return [granted, readAll, relevantAndGrantedPerms]
}

// developer utilities
exports.getManifest = function (req, res) {
  // app.get('/v1/developer/manifest/:app_name'
  // getAllAppTableNames
  felog('NOT TESTED - NOT WROKING - REVIEW')
  function endCB (err, manifest = null, appTables = []) {
    if (err) felog('got err in getting manifest ', err)
    if (manifest) {
      helpers.send_success(res, { manifest: req.freezrRequestorManifest, app_tables: appTables })
    } else {
      helpers.send_failure(res, err, 'app_handler', exports.version, 'getManifest')
    }
  }

  if (!req.freezrRequestorManifest) {
    endCB(new Error('no manifest found'))
  } else {
    if (req.params.app_name === 'infor.freezr.admin') console.log('todo - neeed to separate our manifest of fradmin')
    req.freezrUserDS.getorInitDb({ owner: req.session.logged_in_user_id, app_table: req.params.app_name }, null, function (err, topdb) {
      if (err) {
        endCB(err, req.freezrRequestorManifest)
      } else {
        topdb.getAllAppTableNames(req.params.app_name, function (err, appTables) {
          endCB(err, req.freezrRequestorManifest, appTables)
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
