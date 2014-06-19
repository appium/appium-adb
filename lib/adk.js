"use strict";

var spawn = require('win-spawn')
  , exec = require('child_process').exec
  , net = require('net')
  , _ = require('underscore')
  , logger = require('../../server/logger.js').get('appium');

// EACH emulator needs to define these interfaces
//  isThisMe
//  getAvdName
//  launchAVD
//  getDefinedAvds

var ADK = function (opts) {
  if (!opts) {
    opts = {};
  }
  this.adb = opts.adb;
};


ADK.prototype.isThisMe = function (udid) {
  return udid.indexOf("emulator-") !== -1;
};

ADK.prototype.sendTelnetCommand = function (command, cb) {
  logger.info("Sending telnet command to device: " + command);
  this.getEmulatorPort(function (err, port) {
    if (err) return cb(err);
    var conn = net.createConnection(port, 'localhost');
    var connected = false;
    var readyRegex = /^OK$/m;
    var dataStream = "";
    var res = null;
    var onReady = function () {
      logger.info("Socket connection to device ready");
      conn.write(command + "\n");
    };
    conn.on('connect', function () {
      logger.info("Socket connection to device created");
    });
    conn.on('data', function (data) {
      data = data.toString('utf8');
      if (!connected) {
        if (readyRegex.test(data)) {
          connected = true;
          onReady();
        }
      } else {
        dataStream += data;
        if (readyRegex.test(data)) {
          res = dataStream.replace(readyRegex, "").trim();
          logger.info("Telnet command got response: " + res);
          conn.write("quit\n");
        }
      }
    });
    conn.on('close', function () {
      if (res === null) {
        cb(new Error("Never got a response from command"));
      } else {
        cb(null, res);
      }
    });
  });
};

ADK.prototype.getAvdName = function (emulator, cb) {
  this.sendTelnetCommand(emulator, "avd name", function (err, runningAVDName) {
    if (err) return cb(err);
    cb(null, runningAVDName);
  });
};

ADK.prototype.getDefinedAvds = function (cb) {
  this.adb.checkSdkBinaryPresent("android", function (err, binaryLoc) {
    if (err) return cb(err);
    exec(binaryLoc + " list avd -c", function (err, stdout) {
      if (err) return cb(err);
      var avds = [];
      if (stdout) {
        logger.info("ADK getDefinedAvds:" + stdout.trim());
        avds = stdout.trim().split("\n");
      }
      cb(null, avds);
    }.bind(this));
  }.bind(this));
};

ADK.prototype.launchAVD = function (avdName, avdArgs, language, locale, avdLaunchTimeout,
    avdReadyTimeout, cb, retry) {
  if (typeof retry === "undefined") {
    retry = 0;
  }
  logger.info("Launching Emulator with AVD " + avdName + ", launchTimeout " +
              avdLaunchTimeout + "ms and readyTimeout " + avdReadyTimeout +
              "ms");
  this.checkSdkBinaryPresent("emulator", function (err, emulatorBinaryPath) {
    if (err) return cb(err);

    if (avdName[0] === "@") {
      avdName = avdName.substr(1);
    }

    var launchArgs = ["-avd", avdName];
    if (typeof language === "string") {
      logger.info("Setting Android Device Language to " + language);
      launchArgs.push("-prop", "persist.sys.language=" + language.toLowerCase());
    }
    if (typeof locale === "string") {
      logger.info("Setting Android Device Country to " + locale);
      launchArgs.push("-prop", "persist.sys.country=" + locale.toUpperCase());
    }
    if (typeof avdArgs === "string") {
      avdArgs = avdArgs.split(" ");
      launchArgs = launchArgs.concat(avdArgs);
    }
    var proc = spawn(emulatorBinaryPath.substr(1, emulatorBinaryPath.length - 2),
      launchArgs);
    proc.on("error", function (err) {
      logger.error("Unable to start Emulator: " + err.message);
      // actual error will get caught by getRunningAVDWithRetry
    });
    proc.stderr.on('data', function (data) {
      logger.error("Unable to start Emulator: " + data);
    });
    proc.stdout.on('data', function (data) {
      if (data.toString().indexOf('ERROR') > -1) {
        logger.error("Unable to start Emulator: " + data);
      }
    });
    this.getRunningAVDWithRetry(avdName.replace('@', ''), avdLaunchTimeout,
        function (err) {
      if (err) {
        if (retry < 1) {
          logger.warn("Emulator never became active. Going to retry once");
          proc.kill();
          return this.launchAVD(avdName, avdArgs, language, locale, avdLaunchTimeout,
            avdReadyTimeout, cb, retry + 1);
        } else {
          return cb(err);
        }
      }
      this.waitForEmulatorReady(avdReadyTimeout, cb);
    }.bind(this));
  }.bind(this));
};

module.exports = ADK;