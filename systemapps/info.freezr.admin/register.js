// admin/register


freezr.initPageScripts = function() {
  document.getElementById('register').onsubmit = function (evt) {
    evt.preventDefault();
    var user_id=document.getElementById('user_id').value;
    var password = document.getElementById('password').value;
    var password2 = document.getElementById('password2').value;

    if (!user_id || !password) {
      showError("You need a name and password to log in");
    } else if (user_id.indexOf("_")>-1 || user_id.indexOf(" ")>-1 || user_id.indexOf("/")>-1) {
      showError("user id's cannot have '/' or '_' or spaces in them");
    } else if (!password2 || password != password2) {
      showError("Passwords have to match");
    } else {
      var theInfo = { register_type: "normal",
                      isAdmin: (document.getElementById("isAdminId").checked),
                      useSysFsDb: (document.getElementById("useSysFsDbId").checked),
                      email_address: document.getElementById("email_address").value,
                      user_id: user_id,
                      full_name: document.getElementById("full_name").value,
                      password: password
                    };
      freezerRestricted.connect.write("/v1/admin/user_register", theInfo, gotRegisterStatus, "jsonString");
    }
  }
}

var gotRegisterStatus = function (error, data) {
  if (data) data = freezr.utils.parse(data)
  if (error) {
    showError(error);
  } else if (data.error) {
    showError("Error. "+ data.message)
  } else if (!data) {
    showError("Could not connect to server");
  } else {
    window.location = "/admin/list_users";
  }
}

var showError = function(errorText) {
  var errorBox=document.getElementById("errorBox");
  errorBox.innerHTML= errorText;
  window.scrollTo(0,0);
}
