import { buildStartCmd } from '../helpers.js';
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
    let stdout = await this.shell(['pm', 'list', 'packages', pkg]);
    let apkInstalledRgx = new RegExp(`^package:${pkg.replace(/(\.)/g, "\\$1")}$`, 'm');
    installed = apkInstalledRgx.test(stdout);
    log.debug(`App is${!installed ? ' not' : ''} installed`);
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
    startAppOptions.activity = startAppOptions.activity.replace('$', '\\$');

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
  log.debug(`Waiting for activity matching pkg: '${pkg}' and activity: '${activity}' to` +
            `${not ? ' not' : ''} be focused`);
  const allPackages = pkg.split(',').map((pkgName) => pkgName.trim());
  let endAt = Date.now() + waitMs;

  let possibleActivityNames = [];
  let allActivities = activity.split(",");
  for (let oneActivity of allActivities) {
    oneActivity = oneActivity.trim();
    // Only accept fully qualified activity name.
    if (!oneActivity.startsWith('.')) {
      possibleActivityNames.push(oneActivity);
    }

    for (let currentPkg of allPackages) {
      possibleActivityNames.push(`${currentPkg}.${oneActivity}`.replace(/\.+/g, '.'));
    }
  }
  log.debug(`Possible activities, to be checked: ${possibleActivityNames.join(', ')}`);
  let possibleActivityPatterns = possibleActivityNames.map((possibleActivityName) =>
    new RegExp(`^${possibleActivityName.replace(/\./g, '\\.').replace(/\*/g, '.*?').replace(/\$/g, '\\$')}$`)
  );

  while (Date.now() < endAt) {
    let {appPackage, appActivity} = await this.getFocusedPackageAndActivity();
    let fullyQualifiedActivity = appActivity.startsWith('.') ? `${appPackage}${appActivity}` : appActivity;
    log.debug(`Found package: '${appPackage}' and fully qualified activity name : '${fullyQualifiedActivity}'`);
    let foundAct = (_.includes(allPackages, appPackage) &&
                    _.findIndex(possibleActivityPatterns, (possiblePattern) => possiblePattern.test(fullyQualifiedActivity)) !== -1);
    if ((!not && foundAct) || (not && !foundAct)) {
      return;
    }
    log.debug('Incorrect package and activity. Retrying.');
    // cool down so we're not overloading device with requests
    await sleep(750);
  }
  let activityMessage = possibleActivityNames.join(" or ");
  log.errorAndThrow(`${activityMessage} never ${not ? 'stopped' : 'started'}`);
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
    try {
      await this.adbExec(['install', apk], {timeout});
    } catch (err) {
      // on some systems this will throw an error if the app already
      // exists
      if (err.message.indexOf('INSTALL_FAILED_ALREADY_EXISTS') === -1) {
        throw err;
      }
      log.debug(`Application '${apk}' already installed. Continuing.`);
    }
  }
};

apkUtilsMethods.installOrUpgrade = async function (apk, pkg = null, timeout = 60000) {
  let apkInfo = null;
  if (!pkg) {
    apkInfo = await this.getApkInfo(apk);
    pkg = apkInfo.name;
  }
  if (!pkg) {
    log.warn(`Cannot read the package name of ${apk}. Assuming correct app version is already installed`);
    return;
  }
  if (!await this.isAppInstalled(pkg)) {
    await this.install(apk, false, timeout);
    return;
  }
  const pkgInfo = this.getPackageInfo(pkg);
  const pkgVersionCode = pkgInfo.versionCode;
  if (!apkInfo) {
    apkInfo = await this.getApkInfo(apk);
  }
  const apkVersionCode = apkInfo.versionCode;
  if (_.isUndefined(apkVersionCode) || _.isUndefined(pkgVersionCode)) {
    log.warn(`Cannot read version codes of ${apk} and/or ${pkg}. Assuming correct app version is already installed`);
    return;
  }
  if (pkgVersionCode >= apkVersionCode) {
    log.debug(`The installed "${pkg}" package does not require upgrade (${pkgVersionCode} >= ${apkVersionCode})`);
    return;
  }
  log.debug(`The installed "${pkg}" package is older than ${apk} (${pkgVersionCode} < ${apkVersionCode}). ` +
            `Executing upgrade`);
  try {
    await this.install(apk, true, timeout);
  } catch (err) {
    log.warn(`Cannot upgrade ${pkg} because of "${err.message}". Trying full reinstall`);
    if (!await this.uninstallApk(pkg)) {
      log.errorAndThrow(`"${pkg}" package cannot be uninstalled`);
    }
    await this.install(apk, false, timeout);
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

apkUtilsMethods.getPackageName = async function (apk) {
  let args = ['dump', 'badging', apk];
  await this.initAapt();
  let {stdout} = await exec(this.binaries.aapt, args);
  let apkPackage = new RegExp(/package: name='([^']+)'/g).exec(stdout);
  if (apkPackage && apkPackage.length >= 2) {
    apkPackage = apkPackage[1];
  } else {
    apkPackage = null;
  }
  return apkPackage;
};

apkUtilsMethods.getApkInfo = async function (apkPath) {
  if (!await fs.exists(apkPath)) {
    log.errorAndThrow(`The file at path ${apkPath} does not exist or is not accessible`);
  }
  await this.initAapt();
  try {
    const {stdout} = await exec(this.binaries.aapt, ['d', 'badging', apkPath]);
    const matches = new RegExp(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/).exec(stdout);
    if (matches) {
      return {
        name: matches[1],
        versionCode: parseInt(matches[2], 10),
        versionName: matches[3]
      };
    }
  } catch (err) {
    log.warn(`Error "${err.message}" while getting badging info`);
  }
  return {};
};

apkUtilsMethods.getPackageInfo = async function (pkg) {
  log.debug(`Getting package info for ${pkg}`);
  let result = {name: pkg};
  try {
    const stdout = await this.shell(['dumpsys', 'package', pkg]);
    const versionNameMatch = new RegExp(/versionName=([\d+\.]+)/).exec(stdout);
    if (versionNameMatch) {
      result.versionName = versionNameMatch[1];
    }
    const versionCodeMatch = new RegExp(/versionCode=(\d+)/).exec(stdout);
    if (versionCodeMatch) {
      result.versionCode = parseInt(versionCodeMatch[1], 10);
    }
    return result;
  } catch (err) {
    log.warn(`Error "${err.message}" while dumping package info`);
  }
  return result;
};

export default apkUtilsMethods;
