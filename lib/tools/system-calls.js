import path from 'path';
import log from '../logger.js';
import { system, util } from 'appium-support';
import { getDirectories } from '../helpers';
import { exec } from 'teen_process';

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
    throw new Error(`Could not find ${binaryName} Please set the ANDROID_HOME ` +
                    `environment variable with the Android SDK root directory path.`);
  }
};

export default systemCallMethods;
