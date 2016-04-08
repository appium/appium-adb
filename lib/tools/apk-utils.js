import { buildStartCmd, getPossibleActivityNames } from '../helpers.js';
import { exec } from 'teen_process';
import log from '../logger.js';
import path from 'path';
import _ from 'lodash';
import { sleep } from 'asyncbox';
import { fs } from 'appium-support';

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

apkUtilsMethods.startUri = async function (uri, pkg) {
  if (!uri || !pkg) {
    log.errorAndThrow("URI and package arguments are required");
  }
  try {
    let args = ["am", "start", "-W", "-a", "android.intent.action.VIEW", "-d",
                uri, pkg];
    await this.shell(args);
  } catch (e) {
    log.errorAndThrow(`Error attempting to start URI. Original error: ${e}`);
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
        startAppOptions.activity = `.${startAppOptions.activity}`;
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
  let cmd = ['dumpsys', 'window', 'windows'];
  let nullRe = new RegExp(/mFocusedApp=null/);
  let searchRe = new RegExp('mFocusedApp.+Record\\{.*\\s([^\\s\\/\\}]+)' +
                            '\\/([^\\s\\/\\}\\,]+)\\,?(\\s[^\\s\\/\\}]+)*\\}'); // https://regex101.com/r/xZ8vF7/1
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
      return {appPackage: null, appActivity: null};
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
  log.debug(`Waiting for pkg: '${pkg}' and activity: '${activity}'` +
            `${not ? ' not' : ''} to be focused`);
  let endAt = Date.now() + waitMs;
  let possibleActivityNames = getPossibleActivityNames(pkg, activity);
  log.debug(`Possible activities, to be checked: ${possibleActivityNames.join(', ')}`);
  while (Date.now() < endAt) {
    let {appPackage, appActivity} = await this.getFocusedPackageAndActivity();
    log.debug(`Found package: '${appPackage}' and activity: '${appActivity}'`);
    let foundAct = ((appPackage === pkg) &&
                    (_.findIndex(possibleActivityNames, possibleActivity => possibleActivity === appActivity) !== -1));
    if ((!not && foundAct) || (not && !foundAct)) {
      return;
    }
    log.debug('Incorrect package and activity. Retrying.');
    // cool down so we're not overloading device with requests
    await sleep(750);
  }
  log.errorAndThrow(`${pkg}/${activity} never ${not ? 'stopped' : 'started'}`);
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

apkUtilsMethods.installFromDevicePath = async function (apkPathOnDevice, opts = {}) {
  let stdout = await this.shell(['pm', 'install', '-r', apkPathOnDevice], opts);
  if (stdout.indexOf("Failure") !== -1) {
    log.errorAndThrow(`Remote install failed: ${stdout}`);
  }
};

apkUtilsMethods.install = async function (apk, replace = true, timeout = 60000) {
  if (replace) {
    await this.adbExec(['install', '-r', apk], {timeout});
  } else {
    await this.adbExec(['install', apk], {timeout});
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

apkUtilsMethods.getDeviceLanguage = async function () {
  let language;
  if (await this.getApiLevel() < 23) {
    language = await this.getDeviceSysLanguage();
    if (!language) {
      language = await this.getDeviceProductLanguage();
    }
  } else {
    language = (await this.getDeviceLocale()).split("-")[0];
  }
  return language;
};

apkUtilsMethods.setDeviceLanguage = async function (language) {
  // this method is only used in API < 23
  await this.setDeviceSysLanguage(language);
};

apkUtilsMethods.getDeviceCountry = async function () {
  // this method is only used in API < 23
  let country = await this.getDeviceSysCountry();
  if (!country) {
    country = await this.getDeviceProductCountry();
  }
  return country;
};

apkUtilsMethods.setDeviceCountry = async function (country) {
  // this method is only used in API < 23
  await this.setDeviceSysCountry(country);
};

apkUtilsMethods.getDeviceLocale = async function () {
  // this method is only used in API >= 23
  let locale = await this.getDeviceSysLocale();
  if (!locale) {
    locale = await this.getDeviceProductLocale();
  }
  return locale;
};

apkUtilsMethods.setDeviceLocale = async function (locale) {
  // this method is only used in API >= 23
  await this.setDeviceSysLocale(locale);
};

export default apkUtilsMethods;
