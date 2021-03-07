// copied from register page - need to customize to change password

freezr.initPageScripts = function() {
  document.getElementById('user_id').innerHTML = freezrMeta.userId;

  document.getElementById('changePassword').onsubmit = function (evt) {
    evt.preventDefault();

    var oldPassword=document.getElementById('oldPassword').value;
    var newPassword = document.getElementById('newPassword').value;
    var password2 = document.getElementById('password2').value;

    if (!oldPassword) {
      showError("Please enter your current password");
    } else if (!newPassword) {
      showError("Please enter a new password");
    } else if (!password2 || newPassword != password2) {
      showError("Passwords have to match");
    } else {
      var theInfo = { user_id: freezrMeta.userId,
                      oldPassword: oldPassword,
                      newPassword: newPassword
                    };
      freezerRestricted.connect.write("/v1/account/changePassword.json", theInfo, gotChangeStatus, "jsonString");
    }
  }
}

var gotChangeStatus = function(error, data) {
  data = freezr.utils.parse(data)
  if (error) {
    showError("Error changing password -  "+error.message);
  } else if (!data) {
      showError("Could not connect to server");
  } else {
    showError("Password Changed !! ");
    setTimeout(function() { window.location = "/account/home";},2000)
    document.getElementById("changePassword").style.display="none";
  }
}

var showError = function(errorText) {
  var errorBox=document.getElementById("errorBox");
  errorBox.innerHTML= errorText;
}
