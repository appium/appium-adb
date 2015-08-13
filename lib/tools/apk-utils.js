import { buildStartCmd, getActivityRelativeName } from '../helpers.js';
import { exec } from 'teen_process';
import log from '../logger.js';
import path from 'path';
import _ from 'lodash';
import { sleep } from 'asyncbox';
import { fs } from '../utils';

let apkUtilsMethods = {};

apkUtilsMethods.isAppInstalled = async function (pkg) {
  try {
    let installed = false;
    log.debug(`Getting install status for ${pkg}`);
    let apiLevel = await this.getApiLevel();
    let thirdparty = apiLevel >= 15 ? "-3" : "";
    let stdout = await this.shell(['pm', 'list', 'packages', thirdparty, pkg]);
    let apkInstalledRgx = new RegExp(`^package:${pkg.replace(/(\.)/g, "\\$1")}$`,
                                     'm');
    installed = apkInstalledRgx.test(stdout);
    log.debug(`App is ${!installed ? " not" : ""} installed`);
    return installed;
  } catch (e) {
    log.errorAndThrow(`Error finding if app is installed. Original error: ${e.message}`);
  }
};

apkUtilsMethods.startApp = async function (startAppOptions = {}) {
  try {
    if (!startAppOptions.activity || !startAppOptions.pkg) {
      log.errorAndThrow("activity and pkg is required for launching application");
    }
    startAppOptions = _.clone(startAppOptions);
    // initializing defaults
    _.defaults(startAppOptions, {
        waitPkg: startAppOptions.pkg,
        waitActivity: false,
        retry: true,
        stopApp: true
    });
    // preventing null waitpkg
    startAppOptions.waitPkg = startAppOptions.waitPkg || startAppOptions.pkg;
    let apiLevel = await this.getApiLevel();
    let cmd = buildStartCmd(startAppOptions, apiLevel);
    let stdout = await this.shell(cmd);
    if (stdout.indexOf("Error: Activity class") !== -1 &&
        stdout.indexOf("does not exist") !== -1) {
      if (startAppOptions.retry && startAppOptions.activity[0] !== ".") {
        log.debug("We tried to start an activity that doesn't exist, " +
                  "retrying with . prepended to activity");
        startAppOptions.activity = "." + startAppOptions.activity;
        startAppOptions.retry = false;
        return this.startApp(startAppOptions);
      } else {
        log.errorAndThrow("Activity used to start app doesn't exist or cannot be " +
                          "launched! Make sure it exists and is a launchable activity");
      }
    } else if (stdout.indexOf("java.lang.SecurityException") !== -1) {
      // if the app is disabled on a real device it will throw a security exception
      log.errorAndThrow("Permission to start activity denied.");
    }
    if (startAppOptions.waitActivity) {
      await this.waitForActivity(startAppOptions.waitPkg, startAppOptions.waitActivity,
                                 startAppOptions.waitDuration);
    }
  } catch (e) {
    log.errorAndThrow(`Error occured while starting App. Original error: ${e.message}`);
  }
};


apkUtilsMethods.getFocusedPackageAndActivity = async function () {
  log.debug("Getting focused package and activity");
  let cmd = ['dumpsys', 'window', 'windows'],
      nullRe = new RegExp(/mFocusedApp=null/),
      searchRe = new RegExp('mFocusedApp.+Record\\{.*\\s([^\\s\\/\\}]+)' +
                            '\\/([^\\s\\/\\}]+)(\\s[^\\s\\/\\}]+)*\\}');
  try {
    let stdout = await this.shell(cmd);
    let foundNullMatch = false;
    for (let line of stdout.split("\n")) {
      let foundMatch = searchRe.exec(line);
      if (foundMatch) {
        return {appPackage: foundMatch[1].trim(), appActivity: foundMatch[2].trim()};
      } else if (nullRe.test(line)) {
        foundNullMatch = true;
      }
    }
    if (foundNullMatch) {
      return null;
    } else {
      log.errorAndThrow("Could not parse activity from dumpsys");
    }
  } catch (e) {
    log.errorAndThrow(`Could not get focusPackageAndActivity. Original error: ${e.message}`);
  }
};

apkUtilsMethods.waitForActivityOrNot = async function (pkg, activity, not,
                                                       waitMs = 20000) {
  if (!pkg || !activity) {
    throw new Error("Package and activity required.");
  }
  log.debug(`Waiting for pkg: ${pkg} and activity: ${activity}` +
            `${not ? ' not' : ''} to be focused`);
  let endAt = Date.now() + waitMs;
  let activityRelativeName = getActivityRelativeName(pkg, activity);
  while (Date.now() < endAt) {
    let {appPackage, appActivity} = await this.getFocusedPackageAndActivity();
    let foundAct = ((appPackage === pkg) && (activityRelativeName === appActivity));
    if ((!not && foundAct) || (not && !foundAct)) {
      return;
    }
    // cool down so we're not overloading device with requests
    await sleep(750);
  }
  log.errorAndThrow(`${pkg}/${activityRelativeName} never ` +
                    `${not ? 'stopped' : 'started'}`);
};

apkUtilsMethods.waitForActivity = async function (pkg, act, waitMs = 20000) {
  await this.waitForActivityOrNot(pkg, act, false, waitMs);
};

apkUtilsMethods.waitForNotActivity = async function (pkg, act, waitMs = 20000) {
  await this.waitForActivityOrNot(pkg, act, true, waitMs);
};

apkUtilsMethods.uninstallApk = async function (pkg) {
  log.debug(`Uninstalling ${pkg}`);
  try {
    await this.forceStop(pkg);
    let stdout = await this.adbExec(['uninstall', pkg], {timeout: 20000});
    stdout = stdout.trim();
    // stdout may contain warnings meaning success is not on the first line.
    if (stdout.indexOf("Success") !== -1) {
      log.info("App was uninstalled");
      return true;
    } else {
      log.info("App was not uninstalled, maybe it wasn't on device?");
      return false;
    }
  } catch (e) {
    log.errorAndThrow(`Unable to uninstall APK. Original error: ${e.message}`);
  }
};

apkUtilsMethods.installFromDevicePath = async function (apkPathOnDevice) {
  let stdout = await this.shell(['pm', 'install', '-r', apkPathOnDevice]);
  if (stdout.indexOf("Failure") !== -1) {
    log.errorAndThrow(`Remote install failed: ${stdout}`);
  }
};

apkUtilsMethods.install = async function (apk, replace = true) {
  if (replace) {
    await this.adbExec(['install', '-r', apk]);
  } else {
    await this.adbExec(['install', apk]);
  }
};

apkUtilsMethods.extractStringsFromApk = async function (apk, language, out) {
  log.debug(`Extracting strings for language: ${language || "default"}`);
  let stringsJson = 'strings.json';
  let localPath;
  if (!language) {
    language = await this.getDeviceLanguage();
  }
  let apkTools = this.jars['appium_apk_tools.jar'];
  let args = ['-jar', apkTools, 'stringsFromApk', apk, out, language];
  let fileData, apkStrings;
  try {
    await exec('java', args);
  } catch (e) {
    log.debug(`No strings.xml for language '${language}', getting default ` +
              `strings.xml`);
    args.pop();
    await exec('java', args);
  }

  try {
    log.debug("Reading strings from converted strings.json");
    localPath = path.join(out, stringsJson);
    fileData = await fs.readFile(localPath, 'utf8');
    apkStrings = JSON.parse(fileData);
  } catch (e) {
    if (fileData) {
      log.debug(`Content started with: ${fileData.slice(0, 300)}`);
    }
    let msg = `Could not parse strings from strings.json. Original ` +
              `error: ${e.message}`;
    log.errorAndThrow(msg);
  }
  return {apkStrings, localPath};
};

export default apkUtilsMethods;
