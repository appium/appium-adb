"use strict";

var spawn = require('child_process').spawn
  , exec = require('child_process').exec
  , path = require('path')
  , fs = require('fs')
  , net = require('net')
  , mkdirp = require('mkdirp')
  , logger = require('./logger')
  , async = require('async')
  , ncp = require('ncp')
  , _ = require('underscore')
  , helpers = require('./helpers')
  , unzipFile = helpers.unzipFile
  , testZipArchive = helpers.testZipArchive
  , AdmZip = require('adm-zip')
  , rimraf = require('rimraf')
  , Logcat = require('./logcat')
  , isWindows = helpers.isWindows()
  , temp = require('temp')
  , mv = require('mv')
  , helperJarPath = path.resolve(__dirname, '../jars')
  , logger = require('./logger')
  , getDirectories = helpers.getDirectories;

var ADB = function (opts) {
  if (!opts) {
    opts = {};
  }
  if (typeof opts.sdkRoot === "undefined") {
    opts.sdkRoot = process.env.ANDROID_HOME || '';
  }
  this.sdkRoot = opts.sdkRoot;
  this.udid = opts.udid;
  this.appDeviceReadyTimeout = opts.appDeviceReadyTimeout;
  this.useKeystore = opts.useKeystore;
  this.keystorePath = opts.keystorePath;
  this.keystorePassword = opts.keystorePassword;
  this.keyAlias = opts.keyAlias;
  this.keyPassword = opts.keyPassword;
  this.adb = {path: "adb", defaultArgs:[]};
  this.tmpDir = opts.tmpDir;
  if (opts.remoteAdbHost) {
    this.adb.defaultArgs.push("-H", opts.remoteAdbHost);
  }
  if (opts.remoteAdbPort) {
    this.adb.defaultArgs.push("-P", opts.remoteAdbPort);
  }
  this.curDeviceId = null;
  this.emulatorPort = null;
  this.logcat = null;
  this.binaries = {};
  this.instrumentProc = null;
};

// exposing logger and jars
ADB.logger = logger;
ADB.jars = {};
_(['move_manifest.jar', 'sign.jar', 'appium_apk_tools.jar', 'unsign.jar',
  'verify.jar']).each(function (jarName) {
    ADB.jars[jarName] = path.resolve(__dirname, '../jars', jarName);
  });

ADB.prototype.checkSdkBinaryPresent = function (binary, cb) {
  logger.debug("Checking whether " + binary + " is present");
  var binaryLoc = null;
  var binaryName = binary;
  var cmd = "which";
  if (isWindows) {
    if (binaryName === "android") {
      binaryName += ".bat";
    } else {
      if (binaryName.indexOf(".exe", binaryName.length - 4) === -1) {
        binaryName += ".exe";
      }
    }
    cmd = "where";
  }
  if (this.sdkRoot) {
    var binaryLocs = [ path.resolve(this.sdkRoot, "platform-tools", binaryName)
      , path.resolve(this.sdkRoot, "tools", binaryName) ];
    // get subpaths for currently installed build tool directories
    var buildToolDirs = getDirectories(path.resolve(this.sdkRoot, "build-tools"));

    _.each(buildToolDirs, function (versionDir) {
      binaryLocs.push(path.resolve(this.sdkRoot, "build-tools", versionDir, binaryName));
    }.bind(this));

    _.each(binaryLocs, function (loc) {
      if (fs.existsSync(loc)) binaryLoc = loc;
    });

    if (binaryLoc === null) {
      cb(new Error("Could not find " + binary + " in tools, platform-tools, " +
                   "or supported build-tools under \"" + this.sdkRoot + "\"; " +
                   "do you have the Android SDK installed at this location?"));
      return;
    }
    logger.debug("Using " + binary + " from " + binaryLoc);
    binaryLoc = '"' + binaryLoc.trim() + '"';
    this.binaries[binary] = binaryLoc;
    cb(null, binaryLoc);
  } else {
    logger.warn("The ANDROID_HOME environment variable is not set to the Android SDK root directory path. " +
                "ANDROID_HOME is required for compatibility with SDK 23+. Checking along PATH for " + binary + ".");
    exec(cmd + " " + binary, { maxBuffer: 524288 }, function (err, stdout) {
      if (stdout) {
        logger.debug("Using " + binary + " from " + stdout);
        this.binaries[binary] = '"' + stdout.trim() + '"';
        cb(null, this.binaries[binary]);
      } else {
        cb(new Error("Could not find " + binary + ". Please set the ANDROID_HOME " +
                     "environment variable with the Android SDK root directory path."));
      }
    }.bind(this));
  }
};

ADB.prototype.checkAdbPresent = function (cb) {
  this.checkSdkBinaryPresent("adb", function (err, binaryLoc) {
    if (err) return cb(err);
    this.adb.path = binaryLoc.trim().replace(/"/g, '');
    cb(null, this.adb);
  }.bind(this));
};

ADB.prototype.checkAaptPresent = function (cb) {
  this.checkSdkBinaryPresent("aapt", cb);
};

ADB.prototype.checkZipAlignPresent = function (cb) {
  this.checkSdkBinaryPresent("zipalign", cb);
};

ADB.prototype.exec = function (cmd, opts, cb) {
  if (!cb && typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  if (!cmd) {
    return cb(new Error("You need to pass in a command to exec()"));
  }
  cmd = [this.adb.path].concat(this.adb.defaultArgs).join(" ") + " " + cmd;
  logger.debug("executing: " + cmd);
  opts = _.defaults(opts, {maxBuffer: 524288});
  var retryNum = 2;
  async.retry(retryNum, function (_cb) {
    exec(cmd, opts, function (err, stdout, stderr) {
      var linkerWarningRe = /^WARNING: linker.+$/m;
      // sometimes ADB prints out stupid stdout warnings that we don't want
      // to include in any of the response data, so let's strip it out
      stdout = stdout.replace(linkerWarningRe, '').trim();
      if (err) {
        var protocolFaultError = new RegExp("protocol fault \\(no status\\)", "i").test(stderr);
        var deviceNotFoundError = new RegExp("error: device not found", "i").test(stderr);
        if (protocolFaultError || deviceNotFoundError) {
          logger.info("error sending command, reconnecting device and retrying: " + cmd);
          return setTimeout(function () {
            this.getDevicesWithRetry(function (err, devices) {
              if (err) return _cb(new Error("Reconnect failed, devices are: " + devices));
              _cb(new Error(stderr)); // we've reconnected, so get back into the retry loop
            });
          }.bind(this), 1000);
        }
        return cb(err); // shortcut retry and fall out since we have a non-recoverable error
      } else {
        cb(null, stdout, stderr); // shortcut retry and respond with success
      }
    }.bind(this));
  }.bind(this), function (err) {
    if (err) return cb(err); // if we retry too many times, we'll get the error here, the success case is handled in the retry loop
  });
};

ADB.prototype.shell = function (cmd, cb) {
  if (cmd.indexOf('"') === -1) {
    cmd = '"' + cmd + '"';
  }
  var execCmd = 'shell ' + cmd;
  this.exec(execCmd, cb);
};

ADB.prototype.spawn = function (args) {
  logger.debug("spawning: " + [this.adb.path].concat(this.adb.defaultArgs, args).join(" "));
  return spawn(this.adb.path, this.adb.defaultArgs.concat(args));
};

// android:process= may be defined in AndroidManifest.xml
// http://developer.android.com/reference/android/R.attr.html#process
// note that the process name when used with ps must be truncated to the last 15 chars
// ps -c com.example.android.apis becomes ps -c le.android.apis
ADB.prototype.processFromManifest = function (localApk, cb) {
  this.checkAaptPresent(function (err) {
    if (err) return cb(err);

    var extractProcess = [this.binaries.aapt, 'dump', 'xmltree', '"' + localApk + '"', 'AndroidManifest.xml'].join(' ');
    logger.debug("processFromManifest: " + extractProcess);
    exec(extractProcess, { maxBuffer: 524288 }, function (err, stdout, stderr) {
      if (err || stderr) {
        logger.warn(stderr);
        return cb(new Error("processFromManifest failed. " + err));
      }

      var result = null;
      var lines = stdout.split("\n");
      var applicationRegex = new RegExp(/\s+E: application \(line=\d+\).*/);
      var applicationFound = false;
      var attributeRegex = new RegExp(/\s+A: .+/);
      var processRegex = new RegExp(/\s+A: android:process\(0x01010011\)="([^"]+).*"/);
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];

        if (!applicationFound) {
          if (applicationRegex.test(line)) {
            applicationFound = true;
          }
        } else {
          var notAttribute = !attributeRegex.test(line);
          // process must be an attribute after application.
          if (notAttribute) {
            break;
          }

          var process = processRegex.exec(line);
          // this is an application attribute process.
          if (process && process.length > 1) {
            result = process[1];
            // must trim to last 15 for android's ps binary
            if (result.length > 15) result = result.substr(result.length - 15);
            break;
          }
        }
      }

      cb(null, result);
    });
  }.bind(this));
};

ADB.prototype.packageAndLaunchActivityFromManifest = function (localApk, cb) {
  this.checkAaptPresent(function (err) {
    if (err) return cb(err);
    localApk = '"' + localApk + '"'; // add quotes in case there are spaces

    var badging = [this.binaries.aapt, 'dump', 'badging', localApk].join(' ');
    logger.debug("packageAndLaunchActivityFromManifest: " + badging);
    exec(badging, { maxBuffer: 524288 }, function (err, stdout, stderr) {
      if (err || stderr) {
        logger.warn(stderr);
        return cb(new Error("packageAndLaunchActivityFromManifest failed. " + err));
      }

      var apkPackage = new RegExp(/package: name='([^']+)'/g).exec(stdout);
      if (apkPackage && apkPackage.length >= 2) {
        apkPackage = apkPackage[1];
      } else {
        apkPackage = null;
      }
      var apkActivity = new RegExp(/launchable-activity: name='([^']+)'/g).exec(stdout);
      if (apkActivity && apkActivity.length >= 2) {
        apkActivity = apkActivity[1];
      } else {
        apkActivity = null;
      }
      logger.debug("badging package: " + apkPackage);
      logger.debug("badging act: " + apkActivity);

      cb(null, apkPackage, apkActivity);
    });
  }.bind(this));
};

ADB.prototype.processExists = function (processName, cb) {
  if (!this.isValidClass(processName)) return cb(new Error("Invalid process name: " + processName));

  this.shell("ps", function (err, out) {
    if (err) return cb(err);
    var exists = _.find(out.split(/\r?\n/), function (line) {
      line = line.trim().split(/\s+/);
      var pkgColumn = line[line.length - 1];
      if (pkgColumn && pkgColumn.indexOf(processName) !== -1) {
        return pkgColumn;
      }
    });
    exists = exists ? true : false;
    logger.debug("process: " + processName + " exists:" + exists);
    cb(null, exists);
  });
};

ADB.prototype.compileManifest = function (manifest, manifestPackage,
    targetPackage, cb) {
  logger.debug("Compiling manifest " + manifest);

  var platform = helpers.getAndroidPlatform();
  if (!platform || !platform[1]) {
    return cb(new Error("Required platform doesn't exist (API level >= 17)"));
  }

  // Compile manifest into manifest.xml.apk
  var compileManifest = [this.binaries.aapt + ' package -M "', manifest + '"',
                         ' --rename-manifest-package "',
                         manifestPackage + '"',
                         ' --rename-instrumentation-target-package "',
                         targetPackage + '"', ' -I "',
                         path.resolve(platform[1], 'android.jar') + '" -F "',
                         manifest, '.apk" -f'].join('');
  logger.debug(compileManifest);
  exec(compileManifest, { maxBuffer: 524288 }, function (err, stdout, stderr) {
    if (err) {
      logger.debug(stderr);
      return cb("error compiling manifest");
    }
    logger.debug("Compiled manifest");
    cb();
  });
};

ADB.prototype.insertManifest = function (manifest, srcApk, dstApk, cb) {
  logger.debug("Inserting manifest, src: " + srcApk + ", dst: " + dstApk);
  var extractManifest = function (cb) {
    logger.debug("Extracting manifest");
    // Extract compiled manifest from manifest.xml.apk
    unzipFile(manifest + '.apk', function (err, stderr) {
      if (err) {
        logger.debug("Error unzipping manifest apk, here's stderr:");
        logger.debug(stderr);
        return cb(err);
      }
      cb();
    });
  };

  var createTmpApk = function (cb) {
    logger.debug("Writing tmp apk. " + srcApk + ' to ' + dstApk);
    ncp(srcApk, dstApk, cb);
  };

  var testDstApk = function (cb) {
    logger.debug("Testing new tmp apk.");
    testZipArchive(dstApk, cb);
  };

  var moveManifest = function (cb) {
    if (isWindows) {
      var java = path.resolve(process.env.JAVA_HOME, 'bin', 'java');
      java = isWindows ? '"' + java + '.exe"' : '"' + java + '"';
      var moveManifestCmd = '"' + path.resolve(helperJarPath,
          'move_manifest.jar') + '"';
      moveManifestCmd = [java, '-jar', moveManifestCmd,
        '"' + dstApk + '"',
        '"' + manifest + '"'].join(' ');

      logger.debug("Moving manifest with: " + moveManifestCmd);
      exec(moveManifestCmd, { maxBuffer: 524288 }, function (err) {
        if (err) {
          logger.debug("Got error moving manifest: " + err);
          return cb(err);
        }
        logger.debug("Inserted manifest.");
        cb(null);
      });
    } else {
      // Insert compiled manifest into /tmp/appPackage.clean.apk
      // -j = keep only the file, not the dirs
      // -m = move manifest into target apk.
      var replaceCmd = 'zip -j -m "' + dstApk + '" "' + manifest + '"';
      logger.debug("Moving manifest with: " + replaceCmd);
      exec(replaceCmd, { maxBuffer: 524288 }, function (err) {
        if (err) {
          logger.debug("Got error moving manifest: " + err);
          return cb(err);
        }
        logger.debug("Inserted manifest.");
        cb();
      });
    }
  };

  async.series([
    function (cb) { extractManifest(cb); },
    function (cb) { createTmpApk(cb); },
    function (cb) { testDstApk(cb); },
    function (cb) { moveManifest(cb); }
  ], cb);
};

ADB.prototype.signWithDefaultCert = function (apk, cb) {
  var signPath = path.resolve(helperJarPath, 'sign.jar');
  var resign = 'java -jar "' + signPath + '" "' + apk + '" --override';
  logger.debug("Resigning apk with: " + resign);
  exec(resign, { maxBuffer: 524288 }, function (err, stdout, stderr) {
    if (stderr.indexOf("Input is not an existing file") !== -1) {
      logger.warn("Could not resign apk, got non-existing file error");
      return cb(new Error("Could not sign apk. Are you sure " +
                          "the file path is correct: " +
                          JSON.stringify(apk)));
    }
    cb(err);
  });
};

ADB.prototype.signWithCustomCert = function (apk, cb) {
  var jarsigner = path.resolve(process.env.JAVA_HOME, 'bin', 'jarsigner');
  jarsigner = isWindows ? '"' + jarsigner + '.exe"' : '"' + jarsigner + '"';
  var java = path.resolve(process.env.JAVA_HOME, 'bin', 'java');
  java = isWindows ? '"' + java + '.exe"' : '"' + java + '"';
  var unsign = '"' + path.resolve(helperJarPath, 'unsign.jar') + '"';
  unsign = [java, '-jar', unsign, '"' + apk + '"'].join(' ');

  if (!fs.existsSync(this.keystorePath)) {
    return cb(new Error("Keystore doesn't exist. " + this.keystorePath));
  }

  var sign = [jarsigner,
      '-sigalg MD5withRSA',
      '-digestalg SHA1',
      '-keystore "' + this.keystorePath + '"',
      '-storepass "' + this.keystorePassword + '"',
      '-keypass "' + this.keyPassword + '"',
      '"' + apk + '"',
      '"' + this.keyAlias + '"'].join(' ');
  logger.debug("Unsigning apk with: " + unsign);
  exec(unsign, { maxBuffer: 524288 }, function (err, stdout, stderr) {
    if (err || stderr) {
      logger.warn(stderr);
      return cb(new Error("Could not unsign apk. Are you sure " +
                          "the file path is correct: " +
                          JSON.stringify(apk)));
    }
    logger.debug("Signing apk with: " + sign);
    exec(sign, { maxBuffer: 524288 }, function (err, stdout, stderr) {
      if (err || stderr) {
        logger.warn(stderr);
        return cb(new Error("Could not sign apk. Are you sure " +
                            "the file path is correct: " +
                            JSON.stringify(apk)));
      }
      cb(err);
    });
  });
};

ADB.prototype.sign = function (apk, cb) {
  async.series([
    function (cb) {
      if (this.useKeystore) {
        this.signWithCustomCert(apk, cb);
      } else {
        this.signWithDefaultCert(apk, cb);
      }
    }.bind(this),
    function (cb) { this.zipAlignApk(apk, cb); }.bind(this),
  ], cb);
};

ADB.prototype.zipAlignApk = function (apk, cb) {
  logger.debug("Zip-aligning " + apk);
  this.checkZipAlignPresent(function (err) {
    if (err) return cb(err);

    var alignedApk = temp.path({prefix: 'appium', suffix: '.tmp'});
    mkdirp.sync(path.dirname(alignedApk));

    var alignApk = [this.binaries.zipalign, '-f', '4', '"' + apk + '"', '"' + alignedApk + '"'].join(' ');
    logger.debug("zipAlignApk: " + alignApk);
    exec(alignApk, { maxBuffer: 524288 }, function (err, stdout, stderr) {
      if (err || stderr) {
        logger.warn(stderr);
        return cb(new Error("zipAlignApk failed. " + err));
      }

      mv(alignedApk, apk, { mkdirp: true }, cb);
    });
  }.bind(this));
};

// returns true when already signed, false otherwise.
ADB.prototype.checkApkCert = function (apk, pkg, cb) {
  if (!fs.existsSync(apk)) {
    logger.debug("APK doesn't exist. " + apk);
    return cb(null, false);
  }

  if (this.useKeystore) {
    return this.checkCustomApkCert(apk, pkg, cb);
  }

  var verifyPath = path.resolve(helperJarPath, 'verify.jar');
  var resign = 'java -jar "' + verifyPath + '" "' + apk + '"';
  logger.debug("Checking app cert for " + apk + ": " + resign);
  exec(resign, { maxBuffer: 524288 }, function (err) {
    if (err) {
      logger.debug("App not signed with debug cert.");
      return cb(null, false);
    }
    logger.debug("App already signed.");
    this.zipAlignApk(apk, function (err) {
      if (err) return cb(err);
      cb(null, true);
    });

  }.bind(this));
};

ADB.prototype.checkCustomApkCert = function (apk, pkg, cb) {
  var h = "a-fA-F0-9";
  var md5Str = ['.*MD5.*((?:[', h, ']{2}:){15}[', h, ']{2})'].join('');
  var md5 = new RegExp(md5Str, 'mi');
  var keytool = path.resolve(process.env.JAVA_HOME, 'bin', 'keytool');
  keytool = isWindows ? '"' + keytool + '.exe"' : '"' + keytool + '"';

  this.getKeystoreMd5(keytool, md5, function (err, keystoreHash) {
    if (err) return cb(err);
    this.checkApkKeystoreMatch(keytool, md5, keystoreHash, pkg, apk, cb);
  }.bind(this));
};

ADB.prototype.getKeystoreMd5 = function (keytool, md5re, cb) {
  var keystoreHash;
  var keystore = [keytool, '-v', '-list',
      '-alias "' + this.keyAlias + '"',
      '-keystore "' + this.keystorePath + '"',
      '-storepass "' + this.keystorePassword + '"'].join(' ');
  logger.debug("Printing keystore md5: " + keystore);
  exec(keystore, { maxBuffer: 524288 }, function (err, stdout) {
    if (err) return cb(err);
    keystoreHash = md5re.exec(stdout);
    keystoreHash = keystoreHash ? keystoreHash[1] : null;
    logger.debug('Keystore MD5: ' + keystoreHash);
    cb(null, keystoreHash);
  });
};

ADB.prototype.checkApkKeystoreMatch = function (keytool, md5re, keystoreHash,
    pkg, apk, cb) {
  var entryHash = null;
  var zip = new AdmZip(apk);
  var rsa = /^META-INF\/.*\.[rR][sS][aA]$/;
  var entries = zip.getEntries();
  var numEntries = entries.length;
  var responded = false;
  var examined = 0;

  var onExamine = function (err, matched) {
    examined++;
    if (!responded) {
      if (err) {
        responded = true;
        return cb(err);
      } else if (matched) {
        responded = true;
        return cb(null, true);
      } else if (examined === numEntries) {
        responded = true;
        return cb(null, false);
      }
    }
  };

  var checkMd5 = function (err, stdout) {
    if (responded) return;
    entryHash = md5re.exec(stdout);
    entryHash = entryHash ? entryHash[1] : null;
    logger.debug('entryHash MD5: ' + entryHash);
    logger.debug(' keystore MD5: ' + keystoreHash);
    var matchesKeystore = entryHash && entryHash === keystoreHash;
    logger.debug('Matches keystore? ' + matchesKeystore);
    onExamine(null, matchesKeystore);
  };

  while (entries.length > 0) {
    if (responded) break;
    var entry = entries.pop(); // meta-inf tends to be at the end
    entry = entry.entryName;
    if (!rsa.test(entry)) {
      onExamine(null, false);
      continue;
    }
    logger.debug("Entry: " + entry);
    var entryPath = path.join(this.tmpDir, pkg, 'cert');
    logger.debug("entryPath: " + entryPath);
    var entryFile = path.join(entryPath, entry);
    logger.debug("entryFile: " + entryFile);
    // ensure /tmp/pkg/cert/ doesn't exist or extract will fail.
    rimraf.sync(entryPath);
    // META-INF/CERT.RSA
    zip.extractEntryTo(entry, entryPath, true); // overwrite = true
    logger.debug("extracted!");
    // check for match
    var md5Entry = [keytool, '-v', '-printcert', '-file', entryFile].join(' ');
    logger.debug("Printing apk md5: " + md5Entry);
    exec(md5Entry, { maxBuffer: 524288 }, checkMd5);
  }
};

ADB.prototype.getDevicesWithRetry = function (timeoutMs, cb) {
  if (typeof timeoutMs === "function") {
    cb = timeoutMs;
    timeoutMs = 20000;
  }
  var start = Date.now();
  logger.debug("Trying to find a connected android device");
  var error = new Error("Could not find a connected Android device.");
  var getDevices = function () {
    this.getConnectedDevices(function (err, devices) {
      if (err || devices.length < 1) {
        if ((Date.now() - start) > timeoutMs) {
          cb(error);
        } else {
          logger.debug("Could not find devices, restarting adb server...");
          setTimeout(function () {
            this.restartAdb(function () {
              getDevices();
            }.bind(this));
          }.bind(this), 1000);
        }
      } else {
        cb(null, devices);
      }
    }.bind(this));
  }.bind(this);
  getDevices();
};

ADB.prototype.getApiLevel = function (cb) {
  logger.debug("Getting device API level");
  this.shell("getprop ro.build.version.sdk", function (err, stdout) {
    if (err) {
      logger.warn(err);
      cb(err);
    } else {
      logger.debug("Device is at API Level " + stdout.trim());
      cb(null, stdout);
    }
  });
};

ADB.prototype.getEmulatorPort = function (cb) {
  logger.debug("Getting running emulator port");
  if (this.emulatorPort !== null) {
    return cb(null, this.emulatorPort);
  }
  this.getConnectedDevices(function (err, devices) {
    if (err || devices.length < 1) {
      cb(new Error("No devices connected"));
    } else {
      // pick first device
      var port = this.getPortFromEmulatorString(devices[0].udid);
      if (port) {
        cb(null, port);
      } else {
        cb(new Error("Emulator port not found"));
      }
    }
  }.bind(this));
};

ADB.prototype.rimraf = function (path, cb) {
  this.shell('rm -rf ' + path, cb);
};

ADB.prototype.push = function (localPath, remotePath, cb) {
  try {
    localPath = JSON.parse(localPath);
  } catch (e) { }
  localPath = JSON.stringify(localPath);
  this.exec('push ' + localPath + ' ' + remotePath, cb);
};

ADB.prototype.pull = function (remotePath, localPath, cb) {
  try {
    localPath = JSON.parse(localPath);
  } catch (e) { }
  localPath = JSON.stringify(localPath);
  this.exec('pull ' + remotePath + ' ' + localPath, cb);
};

ADB.prototype.getPortFromEmulatorString = function (emStr) {
  var portPattern = /emulator-(\d+)/;
  if (portPattern.test(emStr)) {
    return parseInt(portPattern.exec(emStr)[1], 10);
  }
  return false;
};

ADB.prototype.getRunningAVD = function (avdName, cb) {
  logger.debug("Trying to find " + avdName + " emulator");
  this.getConnectedEmulators(function (err, emulators) {
    if (err || emulators.length < 1) {
      return cb(new Error("No emulators connected"), null);
    } else {
      async.forEach(emulators, function (emulator, asyncCb) {
        this.setEmulatorPort(emulator.port);
        this.sendTelnetCommand("avd name", function (err, runningAVDName) {
          if (avdName === runningAVDName) {
            logger.debug("Found emulator " + avdName + " in port " + emulator.port);
            this.setDeviceId(emulator.udid);
            return cb(null, emulator);
          }
          asyncCb();
        }.bind(this));
      }.bind(this), function (err) {
        logger.debug("Emulator " + avdName + " not running");
        cb(err, null);
      });
    }
  }.bind(this));
};

ADB.prototype.getRunningAVDWithRetry = function (avdName, timeoutMs, cb) {
  var start = Date.now();
  var error = new Error("Could not find " + avdName + " emulator.");
  var getAVD = function () {
    this.getRunningAVD(avdName.replace('@', ''), function (err, runningAVD) {
      if (err || runningAVD === null) {
        if ((Date.now() - start) > timeoutMs) {
          cb(error);
        } else {
          setTimeout(function () {
            getAVD();
          }.bind(this), 2000);
        }
      } else {
        cb();
      }
    }.bind(this));
  }.bind(this);
  getAVD();
};

ADB.prototype.killAllEmulators = function (cb) {
  var killallCmd = isWindows ?
    "TASKKILL /IM emulator.exe" :
    "/usr/bin/killall -m emulator*";
  exec(killallCmd, { maxBuffer: 524288 }, function (err) {
    if (err) {
      logger.debug("Could not kill emulator. It was probably not running.: " +
        err.message);
    }
    cb();
  });
};

ADB.prototype.launchAVD = function (avdName, avdArgs, language, locale, avdLaunchTimeout,
    avdReadyTimeout, cb, retry) {
  if (typeof retry === "undefined") {
    retry = 0;
  }
  logger.debug("Launching Emulator with AVD " + avdName + ", launchTimeout " +
              avdLaunchTimeout + "ms and readyTimeout " + avdReadyTimeout +
              "ms");
  this.checkSdkBinaryPresent("emulator", function (err, emulatorBinaryPath) {
    if (err) return cb(err);

    if (avdName[0] === "@") {
      avdName = avdName.substr(1);
    }

    var launchArgs = ["-avd", avdName];
    if (typeof language === "string") {
      logger.debug("Setting Android Device Language to " + language);
      launchArgs.push("-prop", "persist.sys.language=" + language.toLowerCase());
    }
    if (typeof locale === "string") {
      logger.debug("Setting Android Device Country to " + locale);
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

ADB.prototype.waitForEmulatorReady = function (timeoutMs, cb) {
  var start = Date.now();
  var error = new Error("Emulator is not ready.");
  logger.debug("Waiting until emulator is ready");
  var getBootAnimStatus = function () {
    this.shell("getprop init.svc.bootanim", function (err, stdout) {
      if (err || stdout === null || stdout.indexOf('stopped') !== 0) {
        if ((Date.now() - start) > timeoutMs) {
          cb(error);
        } else {
          setTimeout(function () {
            getBootAnimStatus();
          }.bind(this), 3000);
        }
      } else {
        cb();
      }
    }.bind(this));
  }.bind(this);
  getBootAnimStatus();
};

ADB.prototype.getConnectedDevices = function (cb) {
  logger.debug("Getting connected devices...");
  this.exec("devices", function (err, stdout) {
    if (err) return cb(err);
    if (stdout.toLowerCase().indexOf("error") !== -1) {
      logger.error(stdout);
      cb(new Error(stdout));
    } else {
      var devices = [];
      _.each(stdout.split("\n"), function (line) {
        if (line.trim() !== "" &&
            line.indexOf("List of devices") === -1 &&
            line.indexOf("* daemon") === -1 &&
            line.indexOf("offline") === -1) {
          var lineInfo = line.split("\t");
          // state is either "device" or "offline", afaict
          devices.push({udid: lineInfo[0], state: lineInfo[1]});
        }
      });
      logger.debug(devices.length + " device(s) connected");
      cb(null, devices);
    }
  }.bind(this));
};

ADB.prototype.getConnectedEmulators = function (cb) {
  logger.debug("Getting connected emulators");
  this.getConnectedDevices(function (err, devices) {
    if (err) return cb(err);
    var emulators = [];
    _.each(devices, function (device) {
      var port = this.getPortFromEmulatorString(device.udid);
      if (port) {
        device.port = port;
        emulators.push(device);
      }
    }.bind(this));
    logger.debug(emulators.length + " emulator(s) connected");
    cb(null, emulators);
  }.bind(this));
};

ADB.prototype.forwardPort = function (systemPort, devicePort, cb) {
  logger.debug("Forwarding system:" + systemPort + " to device:" + devicePort);
  this.exec("forward tcp:" + systemPort + " tcp:" + devicePort, cb);
};

ADB.prototype.forwardAbstractPort = function (systemPort, devicePort, cb) {
  logger.debug("Forwarding system:" + systemPort + " to abstract device:" + devicePort);
  this.exec("forward tcp:" + systemPort + " localabstract:" + devicePort, cb);
};

ADB.prototype.isDeviceConnected = function (cb) {
  this.getConnectedDevices(function (err, devices) {
    if (err) {
      cb(err);
    } else {
      cb(null, devices.length > 0);
    }
  });
};

/*
 * Check whether the ADB connection is up
 */
ADB.prototype.ping = function (cb) {
  this.shell("echo 'ping'", function (err, stdout) {
    if (!err && stdout.indexOf("ping") === 0) {
      cb(null, true);
    } else if (err) {
      cb(err);
    } else {
      cb(new Error("ADB ping failed, returned: " + stdout));
    }
  });
};

ADB.prototype.setDeviceId = function (deviceId) {
  logger.debug("Setting device id to " + deviceId);
  this.curDeviceId = deviceId;
  this.adb.defaultArgs.push("-s", deviceId);
};

ADB.prototype.setEmulatorPort = function (emPort) {
  this.emulatorPort = emPort;
};

ADB.prototype.waitForDevice = function (cb) {
  var doWait = function (innerCb) {
    logger.debug("Waiting for device to be ready and to respond to shell " +
               "commands (timeout = " + this.appDeviceReadyTimeout + ")");
    var movedOn = false
      , timeoutSecs = parseInt(this.appDeviceReadyTimeout, 10);

    setTimeout(function () {
      if (!movedOn) {
        movedOn = true;
        innerCb("Device did not become ready in " + timeoutSecs + " secs; " +
                "are you sure it's powered on?");
      }
    }.bind(this), timeoutSecs * 1000);

    this.exec("wait-for-device", function (err) {
      if (!movedOn) {
        if (err) {
          logger.error("Error running wait-for-device");
          movedOn = true;
          innerCb(err);
        } else {
          this.shell("echo 'ready'", function (err) {
            if (!movedOn) {
              movedOn = true;
              if (err) {
                logger.error("Error running shell echo: " + err);
                innerCb(err);
              } else {
                innerCb();
              }
            }
          }.bind(this));
        }
      }
    }.bind(this));
  }.bind(this);

  var tries = 0;
  var waitCb = function (err) {
    if (err) {
      var lastCb = cb;
      if (tries < 3) {
        tries++;
        logger.debug("Retrying restartAdb");
        lastCb = waitCb.bind(this);
      }
      this.restartAdb(function () {
        this.getConnectedDevices(function () {
          doWait(lastCb);
        });
      }.bind(this));
    } else {
      cb(null);
    }
  };
  doWait(waitCb.bind(this));
};

ADB.prototype.restartAdb = function (cb) {
  this.exec("kill-server", function (err) {
    if (err) {
      logger.error("Error killing ADB server, going to see if it's online " +
                   "anyway");
    }
    cb();
  });
};


ADB.prototype.restart = function (cb) {
  async.series([
    this.stopLogcat.bind(this)
    , this.restartAdb.bind(this)
    , this.waitForDevice.bind(this)
    , this.startLogcat.bind(this)
  ], cb);
};

ADB.prototype.startLogcat = function (cb) {
  if (this.logcat !== null) {
    cb(new Error("Trying to start logcat capture but it's already started!"));
    return;
  }
  this.logcat = new Logcat({
    adb: this.adb
  , debug: false
  , debugTrace: false
  });
  this.logcat.startCapture(cb);
};

ADB.prototype.stopLogcat = function (cb) {
  if (this.logcat !== null) {
    this.logcat.stopCapture(cb);
    this.logcat = null;
  } else {
    cb();
  }
};

ADB.prototype.getLogcatLogs = function () {
  if (this.logcat === null) {
    throw new Error("Can't get logcat logs since logcat hasn't started");
  }
  return this.logcat.getLogs();
};

ADB.prototype.getPIDsByName = function (name, cb) {
  logger.debug("Getting all processes with '" + name + "'");
  this.shell("ps '" + name + "'", function (err, stdout) {
    if (err) return cb(err);
    stdout = stdout.trim();
    var procs = [];
    var outlines = stdout.split("\n");
    _.each(outlines, function (outline) {
      if (outline.indexOf(name) !== -1) {
        procs.push(outline);
      }
    });
    if (procs.length < 1) {
      logger.debug("No matching processes found");
      return cb(null, []);
    }
    var pids = [];
    _.each(procs, function (proc) {
      var match = /[^\t ]+[\t ]+([0-9]+)/.exec(proc);
      if (match) {
        pids.push(parseInt(match[1], 10));
      }
    });
    if (pids.length !== procs.length) {
      var msg = "Could not extract PIDs from ps output. PIDS: " +
                JSON.stringify(pids) + ", Procs: " + JSON.stringify(procs);
      return cb(new Error(msg));
    }
    cb(null, pids);
  });
};

ADB.prototype.killProcessesByName = function (name, cb) {
  logger.debug("Attempting to kill all '" + name + "' processes");
  this.getPIDsByName(name, function (err, pids) {
    if (err) return cb(err);
    var killNext = function (err) {
      if (err) return cb(err);
      var pid = pids.pop();
      if (typeof pid !== "undefined") {
        this.killProcessByPID(pid, killNext);
      } else {
        cb();
      }
    }.bind(this);
    killNext();
  }.bind(this));
};

ADB.prototype.killProcessByPID = function (pid, cb) {
  logger.debug("Attempting to kill process " + pid);
  this.shell("kill " + pid, cb);
};

var _buildStartCmd = function (startAppOptions, apiLevel) {
  var cmd = "am start ";

  cmd += startAppOptions.stopApp && apiLevel >= 15 ? "-S" : "";

  if (startAppOptions.action) {
    cmd += " -a " + startAppOptions.action;
  }

  if (startAppOptions.category) {
    cmd += " -c " + startAppOptions.category;
  }

  if (startAppOptions.flags) {
    cmd += " -f " + startAppOptions.flags;
  }

  if (startAppOptions.pkg) {
    cmd += " -n " + startAppOptions.pkg + "/" + startAppOptions.activity + startAppOptions.optionalIntentArguments;
  }

  return cmd;
};

ADB.prototype.startApp = function (startAppOptions, cb) {
  startAppOptions = _.clone(startAppOptions);
  // initializing defaults
  _.defaults(startAppOptions, {
      waitPkg: startAppOptions.pkg,
      waitActivity: false,
      optionalIntentArguments: false,
      retry: true,
      stopApp: true
  });
  // preventing null waitpkg
  startAppOptions.waitPkg = startAppOptions.waitPkg || startAppOptions.pkg;
  startAppOptions.optionalIntentArguments = startAppOptions.optionalIntentArguments ? " " + startAppOptions.optionalIntentArguments : "";
  this.getApiLevel(function (err, apiLevel) {
    if (err) return cb(err);

    var cmd = _buildStartCmd(startAppOptions, apiLevel);

    this.shell(cmd, function (err, stdout) {
      if (err) return cb(err);
      if (stdout.indexOf("Error: Activity class") !== -1 &&
          stdout.indexOf("does not exist") !== -1) {
        if (!startAppOptions.activity) {
          return cb(new Error("Parameter 'appActivity' is required for launching application"));
        }
        if (startAppOptions.retry && startAppOptions.activity[0] !== ".") {
          logger.debug("We tried to start an activity that doesn't exist, " +
                       "retrying with . prepended to activity");
          startAppOptions.activity = "." + startAppOptions.activity;
          startAppOptions.retry = false;
          return this.startApp(startAppOptions, cb);
        } else {
          var msg = "Activity used to start app doesn't exist or cannot be " +
                    "launched! Make sure it exists and is a launchable activity";
          logger.error(msg);
          return cb(new Error(msg));
        }
      } else if (stdout.indexOf("java.lang.SecurityException") !== -1) {
        // if the app is disabled on a real device it will throw a security exception
        logger.error("Permission to start activity denied.");
        return cb(new Error("Permission to start activity denied."));
      }

      if (startAppOptions.waitActivity) {
        if (startAppOptions.hasOwnProperty("waitDuration")) {
          this.waitForActivity(startAppOptions.waitPkg, startAppOptions.waitActivity, startAppOptions.waitDuration, cb);
        } else {
          this.waitForActivity(startAppOptions.waitPkg, startAppOptions.waitActivity, cb);
        }
      } else {
        cb();
      }
    }.bind(this));
  }.bind(this));
};

ADB.prototype.isValidClass = function (classString) {
  // some.package/some.package.Activity
  return new RegExp(/^[a-zA-Z0-9\./_]+$/).exec(classString);
};

ADB.prototype.broadcastProcessEnd = function (intent, process, cb) {
  // start the broadcast without waiting for it to finish.
  this.broadcast(intent, function () {});

  // wait for the process to end
  var start = Date.now();
  var timeoutMs = 40000;
  var intMs = 400;

  var waitForDeath = function () {
    this.processExists(process, function (err, exists) {
      if (!exists) {
        cb();
      } else if ((Date.now() - start) < timeoutMs) {
        setTimeout(waitForDeath, intMs);
      } else {
        cb(new Error("Process never died within " + timeoutMs + " ms."));
      }
    });
  }.bind(this);

  waitForDeath();
};

ADB.prototype.broadcast = function (intent, cb) {
  if (!this.isValidClass(intent)) return cb(new Error("Invalid intent " + intent));

  var cmd = "am broadcast -a " + intent;
  logger.debug("Broadcasting: " + cmd);
  this.shell(cmd, cb);
};

ADB.prototype.endAndroidCoverage = function () {
  if (this.instrumentProc) this.instrumentProc.kill();
};

ADB.prototype.androidCoverage = function (instrumentClass, waitPkg, waitActivity, cb) {
  if (!this.isValidClass(instrumentClass)) return cb(new Error("Invalid class " + instrumentClass));
  /*
   [ '/path/to/android-sdk-macosx/platform-tools/adb',
   '-s',
   'emulator-5554',
   'shell',
   'am',
   'instrument',
   '-e',
   'coverage',
   'true',
   '-w',
   'com.example.Pkg/com.example.Pkg.instrumentation.MyInstrumentation' ]
   */
  var args = ('shell am instrument -e coverage true -w ' + instrumentClass).split(' ');
  args = this.adb.defaultArgs.concat(args);
  logger.debug("Collecting coverage data with: " + [this.adb.path].concat(args).join(' '));

  var alreadyReturned = false;
  this.instrumentProc = spawn(this.adb.path, args); // am instrument runs for the life of the app process.
  this.instrumentProc.on('error', function (err) {
    logger.error(err);
    if (!alreadyReturned) {
      alreadyReturned = true;
      return cb(err);
    }
  });
  this.instrumentProc.stderr.on('data', function (data) {
    if (!alreadyReturned) {
      alreadyReturned = true;
      return cb(new Error("Failed to run instrumentation: " + new Buffer(data).toString('utf8')));
    }
  });
  this.waitForActivity(waitPkg, waitActivity, function (err) {
    if (!alreadyReturned) {
      alreadyReturned = true;
      return cb(err);
    }
  });
};

ADB.prototype.getFocusedPackageAndActivity = function (cb) {
  logger.debug("Getting focused package and activity");
  var cmd = "dumpsys window windows"
    , nullRe = new RegExp(/mFocusedApp=null/)
    , searchRe = new RegExp(
      /mFocusedApp.+Record\{.*\s([^\s\/\}]+)\/([^\s\/\}]+)(\s[^\s\/\}]+)*\}/);

  this.shell(cmd, function (err, stdout) {
    if (err) return cb(err);
    var foundMatch = false;
    var foundNullMatch = false;
    _.each(stdout.split("\n"), function (line) {
      var match = searchRe.exec(line);
      if (match) {
        foundMatch = match;
      } else if (nullRe.test(line)) {
        foundNullMatch = true;
      }
    });
    if (foundMatch) {
      cb(null, foundMatch[1].trim(), foundMatch[2].trim());
    } else if (foundNullMatch) {
      cb(null, null, null);
    } else {
      var msg = "Could not parse activity from dumpsys";
      logger.error(msg);
      logger.debug(stdout);
      cb(new Error(msg));
    }
  }.bind(this));
};

ADB.prototype.waitForActivityOrNot = function (pkg, activity, not,
    waitMs, cb) {

  if (typeof waitMs === "function") {
    cb = waitMs;
    waitMs = 20000;
  }

  if (!pkg) return cb(new Error("Package must not be null."));

  logger.debug("Waiting for pkg \"" + pkg + "\" and activity \"" + activity +
    "\" to " + (not ? "not " : "") + "be focused");
  var intMs = 750
    , endAt = Date.now() + waitMs;

  var activityRelativeName = helpers.getActivityRelativeName(pkg, activity);

  var checkForActivity = function (foundPackage, foundActivity) {
    var foundAct = false;
    if (foundPackage === pkg) {
      _.each(activityRelativeName.split(','), function (act) {
        act = act.trim();
        if (act === foundActivity || "." + act === foundActivity) {
          foundAct = true;
        }
      });
    }
    return foundAct;
  };

  var wait = function () {
    this.getFocusedPackageAndActivity(function (err, foundPackage,
          foundActivity) {
      if (err) return cb(err);
      var foundAct = checkForActivity(foundPackage, foundActivity);
      if ((!not && foundAct) || (not && !foundAct)) {
        cb();
      } else if (Date.now() < endAt) {
        setTimeout(wait, intMs);
      } else {
        var verb = not ? "stopped" : "started";
        var msg = pkg + "/" + activityRelativeName + " never " + verb + ". Current: " +
                  foundPackage + "/" + foundActivity;
        logger.error(msg);
        cb(new Error(msg));
      }
    }.bind(this));
  }.bind(this);

  wait();
};

ADB.prototype.waitForActivity = function (pkg, act, waitMs, cb) {
  this.waitForActivityOrNot(pkg, act, false, waitMs, cb);
};

ADB.prototype.waitForNotActivity = function (pkg, act, waitMs, cb) {
  this.waitForActivityOrNot(pkg, act, true, waitMs, cb);
};

ADB.prototype.uninstallApk = function (pkg, cb) {
  logger.debug("Uninstalling " + pkg);
  this.forceStop(pkg, function (err) {
    if (err) logger.debug("Force-stopping before uninstall didn't work; " +
                         "maybe app wasn't running");
    this.exec("uninstall " + pkg, {timeout: 20000}, function (err, stdout) {
      if (err) {
        logger.error(err);
        cb(err);
      } else {
        stdout = stdout.trim();
        // stdout may contain warnings meaning success is not on the first line.
        if (stdout.indexOf("Success") !== -1) {
          logger.debug("App was uninstalled");
        } else {
          logger.debug("App was not uninstalled, maybe it wasn't on device?");
        }
        cb();
      }
    });
  }.bind(this));
};

ADB.prototype.installRemote = function (remoteApk, cb) {
  var cmd = 'pm install -r ' + remoteApk;
  this.shell(cmd, function (err, stdout) {
    if (err) return cb(err);
    if (stdout.indexOf("Failure") !== -1) {
      return cb(new Error("Remote install failed: " + stdout));
    }
    cb();
  });
};

ADB.prototype.install = function (apk, replace, cb) {
  if (typeof replace === "function") {
    cb = replace;
    replace = true;
  }
  var cmd = 'install ';
  if (replace) {
    cmd += '-r ';
  }
  cmd += '"' + apk + '"';
  this.exec(cmd, cb);
};

ADB.prototype.mkdir = function (remotePath, cb) {
  this.shell('mkdir -p ' + remotePath, cb);
};

ADB.prototype.instrument = function (pkg, activity, instrumentWith, cb) {
  if (activity[0] !== ".") {
    pkg = "";
  }
  var cmd = "am instrument -e main_activity '" + pkg + activity + "' " +
            instrumentWith;
  cmd = cmd.replace(/\.+/g, '.'); // Fix pkg..activity error
  this.shell(cmd, function (err, stdout) {
    if (err) return cb(err);
    if (stdout.indexOf("Exception") !== -1) {
      logger.error(stdout);
      var msg = stdout.split("\n")[0] || "Unknown exception during " +
                                         "instrumentation";
      return cb(new Error(msg));
    }
    cb();
  });
};

ADB.prototype.checkAndSignApk = function (apk, pkg, cb) {
  this.checkApkCert(apk, pkg, function (err, appSigned) {
    if (err) return cb(err);
    if (!appSigned) {
      this.sign(apk, cb);
    } else {
      cb();
    }
  }.bind(this));
};

ADB.prototype.forceStop = function (pkg, cb) {
  this.shell('am force-stop ' + pkg, cb);
};

ADB.prototype.clear = function (pkg, cb) {
  this.shell("pm clear " + pkg, cb);
};

ADB.prototype.stopAndClear = function (pkg, cb) {
  this.forceStop(pkg, function (err) {
    if (err) return cb(err);
    this.clear(pkg, cb);
  }.bind(this));
};

ADB.prototype.isAppInstalled = function (pkg, cb) {
  var installed = false;

  logger.debug("Getting install status for " + pkg);
  this.getApiLevel(function (err, apiLevel) {
    if (err) return cb(err);
    var thirdparty = apiLevel >= 15 ? "-3 " : "";
    var listPkgCmd = "pm list packages " + thirdparty + pkg;
    this.shell(listPkgCmd, function (err, stdout) {
      if (err) return cb(err);
      var apkInstalledRgx = new RegExp('^package:' +
          pkg.replace(/(\.)/g, "\\$1") + '$', 'm');
      installed = apkInstalledRgx.test(stdout);
      logger.debug("App is" + (!installed ? " not" : "") + " installed");
      cb(null, installed);
    }.bind(this));
  }.bind(this));
};

ADB.prototype.lock = function (cb) {
  logger.debug("Pressing the KEYCODE_POWER button to lock screen");
  this.keyevent(26, cb);
};

ADB.prototype.back = function (cb) {
  logger.debug("Pressing the BACK button");
  var cmd = "input keyevent 4";
  this.shell(cmd, cb);
};

ADB.prototype.goToHome = function (cb) {
  logger.debug("Pressing the HOME button");
  this.keyevent(3, cb);
};

ADB.prototype.keyevent = function (keycode, cb) {
  var code = parseInt(keycode, 10);
  // keycode must be an int.
  var cmd = 'input keyevent ' + code;
  this.shell(cmd, cb);
};

ADB.prototype.isScreenLocked = function (cb) {
  var cmd = "dumpsys window";
  this.shell(cmd, function (err, stdout) {
    if (err) return cb(err);
    if (process.env.APPIUM_LOG_DUMPSYS) {
      // optional debugging
      // if the method is not working, turn it on and send us the output
      var dumpsysFile = path.resolve(process.cwd(), "dumpsys.log");
      logger.debug("Writing dumpsys output to " + dumpsysFile);
      fs.writeFileSync(dumpsysFile, stdout);
    }
   cb(null, helpers.isShowingLockscreen(stdout) || helpers.isCurrentFocusOnKeyguard(stdout) ||
       !helpers.isScreenOnFully(stdout));
  });
};

ADB.prototype.isSoftKeyboardPresent = function (cb) {
  var cmd = "dumpsys input_method";
  this.shell(cmd, function (err, stdout) {
    if (err) return cb(err);
    var isKeyboardShown = false;
    var canCloseKeyboard = false;
    var inputShownMatch = /mInputShown=\w+/gi.exec(stdout);
    if (inputShownMatch && inputShownMatch[0]) {
      isKeyboardShown = inputShownMatch[0].split('=')[1] === 'true';
      var isInputViewShownMatch = /mIsInputViewShown=\w+/gi.exec(stdout);
      if (isInputViewShownMatch && isInputViewShownMatch[0]) {
        canCloseKeyboard = isInputViewShownMatch[0].split('=')[1] === 'true';
      }
    }
    cb(null, isKeyboardShown, canCloseKeyboard);
  });
};

ADB.prototype.sendTelnetCommand = function (command, cb) {
  logger.debug("Sending telnet command to device: " + command);
  this.getEmulatorPort(function (err, port) {
    if (err) return cb(err);
    var conn = net.createConnection(port, 'localhost');
    var connected = false;
    var readyRegex = /^OK$/m;
    var dataStream = "";
    var res = null;
    var onReady = function () {
      logger.debug("Socket connection to device ready");
      conn.write(command + "\n");
    };
    conn.on('connect', function () {
      logger.debug("Socket connection to device created");
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
          logger.debug("Telnet command got response: " + res);
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

ADB.prototype.isAirplaneModeOn = function (cb) {
  var cmd = 'settings get global airplane_mode_on';
  this.shell(cmd, function (err, stdout) {
    if (err) return cb(err);
    cb(null, parseInt(stdout) !== 0);
  });
};

/*
 * on: 1 (to turn on) or 0 (to turn off)
 */
ADB.prototype.setAirplaneMode = function (on, cb) {
  var cmd = 'settings put global airplane_mode_on ' + on;
  this.shell(cmd, cb);
};

/*
 * on: 1 (to turn on) or 0 (to turn off)
 */
ADB.prototype.broadcastAirplaneMode = function (on, cb) {
  var cmd = 'am broadcast -a android.intent.action.AIRPLANE_MODE --ez state ' +
      (on === 1 ? 'true' : 'false');
  this.shell(cmd, cb);
};

ADB.prototype.isWifiOn = function (cb) {
  var cmd = 'settings get global wifi_on';
  this.shell(cmd, function (err, stdout) {
    if (err) return cb(err);
    cb(null, parseInt(stdout) !== 0);
  });
};

/*
 * on: 1 (to turn on) or 0 (to turn off)
 */
ADB.prototype.setWifi = function (on, cb) {
  var cmd = 'am start -n io.appium.settings/.Settings -e wifi ' + (on === 1 ? 'on' : 'off');
  this.shell(cmd, cb);
};

ADB.prototype.isDataOn = function (cb) {
  var cmd = 'settings get global mobile_data';
  this.shell(cmd, function (err, stdout) {
    if (err) return cb(err);
    cb(null, parseInt(stdout) !== 0);
  });
};

/*
 * on: 1 (to turn on) or 0 (to turn off)
 */
ADB.prototype.setData = function (on, cb) {
  var cmd = 'am start -n io.appium.settings/.Settings -e data ' + (on === 1 ? 'on' : 'off');
  this.shell(cmd, cb);
};

/*
 * opts: { wifi: 1/0, data 1/0 } (1 to turn on, 0 to turn off)
 */
ADB.prototype.setWifiAndData = function (opts, cb) {
  var cmdOpts = '';
  if (typeof opts.wifi !== 'undefined') {
    cmdOpts = '-e wifi ' + (opts.wifi === 1 ? 'on' : 'off');
  }
  if (typeof opts.data !== 'undefined') {
    cmdOpts = cmdOpts + ' -e data ' + (opts.data === 1 ? 'on' : 'off');
  }
  var cmd = 'am start -n io.appium.settings/.Settings ' + cmdOpts;
  this.shell(cmd, cb);
};

ADB.prototype.availableIMEs = function (cb) {
  this.shell('ime list -a',  function (err, stdout) {
    if (err) return cb(err);
    var engines = [];
    _.each(stdout.split('\n'), function (line) {
      // get a listing that has IME IDs flush left,
      // and lots of extraneous info indented
      if (line.length > 0 && line[0] !== ' ') {
        // remove newline and trailing colon, and add to the list
        engines.push(line.trim().replace(/:$/, ''));
      }
    });
    cb(null, engines);
  });
};

ADB.prototype.defaultIME = function (cb) {
  var cmd = 'settings get secure default_input_method';
  this.shell(cmd, function (err, engine) {
    if (err) return cb(err);
    cb(null, engine.trim());
  });
};

ADB.prototype.enableIME = function (imeId, cb) {
  var cmd = 'ime enable ' + imeId;
  this.shell(cmd, cb);
};

ADB.prototype.disableIME = function (imeId, cb) {
  var cmd = 'ime disable ' + imeId;
  this.shell(cmd, cb);
};

ADB.prototype.setIME = function (imeId, cb) {
  var cmd = 'ime set ' + imeId;
  this.shell(cmd, cb);
};

ADB.prototype.hasInternetPermissionFromManifest = function (localApk, cb) {
  this.checkAaptPresent(function (err) {
    if (err) return cb(err);
    localApk = '"' + localApk + '"'; // add quotes in case there are spaces
    var badging = [this.binaries.aapt, 'dump', 'badging', localApk].join(' ');
    logger.debug("hasInternetPermissionFromManifest: " + badging);
    exec(badging, { maxBuffer: 524288 }, function (err, stdout, stderr) {
      if (err || stderr) {
        logger.warn(stderr);
        return cb(new Error("hasInternetPermissionFromManifest failed. " + err));
      }
      var hasInternetPermission = new RegExp("uses-permission:.*'android.permission.INTERNET'").test(stdout);
      cb(null, hasInternetPermission);
    });
  }.bind(this));
};

ADB.prototype.reboot = function (cb) {
  var adbCmd = "stop; sleep 2; setprop sys.boot_completed 0; start";
  this.shell(adbCmd, function (err) {
    if (err) return cb(err);
    var bootCompleted = false;
    var i = 90;
    logger.debug('waiting for reboot, this takes time.');
    async.until(
      function test() { return bootCompleted; },
      function fn(cb) {
        i--;
        if (i < 0) return cb(new Error('device didn\'t reboot within 90 seconds'));
        if (i % 5 === 0) logger.debug('still waiting for reboot.');
        this.shell("getprop sys.boot_completed", function (err, stdout) {
          if (err) return cb(err);
          bootCompleted = '1' === stdout.trim();
          setTimeout(cb, 1000);
        });
      }.bind(this),
      cb
    );
  }.bind(this));
};

ADB.getAdbServerPort = function () {
  return process.env.ANDROID_ADB_SERVER_PORT || 5037;
};

module.exports = ADB;
