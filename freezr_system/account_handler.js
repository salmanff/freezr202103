// freezr.info - nodejs system files - account_handler

/* global User, Flags */

exports.version = '0.0.200'

const helpers = require('./helpers.js')
const bcrypt = require('bcryptjs')
const async = require('async')
const fs = require('fs')
const json = require('comment-json')
const fileHandler = require('./file_handler.js')
require('./flags_obj.js')

exports.generate_login_page = function (req, res) {
  // app.get('/login', publicUserPage, accountHandler.generate_login_page)
  // app.get('/account/login', publicUserPage, accountHandler.generate_login_page)
  fdlog('login_page ' + JSON.stringify(req.url))
  if (req.session && req.session.logged_in_user_id && req.url === '/account/login') { // last term relevant only if freezr preferences file has been deleted
    felog('redirect to home - already logged in')
    res.redirect('/account/home')
  } else {
    // fdlog todo - need to sanitize text
    var options = {
      page_title: (req.params.app_name ? 'Freezr App Login for ' + req.params.app_name : ' Login (Freezr)'),
      css_files: './public/info.freezr.public/public/freezr_style.css',
      initial_query: null,
      server_name: req.protocol + '://' + req.get('host'),
      freezr_server_version: req.freezr_server_version,
      app_name: (req.params.app_name ? req.params.app_name : 'info.freezr.account'),
      other_variables: 'var login_for_app_name = ' + (req.params.app_name ? ("'" + req.params.app_name + "';") : 'null') + ';' +
        ' var loginAction = ' + (req.params.loginaction ? ("'" + req.params.loginaction + "';") : 'null') + ';' +
        ' var freezrServerStatus = ' + JSON.stringify(req.freezrStatus) + ';' +
        ' freezrAllowSelfReg = ' + req.freezrAllowSelfReg + ';'
    }

    if (!req.session) req.session = {}
    if (!req.session.device_code) {
      req.session.device_code = helpers.randomText(20)
      // todo use randomBytes(10).toString(‘base64')
      // todo - Record device code below async-ly and keep track of all attempts to access
    }
    options.app_name = 'info.freezr.public'
    options.page_url = 'public/account_' + ((req.params.app_name && req.params.app_name !== 'info.freezr.public') ? 'app' : '') + 'login.html'
    options.script_files = ['./public/info.freezr.public/public/account_login.js']
    options.user_id = req.session.logged_in_user_id

    fileHandler.load_data_html_and_page(req, res, options)
  }
}
exports.generateSystemDataPage = function (req, res) {
  // app.get('/account/appdata/:target_app/:action', accountLoggedInUserPage, addUserAppsAndPermDBs, accountHandler.generateSystemDataPage)

  req.params.page = 'appdata_' + req.params.action // todo sanitize text
  req.params.other_variables = "const app_name ='" + req.params.target_app + "'"
  exports.generateAccountPage(req, res)
}
exports.generateAccountPage = function (req, res) {
  // app.get('/account/:page', accountLoggedInUserPage, addUserAppsAndPermDBs, accountHandler.generateAccountPage)
  // app.get('/account/:page/:target_app', accountLoggedInUserPage, addUserAppsAndPermDBs, accountHandler.generateAccountPage)
  // assumes user's logged in status has been validated and req.AppToken

  fdlog('NEWgenerateAccountPage accountPage: ' + req.url + 'target_app: ' + req.params.target_app)
  if (!req.params.page) {
    req.params.page = 'home'
  } else {
    req.params.page = req.params.page.toLowerCase()
  }

  if (accountPageConfig[req.params.page]) {
    var options = accountPageConfig[req.params.page]
    options.app_name = 'info.freezr.account'
    options.user_id = req.session.logged_in_user_id
    options.user_is_admin = req.session.logged_in_as_admin
    options.server_name = req.protocol + '://' + req.get('host')
    options.other_variables = req.params.other_variables // only from generateSystemDataPage

    // onsole.log(options)
    if (!req.freezrTokenInfo || !req.freezrTokenInfo.app_token || !req.session.logged_in_user_id) {
      helpers.send_failure(res, helpers.error('invalid credentials'), 'account_handler', exports.version, 'login')
    } else if (!options.initial_query_func) {
      res.cookie('app_token_' + req.session.logged_in_user_id, req.freezrTokenInfo.app_token, { path: '/account' })
      fileHandler.load_data_html_and_page(req, res, options)
    } else { // initial_query_func
      res.cookie('app_token_' + req.session.logged_in_user_id, req.freezrTokenInfo.app_token, { path: '/account' })
      req.params.internal_query_token = req.freezrTokenInfo.app_token // internal query request

      if (req.params.page === 'perms' && req.query.requestor_app) req.params.target_app = req.query.requestor_app

      req.freezrInternalCallFwd = function (err, results) {
        if (err) {
          res.redirect('/admin/public/starterror')
        } else {
          options.queryresults = results
          fileHandler.load_data_html_and_page(req, res, options)
        }
      }
      options.initial_query_func(req, res)
    }
  } else {
    // onsole.log("SNBH - accountPageConfig - Redirecting from generateAccountPage")
    res.redirect('/account/home')
  }
}

exports.ping = function (req, res) {
  // app.get('/ceps/ping', addVersionNumber, accountHandler.ping)
  // app.get('/feps/ping', addVersionNumber, accountHandler.ping)

  // todo - could also make this token based... so check token to see if logged_in to app and what capabilities the ceps server accepts

  fdlog('ping..' + JSON.stringify(req.query))
  if (!req.session.logged_in_user_id) {
    helpers.send_success(res, { logged_in: false, server_type: 'info.freezr', server_version: req.freezr_server_version })
  } else {
    helpers.send_success(res, { logged_in: true, logged_in_as_admin: req.session.logged_in_as_admin, user_id: req.session.logged_in_user_id, server_type: 'info.freezr', server_version: req.freezr_server_version })
  }
}

// PASSWORD / USER MANAGEMENT
const EXPIRY_DEFAULT = 30 * 24 * 60 * 60 * 1000 // 30 days
exports.app_password_generate_one_time_pass = function (req, res) {
  // app.get('/v1/account/apppassword/generate', accountLoggedInAPI, addAppTokenDB, accountHandler.app_password_generate_one_time_pass)

  const userId = req.session.logged_in_user_id
  const appName = (req.query && req.query.app_name) ? req.query.app_name : null
  const expiry = (req.query && req.query.expiry) ? parseInt(req.query.expiry) : (new Date().getTime() + EXPIRY_DEFAULT)
  const oneDevice = !(req.query && req.query.one_device && req.query.one_device === 'false')
  fdlog('app_password_generate_one_time_pass  ' + JSON.stringify(req.query) + ' user: ' + userId + 'app:' + appName)

  if (!userId) {
    const err = helpers.auth_failure('account_handler.js', exports.version, 'app_password_generate_one_time_pass', 'Missing user id')
    helpers.send_failure(res, err, 'account_handler', exports.version, 'app_password_generate_one_time_pass')
  } else if (!appName) {
    const err = helpers.auth_failure('account_handler.js', exports.version, 'app_password_generate_one_time_pass', 'Missing app name')
    helpers.send_failure(res, err, 'account_handler', exports.version, 'app_password_generate_one_time_pass')
  } else {
    const write = {
      logged_in: false,
      source_device: req.session.device_code,
      user_id: userId,
      app_name: appName,
      app_password: helpers.generateOneTimeAppPassword(userId, appName, req.session.device_code),
      app_token: helpers.generateAppToken(userId, appName, req.session.device_code), // create token instead
      expiry: expiry,
      one_device: oneDevice,
      user_device: null,
      date_used: null // to be replaced by date
    }
    req.freezrAppTokenDB.create(null, write, null, (err, results) => {
      if (err) {
        helpers.send_failure(res, err, 'account_handler', exports.version, 'app_password_generate_one_time_pass')
      } else {
        helpers.send_success(res, { app_password: write.app_password, app_name: appName })
      }
    })
  }
}
exports.app_password_update_params = function (req, res) {
  // app.get('/v1/account/apppassword/updateparams', accountLoggedInAPI, addAppTokenDB, accountHandler.app_password_update_params)

  fdlog('app_password_update_params  ' + JSON.stringify(req.query))
  const userId = req.session.logged_in_user_id
  const appName = (req.query && req.query.app_name) ? req.query.app_name : null
  const expiry = (req.query && req.query.expiry) ? parseInt(req.query.expiry) : null
  const oneDevice = !(req.query && req.query.one_device && req.query.one_device === 'false')
  const params = { expiry, oneDevice }
  const password = (req.query && req.query.password) ? req.query.password : null

  // todo later - should also check if there are open ones and clean up expired ones

  if (!userId) {
    const err = helpers.auth_failure('account_handler.js', exports.version, 'app_password_update_params', 'Missing user id')
    helpers.send_failure(res, err, 'account_handler', exports.version, 'app_password_update_params')
  } else if (!appName) {
    const err = helpers.auth_failure('account_handler.js', exports.version, 'app_password_update_params', 'Missing app name')
    helpers.send_failure(res, err, 'account_handler', exports.version, 'app_password_update_params')
  } else if (!password) {
    const err = helpers.auth_failure('account_handler.js', exports.version, 'app_password_update_params', 'Missing app password')
    helpers.send_failure(res, err, 'account_handler', exports.version, 'app_password_update_params')
  } else if (!req.query.expiry && !req.query.one_device && !(req.query.one_device === false)) {
    const err = helpers.auth_failure('account_handler.js', exports.version, 'app_password_update_params', 'failure on device expiry?')
    helpers.send_failure(res, err, 'account_handler', exports.version, 'app_password_update_params')
  } else {
    req.freezrAppTokenDB.query({ app_password: password }, null,
      (err, results) => {
        if (err) {
          helpers.send_failure(res, err, 'account_handler', exports.version, 'app_password_update_params')
        } else if (!results || results.length === 0) {
          err = helpers.error('no_results', 'expected record but found none (app_password_update_params)')
          helpers.send_failure(res, err, 'account_handler', exports.version, 'app_password_update_params')
        } else {
          const record = results[0] // todo - theoretically there could be multiple and the right one need to be found
          if (record.user_id !== userId || record.app_name !== appName) {
            err = helpers.error('no_results', 'app_name or user_id do not match expected value(app_password_update_params)')
            helpers.send_failure(res, err, 'account_handler', exports.version, 'app_password_update_params')
          } else if (helpers.expiry_date_passed(record.expiry)) {
            err = helpers.error('password_expired', 'One time password has expired.')
            helpers.send_failure(res, err, 'account_handler', exports.version, 'app_password_update_params')
          } else if (record.date_used) {
            err = helpers.error('password_used', 'Cannot change parameters after password has been used')
            helpers.send_failure(res, err, 'account_handler', exports.version, 'app_password_update_params')
          } else {
            var changes = {}
            if (expiry) changes.expiry = expiry
            if (oneDevice || oneDevice === false) changes.one_device = params.oneDevice
            req.freezrAppTokenDB.update((record._id + ''), changes, { replaceAllFields: false }, function (err, results) {
              if (err) {
                helpers.send_failure(res, err, 'account_handler', exports.version, 'app_password_update_params')
              } else {
                helpers.send_success(res, { success: true })
              }
            })
          }
        }
      })
  }
}
exports.changePassword = function (req, res) {
  // app.put('/v1/account/changePassword.json', accountLoggedInAPI, addAllUsersDb, accountHandler.changePassword)
  // req.freezrUserDS
  // onsole.log("Changing password  "+JSON.stringify(req.body));

  var userId = req.body.user_id
  let u = null
  async.waterfall([
    // 1. basic checks
    function (cb) {
      if (!userId) {
        cb(helpers.auth_failure('account_handler.js', exports.version, 'changePassword', 'Missing user id'))
      } else if (!req.session.logged_in_user_id || userId !== req.session.logged_in_user_id) {
        cb(helpers.auth_failure('account_handler.js', exports.version, 'changePassword', 'user not logged in'))
      } else if (!req.body.oldPassword) {
        cb(helpers.auth_failure('account_handler.js', exports.version, 'changePassword', 'Missing old password'))
      } else if (!req.body.newPassword) {
        cb(helpers.auth_failure('account_handler.js', exports.version, 'changePassword', 'Missing new password'))
      } else {
        cb(null)
      }
    },

    // 2. get user
    function (cb) {
      req.allUsersDb.query({ user_id: userId }, null, cb)
    },

    // 3. check the password
    function (results, cb) {
      require('./user_obj.js')
      u = new User(results[0])
      if (!results || results.length === 0) {
        cb(helpers.auth_failure('account_handler.js', exports.version, 'changePassword', 'funky error'))
      } else if (results.length > 1) {
        cb(helpers.auth_failure('account_handler.js', exports.version, 'changePassword', 'getting too many users'))
      } else if (u.check_passwordSync(req.body.oldPassword)) {
        bcrypt.hash(req.body.newPassword, 10, cb)
      } else {
        fdlog('need to limit number of wring passwords - set a file in the datastore ;) ')
        cb(helpers.auth_failure('account_handler.js', exports.version, 'changePassword', 'Wrong password'))
      }
    },

    // 3. change pw for the user.
    function (hash, cb) {
      req.allUsersDb.update(
        { user_id: userId },
        { password: hash },
        { replaceAllFields: false },
        cb)
    }

  ],
  function (err, returns) {
    if (err) {
      helpers.send_failure(res, err, 'account_handler', exports.version, 'changePassword')
    } else if (!returns || !returns.nModified || returns.nModified === 0) {
      helpers.send_failure(res, helpers.error('change error - was not able to change any passwords: ' + JSON.stringify(returns)), 'account_handler', exports.version, 'changePassword')
    } else {
      if (returns.nModified !== 1) felog('changePassword', 'error in changing user records - to investigate why more than 1 modified ', returns)
      helpers.send_success(res, { user: u.response_obj() })
    }
  })
}
exports.list_all_user_apps = function (req, res) {
  // app.get('/v1/account/app_list.json', accountLoggedInAPI, accountHandler.list_all_user_apps)
  // accountLoggedInAPI ->

  const userId = req.session.logged_in_user_id
  const userDS = req.freezrUserDS
  const oac = {
    owner: userId,
    app_name: 'info.freezr.account',
    collection_name: 'app_list'
  }

  var removedApps = []
  var userApps = []

  async.waterfall([
    // 1. get db
    function (cb) {
      userDS.getorInitDb(oac, null, cb)
    },

    // 2. get all user apps
    function (appList, cb) {
      appList.query({}, null, cb)
    },

    function (results, cb) {
      if (results && results.length > 0) {
        results = results.map(app => { return { app_name: app.app_name, removed: app.removed, _date_modified: app._date_modified, _id: app._id, app_display_name: app.app_display_name } })
        for (var i = 0; i < results.length; i++) {
          if (results[i].app_name && results[i].app_name === results[i].app_display_name) { results[i].app_display_name = results[i].app_display_name.replace(/\./g, '. ') }
          results[i].logo = '/app_files/' + results[i].app_name + '/static/logo.png'
          if (results[i].removed) {
            removedApps.push(results[i])
          } else {
            userApps.push(results[i])
          }
        }
      }
      cb(null)
    }
  ],
  function (err) {
    if (err) {
      felog('list_all_user_apps', 'ERROR in list_all_user_apps ', err)
      if (req.freezrInternalCallFwd) {
        req.freezrInternalCallFwd(err, null)
      } else {
        helpers.send_failure(res, err, 'account_handler', exports.version, 'list_all_user_apps')
      }
    } else {
      // onsole.log(" results",{removedApps:removedApps, user_apps:userApps})
      if (req.freezrInternalCallFwd) {
        req.freezrInternalCallFwd(null, { removed_apps: removedApps, user_apps: userApps })
      } else {
        helpers.send_success(res, { removed_apps: removedApps, user_apps: userApps })
      }
    }
  })
}

// App Installation and Updating
exports.get_file_from_url_to_install_app = function (req, res) {
  // app.post('/v1/account/app_install_from_url.json', accountLoggedInUserPage, addUserAppsAndPermDBs, accountHandler.get_file_from_url_to_install_app)
  // onsole.log("get_file_from_url_to_install_app",req.body)

  // todo 2020-07 this needs to be redone so that it saves to a temp file and then

  const fs = require('fs')
  const request = require('request')

  const download = (url, dest, cb) => {
    fdlog('download ', { url, dest })
    // from stackoverflow.com/questions/11944932/how-to-download-a-file-with-node-js-without-using-third-party-libraries
    const file = fs.createWriteStream(dest)
    const sendReq = request.get(url)

    // verify response code
    sendReq.on('response', (response) => {
      if (response.statusCode !== 200) {
        return cb(new Error('Bad Connection - Response status was ' + response.statusCode))
      }
      sendReq.pipe(file)
    })

    // close() is async, call cb after close completes
    file.on('finish', () => file.close(cb))

    // check for request errors
    sendReq.on('error', (err) => {
      return cb(err)
    })

    file.on('error', (err) => {
      if (err) felog('download', 'file error', err)
      cb(err)
    })
  }

  const tempAppName = req.body.app_name
  const tempFolderPath = helpers.FREEZR_USER_FILES_DIR + '/' + req.session.logged_in_user_id + '/tempapps/' + tempAppName

  fileHandler.mkdirp(tempFolderPath, function (err) {
    if (err) {
      helpers.send_success(res, { success: false, err: err, flags: null, text: '' })
    } else {
      const zipFilePath = tempFolderPath + '/' + tempAppName + '.zip'
      download(req.body.app_url, zipFilePath, function (err) {
        if (!err && req.body.app_name) {
          req.app_name = req.body.app_name
          req.file = {}
          req.file.originalname = req.body.app_name + '.zip'

          fs.readFile(fileHandler.fullLocalPathTo(zipFilePath), null, function (err, content) {
            if (err) {
              helpers.send_success(res, { success: false, err: err, flags: null, text: '' })
            } else {
              req.file.buffer = content
              req.installsource = 'get_file_from_url_to_install_app'
              exports.install_app(req, res)
            }
          })

          // req.file.buffer = zipFilePath
          // req.installsource = 'get_file_from_url_to_install_app'
          // exports.install_app(req, res)
          // fdlog? todonow  delete tempfile... determine name ... put file under user / files
        } else { // err or missing app name
          var flags = new Flags({})
          flags.meta.app_name = req.body.app_name
          if (!err) err = { code: 'Missing App name', message: 'app name is required to create an app.' }
          if (!err.code) err.code = 'err_unknown'
          if (!err.message) err.message = 'Could not connect to the requested URL'
          flags.add('errors', err.code, { function: 'install_app', text: err.message })

          helpers.send_success(res, { success: false, err: err, flags: null, text: '' })
        }
      })
    }
  })
}
exports.install_blank_app = function (req, res) {
  // app.post('/v1/account/app_install_blank', accountLoggedInUserPage, addUserAppsAndPermDBs, accountHandler.install_blank_app)

  // from access_handler and perm_handler
  fdlog('install_blank_app ')
  const appName = req.body.app_name
  const appConfig = {
    meta: {
      app_name: appName,
      app_display_name: appName,
      app_version: 0
    }
  }
  var flags = new Flags({ app_name: appName, didwhat: 'installed' })

  async.waterfall([
  // 1. make sure data and file names exist and appName is valid
    function (cb) {
      if (!req.session.logged_in_user_id) {
        cb(helpers.missing_data('user_id'))
      } else if (!appName || appName.length < 1) {
        cb(helpers.invalid_data('app name missing - that is the name of the app zip file name before any spaces.', 'account_handler', exports.version, 'install_blank_app'))
      } else if (helpers.system_apps.indexOf(appName) > -1 || !helpers.valid_app_name(appName)) {
        cb(helpers.invalid_data('app name not allowed: ' + appName, 'account_handler', exports.version, 'install_blank_app'))
      } else {
        req.freezrUserAppListDB.read_by_id(appName, cb)
      }
    },

    // see if entity exists
    function (existingEntity, cb) {
      if (existingEntity) {
        cb(helpers.invalid_data('app already exists ' + appName, 'account_handler', exports.version, 'install_blank_app'))
      } else {
        createOrUpdateUserAppList(req.freezrUserAppListDB, appConfig, null, cb)
      }
    },
    function (info, cb) {
      cb(null)
    }
  ],
  function (err) {
    if (err) {
      if (!err.code) err.code = 'err_unknown'
      flags.add('errors', err.code, { function: 'install_blank_app', text: err.message })
    }
    helpers.send_success(res, { err: err, flags: flags.sentencify() })
  })
}
exports.install_app = function (req, res) {
  // installAppFromZipFile =>    app.put('/v1/account/app_install_from_zipfile.json', accountLoggedInUserPage, addUserAppsAndPermDBs, installAppFromZipFile)
  // onsole.log("install_app file.originalname ",req.file.originalname,"app_name ",req.app_name)

  fdlog('install_app ' + req.file.originalname + (req.installsource || ''))

  // from access_handler and perm_handler
  const userDS = req.freezrUserDS
  let appFS // ds generated from userAppFs

  const tempAppName = tempAppNameFromFileName(req.file.originalname)
  const tempFolderPath = helpers.FREEZR_USER_FILES_DIR + '/' + req.session.logged_in_user_id + '/tempapps/' + tempAppName

  var appConfig = null
  let realAppName
  let realAppPath
  var flags = new Flags({})

  async.waterfall([
  // 1. make sure data and file names exist and tempAppName is correct
    function (cb) {
      if (!req.session.logged_in_user_id) {
        cb(helpers.missing_data('user_id'))
      } else if (!req.file) {
        cb(helpers.missing_data('file', 'account_handler', exports.version, 'install_app'))
      } else if (!req.file.originalname) {
        cb(helpers.missing_data('file name', 'account_handler', exports.version, 'install_app'))
      } else if (req.file.originalname.length < 5 || req.file.originalname.substr(-4) !== '.zip') {
        cb(helpers.invalid_data('file name not zip: ' + req.file.originalname, 'account_handler', exports.version, 'install_app'))
      } else {
        cb(null)
      }
    },

    // REMOVE THE LOCAL temp DIRECTORY and extract zip files to it to read the app config
    function (cb) {
      fileHandler.deleteLocalFolderAndContents(tempFolderPath, cb)
    },
    function (cb) {
      // if (req.installsource === 'get_file_from_url_to_install_app') {
      //  cb(null)
      // } else {
      fileHandler.extractZipToLocalFolder(req.file.buffer, tempFolderPath, tempAppName, cb)
      // }
    },

    // get the config file and the real name and check it
    function (cb) {
      fileHandler.getLocalAppConfig(tempFolderPath, cb)
    },
    function (configFromFile, cb) {
      appConfig = configFromFile
      realAppName = (appConfig && appConfig.meta && appConfig.meta.app_name) ? appConfig.meta.app_name : tempAppName
      flags = new Flags({ app_name: realAppName, didwhat: 'installed' })
      if (realAppName !== tempAppName) flags.add('notes', 'app_name_different')

      if (!realAppName || realAppName.length < 1) {
        fileHandler.deleteLocalFolderAndContents(tempFolderPath, function (err) {
          if (err) felog('install_app', 'error deleting local folder after app name missing ')
          cb(helpers.invalid_data('app name missing - that is the name of the app zip file name before any spaces.', 'account_handler', exports.version, 'install_app'))
        })
      } else if (helpers.system_apps.indexOf(realAppName) > -1 || !helpers.valid_app_name(realAppName)) {
        fileHandler.deleteLocalFolderAndContents(tempFolderPath, function (err) {
          if (err) felog('install_app', 'error deleting local folder 2 after app name not allowed ')
          cb(helpers.invalid_data('app name not allowed: ' + tempAppName, 'account_handler', exports.version, 'install_app'))
        })
      } else {
        cb(null)
      }
    },

    /* Old - not used any more
    // delete the old folder both on local (cache) and the temporary folder
    function (cb) {
       delete temporary file when app has been downloaded
       if (req.installsource === 'get_file_from_url_to_install_app') {
         fs.unlink(req.file.buffer, cb)
       } else {
        cb(null)
     }
    },
    */
    // get appfs to eextract app files
    function (cb) {
      userDS.getorInitAppFS(realAppName, {}, cb)
    },
    // delete previous version of cache (or real folder if local)
    function (userAppFS, cb) {
      appFS = userAppFS
      // todo fdlog - add glitch prefix to folder
      realAppPath = helpers.FREEZR_USER_FILES_DIR + '/' + req.session.logged_in_user_id + '/apps/' + realAppName
      fileHandler.deleteLocalFolderAndContents(realAppPath, cb)
    },
    // extract to local folder
    function (cb) {
      fileHandler.extractZipToLocalFolder(req.file.buffer, realAppPath, tempAppName, cb)
    },
    // extract to actual location (except when it is a local system - ie it already exists)
    function (cb) {
      if (appFS.fsParams.type === 'local') {
        cb(null) // already copied to local above
      } else {
        fileHandler.extractZipAndReplaceToCloudFolder(req.file.buffer, req.file.originalname, appFS, cb)
      }
    },
    function (cb) { // remove the temprary file
      fileHandler.deleteLocalFolderAndContents(tempFolderPath, cb)
    },

    // 5. check app_config (populate app_version and app_display_name and permissons)
    function (cb) {
      if (!appConfig) flags.add('notes', 'appconfig_missing')
      if (!appConfig) appConfig = {}
      if (!appConfig.meta) appConfig.meta = {}
      if (!appConfig.meta.app_name) appConfig.meta.app_name = realAppName
      if (!appConfig.meta.app_display_name) appConfig.meta.app_display_name = realAppName
      if (!appConfig.meta.app_version) appConfig.meta.app_version = 0

      flags = fileHandler.checkAppConfig(appConfig, realAppName, appConfig.meta.app_version, flags)

      updatePermissionRecordsFromAppConfig(req.freezrUserPermsDB, realAppName, appConfig, flags, cb)
    },

    // 6. Update the app list
    function (newflags, cb) {
      flags = newflags || flags

      const customEnv = null // todo to be added later
      createOrUpdateUserAppList(req.freezrUserAppListDB, appConfig, customEnv, cb)
    },

    // 8. If app already exists, flag it as an update
    function (info, cb) {
      if (info.isUpdate) {
        flags.add('notes', 'app_updated_msg')
        flags.meta.didwhat = 'updated'
      } else {
        flags.meta.didwhat = 'uploaded'
      }
      cb(null)
    }
    // todo later (may be) - also check app_config permissions (as per changeNamedPermissions) to warn of any issues
  ],
  function (err, dummy) {
    // todo: if there is an error in a new app_config the previous one gets wied out but the ap still runs (as it was instaled before successfully), so it should be marked with an error.
    // todo: also better to wipe out old files so old files dont linger if they dont exist in new version
    flags.meta.app_name = realAppName
    if (err) {
      if (!err.code) err.code = 'err_unknown'
      flags.add('errors', err.code, { function: 'install_app', text: err.message })
    }
    // onsole.log(flags.sentencify())
    helpers.send_success(res, { err: err, flags: flags.sentencify() })
  })
}
const tempAppNameFromFileName = function (originalname) {
  let name = ''
  const parts = originalname.split('.')
  if (helpers.endsWith(parts[(parts.length - 2)], '-master')) parts[(parts.length - 2)] = parts[(parts.length - 2)].slice(0, -7)
  parts.splice(parts.length - 1, 1)
  name = parts.join('.')
  name = name.split(' ')[0]
  return name
}
exports.appMgmtActions = function (req, res) /* deleteApp updateApp */ {
  //   app.post('/v1/account/appMgmtActions.json', accountLoggedInAPI, addUserAppsAndPermDBs, accountHandler.appMgmtActions)
  // onsole.log("At app mgmt actions "+JSON.stringify(req.body));

  var action = (req.body && req.body.action) ? req.body.action : null
  var appName = (req.body && req.body.app_name) ? req.body.app_name : null

  if (action === 'removeAppFromHomePage') {
    req.freezrUserAppListDB.update(appName, { removed: true }, { replaceAllFields: false }, function (err, result) {
      if (err) {
        felog('appMgmtActions', 'removeAppFromHomePage err for ' + appName, err)
        helpers.send_failure(res, err, 'account_handler', exports.version, '', 'could not mark as removed')
      } else {
        helpers.send_success(res, { success: true })
      }
    })
  } else if (action === 'deleteApp') {
    async.waterfall([
      function (cb) {
        req.freezrUserAppListDB.delete_record(appName, null, cb)
      },
      function (result, cb) {
        req.freezrUserPermsDB.delete_records({ requestor_app: appName }, null, cb)
      },
      function (results, cb) {
        const folderPath = helpers.FREEZR_USER_FILES_DIR + '/' + req.session.logged_in_user_id + '/apps/' + appName
        fileHandler.deleteLocalFolderAndContents(folderPath, cb)
      },
      function (cb) {
        req.freezrUserDS.getorInitAppFS(appName, {}, cb)
      },
      function (appFS, cb) {
        appFS.removeAllAppFiles(null, cb)
      },
      function (cb) {
        fdlog('need to remove tables when remove app too?')
        // 2020 todo - when deleting app, get user to also approve deleting the app_tables
        //  send app_table names to know what to delete
        //  create a new perm flow to get the userds and delete all relevant tables
        //  also then remove all table_id related to the above tables in permissions
        // also need to check if tables are being used  y other apps
        cb(null)
      }
    ], function (err) {
      if (err) {
        helpers.send_internal_err_failure(res, 'account_handler', exports.version, 'appMgmtActions - deleteApp', 'Internal error trying to delete app. ')
      } else {
        // onsole.log("success in deleting app")
        helpers.send_success(res, { success: true })
      }
    })
  } else if (action === 'updateApp') {
    fdlog('going to updateApp ', appName)

    var flags = new Flags({ app_name: appName })
    const realAppName = appName
    const userDS = req.freezrUserDS
    let appConfig = null
    let appFS
    const realAppPath = helpers.FREEZR_USER_FILES_DIR + '/' + req.session.logged_in_user_id + '/apps/' + realAppName

    async.waterfall([
      // updateApp 1. make sure data and file names exist
      function (cb) {
        if (!req.session.logged_in_user_id) {
          cb(helpers.missing_data('user_id'))
        } else if (!helpers.valid_app_name(realAppName)) {
          cb(helpers.invalid_data('app name: ' + realAppName, 'account_handler', exports.version, 'appMgmtActions'))
        } else if (!realAppName || realAppName.length < 1) {
          cb(helpers.invalid_data('app name missing - ', '', exports.version, 'install_app'))
        } else if (helpers.system_apps.indexOf(realAppName) > -1 || !helpers.valid_app_name(realAppName)) {
          cb(helpers.invalid_data('app name not allowed: ' + appName, 'account_handler', exports.version, 'install_app'))
        } else if (!userDS) {
          cb(helpers.missing_data('userDS'))
        } else {
          cb(null)
        }
      },

      // get appFS and delete the local folder (if using cloud storage)
      function (cb) {
        userDS.getorInitAppFS(realAppName, {}, cb)
      },
      function (userAppFS, cb) {
        appFS = userAppFS
        if (appFS.fsParams.type === 'local') {
          cb(null)
        } else {
          fileHandler.deleteLocalFolderAndContents(realAppPath, cb)
        }
      },

      // reset cache and read app config and update perms and app record
      function (cb) {
        appFS.cache.appfiles = {}

        appFS.readAppFile(helpers.APP_CONFIG_FILE_NAME, {}, cb)
      },
      function (readConfig, cb) {
        appConfig = json.parse(readConfig)
        if (!appConfig) flags.add('notes', 'appconfig_missing')
        if (!appConfig) appConfig = {}
        if (!appConfig.meta) appConfig.meta = {}
        if (!appConfig.meta.app_name) appConfig.meta.app_name = realAppName
        if (!appConfig.meta.app_display_name) appConfig.meta.app_display_name = realAppName
        if (!appConfig.meta.app_version) appConfig.meta.app_version = 0

        flags = fileHandler.checkAppConfig(appConfig, realAppName, appConfig.meta.app_version, flags)

        updatePermissionRecordsFromAppConfig(req.freezrUserPermsDB, realAppName, appConfig, flags, cb)
      },

      function (newflags, cb) {
        flags = newflags
        createOrUpdateUserAppList(req.freezrUserAppListDB, appConfig, null, cb)
      }
    ],
    function (err, info) {
      flags.meta.app_name = realAppName
      if (err) {
        flags.add('errors', 'err_unknown', { function: 'appMgmtActions update', text: JSON.stringify(err) })
      }
      if (info.isUpdate) {
        flags.add('notes', 'app_updated_msg')
        flags.meta.didwhat = 'updated'
      } else {
        flags.meta.didwhat = 'uploaded'
      }
      helpers.send_success(res, flags.sentencify())
    })
  } else {
    helpers.send_failure(res, new Error('unknown action'), 'account_handler', exports.version, 'appMgmtActions')
  }
}

// PERMISSIONS
// format: {requestor_app, name, table_id, type, description, 'returnFields', 'searchFields'}
exports.allRequestorAppPermissions = function (req, res) {
  // app.get('/v1/permissions/getall/:app_name', userAPIRights, addUserPermDBs, accountHandler.allRequestorAppPermissions)
  // optional query: groupall
  // groupall and having a call forward (req.freezrInternalCallFwd) groups the items in various categories

  const requestorApp = req.params.target_app || req.params.app_name // target_app for account/perms
  fdlog('allRequestorAppPermissions for requestorApp ' + requestorApp + ' target_app is' + req.params.target_app) // + 'req.freezrTokenInfo', req.freezrTokenInfo)
  if (req.freezrTokenInfo.app_name !== req.params.app_name && req.freezrTokenInfo.app_name !== 'info.freezr.account') {
    felog('allRequestorAppPermissions', 'auth error', req.freezrTokenInfo.app_name, req.params.app_name, ' - tocken info: ', req.freezrTokenInfo)
    helpers.send_failure(res, new Error('auth error - allRequestorAppPermissions'), 'account_handler', exports.version, 'disallowed')
  } else {
    req.freezrUserPermsDB.query({ requestor_app: requestorApp }, {}, function (err, returnPerms) {
      fdlog('allRequestorAppPermissions : req.query: ', { requestorApp, returnPerms })
      if (err) {
        helpers.send_failure(res, err, 'account_handler', exports.version, 'requestorApp')
      } else if ((req.query && req.query.groupall) || req.freezrIntermediateCallFwd || req.freezrInternalCallFwd) {
        var ret = {}
        ret[requestorApp] = groupPermissions(returnPerms, requestorApp)
        ret[requestorApp].app_name = '' // todo get app name and display name [later: why blank?]
        ret[requestorApp].app_display_name = requestorApp

        if (req.freezrIntermediateCallFwd) { /* ie coming from internal request for perm */
          fdlog('have freezrIntermediateCallFwd', { ret })
          req.freezrIntermediateCallFwd(null, ret)
        } else if (req.freezrInternalCallFwd) { /* ie coming from internal request for perm */
          fdlog('have freezrInternalCallFwd', { ret })
          req.freezrInternalCallFwd(null, ret)
        } else {
          // fdlog('sending success - allRequestorAppPermissions - NO freezrIntermediateCallFwd')
          helpers.send_success(res, ret)
        }
      } else {
        // fdlog({ returnPerms })
        helpers.send_success(res, returnPerms)
      }
    })
  }
}
function groupPermissions (returnPermissions, appName) {
  var groupedPermissions = {
    outside_scripts: [],
    thisAppToThisApp: [],
    thisAppToOtherApps: [],
    otherAppsToThisApp: [],
    unknowns: []
  }

  if (!returnPermissions || returnPermissions.length === 0) {
    return groupedPermissions
  } else {
    let aPerm
    for (var i = 0; i < returnPermissions.length; i++) {
      aPerm = returnPermissions[i]
      /*
      if (aPerm.type === 'outside_scripts') {
        groupedPermissions.outside_scripts.push(aPerm)
      } else
      */
      if (['object_delegate', 'db_query'].indexOf(aPerm.type) > -1 && aPerm.requestor_app === appName && helpers.startsWith(aPerm.table_id, appName)) {
        groupedPermissions.thisAppToThisApp.push(aPerm)
      } else if (['object_delegate', 'db_query'].indexOf(aPerm.type) > -1 && aPerm.requestor_app !== appName && helpers.startsWith(aPerm.table_id, appName)) {
        groupedPermissions.otherAppsToThisApp.push(aPerm)
      } else if (['object_delegate', 'db_query'].indexOf(aPerm.type) > -1 && aPerm.requestor_app === appName && !helpers.startsWith(aPerm.table_id, appName)) {
        groupedPermissions.thisAppToOtherApps.push(aPerm)
      } else {
        groupedPermissions.unknowns.push(aPerm)
        felog('groupPermissions', 'ERROR - why this . uknown permission ' + JSON.stringify(aPerm))
      }
    }
    // onsole.log("returning groupedPermissions", groupedPermissions)
    return groupedPermissions
  }
}
exports.generatePermissionHTML = function (req, res) {
  // app.get('/v1/permissions/gethtml/:app_name', userAPIRights, addUserPermDBs, accountHandler.generatePermissionHTML)
  fdlog('generatePermissionHTML ' + req.url, 'req.params', req.params)

  if (!req.freezrTokenInfo) fdlog('generatePermissionHTML Missing req.freezrTokenInfo')
  // fdlog('generatePermissionHTML req.params', req.params, 'req.query', req.query, 'switch? ' + (req.path.indexOf('/account/perms') === 0) + '  ' + req.path.indexOf('/account/perms'))
  if (req.query.table_id && req.path.indexOf('/account/perms') === 0) { // ie parameters are under query
    fdlog('switch fpr account/perms') // todo - review
    // req.params.app_name = req.params.target_app
    // req.params.requestee_app = req.query.requestor_app
  }
  req.freezrIntermediateCallFwd = function (err, results) {
    if (err) felog('generatePermissionHTML', 'err in generatePermissionHTML - freezrIntermediateCallFwd ', err)
    fdlog('freezrIntermediateCallFwd results ', JSON.stringify(results))
    var Mustache = require('mustache')
    // todo add option to wrap pcard in html header
    fileHandler.getLocalSystemAppFileContent('systemapps/info.freezr.account/account_permobject.html', function (err, htmlForPermGroup) {
      let htmlContent = ''
      if (err || !htmlForPermGroup) {
        felog('generatePermissionHTML', 'file missing', 'html file missing')
        htmlContent = 'error - unable to retrieve html'
      } else {
        htmlForPermGroup = htmlForPermGroup.toString()
        Object.keys(results).forEach(function (appName, i) {
          const appObj = results[appName]
          htmlContent += '<table class="app_container" width="100%"><tbody><tr><td width="40px"><br><br><img src="/app_files/' + appName + '/static/logo.png" width="40px" class="logo_img"></td>'
          htmlContent += '<td><div class="freezer_dialogue_topTitle">' + appObj.app_display_name + '</div><span class="small_text">' + appName + '</span><br></td></tr></tbody></table>'

          htmlContent += '<div id="freezer_InnerLoginInfo"></div>'

          const IntroText = {
            outside_scripts: 'This app is asking for permission to be able to access programming scripts from the web. This can be VERY DANGEROUS. DO NOT ACCEPT THIS unless you totally trust the app provider and the source of the script. <br/> <b> PROCEED WITH CAUTION.</b> ',
            thisAppToThisApp: 'This app is asking for permission to share data from this app:',
            thisAppToOtherApps: 'This app is asking for permissions to access data from other apps:',
            otherAppsToThisApp: 'Other apps are asking for permission to see your data from this app:',
            unkowns: 'These permissions are uknkown to freezr'
          }
          const addPermSentence = function (aPerm) {
            let sentence = ''
            const hasBeenAccepted = (aPerm.granted && !aPerm.outDated)
            const otherApp = !helpers.startsWith(aPerm.table_id, aPerm.requestor_app)
            const accessWord = otherApp ? 'access and share' : 'share'

            sentence += otherApp ? ("The app, <b style='color:purple;'>" + aPerm.requestor_app + '</b>,') : 'This app'
            sentence += hasBeenAccepted ? ' is able to ' : ' wants to be able to '
            if (aPerm.type === 'db_query') {
              sentence += accessWord + ': ' + (aPerm.return_fields ? (aPerm.return_fields.join(', ')) : 'ERROR') + ' with the following groups: ' + (aPerm.sharable_group || 'NONE') + '.<br/>'
            } else if (aPerm.type === 'object_delegate') {
              sentence += accessWord + ' individual data records with the following group:  ' + (aPerm.sharable_group || 'None') + '.<br/>'
            } else if (aPerm.type === 'outside_scripts') {
              sentence = (hasBeenAccepted ? 'This app can ' : 'This app wants to ') + ' access the following scripts from the web: ' + aPerm.script_url + '<br/>This script can take ALL YOUR DATA and evaporate it into the cloud.<br/>'
            }
            if (aPerm.outDated) sentence += 'This permission was previously granted but the permission paramteres have changed to you would need to re-authorise it.<br/>'
            aPerm.sentence = sentence
            aPerm.action = hasBeenAccepted ? 'Deny' : 'Accept'
            return aPerm
          }

          let permCount = 0
          Object.keys(appObj).forEach(function (permType, i) {
            if (permType !== 'app_name' && permType !== 'app_display_name') {
              var toRender = {
                perm_grouping_intro: IntroText[permType],
                perm_list: appObj[permType],
                perm_type: permType
              }
              if (toRender.perm_list.length > 0) {
                // toRender.perm_list =
                permCount++
                toRender.perm_list.map(addPermSentence)
                // fdlog('permobject - toRender for key: ', permType, ' for toRender.perm_list: ', toRender.perm_list)
                htmlContent += Mustache.render(htmlForPermGroup, toRender)
              }
            }
          })
          if (permCount === 0) htmlContent += '<div class="freezer_dialogueTitle">There are no requests to share data related to this app.</div>'
        })
      }
      if (req.freezrInternalCallFwd) {
        req.freezrInternalCallFwd(err, { all_perms_in_html: htmlContent })
      } else {
        helpers.send_success(res, { all_perms_in_html: htmlContent })
      }
    })
  }
  exports.allRequestorAppPermissions(req, res)
}
exports.changeNamedPermissions = function (req, res) {
  // app.put('/v1/permissions/change/:requestee_app_table', accountLoggedInAPI, addUserPermsAndRequesteeDB, addPublicRecordsDB, accountHandler.changeNamedPermissions)

  fdlog('changePermissions ' + JSON.stringify(req.body))
  if (req.body.changeList && req.body.changeList.length === 1 && req.body.changeList[0].name && req.body.changeList[0].action && req.body.changeList[0].table_id && req.body.changeList[0].requestor_app) {
    const list = req.body.changeList[0]

    const permQuery = { name: list.name, table_id: list.table_id, requestor_app: list.requestor_app }
    req.freezrUserPermsDB.query(permQuery, {}, function (err, results) {
      if (err) {
        felog('changeNamedPermissions', err)
        helpers.send_failure(res, helpers.error('error getting permissions from db'), 'account_handler', exports.version, 'changeNamedPermissions')
      } else if (results.length === 0) {
        helpers.send_failure(res, helpers.error('permission record not found - try re-installing app'), 'account_handler', exports.version, 'changeNamedPermissions')
      } else if (results.length > 1) {
        req.freezrUserPermsDB.delete(results[1]._id, function (err, ret) {
          if (err) { felog('changeNamedPermissions', 'could not delete extra permission') } else { felog('changeNamedPermissions', 'extra permission SNBH') }
          helpers.send_failure(res, helpers.error('SNBH - more than one permission record'), 'account_handler', exports.version, 'changeNamedPermissions')
        })
      } else if (list.action === 'Accept' || list.action === 'Deny') {
        fdlog('changeNamedPermissions - going to accept or deny:', list.action)
        // update and also
        const granted = (list.action === 'Accept')
        const change = { outDated: false, granted, revokeIsWip: (!granted) }
        const oldGrantees = results[0].grantees || []
        const permId = results[0]._id
        req.freezrUserPermsDB.update(results[0]._id, change, { replaceAllFields: false }, function (err, results) {
          if (err) {
            helpers.send_failure(res, err, 'account_handler', exports.version, 'changeNamedPermissions')
          } else if (!granted) {
            const fullPermName = (permQuery.requestor_app + '/' + permQuery.name).replace(/\./g, '. ')
            // todo - this function needs to scale - in case of too many records, split in chunks
            // Get all records with grantee permissions and remove the permission
            async.forEach(oldGrantees, function (grantee, cb2) {
              var thequery = {}
              thequery['_accessible.' + grantee + '.' + fullPermName + '.granted'] = true
              req.freezrRequesteeDB.query(thequery, {}, function (err, recs) {
                if (err) felog('changeNamedPermissions', err) // handle
                fdlog('todo - also need to update freezrPublicPermDB if there are no more public permissions')
                async.forEach(recs, function (rec, cb3) {
                  const accessible = rec._accessible
                  const publicid = (accessible[grantee] && accessible[grantee][fullPermName] && accessible[grantee][fullPermName].publicid) ? accessible[grantee][fullPermName].publicid : null
                  if (accessible[grantee] && accessible[grantee][fullPermName]) delete accessible[grantee][fullPermName]
                  if (helpers.isEmpty(accessible[grantee])) delete accessible[grantee]
                  req.freezrRequesteeDB.update(rec._id, { accessible: accessible }, { replaceAllFields: false }, function (err) {
                    if (grantee !== '_public') {
                      cb3(err)
                    } else {
                      // accessiblesQuery = {permissionName: permQuery.name, table_id: permQuery.table_id, requestor_app:permQuery.requestor_app, dataOwner:req.session.logged_in_user_id,  originalRecordId:}
                      req.freezrPublicRecordsDB.delete_record(publicid, cb3)
                    }
                  })
                }, cb2)
              })
            }, function (err) {
              if (err) felog('changeNamedPermissions', 'if error, the perm update should be added to a clean up list')
              if (err) {
                helpers.send_failure(res, helpers.invalid_data('Could not affect chenge throughout freezr.', 'account_handler'), 'account_handler', exports.version, 'changeNamedPermissions')
              } else {
                felog('changeNamedPermissions', 'should clean up revokeIsWip items after wards in case this operation doesnt complete')
                req.freezrUserPermsDB.update(permId, { revokeIsWip: false, grantees: [] }, { replaceAllFields: false }, function (err) {
                  if (err) {
                    helpers.send_failure(res, helpers.invalid_data('Could not affect chenge throughout freezr.', 'account_handler'), 'account_handler', exports.version, 'changeNamedPermissions')
                  } else {
                    helpers.send_success(res, { success: true, name: permQuery.name, buttonId: req.body.changeList[0].buttonId, action: list.action, flags: null })
                  }
                })
              }
            })
          } else { // granted
            fdlog('todo freezrPublicPermDB functionality needs to be tested')
            req.freezrPublicManifestsDb.query({ user_id: req.session.logged_in_user_id, app_name: list.requestor_app }, null, (err, results) => {
              if (err) {
                felog('changeNamedPermissions', 'error setting freezrPublicPermDB - also flag below needs to be set correctly')
                helpers.send_success(res, { success: true, name: permQuery.name, buttonId: req.body.changeList[0].buttonId, action: list.action, flags: ['freezrPublicPermDB - error reading record'] })
              } else {
                fdlog('todo - need to get each card as well')
                var permissions = [list.name]
                var recId = null
                if (results && results[0]) {
                  recId = results[0]._id
                  permissions = helpers.addToListAsUnique(results[0].permissions, list.name)
                }
                const write = {
                  manifest: req.freezrRequestorAppConfig,
                  cards: req.freezrPublicCards,
                  user_id: req.session.logged_in_user_id,
                  app_name: list.requestor_app,
                  permissions
                }
                const sendResult = function (err, result) {
                  const flags = err ? ['freezrPublicPermDB - error setting record'] : null
                  helpers.send_success(res, { success: true, name: permQuery.name, buttonId: req.body.changeList[0].buttonId, action: list.action, flags })
                }
                if (results && results[0]) {
                  req.freezrPublicManifestsDb.update(recId, write, { replaceAllFields: true }, sendResult)
                } else {
                  req.freezrPublicManifestsDb.create(recId, write, null, sendResult)
                }
              }
            })
          }
        })
      } else {
        helpers.send_failure(res, helpers.invalid_data('action needs to be Deny or Accept.', 'account_handler'), 'account_handler', exports.version, 'changeNamedPermissions')
      }
    })
  } else {
    helpers.send_failure(res, helpers.invalid_data('One request at a time can be accepted.', 'account_handler'), 'account_handler', exports.version, 'changeNamedPermissions')
  }
}

const PERMISSION_FIELDS = {
  requestor_app: { storedAs: 'requestor_app' },
  table_id: { storedAs: 'table_id' },
  type: {},
  name: {},
  granted: { type: 'bool' },
  outDated: { type: 'bool' },
  allow_public: { type: 'bool', storedAs: 'allow_public' },
  description: '',
  return_fields: { storedAs: 'return_fields', type: 'array' },
  search_fields: { storedAs: 'search_fields', type: 'array' }
}
// old ones: anonymously , sort_fields, max_count, outside_scripts, web_connect, 'permitted_fields', 'sharable_group',

const permissionObjectFromAppConfigParams = function (requestorApp, name, appConfigPerm) {
  if (!appConfigPerm || typeof appConfigPerm !== 'object' || !requestorApp || !name) {
    felog('permissionObjectFromAppConfigParams', 'cannot make permission without a name ', { requestorApp, name })
    throw new Error('cannot make permission without a name ')
  }
  const returnpermission = {}
  if (appConfigPerm && typeof appConfigPerm === 'object') {
    Object.entries(PERMISSION_FIELDS).forEach(([key, prop]) => {
      const newkey = prop.storedAs || key
      if (prop.type === 'bool') {
        returnpermission[newkey] = (typeof appConfigPerm[key] === 'undefined') ? null : appConfigPerm[newkey]
      } else if (PERMISSION_FIELDS[key].type === 'array') {
        if (appConfigPerm[newkey] && !Array.isArray(prop)) felog('permissionObjectFromAppConfigParams', '' + key + ' needs to be an array - this was ignored.')
        returnpermission[newkey] = appConfigPerm[newkey] ? [...appConfigPerm[newkey]] : []
        fdlog('todo security - need to protect from user input ?')
      } else {
        returnpermission[newkey] = appConfigPerm[newkey]
        fdlog('todo security - need to protect from user input? ')
      }
    })
  }
  returnpermission.name = name
  returnpermission.requestor_app = requestorApp

  // old returnpermission.table_id =  app_config_perm_params.table_id || requestee_app
  if (!appConfigPerm.table_id) {
    returnpermission.table_id = appConfigPerm.requestee_app || requestorApp
    returnpermission.table_id += (appConfigPerm.collection_name ? ('.' + appConfigPerm.collection_name) : '')
  }
  if (!returnpermission.table_id) {
    felog('permissionObjectFromAppConfigParams', 'cannot make permission without a table ', { returnpermission, requestorApp, name })
    throw new Error('cannot make permission without a name ')
  }
  return returnpermission
}
const updatePermissionRecordsFromAppConfig = function (freezrUserPermsDB, appName, AppConfig, flags, callback) {
  const appConfigPerms = (AppConfig && AppConfig.permissions && Object.keys(AppConfig.permissions).length > 0) ? JSON.parse(JSON.stringify(AppConfig.permissions)) : null

  if (!AppConfig) {
    flags.add('notes', 'appconfig_missing')
    callback(null, flags)
  } else if (!appConfigPerms) {
    callback(null, flags)
  } else {
    // AppConfig exists - check it is valid
    // make a list of the schemas to re-iterate later and add blank permissions
    var queriedSchemaList = []
    let schemadPermission
    for (const [name, statedPerm] of Object.entries(appConfigPerms)) {
      schemadPermission = permissionObjectFromAppConfigParams(appName, name, statedPerm)
      queriedSchemaList.push(schemadPermission)
    }

    async.forEach(queriedSchemaList, function (schemadPermission, cb) { // get perms
      const permQuery = { name: schemadPermission.name, requestor_app: schemadPermission.requestor_app }

      freezrUserPermsDB.query(permQuery, {}, function (err, returnPerms) {
        if (err) {
          cb(helpers.internal_error('account_handler', exports.version, 'updatePermissionRecordsFromAppConfig', 'permision query error'))
        } else if (!returnPerms || returnPerms.length === 0) { // create new perm: schemadPermission.name for aUser
          schemadPermission.outDated = true
          schemadPermission.granted = false
          schemadPermission.denied = true
          freezrUserPermsDB.create(null, schemadPermission, {}, cb)
        } else if (permissionsAreSame(schemadPermission, returnPerms[0])) {
          cb(null)
        } else {
          schemadPermission.outDated = true
          schemadPermission.granted = false
          schemadPermission.denied = false
          if (returnPerms.length > 1) helpers.state_error('account_handler', exports.version, 'updatePermissionRecordsFromAppConfig', 'more than one permission for same app: ', schemadPermission.requestor_app + ' and permission name: ' + schemadPermission.name)
          freezrUserPermsDB.update(returnPerms[0]._id, schemadPermission, {}, cb)
        }
      })
    },
    function (err) {
      if (err) {
        callback(err, flags)
      } else {
        callback(null, flags)
      }
    })
  }
}

const createOrUpdateUserAppList = function (userAppListDb, appConfig, env, callback) {
  // note - currently updates the app_display_name only (and marks it as NOT removed)

  let appExists = false
  let appEntity = null

  const appName = (appConfig.meta && appConfig.meta.app_name) ? appConfig.meta.app_name : null
  const appDisplayName = (appConfig.meta && appConfig.meta.app_display_name) ? appConfig.meta.app_display_name : appConfig.app_name

  async.waterfall([
    // 1 make sure data exists and that app exists
    function (cb) {
      if (!appName) {
        cb(helpers.missing_data('app_name', 'account_handler', exports.version, 'add_app'))
      } else if (!helpers.valid_app_name(appName)) {
        cb(helpers.invalid_data('app_name: ' + appName, 'account_handler', exports.version, 'createOrUpdateUserAppList'))
      } else {
        userAppListDb.read_by_id(appName, cb)
      }
    },

    // 3. create or update the app in the database.
    function (existingEntity, cb) {
      if (existingEntity) {
        appExists = true
        appEntity = existingEntity
        appEntity.app_config = appConfig
        if (env) appEntity.env = env
        userAppListDb.update(appName, appEntity, { replaceAllFields: true }, cb)
      } else {
        appEntity = { app_name: appName, app_display_name: appDisplayName, app_config: appConfig, env, removed: false }
        userAppListDb.create(appName, appEntity, null, cb)
      }
    }
  ],
  function (err) {
    if (err) {
      callback(err, {})
    } else {
      callback(null, { isUpdate: appExists })
    }
  })
}
const permissionsAreSame = function (p1, p2) {
  return objectsaresame(p1, p2, ['granted', 'outDated', 'denied', 'grantees'])
}
const objectsaresame = function (obj1, obj2, ignorekeys = [], dolog = false) {
  if (typeof obj1 !== typeof obj2) {
    return false
  }
  if (!obj1 || ['string', 'boolean', 'number'].includes(typeof obj1)) return obj1 === obj2

  let areSame = true
  for (const key in obj1) {
    if ((!ignorekeys.includes(key)) && !objectsaresame(obj1[key], obj2[key], [], false)) {
      areSame = false
    }
    ignorekeys.push(key)
  }
  if (areSame) {
    for (const key in obj2) {
      if ((!ignorekeys.includes(key)) && !objectsaresame(obj1[key], obj2[key], [])) {
        areSame = false
      }
    }
  }
  return areSame
}

// CONFIGS
var accountPageConfig = { // config parameters for accounts pages
  home: {
    page_title: 'Accounts Home (Freezr)',
    css_files: ['./public/info.freezr.public/public/freezr_style.css', 'account_home.css'],
    page_url: 'account_home.html',
    initial_query_func: exports.list_all_user_apps,
    // initial_query: {'url':'/v1/account/app_list.json'},
    app_name: 'info.freezr.account',
    script_files: ['account_home.js']
  },
  changepassword: {
    page_title: 'Change Password (freezr)',
    css_files: './public/info.freezr.public/public/freezr_style.css',
    page_url: 'account_changepassword.html',
    script_files: ['account_changepassword.js']
  },
  app_management: {
    page_title: 'Apps (freezr)',
    css_files: ['./public/info.freezr.public/public/freezr_style.css', 'account_app_management.css'],
    page_url: 'account_app_management.html',
    // initial_query: {'url':'/v1/account/app_list.json'},
    initial_query_func: exports.list_all_user_apps,
    script_files: ['account_app_management.js', './public/info.freezr.public/public/mustache.js']
  },
  perms: {
    page_title: 'Permissions (freezr)',
    css_files: ['./public/info.freezr.public/public/freezr_style.css'],
    page_url: 'account_perm.html',
    // initial_query: {'url':'/v1/account/app_list.json'},
    initial_query_func: exports.generatePermissionHTML,
    script_files: ['account_perm.js']
  },
  autoclose: {
    page_title: 'Autoclose tab (freezr)',
    page_url: 'account_autoclose.html',
    script_files: ['account_autoclose.js']
  },
  appdata_view: {
    page_title: 'View all my data ',
    page_url: 'account_appdata_view.html',
    css_files: ['account_appdata_view.css'],
    script_files: ['account_appdata_view.js', 'FileSaver.js']
  },
  appdata_backup: {
    page_title: 'Backup and Restore data',
    page_url: 'account_appdata_backup.html',
    css_files: ['account_appdata_backup.css'],
    script_files: ['account_appdata_backup.js', 'FileSaver.js']
  }
}

// Loggers
const LOG_ERRORS = true
const felog = function (...args) { if (LOG_ERRORS) helpers.warning('account_handler.js', exports.version, ...args) }
const LOG_DEBUGS = false
const fdlog = function (...args) { if (LOG_DEBUGS) console.log(...args) }