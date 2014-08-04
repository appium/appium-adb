"use strict";

var spawn = require('win-spawn')
  , exec = require('child_process').exec
  , fs = require('fs')
  , _ = require('underscore')
  , helpers = require('./helpers')
  , isWindows = helpers.isWindows()
  , isMac = helpers.isMac()
  , isLinux = helpers.isLinux()
  , logger = require('./logger');

// EACH emulator needs to define these interfaces
//  isThisMe
//  getAvdName
//  launchAVD
//  getDefinedAvds

var GENYMOTION = function (opts) {
  if (!opts) {
    opts = {};
  }
  this.adb = opts.adb;
};

GENYMOTION.prototype.isThisMe = function (udid) {
  var gmrx = new RegExp(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:(\d+)/);
  return gmrx.test(udid);
};

GENYMOTION.prototype.getAvdNameAndUid = function (line) {
  var uid = null;
  var name = null;
  // find the uid
  var i1 = line.indexOf("{");
  if (i1 !== -1) {
    var i2 = line.indexOf("}", i1);
    if (i2 !== -1) {
      uid = line.substring(i1 + 1, i2);
    }
    // find the name
    i1 = line.indexOf('"');
    i2 = line.lastIndexOf('"');
    if (i2 !== -1 &&  i1 !== -1) {
      name = line.substring(i1 + 1, i2);
    }
  }
  return {
    name: name,
    uid: uid
  };
};

// get running genymotion vms and try to match ip (from adb devices with queried ip address)
GENYMOTION.prototype.getAvdName = function (emulator, cb) {
  var ip = this.getIpAddress(emulator);
  if (ip === null) return cb(new Error("ip not found"));
  this.checkVBoxManagePresent(function (err, vbox) {
    if (err) return cb(err);
    var cmd = vbox + " list runningvms";
    exec(cmd, function (err, stdout) {
      if (err) return cb(err);
      if (stdout) {
        var lines = stdout.trim().split("\n");
        var lineIdx = 0, numLines = lines.length;
        var notFound = new Error("Avd name could not be found");

        var avdNameAndUid = function (lines) {
          if (lineIdx >= numLines) return cb(notFound);
          var avd = this.getAvdNameAndUid(lines[lineIdx++]);
          if (avd.name !== null && avd.uid !== null) {
            // get ip number
            cmd = vbox + " guestproperty get \"" + avd.name + "\" androvm_ip_management";
            exec(cmd, function (err, stdout2) {
              if (err === null && stdout2.length > 0 && stdout2.indexOf("Value: ") !== -1) {
                var testIp = stdout2.substring(7).trim();
                if (testIp === ip) {
                  logger.info("Genymotion name for " + emulator.udid + " is " + avd.name);
                  return cb(null, avd.name);		// return gm name from ip
                }
              }
              setTimeout(function () {
                avdNameAndUid(lines);
              }.bind(this), 1);
            }.bind(this));
          } else {
              setTimeout(function () {
                avdNameAndUid(lines);
              }.bind(this), 1);
          }
        }.bind(this);
        avdNameAndUid(lines);

      } else {
        cb(new Error("Could not find genymotion avd"));
      }
    }.bind(this));
  }.bind(this));
};

GENYMOTION.prototype.getGenymotionPath = function () {
  var gm;
  if (isMac) {
    gm = "/Applications/Genymotion.app/Contents/MacOS/player";
  } else if (isWindows) {
    gm = process.env.ProgramFiles + "\\Genymotion\\Genymobile\\player.exe";
  } else if (isLinux) {
    gm = process.env.HOME + "/genymotion/player";
  }
  logger.debug("Genymotion player:" + gm);
  return gm;
};

GENYMOTION.prototype.checkGenymotionPlayerPresent = function () {
  var gmPath = this.getGenymotionPath();
  if (!fs.existsSync(gmPath)) {
    gmPath = null;
  }
  return gmPath;
};

GENYMOTION.prototype.getVBoxmanagePath = function (cb) {
  var cmd;
  if (isWindows) {
    cmd = "where";
  } else {
    cmd = "which";
  }
  cmd += " vboxmanage";
  exec(cmd, function (err, stdout) {
    if (stdout) {
      stdout = stdout.trim();
    }
    cb(err, stdout);
  }.bind(this));
};

GENYMOTION.prototype.checkVBoxManagePresent = function (cb) {
  this.getVBoxmanagePath(function (err, vbox) {
    if (err) return cb(err);
    if (fs.existsSync(vbox)) {
      cb(null, vbox);
    } else {
      cb(new Error("Could not find VBoxManage."));
    }
  }.bind(this));
};

GENYMOTION.prototype.getIpAddress = function (emulator) {
  var ip = null;
  if (emulator.udid !== null) {
    ip = emulator.udid.substring(0, emulator.udid.indexOf(":"));
  }
  return ip;
};

GENYMOTION.prototype.launchAVD = function (avdName, avdArgs, avdLaunchTimeout,
                                    avdReadyTimeout, cb, retry) {
  var gmPlayer = this.checkGenymotionPlayerPresent();
  if (gmPlayer) {
    var gmArgs = ["--vm-name", avdName];
    logger.debug("GMLaunch:" + gmPlayer);
    var proc = spawn(gmPlayer, gmArgs, {detached: true});   // launch detached from appium
    this.adb.getRunningAVDWithRetry(avdName.replace('@', ''), avdLaunchTimeout, function (err) {
      if (err) {
        if (retry < 1) {
          logger.warn("Emulator never became active. Going to retry once");
          proc.kill();
          return this.launchAVD(avdName, avdArgs, avdLaunchTimeout,
            avdReadyTimeout, cb, retry + 1);
        } else {
          return cb(err);
        }
      }
      this.adb.waitForEmulatorReady(avdReadyTimeout, cb);
    }.bind(this));
  } else {
    return cb(new Error("Could not get Genymotion player"));
  }
};

GENYMOTION.prototype.getDefinedAvds = function (cb) {
  this.checkVBoxManagePresent(function (err, vbox) {
    if (err) return cb(err);
    var cmd = vbox + " list vms";
    exec(cmd, function (err, stdout) {
      var avds = [];
      if (stdout) {
        logger.info("GM getDefinedAvds:\n" + stdout.trim());
        _.each(stdout.trim().split("\n"), function (line) {
          var avd = this.getAvdNameAndUid(line);
          if (avd.name !== null) {
            avds.push(avd.name);
          }
        }.bind(this));
      }
      cb(null, avds);
    }.bind(this));
  }.bind(this));
};

module.exports = GENYMOTION;