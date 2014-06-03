"use strict";

var logger = require('./logger'),
    fs = require('fs'),
    path = require('path'),
    exec = require('child_process').exec,
    AdmZip = require('adm-zip'),
    osType = require('os').type();

exports.unzipFile = function (zipPath, cb) {
  logger.info("Unzipping " + zipPath);
  exports.testZipArchive(zipPath, function (err, valid) {
    if (valid) {
      if (exports.isWindows()) {
        var zip = new AdmZip(zipPath);
        zip.extractAllTo(path.dirname(zipPath), true);
        logger.info("Unzip successful");
        cb(null, null);
      } else {
        var execOpts = {cwd: path.dirname(zipPath), maxBuffer: 524288};
        exec('unzip -o ' + zipPath, execOpts, function (err, stderr, stdout) {
          if (!err) {
            logger.info("Unzip successful");
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
  logger.info("Testing zip archive: " + zipPath);
  if (exports.isWindows()) {
    if (fs.existsSync(zipPath)) {
      logger.info("Zip archive tested clean");
      cb(null, true);
    } else {
      cb("Zip archive was not found.", false);
    }
  } else {
    var execOpts = {cwd: path.dirname(zipPath)};
    exec("unzip -tq " + zipPath, execOpts, function (err, stderr, stdout) {
      if (!err) {
        if (/No errors detected/.exec(stderr)) {
          logger.info("Zip archive tested clean");
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
