import path from 'path';
import log from '../logger.js';
import { system, util } from 'appium-support';
import { getDirectories } from '../helpers';
import { exec } from 'teen_process';
import { sleep, retry } from 'asyncbox';

let systemCallMethods = {};

systemCallMethods.getSdkBinaryPath = async function (binaryName) {
  log.info(`Checking whether ${binaryName} is present`);
  if (this.sdkRoot) {
    return this.getBinaryFromSdkRoot(binaryName);
  } else {
    log.warn(`The ANDROID_HOME environment variable is not set to the Android SDK ` +
             `root directory path. ANDROID_HOME is required for compatibility ` +
             `with SDK 23+. Checking along PATH for ${binaryName}.`);
    return this.getBinaryFromPath(binaryName);

  }
};

systemCallMethods.getCommandForOS = function (binaryName) {
  let cmd = "which";
  if (system.isWindows()) {
    if (binaryName === "android") {
      binaryName += ".bat";
    } else {
      if (binaryName.indexOf(".exe", binaryName.length - 4) === -1) {
        binaryName += ".exe";
      }
    }
    cmd = "where";
  }
  return cmd;
};

systemCallMethods.getBinaryFromSdkRoot = async function(binaryName) {
  let binaryLoc = null;
  let binaryLocs = [path.resolve(this.sdkRoot, "platform-tools", binaryName),
                    path.resolve(this.sdkRoot, "tools", binaryName)];
  // get subpaths for currently installed build tool directories
  let buildToolDirs = [];
  buildToolDirs = await getDirectories(path.resolve(this.sdkRoot, "build-tools"));
  for (let versionDir of buildToolDirs) {
    binaryLocs.push(path.resolve(this.sdkRoot, "build-tools", versionDir, binaryName));
  }
  for (let loc of binaryLocs) {
    let flag = await util.fileExists(loc);
    if (flag) {
      binaryLoc = loc;
    }
  }
  if (binaryLoc === null) {
    throw new Error(`Could not find ${binaryName} in tools, platform-tools, ` +
                    `or supported build-tools under ${this.sdkRoot} ` +
                    `do you have the Android SDK installed at this location?`);
  }
  binaryLoc = binaryLoc.trim();
  log.info(`Using ${binaryName} from ${binaryLoc}`);
  return binaryLoc;
};

systemCallMethods.getBinaryFromPath = async function(binaryName) {
  let binaryLoc = null;
  let cmd = this.getCommandForOS(binaryName);
  try {
    let {stdout} = await exec(cmd, [binaryName]);
    log.info(`Using ${binaryName} from ${stdout}`);
    // TODO write a test for binaries with spaces.
    binaryLoc = stdout.trim();
    return binaryLoc;
  } catch(e) {
    log.error(`Could not find ${binaryName} Please set the ANDROID_HOME ` +
              `environment variable with the Android SDK root directory path.`);
    throw new Error(`Could not find ${binaryName} Please set the ANDROID_HOME ` +
                    `environment variable with the Android SDK root directory path.`);
  }
};

systemCallMethods.getConnectedDevices = async function () {
  log.debug("Getting connected devices...");
  try {
    let {stdout} = await exec(this.adb.path, ['devices']);
    if (stdout.toLowerCase().indexOf("error") !== -1) {
      log.error(stdout);
      throw new Error(stdout);
    } else {
      let devices = [];
      for (let line of stdout.split("\n")) {
        if (line.trim() !== "" &&
            line.indexOf("List of devices") === -1 &&
            line.indexOf("* daemon") === -1 &&
            line.indexOf("offline") === -1) {
          let lineInfo = line.split("\t");
          // state is either "device" or "offline", afaict
          devices.push({udid: lineInfo[0], state: lineInfo[1]});
        }
      }
      log.debug(`${devices.length} device(s) connected`);
      return devices;
    }
  } catch (e) {
    log.error(`Error while getting connected devices. Original error: ${e.message}`);
    throw new Error(`Error while getting connected devices. Original error: ${e.message}`);
  }
};

systemCallMethods.getDevicesWithRetry = async function (timeoutMs = 20000) {
  let start = Date.now();
  log.debug("Trying to find a connected android device");
  let getDevices = async () => {
    if ((Date.now() - start) > timeoutMs) {
      throw new Error("Could not find a connected Android device.");
    }
    try {
      let devices = await this.getConnectedDevices();
      if (devices.length < 1) {
        log.debug("Could not find devices, restarting adb server...");
        await this.restartAdb();
        // cool down
        await sleep(200);
        return getDevices();
      }
      return devices;
    } catch (e) {
      log.debug("Could not find devices, restarting adb server...");
      await this.restartAdb();
      // cool down
      await sleep(200);
      return getDevices();
    }
  };
  return getDevices();
};

systemCallMethods.restartAdb = async function () {
  if (!this.suppressKillServer) {
    try {
      await exec(this.adb.path, ['kill-server']);
    } catch (e) {
      log.error("Error killing ADB server, going to see if it's online anyway");
    }
  }
};

systemCallMethods.adbExec = async function (cmd, opts = {}) {
  if (!cmd) {
    throw new Error("You need to pass in a command to adbExec()");
  }
  let execFunc = async () => {
    try {
      if (!(cmd instanceof Array)) {
        cmd = [cmd];
      }
      let {stdout} = await exec(this.adb.path, this.adb.defaultArgs.concat(cmd), opts);
      // sometimes ADB prints out stupid stdout warnings that we don't want
      // to include in any of the response data, so let's strip it out
      let linkerWarningRe = /^WARNING: linker.+$/m;
      stdout = stdout.replace(linkerWarningRe, '').trim();
      return stdout;
    } catch (e) {
      let protocolFaultError = new RegExp("protocol fault \\(no status\\)", "i").test(e);
      let deviceNotFoundError = new RegExp("error: device not found", "i").test(e);
      if (protocolFaultError || deviceNotFoundError) {
        log.info(`error sending command, reconnecting device and retrying: ${cmd}`);
        await sleep(1000);
        await this.getDevicesWithRetry();
      }
      log.error(`Error occurred executing adbExec. Original error: ${e.message}`);
      throw new Error(`Error occurred executing adbExec. Original error: ${e.message}`);
    }
  };
  return retry(2, execFunc);
};

systemCallMethods.shell = async function (cmd) {
  let execCmd = ['shell'];
  if (cmd instanceof Array) {
    execCmd = execCmd.concat(cmd);
  } else {
    execCmd.push(cmd);
  }
  return this.adbExec(execCmd);
};

systemCallMethods.getAdbServerPort = function () {
  return process.env.ANDROID_ADB_SERVER_PORT || 5037;
};

export default systemCallMethods;
