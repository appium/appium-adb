import _ from 'lodash';
import path from 'path';
//import { helpers } from './helpers';
import { default as log } from 'appium-logger';
import fs from 'fs';
import { retry } from 'asyncbox';

//import { logger as log } from './logger';
import { getDirectories, prettyExec, isWindows } from './helpers';

class SystemCallsHelper {

  constructor (sdkRoot) {
    this.sdkRoot = sdkRoot;
  }

  async checkSdkBinaryPresent (binary) {
    log.info("Checking whether " + binary + " is present");
    let binaryLoc = null;
    let binaryName = binary;
    let cmd = "which";
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
      let binaryLocs = [path.resolve(this.sdkRoot, "platform-tools", binaryName)
        , path.resolve(this.sdkRoot, "tools", binaryName)];
      // get subpaths for currently installed build tool directories
      let buildToolDirs = getDirectories(path.resolve(this.sdkRoot, "build-tools"));

      _.each(buildToolDirs, (versionDir) => {
        binaryLocs.push(path.resolve(this.sdkRoot, "build-tools", versionDir, binaryName));
      });

      _.each(binaryLocs, (loc) => {
        if (fs.existsSync(loc)) binaryLoc = loc;
      });
      if (binaryLoc === null) {
        throw new Error("Could not find " + binary + " in tools, platform-tools, " +
                     "or supported build-tools under \"" + this.sdkRoot + "\"; " +
                     "do you have the Android SDK installed at this location?");
      }
      binaryLoc = binaryLoc.trim();
      log.info("Using " + binary + " from " + binaryLoc);
      //this.binaries[binary] = binaryLoc;
      return binaryLoc;
    } else {
      log.warn("The ANDROID_HOME environment variable is not set to the Android SDK root directory path. " +
                  "ANDROID_HOME is required for compatibility with SDK 23+. Checking along PATH for " + binary + ".");
      try {
        let {stdout} = await prettyExec(cmd, [binary], { maxBuffer: 524288 });
        log.info("Using " + binary + " from " + stdout);
        binaryLoc = '"' + stdout.trim() + '"';
        return binaryLoc;
      } catch(e) {
        throw Error("Could not find " + binary + ". Please set the ANDROID_HOME " +
                    "environment variable with the Android SDK root directory path.");
      }
  }
}

 async exec (cmd, adb, opts = {maxBuffer: 524288, wrapArgs: false}) {
    /*if (!cb && typeof opts === 'function') {
      cb = opts;
      opts = {};
    }*/
    if (!cmd) {
      throw new Error("You need to pass in a command to exec()");
    }
  //  opts = _.defaults(opts, );
    let retryNum = 2;
    let execFunc = async () => {
      prettyExec(adb.path, adb.defaultArgs.concat([cmd]),
                 opts, function (err, stdout, stderr) {
        var linkerWarningRe = /^WARNING: linker.+$/m;
        // sometimes ADB prints out stupid stdout warnings that we don't want
        // to include in any of the response data, so let's strip it out
        stdout = stdout.replace(linkerWarningRe, '').trim();
        if (err) {
          var protocolFaultError = new RegExp("protocol fault \\(no status\\)", "i").test(stderr);
          var deviceNotFoundError = new RegExp("error: device not found", "i").test(stderr);
          if (protocolFaultError || deviceNotFoundError) {
            log.info("error sending command, reconnecting device and retrying: " + cmd);
            return setTimeout( () => {
              adb.getDevicesWithRetry(function (err, devices) {
                if (err) throw new Error("Reconnect failed, devices are: " + devices);
                throw Error(stderr); // we've reconnected, so get back into the retry loop
              });
            }, 1000);
          }
          throw err; // shortcut retry and fall out since we have a non-recoverable error
        } else {
          let output = {stdout: stdout, stderr: stderr};
          return output; // shortcut retry and respond with success
        }
      }.bind(this));
    };
    await retry (retryNum, execFunc);
  }

  async shell (cmd, cb) {
    if (cmd.indexOf('"') === -1) {
      cmd = '"' + cmd + '"';
    }
    var execCmd = 'shell ' + cmd;
    this.exec(execCmd, cb);
  }

}

export { SystemCallsHelper };
