import { buildStartCmd } from '../helpers.js';
import { exec } from 'teen_process';
import log from '../logger.js';
import path from 'path';
import _ from 'lodash';
import { retryInterval } from 'asyncbox';
import { fs } from 'appium-support';


let apkUtilsMethods = {};

/**
 * Check whether the particular package is present on the device under test.
 *
 * @param {string} pkg - The name of the package to check.
 * @return {boolean} True if the package is installed.
 */
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

/**
 * Start the particular URI on the device under test.
 *
 * @param {string} uri - The name of URI to start.
 * @param {string} pkg - The name of the package to start the URI with.
 */
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

/**
 * Start the particular package on the device under test.
 *
 * @param {object} startAppOptions [{}] - Startup options mapping.
 *                                        It is mandatory that 'activity' and 'pkg' properties are set.
 *                                        Additional supported properties are: 'retry', 'stopApp', 'waitPkg'
 *                                        and 'waitActivity'.
 * @return {string} The output of the corresponding adb command.
 */
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

/**
 * @typedef {Object} PackageActivityInfo
 * @property {?string} appPackage - The name of application package,
 *                                  for example 'com.acme.app'.
 * @property {?string} appActivity - The name of main application activity.
 */

/**
 * Get the name of currently focused package and activity.
 *
 * @return {PackageActivityInfo} The mapping, where property names are 'appPackage' and 'appActivity'.
 * @throws {Error} If there is an error while parsing the data.
 */
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

/**
 * Wait for the given activity to be focused/non-focused.
 *
 * @param {string} pkg - The name of the package to wait for.
 * @param {string} activity - The name of the activity, belonging to that package,
 *                            to wait for.
 * @param {boolean} waitForStop - Whether to wait until the activity is focused (true)
 *                                or is not focused (false).
 * @param {number} waitMs [20000] - Number of milliseconds to wait before timeout occurs.
 * @throws {error} If timeout happens.
 */
apkUtilsMethods.waitForActivityOrNot = async function (pkg, activity, waitForStop, waitMs = 20000) {
  if (!pkg || !activity) {
    throw new Error('Package and activity required.');
  }
  log.debug(`Waiting up to ${waitMs}ms for activity matching pkg: '${pkg}' and ` +
            `activity: '${activity}' to${waitForStop ? ' not' : ''} be focused`);

  const splitNames = (names) => names.split(',').map((name) => name.trim());

  const allPackages = splitNames(pkg);
  const allActivities = splitNames(activity);

  let possibleActivityNames = [];
  for (let oneActivity of allActivities) {
    if (oneActivity.startsWith('.')) {
      // add the package name if activity is not full qualified
      for (let currentPkg of allPackages) {
        possibleActivityNames.push(`${currentPkg}${oneActivity}`.replace(/\.+/g, '.'));
      }
    } else {
      // accept fully qualified activity name.
      possibleActivityNames.push(oneActivity);
    }
  }
  /* jshint ignore:start */
  log.debug(`Possible activities, to be checked: ${possibleActivityNames.map((name) => `'${name}'`).join(', ')}`);
  /* jshint ignore:end */
  let possibleActivityPatterns = possibleActivityNames.map((possibleActivityName) =>
    new RegExp(`^${possibleActivityName.replace(/\./g, '\\.').replace(/\*/g, '.*?').replace(/\$/g, '\\$')}$`)
  );

  // figure out the number of retries. Try once if waitMs is less that 750
  // 30 times if parsing is not possible
  let retries = parseInt(waitMs / 750, 10) || 1;
  retries = isNaN(retries) ? 30 : retries;
  await retryInterval(retries, 750, async () => {
    let {appPackage, appActivity} = await this.getFocusedPackageAndActivity();
    if (appActivity && appPackage) {
      let fullyQualifiedActivity = appActivity.startsWith('.') ? `${appPackage}${appActivity}` : appActivity;
      log.debug(`Found package: '${appPackage}' and fully qualified activity name : '${fullyQualifiedActivity}'`);
      let foundAct = (_.includes(allPackages, appPackage) &&
                      _.findIndex(possibleActivityPatterns, (possiblePattern) => possiblePattern.test(fullyQualifiedActivity)) !== -1);
      if ((!waitForStop && foundAct) || (waitForStop && !foundAct)) {
        return;
      }
    }
    log.debug('Incorrect package and activity. Retrying.');
    /* jshint ignore:start */
    throw new Error(`${possibleActivityNames.map((name) => `'${name}'`).join(' or ')} never ${waitForStop ? 'stopped' : 'started'}`);
    /* jshint ignore:end */
  });
};

/**
 * Wait for the given activity to be focused
 *
 * @param {string} pkg - The name of the package to wait for.
 * @param {string} activity - The name of the activity, belonging to that package,
 *                            to wait for.
 * @param {number} waitMs [20000] - Number of milliseconds to wait before timeout occurs.
 * @throws {error} If timeout happens.
 */
apkUtilsMethods.waitForActivity = async function (pkg, act, waitMs = 20000) {
  await this.waitForActivityOrNot(pkg, act, false, waitMs);
};

/**
 * Wait for the given activity to be non-focused.
 *
 * @param {string} pkg - The name of the package to wait for.
 * @param {string} activity - The name of the activity, belonging to that package,
 *                            to wait for.
 * @param {number} waitMs [20000] - Number of milliseconds to wait before timeout occurs.
 * @throws {error} If timeout happens.
 */
apkUtilsMethods.waitForNotActivity = async function (pkg, act, waitMs = 20000) {
  await this.waitForActivityOrNot(pkg, act, true, waitMs);
};

/**
 * Uninstall the given package from the device under test.
 *
 * @param {string} pkg - The name of the package to be uninstalled.
 * @return {boolean} True if the package was found on the device and
 *                   successfully uninstalled.
 */
apkUtilsMethods.uninstallApk = async function (pkg) {
  log.debug(`Uninstalling ${pkg}`);
  if (!await this.isAppInstalled(pkg)) {
    log.info(`${pkg} was not uninstalled, because it was not present on the device`);
    return false;
  }
  let stdout;
  try {
    await this.forceStop(pkg);
    stdout = await this.adbExec(['uninstall', pkg], {timeout: 20000});
  } catch (e) {
    log.errorAndThrow(`Unable to uninstall APK. Original error: ${e.message}`);
  }
  stdout = stdout.trim();
  log.debug(`ADB command output: ${stdout}`);
  if (stdout.indexOf("Success") !== -1) {
    log.info(`${pkg} was successfully uninstalled`);
    return true;
  }
  log.info(`${pkg} was not uninstalled`);
  return false;
};

/**
 * Install the package after it was pushed to the device under test.
 *
 * @param {string} apkPathOnDevice - The full path to the package on the device file system.
 * @param {object} opts [{}] - Additional exec options. See {@link https://github.com/appium/node-teen_process}
 *                             for more details on this parameter.
 * @throws {error} If there was a failure during application install.
 */
apkUtilsMethods.installFromDevicePath = async function (apkPathOnDevice, opts = {}) {
  let stdout = await this.shell(['pm', 'install', '-r', apkPathOnDevice], opts);
  if (stdout.indexOf("Failure") !== -1) {
    log.errorAndThrow(`Remote install failed: ${stdout}`);
  }
};

/**
 * Install the package from the local file system.
 *
 * @param {string} apk - The full path to the local package.
 * @param {boolean} repalce [true] - Whether to replace the package if it
 *                                   already installed. True by default.
 * @param {number} timeout [60000] - The number of milliseconds to wait until
 *                                   installation is completed.
 * @throws {error} If an unexpected error happens during install.
 */
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

/**
 * Install the package from the local file system of upgrade it if an older
 * version of the same package is already installed.
 *
 * @param {string} apk - The full path to the local package.
 * @param {?string} pkg - The name of the installed package. The method will
 *                        perform faster if it is set.
 * @param {?number} timeout [60000] - The number of milliseconds to wait until
 *                                   installation is completed.
 * @throws {error} If an unexpected error happens during install.
 */
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
    log.debug(`App '${apk}' not installed. Installing`);
    await this.install(apk, false, timeout);
    return;
  }

  const pkgInfo = await this.getPackageInfo(pkg);
  const pkgVersionCode = pkgInfo.versionCode;
  if (!apkInfo) {
    apkInfo = await this.getApkInfo(apk);
  }
  const apkVersionCode = apkInfo.versionCode;

  if (_.isUndefined(apkVersionCode) || _.isUndefined(pkgVersionCode)) {
    log.warn(`Cannot read version codes of '${apk}' and/or '${pkg}'. Assuming correct app version is already installed`);
    return;
  }
  if (pkgVersionCode >= apkVersionCode) {
    log.debug(`The installed '${pkg}' package does not require upgrade (${pkgVersionCode} >= ${apkVersionCode})`);
    return;
  }
  log.debug(`The installed '${pkg}' package is older than '${apk}' (${pkgVersionCode} < ${apkVersionCode}). ` +
            `Executing upgrade`);
  try {
    await this.install(apk, true, timeout);
  } catch (err) {
    log.warn(`Cannot upgrade '${pkg}' because of '${err.message}'. Trying full reinstall`);
    if (!await this.uninstallApk(pkg)) {
      log.errorAndThrow(`'${pkg}' package cannot be uninstalled`);
    }
    await this.install(apk, false, timeout);
  }
};

/**
 * Extract string resources from the given package on local file system.
 *
 * @param {string} apk - The full path to the local package.
 * @param {string} language - The name of the language to extract the resources for.
 * @param {string} out - The name of the destination folder on the local file system to
 *                       store the extracted file to.
 * @return {object} A mapping object, where properties are: 'apkStrings', containing
 *                  parsed resource file represented as JSON object, and 'localPath',
 *                  containing the path to the extracted file on the local file system.
 */
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

/**
 * Get the language name of the device under test.
 *
 * @return {string} The name of device language.
 */
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

/**
 * Set the language name of the device under test.
 *
 * @param {string} language - The name of the new device language.
 */
apkUtilsMethods.setDeviceLanguage = async function (language) {
  // this method is only used in API < 23
  await this.setDeviceSysLanguage(language);
};

/**
 * Get the country name of the device under test.
 *
 * @return {string} The name of device country.
 */
apkUtilsMethods.getDeviceCountry = async function () {
  // this method is only used in API < 23
  let country = await this.getDeviceSysCountry();
  if (!country) {
    country = await this.getDeviceProductCountry();
  }
  return country;
};

/**
 * Set the country name of the device under test.
 *
 * @param {string} country - The name of the new device country.
 */
apkUtilsMethods.setDeviceCountry = async function (country) {
  // this method is only used in API < 23
  await this.setDeviceSysCountry(country);
};

/**
 * Get the locale name of the device under test.
 *
 * @return {string} The name of device locale.
 */
apkUtilsMethods.getDeviceLocale = async function () {
  // this method is only used in API >= 23
  let locale = await this.getDeviceSysLocale();
  if (!locale) {
    locale = await this.getDeviceProductLocale();
  }
  return locale;
};

/**
 * Set the locale name of the device under test.
 *
 * @param {string} locale - The name of the new device country.
 */
apkUtilsMethods.setDeviceLocale = async function (locale) {
  // this method is only used in API >= 23
  await this.setDeviceSysLocale(locale);
};

/**
 * Get the package name from local apk file.
 *
 * @param {string} apk - The full path to existing .apk package on the local
 *                       file system.
 * @return {string} The parsed package name or _null_ if it cannot be parsed.
 */
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

/**
 * @typedef {Objcet} AppInfo
 * @property {string} name - Package name, for example 'com.acme.app'.
 * @property {number} versionCode - Version code.
 * @property {string} versionName - Version name, for example '1.0'.
 */

/**
 * Get the package info from local apk file.
 *
 * @param {string} apkPath - The full path to existing .apk package on the local
 *                           file system.
 * @return {?AppInfo} The parsed application information.
 */
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

/**
 * Get the package info from the installed application.
 *
 * @param {string} pkg - The name of the installed package.
 * @return {?AppInfo} The parsed application information.
 */
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
