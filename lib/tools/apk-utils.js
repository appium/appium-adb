import { buildStartCmd } from '../helpers.js';
import { exec } from 'teen_process';
import log from '../logger.js';
import path from 'path';
import _ from 'lodash';
import { retryInterval } from 'asyncbox';
import { fs, util, mkdirp } from 'appium-support';
import semver from 'semver';
import os from 'os';

let apkUtilsMethods = {};

/**
 * Check whether the particular package is present on the device under test.
 *
 * @param {string} pkg - The name of the package to check.
 * @return {boolean} True if the package is installed.
 */
apkUtilsMethods.isAppInstalled = async function (pkg) {
  let installed = false;
  log.debug(`Getting install status for ${pkg}`);
  try {
    let stdout = await this.shell(['pm', 'list', 'packages', pkg]);
    let apkInstalledRgx = new RegExp(`^package:${pkg.replace(/(\.)/g, "\\$1")}$`, 'm');
    installed = apkInstalledRgx.test(stdout);
    log.debug(`App is${!installed ? ' not' : ''} installed`);
    return installed;
  } catch (e) {
    throw new Error(`Error finding if app is installed. Original error: ${e.message}`);
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
    throw new Error("URI and package arguments are required");
  }
  try {
    let args = ["am", "start", "-W", "-a", "android.intent.action.VIEW", "-d",
                uri.replace(/&/g, '\\&'), pkg];
    const res = await this.shell(args);
    if (res.toLowerCase().includes('unable to resolve intent')) {
      throw new Error(res);
    }
  } catch (e) {
    throw new Error(`Error attempting to start URI. Original error: ${e}`);
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
      throw new Error("activity and pkg is required for launching application");
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
        throw new Error("Activity used to start app doesn't exist or cannot be " +
                          "launched! Make sure it exists and is a launchable activity");
      }
    } else if (stdout.indexOf("java.lang.SecurityException") !== -1) {
      // if the app is disabled on a real device it will throw a security exception
      throw new Error("Permission to start activity denied.");
    }
    if (startAppOptions.waitActivity) {
      await this.waitForActivity(startAppOptions.waitPkg, startAppOptions.waitActivity,
                                 startAppOptions.waitDuration);
    }
  } catch (e) {
    throw new Error(`Error occured while starting App. Original error: ${e.message}`);
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
      throw new Error("Could not parse activity from dumpsys");
    }
  } catch (e) {
    throw new Error(`Could not get focusPackageAndActivity. Original error: ${e.message}`);
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
      possibleActivityNames.push(`${pkg}.${oneActivity}`);
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
 * @typedef {Object} UninstallOptions
 * @property {number} timeout [20000] - The count of milliseconds to wait until the
 *                                      app is uninstalled.
 * @property {boolean} keepData [false] - Set to true in order to keep the
 *                                        application data and cache folders after uninstall.
 */

const APK_UNINSTALL_TIMEOUT = 20000;

/**
 * Uninstall the given package from the device under test.
 *
 * @param {string} pkg - The name of the package to be uninstalled.
 * @param {?UninstallOptions} options - The set of uninstallation options.
 * @return {boolean} True if the package was found on the device and
 *                   successfully uninstalled.
 */
apkUtilsMethods.uninstallApk = async function (pkg, options = {}) {
  log.debug(`Uninstalling ${pkg}`);
  if (!await this.isAppInstalled(pkg)) {
    log.info(`${pkg} was not uninstalled, because it was not present on the device`);
    return false;
  }

  let timeout = APK_UNINSTALL_TIMEOUT;
  if (util.hasValue(options.timeout) && !isNaN(options.timeout)) {
    timeout = parseInt(options.timeout, 10);
  }
  const cmd = ['uninstall'];
  if (options.keepData) {
    cmd.push('-k');
  }
  cmd.push(pkg);

  let stdout;
  try {
    await this.forceStop(pkg);
    stdout = (await this.adbExec(cmd, {timeout})).trim();
  } catch (e) {
    throw new Error(`Unable to uninstall APK. Original error: ${e.message}`);
  }
  log.debug(`'adb ${cmd.join(' ')}' command output: ${stdout}`);
  if (stdout.includes("Success")) {
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
    throw new Error(`Remote install failed: ${stdout}`);
  }
};

const APK_INSTALL_TIMEOUT = 60000;

/**
 * @typedef {Object} InstallOptions
 * @property {number} timeout [60000] - The count of milliseconds to wait until the
 *                                      app is installed.
 * @property {boolean} allowTestPackages [false] - Set to true in order to allow test
 *                                                 packages installation.
 * @property {boolean} useSdcard [false] - Set to true to install the app on sdcard
 *                                         instead of the device memory.
 * @property {boolean} grantPermissions [false] - Set to true in order to grant all the
 *                                                permissions requested in the application's manifest
 *                                                automatically after the installation is completed
 *                                                under Android 6+.
 * @property {boolean} replace [true] - Set it to false if you don't want
 *                                      the application to be upgraded/reinstalled
 *                                      if it is already present on the device.
 */

/**
 * Install the package from the local file system.
 *
 * @param {string} apk - The full path to the local package.
 * @param {boolean} repalce [true] - Whether to replace the package if it
 *                                   already installed. True by default.
 * @param {?InstallOptions} options - The set of installation options.
 * @throws {error} If an unexpected error happens during install.
 */
apkUtilsMethods.install = async function (apk, options = {}) {
  if (!util.hasValue(options.replace)) {
    options.replace = true;
  }
  let timeout = APK_INSTALL_TIMEOUT;
  if (util.hasValue(options.timeout) && !isNaN(options.timeout)) {
    timeout = parseInt(options.timeout, 10);
  }

  const additionalArgs = [];
  if (options.allowTestPackages) {
    additionalArgs.push('-t');
  }
  if (options.useSdcard) {
    additionalArgs.push('-s');
  }
  if (options.grantPermissions) {
    const apiLevel = await this.getApiLevel();
    if (apiLevel < 23) {
      log.debug(`Skipping granting permissions for '${apk}', since ` +
                `the current API level ${apiLevel} does not support applications ` +
                `permissions customization`);
    } else {
      additionalArgs.push('-g');
    }
  }

  const executeInstall = async (args) => {
    const output = await this.adbExec(['install', ...args, apk], {timeout});
    const truncatedOutput = (!_.isString(output) || output.length <= 300) ?
      output : `${output.substr(0, 150)}...${output.substr(output.length - 150)}`;
    log.debug(`Install command stdout: ${truncatedOutput}`);
    if (_.isString(output) && output.includes('INSTALL_FAILED')) {
      throw new Error(output);
    }
  };

  if (options.replace) {
    return await executeInstall(['-r', ...additionalArgs]);
  }

  try {
    await executeInstall(additionalArgs);
  } catch (err) {
    // on some systems this will throw an error if the app already
    // exists
    if (!err.message.includes('INSTALL_FAILED_ALREADY_EXISTS')) {
      throw err;
    }
    log.debug(`Application '${apk}' already installed. Continuing.`);
  }
};

/**
 * @typedef {Object} InstallOrUpgradeOptions
 * @property {number} timeout [60000] - The count of milliseconds to wait until the
 *                                      app is installed.
 * @property {boolean} allowTestPackages [false] - Set to true in order to allow test
 *                                                 packages installation.
 * @property {boolean} useSdcard [false] - Set to true to install the app on sdcard
 *                                         instead of the device memory.
 * @property {boolean} grantPermissions [false] - Set to true in order to grant all the
 *                                                permissions requested in the application's manifest
 *                                                automatically after the installation is completed
 *                                                under Android 6+.
 */

/**
 * Install the package from the local file system of upgrade it if an older
 * version of the same package is already installed.
 *
 * @param {string} apk - The full path to the local package.
 * @param {?string} pkg - The name of the installed package. The method will
 *                        perform faster if it is set.
 * @param {?InstallOrUpgradeOptions} options - Set of install options.
 * @throws {error} If an unexpected error happens during install.
 */
apkUtilsMethods.installOrUpgrade = async function (apk, pkg = null, options = {}) {
  if (!util.hasValue(options.timeout)) {
    options.timeout = APK_INSTALL_TIMEOUT;
  }

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
    await this.install(apk, Object.assign({}, options, {replace: false}));
    return;
  }

  const {versionCode:pkgVersionCode, versionName:pkgVersionNameStr} = await this.getPackageInfo(pkg);
  const pkgVersionName = semver.valid(semver.coerce(pkgVersionNameStr));
  if (!apkInfo) {
    apkInfo = await this.getApkInfo(apk);
  }
  const {versionCode:apkVersionCode, versionName:apkVersionNameStr} = apkInfo;
  const apkVersionName = semver.valid(semver.coerce(apkVersionNameStr));

  if (!_.isNumber(apkVersionCode) || !_.isNumber(pkgVersionCode)) {
    log.warn(`Cannot read version codes of '${apk}' and/or '${pkg}'`);
    if (!_.isString(apkVersionName) || !_.isString(pkgVersionName)) {
      log.warn(`Cannot read version names of '${apk}' and/or '${pkg}'. Assuming correct app version is already installed`);
      return;
    }
  }
  if (_.isNumber(apkVersionCode) && _.isNumber(pkgVersionCode) && pkgVersionCode > apkVersionCode) {
    log.debug(`The installed '${pkg}' package does not require upgrade (${pkgVersionCode} > ${apkVersionCode})`);
    return;
  }
  // Check version names in case if version codes are not being updated properly
  if (_.isString(apkVersionName) && _.isString(pkgVersionName)) {
    if (semver.satisfies(pkgVersionName, `>=${apkVersionName}`)) {
      log.debug(`The installed '${pkg}' package does not require upgrade ('${pkgVersionName}' >= '${apkVersionName}')`);
      return;
    }
  } else if (_.isNumber(apkVersionCode) && _.isNumber(pkgVersionCode) && pkgVersionCode === apkVersionCode) {
    log.debug(`The installed '${pkg}' package does not require upgrade (${pkgVersionCode} === ${apkVersionCode})`);
    return;
  }

  log.debug(`The installed '${pkg}' package is older than '${apk}' ` +
            `(${pkgVersionCode} < ${apkVersionCode} or '${pkgVersionName}' < '${apkVersionName}')'. ` +
            `Executing upgrade`);
  try {
    await this.install(apk, Object.assign({}, options, {replace: true}));
  } catch (err) {
    log.warn(`Cannot upgrade '${pkg}' because of '${err.message}'. Trying full reinstall`);
    if (!await this.uninstallApk(pkg)) {
      throw new Error(`'${pkg}' package cannot be uninstalled`);
    }
    await this.install(apk, Object.assign({}, options, {replace: false}));
  }
};

/**
 * Extract string resources from the given package on local file system.
 *
 * @param {string} apk - The full path to the local package.
 * @param {?string} language - The name of the language to extract the resources for.
 *                             The default language is used if this equals to `null`/`undefined`
 * @param {string} out - The name of the destination folder on the local file system to
 *                       store the extracted file to.
 * @return {Object} A mapping object, where properties are: 'apkStrings', containing
 *                  parsed resource file represented as JSON object, and 'localPath',
 *                  containing the path to the extracted file on the local file system.
 */
apkUtilsMethods.extractStringsFromApk = async function (apk, language, out) {
  log.debug(`Extracting strings for language: ${language || 'default'}`);
  await this.initAapt();
  let rawAaptOutput;
  try {
    const {stdout} = await exec(this.binaries.aapt, [
      'd',
      '--values',
      'resources',
      apk,
    ]);
    rawAaptOutput = stdout;
  } catch (e) {
    throw new Error(`Cannot extract resources from '${apk}'. Original error: ${e.message}`);
  }

  const defaultConfigMarker = '(default)';
  let configMarker = language || defaultConfigMarker;
  if (configMarker.includes('-') && !configMarker.includes('-r')) {
    configMarker = configMarker.replace('-', '-r');
  }
  if (configMarker.toLowerCase().startsWith('en')) {
    // Assume the 'en' configuration is the default one
    const {stdout} = await exec(this.binaries.aapt, [
      'd',
      'configurations',
      apk,
    ]);
    const configs = stdout.split(os.EOL);
    if (!configs.includes(configMarker)) {
      log.debug(`There is no '${configMarker}' configuration. ` +
                `Replacing it with '${defaultConfigMarker}'`);
      configMarker = defaultConfigMarker;
    }
  }

  const apkStrings = {};
  let isInConfig = false;
  let currentResourceId = null;
  let isInPluralGroup = false;
  const startsWithAny = (s, arr) => arr.reduce((acc, x) => acc || s.startsWith(x), false);
  const normalizeStringMatch = (s) => s.replace(/"$/, '').replace(/^"/, '').replace(/\\"/g, '"');
  for (const line of rawAaptOutput.split(os.EOL)) {
    const trimmedLine = line.trim();
    if (_.isEmpty(trimmedLine)) {
      continue;
    }

    if (startsWithAny(trimmedLine, ['config', 'type', 'spec', 'Package'])) {
      isInConfig = trimmedLine.startsWith(`config ${configMarker}:`);
      currentResourceId = null;
      isInPluralGroup = false;
      continue;
    }

    if (!isInConfig) {
      continue;
    }

    if (trimmedLine.startsWith('resource')) {
      isInPluralGroup = false;
      currentResourceId = null;

      if (trimmedLine.includes(':string/')) {
        const match = /:string\/(\S+):/.exec(trimmedLine);
        if (match) {
          currentResourceId = match[1];
        }
      } else if (trimmedLine.includes(':plurals/')) {
        const match = /:plurals\/(\S+):/.exec(trimmedLine);
        if (match) {
          currentResourceId = match[1];
          isInPluralGroup = true;
        }
      }
      continue;
    }

    if (currentResourceId && trimmedLine.startsWith('(string')) {
      const match = /"[^"\\]*(?:\\.[^"\\]*)*"/.exec(trimmedLine);
      if (match) {
        apkStrings[currentResourceId] = normalizeStringMatch(match[0]);
      }
      currentResourceId = null;
      continue;
    }

    if (currentResourceId && isInPluralGroup && trimmedLine.includes(': (string')) {
      const match = /"[^"\\]*(?:\\.[^"\\]*)*"/.exec(trimmedLine);
      if (match) {
        apkStrings[currentResourceId] = [
          ...(apkStrings[currentResourceId] || []),
          normalizeStringMatch(match[0]),
        ];
      }
      continue;
    }
  }

  if (_.isEmpty(apkStrings)) {
    log.warn(`No strings have been found in '${apk}' resources ` +
             `for '${configMarker}' configuration`);
  } else {
    log.info(`Successfully extracted ${_.keys(apkStrings).length} strings from '${apk}' resources ` +
             `for '${configMarker}' configuration`);
  }

  const localPath = path.resolve(out, 'strings.json');
  await mkdirp(out);
  await fs.writeFile(localPath, JSON.stringify(apkStrings, null, 2), 'utf-8');
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
 * Set the locale name of the device under test and the format of the locale is en-US, for example.
 * This method call setDeviceLanguageCountry, so, please use setDeviceLanguageCountry as possible.
 *
 * @param {string} locale - Names of the device language and the country connected with `-`. e.g. en-US.
 */
apkUtilsMethods.setDeviceLocale = async function (locale) {
  const validateLocale = new RegExp(/[a-zA-Z]+-[a-zA-Z0-9]+/);
  if (!validateLocale.test(locale)) {
    log.warn(`setDeviceLocale requires the following format: en-US or ja-JP`);
    return;
  }

  let split_locale = locale.split("-");
  await this.setDeviceLanguageCountry(split_locale[0], split_locale[1]);
};

/**
 * Make sure current device locale is expected or not.
 *
 * @param {string} language - Language. The language field is case insensitive, but Locale always canonicalizes to lower case.
 * @param {string} country - Country. The language field is case insensitive, but Locale always canonicalizes to lower case.
 *
 * @return {boolean} If current locale is language and country as arguments, return true.
 */
apkUtilsMethods.ensureCurrentLocale = async function (language, country) {
  const hasLanguage = _.isString(language);
  const hasCountry = _.isString(country);

  if (!hasLanguage && !hasCountry) {
    log.warn('ensureCurrentLocale requires language or country');
    return false;
  }

  // get lower case versions of the strings
  language = (language || '').toLowerCase();
  country = (country || '').toLowerCase();

  const apiLevel = await this.getApiLevel();

  return await retryInterval(5, 1000, async () => {
    try {
      if (apiLevel < 23) {
        let curLanguage, curCountry;
        if (hasLanguage) {
          curLanguage = (await this.getDeviceLanguage()).toLowerCase();
          if (!hasCountry && language === curLanguage) {
            return true;
          }
        }
        if (hasCountry) {
          curCountry = (await this.getDeviceCountry()).toLowerCase();
          if (!hasLanguage && country === curCountry) {
            return true;
          }
        }
        if (language === curLanguage && country === curCountry) {
          return true;
        }
      } else {
        const curLocale = (await this.getDeviceLocale()).toLowerCase();
        if (`${language}-${country}` === curLocale)  {
          return true;
        }
      }
      return false;
    } catch (err) {
      // if there has been an error, restart adb and retry
      log.error(`Unable to check device localization: ${err.message}`);
      log.debug('Restarting ADB and retrying...');
      await this.restartAdb();
      throw err;
    }
  });
};

/**
 * Set the locale name of the device under test.
 *
 * @param {string} language - Language. The language field is case insensitive, but Locale always canonicalizes to lower case.
 *                            format: [a-zA-Z]{2,8}. e.g. en, ja : https://developer.android.com/reference/java/util/Locale.html
 * @param {string} country - Country. The country (region) field is case insensitive, but Locale always canonicalizes to upper case.
 *                            format: [a-zA-Z]{2} | [0-9]{3}. e.g. US, JP : https://developer.android.com/reference/java/util/Locale.html
 */
apkUtilsMethods.setDeviceLanguageCountry = async function (language, country) {
  let hasLanguage = language && _.isString(language);
  let hasCountry = country && _.isString(country);
  if (!hasLanguage && !hasCountry) {
    log.warn(`setDeviceLanguageCountry requires language or country.`);
    log.warn(`Got language: '${language}' and country: '${country}'`);
    return;
  }
  let wasSettingChanged = false;
  let apiLevel = await this.getApiLevel();

  language = (language || '').toLowerCase();
  country = (country || '').toUpperCase();

  if (apiLevel < 23) {
    let curLanguage = (await this.getDeviceLanguage()).toLowerCase();
    let curCountry = (await this.getDeviceCountry()).toUpperCase();
    if (hasLanguage && language !== curLanguage) {
      await this.setDeviceLanguage(language);
      wasSettingChanged = true;
    }
    if (hasCountry && country !== curCountry) {
      await this.setDeviceCountry(country);
      wasSettingChanged = true;
    }
  } else {
    let curLocale = await this.getDeviceLocale();

    if (apiLevel === 23) {
      let locale;
      if (!hasCountry) {
        locale = language;
      } else if (!hasLanguage) {
        locale = country;
      } else {
        locale = `${language}-${country}`;
      }

      log.debug(`Current locale: '${curLocale}'; requested locale: '${locale}'`);
      if (locale.toLowerCase() !== curLocale.toLowerCase()) {
        await this.setDeviceSysLocale(locale);
        wasSettingChanged = true;
      }
    } else { // API >= 24
      if (!hasCountry || !hasLanguage) {
        log.warn(`setDeviceLanguageCountry requires both language and country to be set for API 24+`);
        log.warn(`Got language: '${language}' and country: '${country}'`);
        return;
      }

      log.debug(`Current locale: '${curLocale}'; requested locale: '${language}-${country}'`);
      if (`${language}-${country}`.toLowerCase() !== curLocale.toLowerCase()) {
        await this.setDeviceSysLocaleViaSettingApp(language, country);
      }
    }
  }

  if (wasSettingChanged) {
    log.info("Rebooting the device in order to apply new locale via 'setting persist.sys.locale' command.");
    await this.reboot();
  }
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
 * @typedef {Object} AppInfo
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
    throw new Error(`The file at path ${apkPath} does not exist or is not accessible`);
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
  log.debug(`Getting package info for '${pkg}'`);
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
    log.warn(`Error '${err.message}' while dumping package info`);
  }
  return result;
};

export default apkUtilsMethods;
