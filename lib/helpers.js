"use strict";

var logger = require('./logger'),
    fs = require('fs'),
    path = require('path'),
    exec = require('child_process').exec,
    AdmZip = require('adm-zip'),
    osType = require('os').type(),
    _ = require('underscore'),
    Args = require("vargs").Constructor;

exports.unzipFile = function (zipPath, cb) {
  logger.debug("Unzipping " + zipPath);
  exports.testZipArchive(zipPath, function (err, valid) {
    if (valid) {
      if (exports.isWindows()) {
        var zip = new AdmZip(zipPath);
        zip.extractAllTo(path.dirname(zipPath), true);
        logger.debug("Unzip successful");
        cb(null, null);
      } else {
        var execOpts = {cwd: path.dirname(zipPath), maxBuffer: 524288};
        exec('unzip -o ' + zipPath, execOpts, function (err, stderr, stdout) {
          if (!err) {
            logger.debug("Unzip successful");
            cb(null, stderr);
          } else {
            logger.error("Unzip threw error " + err);
            logger.error("Stderr: " + stderr);
            logger.error("Stdout: " + stdout);
            cb("Archive could not be unzipped, check appium logs.", null);
          }
        });
      }
    } else {
      cb(err, null);
    }
  });
};

exports.testZipArchive = function (zipPath, cb) {
  logger.debug("Testing zip archive: " + zipPath);
  if (exports.isWindows()) {
    if (fs.existsSync(zipPath)) {
      logger.debug("Zip archive tested clean");
      cb(null, true);
    } else {
      cb("Zip archive was not found.", false);
    }
  } else {
    var execOpts = {cwd: path.dirname(zipPath)};
    exec("unzip -tq " + zipPath, execOpts, function (err, stderr, stdout) {
      if (!err) {
        if (/No errors detected/.exec(stderr)) {
          logger.debug("Zip archive tested clean");
          cb(null, true);
        } else {
          logger.error("Zip file " + zipPath + " was not valid");
          logger.error("Stderr: " + stderr);
          logger.error("Stdout: " + stdout);
          cb("Zip archive did not test successfully, check appium server logs " +
             "for output", false);
        }
      } else {
        logger.error("Test zip archive threw error " + err);
        logger.error("Stderr: " + stderr);
        logger.error("Stdout: " + stdout);
        cb("Error testing zip archive, are you sure this is a zip file? " + err, null);
      }
    });
  }
};

exports.isWindows = function () {
  return osType === 'Windows_NT';
};

exports.getAndroidPlatform = function () {
  var androidHome = process.env.ANDROID_HOME;
  if (typeof androidHome !== "string") {
    logger.error("ANDROID_HOME was not exported!");
    return null;
  }

  var locs = ['android-4.2', 'android-17', 'android-4.3', 'android-18',
      'android-4.4', 'android-19', 'android-L', 'android-20', 'android-5.0',
      'android-21'];
  var res = null;
  _.each(locs.reverse(), function (loc) {
    var platforms = path.resolve(androidHome, 'platforms')
    , platform = loc;
    if (res === null && fs.existsSync(path.resolve(platforms, platform))) {
      res = [platform, path.resolve(platforms, platform)];
    }
  });
  return res;
};

exports.getDirectories = function (rootPath) {
  var files = fs.readdirSync(rootPath);
  var dirs = [];
  _.each(files, function (file) {
      var pathString = path.resolve(rootPath, file);
      if (fs.lstatSync(pathString).isDirectory()) dirs.push(file);
  }.bind(this));
  // It is not a clean way to sort it, but in this case would work fine because we have numerics and alphanumeric
  // will return some thing like this ["17.0.0", "18.0.1", "19.0.0", "19.0.1", "19.1.0", "20.0.0", "android-4.2.2", "android-4.3", "android-4.4"]
  return dirs.sort();
};

/*
 * Checks mShowingLockscreen in dumpsys output to determine if lock screen is showing
 */
exports.isShowingLockscreen = function (dumpsys) {
  var m = /mShowingLockscreen=\w+/gi.exec(dumpsys);
  var ret = (m && m.length && m[0].split('=')[1] === 'true') || false;
  return ret;
};

/*
 * Checks mCurrentFocus in dumpsys output to determine if Keyguard is activated
 */
exports.isCurrentFocusOnKeyguard = function (dumpsys) {
  var m = /mCurrentFocus.+Keyguard/gi.exec(dumpsys);
  return (m && m.length && m[0]) ? true : false;
};

/*
 * Checks mScreenOnFully in dumpsys output to determine if screen is showing
 * Default is true
 */
exports.isScreenOnFully = function (dumpsys) {
  var m = /mScreenOnFully=\w+/gi.exec(dumpsys);
  return !m || // if information is missing we assume screen is fully on
    (m && m.length > 0 && m[0].split('=')[1] === 'true') || false;
};

exports.getActivityRelativeName = function (pkgName, activityRelativeName) {
  var relativeName = activityRelativeName;

  // need to beware of namespaces with overlapping chars:
  //   com.foo.bar
  //   com.foo.barx
  if (activityRelativeName.indexOf(pkgName + ".") === 0) {
    relativeName = activityRelativeName.substring(pkgName.length);
  }

  return relativeName;
};

var wrapForExec = function (s) {
  // not a string
  if (typeof s !== 'string') return s;
  // already wrapped
  if (s.match(/^['"].*['"]$/)) return s;
  // wrap if necessary;
  if (s.match(/[\s"]/)) {
    // escape quote
    s = s.replace(/"/g, '\\"');
    return '"' + s + '"';
  }
  return s;
};
exports.wrapForExec = wrapForExec;

exports.prettyExec = function (/*cmd, args, opts, cb*/) {
  var vargs = new Args(arguments);

  var cmdOpts = vargs.all[2] || {};
  var wrapArgs = cmdOpts.wrapArgs === false ? false : true;
  delete cmdOpts.wrapArgs;
  if (_.isEmpty(cmdOpts)) cmdOpts = undefined;

  var cmd = wrapForExec(vargs.all[0]);

  var cmdArgs = _(vargs.all[1]).map(function (arg) {
    return wrapArgs ? wrapForExec(arg) : arg;
  });

  var fullCmd = [cmd].concat(cmdArgs).join(' ');

  logger.debug("executing cmd: " + fullCmd);
  exec.call(null, fullCmd, cmdOpts, vargs.callback);
};

