// account app Management

var doShowDevoptions = false;
var userHasIntiatedAcions = false;
freezr.initPageScripts = function() {
  document.addEventListener('click', function (evt) {
    if (evt.target.id && freezr.utils.startsWith(evt.target.id,"button_")) {
      var parts = evt.target.id.split('_');
      var args = evt.target.id.split('_');
      args.splice(0,2).join('_');
      //onsole.log(args)
      if (buttons[parts[1]]) buttons[parts[1]](args, evt.target);
    }
  });

DEFAULT_EXPIRY_DAYS = 30// days

  document.getElementById("appUrl").addEventListener('keyup', function() {
    document.getElementById("appNameFromUrl").innerText = getAppFromUrl(document.getElementById("appUrl").innerText)
  })

  if (!freezrMeta.adminUser) {
    setTimeout(function(){
      document.getElementById("button_showDevOptions").style.display="none";
      if (document.getElementById("freezer_users_butt"))document.getElementById("freezer_users_butt").style.display="none";
    }, 300);}
  if (freezrMeta.adminUser && window.location.search.indexOf("dev=true")>0) doShowDevoptions = true;
  showDevOptions();
}



var showDevOptions = function(){
  buttons.updateAppList();
  if (doShowDevoptions && freezrMeta.adminUser) {
    document.getElementById("addFileTable").style.display="block";
    document.getElementById("button_showDevOptions").style.display="none";
  }
}

freezr.onFreezrMenuClose = function(hasChanged) {
  //freezerRestricted.menu.resetDialogueBox(true);
  if (userHasIntiatedAcions) buttons.updateAppList();
  //setTimeout(function() {freezerRestricted.menu.resetDialogueBox(true);},300);
}
var buttons = {
  'showDevOptions': function(args) {
    doShowDevoptions = true;
    showDevOptions();
    history.pushState(null, null, '?dev=true');
  },
  'goto': function(args) {
    window.open("/apps/"+args[1]+'/index.html',"_self");
  },
  'installApp': function(args) {
    userHasIntiatedAcions = true;
    window.open("/apps/"+args[0],"_self");
  },
  'reinstallApp': function(args) {
    userHasIntiatedAcions = true;
    window.open("/apps/"+args[0],"_self");
  },
  'removeAppFromHomePage': function(args) {
      userHasIntiatedAcions = true;
      freezerRestricted.connect.ask('/v1/account/appMgmtActions.json', {'action':'removeAppFromHomePage', 'app_name':args[0]}, remove_app_callback)
  },
  'deleteApp': function(args) {
      userHasIntiatedAcions = true;
      freezerRestricted.connect.ask('/v1/account/appMgmtActions.json', {'action':'deleteApp', 'app_name':args[0]}, delete_app_callback)
  },
  'uploadZipFileApp': function (args) {
    userHasIntiatedAcions = true;
    var fileInput = document.getElementById('app_zipfile2');
    var file = (fileInput && fileInput.files)? fileInput.files[0]: null;

    var parts = file.name.split('.');
    if (endsWith(parts[(parts.length-2)],"-master")) parts[(parts.length-2)] = parts[(parts.length-2)].slice(0,-7);
    if (startsWith((parts[(parts.length-2)]),"_v_")) {
        parts.splice(parts.length-2,2);
    } else {
        parts.splice(parts.length-1,1);
    }
    app_name = parts.join('.');
    app_name = app_name.split(' ')[0];

    if (!fileInput || !file) {
      showError("Please Choose a file first.");
    } else if (file.name.substr(-4) != ".zip") {
      document.getElementById('errorBox').innerHTML="The app file uploaded must be a zipped file. (File name represents the app name.)";
    } else if (!valid_app_name(app_name)) {
      document.getElementById('errorBox').innerHTML="Invalid app name - please make sure the zip file conforms to freezr app name guidelines";
    } else {
      var uploadData = new FormData();
      uploadData.append('file', file);
      uploadData.append('app_name', app_name);
      var url = "/v1/account/app_install_from_zipfile.json";
      //var theEl = document.getElementById(file.name);
      //if (!theEl || confirm("This app exists. Do you want to replace it with the uplaoded files?")) {
        freezerRestricted.menu.resetDialogueBox(true);
        if (file.size > 500000) document.getElementById("freezer_dialogueInnerText").innerHTML = "<br/>You are uploading a large file. This might take a little while. Please be patient.<br/>"+document.getElementById("freezer_dialogueInnerText").innerHTML
        freezerRestricted.connect.send(url, uploadData, function(error, returndata) {
            var d = freezr.utils.parse(returndata);
            //onsole.log("Upload file returned ",d)
            if (error || d.err) {
              writeErrorsToFreezrDialogue(d)
            } else{
              ShowAppUploadErrors(d.flags, 'uploadZipFileApp' ,uploadSuccess);
            }
          }, "PUT", null);
      //}
    }
  },
  'addAppViaUrl': function() {
    userHasIntiatedAcions = true;
    let app_url = document.getElementById('appUrl').innerText;
    let app_name= document.getElementById("appNameFromUrl").innerText

    if (!app_url) {
        showError("Please enter a url to a zip file");
    } else if (app_url == "https://github.com/user/repo"){
      showError("Please enter an actual github user and repository or point to a zip file url.");
    } else if (!valid_app_name(app_name)) {
      showError("Invalid app name - please correct the app name")
    } else {
      app_url = normliseGithubUrl(app_url)
      freezerRestricted.menu.resetDialogueBox(true);
      freezerRestricted.connect.ask('/v1/account/app_install_from_url.json', {'app_url':app_url,'app_name':app_name }, function(error, returndata) {
          //onsole.log(returndata)
          var d = freezr.utils.parse(returndata);
          if (error || d.err) {
            writeErrorsToFreezrDialogue(d)
          } else{
            ShowAppUploadErrors(d.flags, 'addAppViaUrl', uploadSuccess);
          }
      })
    }
  },
  'addBlankApp': function() {
    userHasIntiatedAcions = true;
    let app_name= document.getElementById("appNameForBlankApp").innerText

    if (!valid_app_name(app_name)) {
      showError("Invalid app name - please correct the app name")
    } else {
      freezerRestricted.menu.resetDialogueBox(true);
      freezerRestricted.connect.ask('/v1/account/app_install_blank', {'app_name':app_name }, function(error, returndata) {
          //onsole.log(returndata)
          var d = freezr.utils.parse(returndata);
          d.isBlankOfflineApp = true
          if (error || d.err) {
            writeErrorsToFreezrDialogue(d)
          } else{
            ShowAppUploadErrors(d.flags, 'addBlankApp', uploadSuccess);
          }
      })
    }
  },
  'updateApp': function(args) {
    userHasIntiatedAcions = true;
    window.scrollTo(0, 0);
    freezerRestricted.menu.resetDialogueBox(true);
    document.getElementById("freezer_dialogue_closeButt").style.display="none";
    document.getElementById("freezer_dialogue_homeButt").style.display="none";
    document.getElementById("freezer_dialogueScreen").onclick=null;
    freezerRestricted.connect.ask('/v1/account/appMgmtActions.json', {'action':'updateApp', 'app_name':args[0]}, function(error, returndata) {
        console.log(returndata)
        document.getElementById("freezer_dialogue_closeButt").style.display="block";
        document.getElementById("freezer_dialogue_homeButt").style.display="block";
        if (error || returndata.err) {
          if (document.getElementById("freezer_dialogueInnerText")) document.getElementById("freezer_dialogueInnerText").innerHTML= "<br/>"+JSON.stringify(returndata.err);
        } else {
          ShowAppUploadErrors(returndata.flags, 'updateApp', showDevOptions)
        }
        buttons.updateAppList();
    })
  },
  'genAppPassword': function(args, elClicked){
    let noticeDiv = document.getElementById("perms_dialogue")
    var rect = elClicked.getBoundingClientRect();
    noticeDiv.style.left =(rect.left)+"px"
    noticeDiv.style.width =(window.innerWidth - (2*rect.left)+50)+"px"
    noticeDiv.style.top =(rect.top+window.scrollY-15)+"px"
    noticeDiv.style.display="block"
    document.getElementById("spinner").style.display="block";
    document.getElementById("perms_text").style.display="none";
    document.getElementById("numdaysvalid").value=DEFAULT_EXPIRY_DAYS;
    document.getElementById("one_device").checked=false;
    document.getElementById("appNameForApp").innerHTML=args[0];
    document.getElementById("perm_warning").style.display="none"
    document.getElementById("button_savePermsChanges").style.display="none";
    elClicked.parentElement.style="padding-bottom:60px"

    const didChange = function(){document.getElementById("button_savePermsChanges").style.display="block";}
    document.getElementById("numdaysvalid").onchange= didChange;
    document.getElementById("numdaysvalid").oninput= didChange;
    document.getElementById("one_device").onchange=didChange;


    let app_name = args[0]
    let expiry = new Date().getTime()
    expiry += DEFAULT_EXPIRY_DAYS * 24 * 3600 * 1000
    let one_device = false;
    let options = {app_name, expiry, one_device}

    let url = '/v1/account/apppassword/generate';
    //onsole.log("sending genAppPassword options",options)

    freezerRestricted.connect.read(url, options , (error, resp) => {
      resp=freezr.utils.parse(resp)
      //onsole.log(resp)
      if (error) console.warn(error)
      document.getElementById("spinner").style.display="none";
      document.getElementById("appPasswordForApp").innerHTML = resp.app_password
      document.getElementById("appAuthUrlForApp").innerHTML = freezrMeta.serverAddress+'?user='+freezrMeta.userId+'&password='+resp.app_password
      document.getElementById("perms_text").style.display="block"
    })
  },
  'closePermsDialogue':function(){
    document.getElementById('perms_dialogue').style.display="none";
  },
  'savePermsChanges':function(){
    let expiry = new Date().getTime()
    expiry += parseInt(document.getElementById("numdaysvalid").value) * 24 * 3600 * 1000
    let one_device = document.getElementById("one_device").checked;
    let app_name = document.getElementById("appNameForApp").innerText;
    let password = document.getElementById("appPasswordForApp").innerText;
    let options = {app_name, expiry, one_device, password}
    let url = '/v1/account/apppassword/updateparams';

    //onsole.log("sending savePermsChanges options",options)
    freezerRestricted.connect.read(url, options , (error, resp) => {
      resp=freezr.utils.parse(resp)
      //onsole.log(resp)
      if (error) console.warn(error)
      document.getElementById("button_savePermsChanges").style.display="none";
      document.getElementById("perm_warning").style.display="block";
      document.getElementById("perm_warning").innerHTML = (resp.success? "Changes were saved successfully": "There was an error saving your changes. Try again later");
      setTimeout(function(){document.getElementById("perm_warning").style.display="none";},15000)
    })


      // save changes to perm
      // make sure cookie toggle works
      // copytext do
  },
  'gotoAppData':function(args) {
    let url = '/account/appdata/'+ args[0] +'/view'
    window.open(url,'_self')
  },
  'gotoAppPerms':function(args) {
    let url = '/account/perms/'+ args[0]
    window.open(url,'_self')
  },
  'addAppInFolder': function() {
    userHasIntiatedAcions = true;
    var app_name = document.getElementById('appNameFromFolder').value;
    if (!app_name) {
        showError("Please enter an app name");
    } else {
      buttons.updateApp([app_name]);
    }
  },
  'updateAppList': function() {
      freezr.utils.getAllAppList (function (error, returndata) {
          var theData = returndata;
          var theEl = document.getElementById("app_list");
          if(!theData) {
            theEl.innerHTML = "No Apps have been installed";
          } else if (error || theData.err || theData.error) {
            console.warn(error)
            theEl.innerHTML = "ERROR RETRIEVING APP LIST";
          } else {
            freezr.utils.getHtml("app_mgmt_list.html", null, function(error, theHtml) {
              if (error) console.warn(error)
              theEl.innerHTML = Mustache.to_html( theHtml,theData );
              var imglist = document.getElementsByClassName("logo_img");
              var imglistener = function(evt){
                    this.src="/app_files/info.freezr.public/public/static/freezer_logo_empty.png"
                    this.removeEventListener("error",imglistener);
                }
              for (var i=0; i<imglist.length; i++) {
                  imglist[i].addEventListener("error", imglistener )
              }
              if (doShowDevoptions && freezrMeta.adminUser) Array.prototype.forEach.call(document.getElementsByClassName("dev_option"), function(el, index) {el.style.display="block";});
            })
          }
      });
  },
  'chooseFile':function() {
    // document.getElementById('buttons_uploadZipFileApp').style.display="block";
    document.getElementById('app_zipfile2').click();
    document.getElementById('button_uploadZipFileApp').style.display  ="block";
  },
  'closeMenu':function() {
    freezr.utils.freezrMenuClose();
    //setTimeout(function() {freezerRestricted.menu.resetDialogueBox(true);},300);
  }

}

const normliseGithubUrl = function (aUrl){
  if (startsWith(aUrl, "https://github.com/") && (aUrl.match(/\//g) || []).length==4 && !endsWith(aUrl,".zip") ) {
    aUrl = aUrl+"/archive/master.zip"
  }
  return aUrl
}

var ShowAppUploadErrors = function (theData, type, callFwd) {
  freezr.utils.getHtml("uploaderrors.html", null, function (error, theHtml) {
    if (error) console.warn(error)

    var theEl = document.getElementById("freezer_dialogueInnerText");
    try {
      //onsole.log("theHtml",theHtml)
      //onsole.log("theData",theData)
      theEl.innerHTML = Mustache.to_html( theHtml,theData );
      if (type == "addBlankApp") {
        document.getElementById("button_closeMenu_1").style.display="block"
        document.getElementById("finalise_outer").style.display="none"
      }
    } catch(e) {
      console.warn("mustache failed",e)
      theEl.innerHTML = JSON.stringify(theData);
    }
    if (callFwd) callFwd();
  })
}

var uploadSuccess = function() {
  buttons.updateAppList();
  //document.getElementById("freezer_dialogue_extra_title").innerHTML="Finalize Installation and Launch'."
  //document.getElementById("freezer_dialogue_extra_title").onclick=function() {buttons.goto}
}
var remove_app_callback = function(error, data) {
  data = freezerRestricted.utils.parse(data);
  window.scrollTo(0, 0);
  if (error || data.error) {
    console.warn({error, data})
    showError("Error removing app")
  } else if (!data || !data.success) {
    showError("Could not connect to server");
  } else {
    showError("The app was removed from your home page. Scroll down to 'removed apps' section below to re-install or to delete completely.");
    buttons.updateAppList();
  }
}
var delete_app_callback = function(error, data) {
  data = freezerRestricted.utils.parse(data);
  window.scrollTo(0, 0);
  if (error) {
    showError('Error: ' + error.message)
  } else if (!data) {
    showError('Could not connect to server')
  } else if (data && data.other_data_exists) {
    showError("Your data was deleted. But the app cannot be removed until other users have also deleted ther data.");
  } else {
    showError("The app was deleted.");
    buttons.updateAppList();
  }
}

var gotChangeStatus = function(data) {
  data = freezerRestricted.utils.parse(data);
  if (!data) {
      showError("Could not connect to server");
  } else if (data.error) {
    showError("Error:"+data.message);
  } else {
    showError("success in making app");
    window.location = "/account/apps";
  }
}

var timer = null;
var showError = function(errorText) {
  timer = null;
  var errorBox=document.getElementById("errorBox");
  errorBox.innerHTML= errorText? errorText: " &nbsp ";
  if (errorText) {
    timer = setTimeout(function () {showError();
  },5000)}
}

const writeErrorsToFreezrDialogue = function(data){
  const el = document.getElementById("freezer_dialogueInnerText");
  el.innerHTML = "<br/><h1>Error: Could not install app</h1><br/>"

  if (data.flags && data.flags.errors){
    data.flags.errors.forEach((aflag) => {
      el.innerHTML+= aflag.text+" ("+aflag.function+") <br/>"
    })
  }

  if (data.err) el.innerHTML += "<br/>("+JSON.stringify(data.err)+")";
}

var valid_app_name = function(app_name) {
        if (!app_name) return false;
        if (app_name.length<1) return false;
        if (!valid_filename(app_name)) return false;
        if (starts_with_one_of(app_name, ['.','-','\\','system'] )) return false;
        if (SYSTEM_APPS.indexOf(app_name)>-1) return false;
        if (app_name.indexOf("_") >-1) return false;
        if (app_name.indexOf(" ") >-1) return false;
        if (app_name.indexOf("$") >-1) return false;
        if (app_name.indexOf('"') >-1) return false;
        if (app_name.indexOf("/") >-1) return false;
        if (app_name.indexOf("\\") >-1) return false;
        if (app_name.indexOf("{") >-1) return false;
        if (app_name.indexOf("}") >-1) return false;
        if (app_name.indexOf("..") >-1) return false;
        var app_segements = app_name.split('.');
        if (app_segements.length <3) return false;
        return true;
    }
var valid_filename = function (fn) {
        var re = /[^\.a-zA-Z0-9-_ ]/;
        // @"^[\w\-. ]+$" http://stackoverflow.com/questions/11794144/regular-expression-for-valid-filename
        return typeof fn == 'string' && fn.length > 0 && !(fn.match(re) );
    };
var endsWith = function (longertext, checktext) {
        if (!checktext || !longertext || checktext.length > longertext.length) {return false} else {
        return (checktext == longertext.slice((longertext.length-checktext.length)));}
    }
var startsWith = function(longertext, checktext) {
        if (!longertext || !checktext || !(typeof longertext === 'string')|| !(typeof checktext === 'string')) {return false} else
        if (checktext.length > longertext.length) {return false} else {
        return (checktext == longertext.slice(0,checktext.length));}
    }
var starts_with_one_of = function(thetext, stringArray) {
        for (var i = 0; i<stringArray.length; i++) {
            if (startsWith(thetext,stringArray[i])) return true;
        }
        return false;
    }
const SYSTEM_APPS = ["info.freezr.account","info.freezr.admin","info.freezr.public","info.freezr.permissions","info.freezr.posts"];
function getAppFromUrl (aUrl){
  let app_name = aUrl
  if (startsWith(aUrl, "https://github.com/") ) {
    app_name = app_name.replace("https://github.com/","")
    app_name = app_name.slice(app_name.indexOf("/")+1)
    if (app_name.indexOf("/")>-1) app_name = app_name.slice(0,app_name.indexOf("/"))
  } else {
    app_name = app_name.slice(app_name.lastIndexOf("/")+1)
    if (app_name.indexOf(".zip")>-1) app_name = app_name.slice(0, app_name.indexOf(".zip"))
  }
  //onsole.log("fetching from ",aUrl)
  return app_name
}
