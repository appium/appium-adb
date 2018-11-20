import { buildStartCmd, APKS_EXTENSION, buildInstallArgs, APK_INSTALL_TIMEOUT } from '../helpers.js';
import { exec } from 'teen_process';
import log from '../logger.js';
import path from 'path';
import _ from 'lodash';
import { retryInterval } from 'asyncbox';
import { fs, util, mkdirp } from 'appium-support';
import semver from 'semver';
import os from 'os';

let apkUtilsMethods = {};

const ACTIVITIES_TROUBLESHOOTING_LINK =
  'https://github.com/appium/appium/blob/master/docs/en/writing-running-appium/android/activity-startup.md';

/**
 * Check whether the particular package is present on the device under test.
 *
 * @param {string} pkg - The name of the package to check.
 * @return {boolean} True if the package is installed.
 * @throws {Error} If there was an error while detecting application state
 */
apkUtilsMethods.isAppInstalled = async function (pkg) {
  log.debug(`Getting install status for ${pkg}`);
  const installedPattern = new RegExp(`^\\s*Package\\s+\\[${_.escapeRegExp(pkg)}\\][^:]+:$`, 'm');
  try {
    const stdout = await this.shell(['dumpsys', 'package', pkg]);
    const isInstalled = installedPattern.test(stdout);
    log.debug(`'${pkg}' is${!isInstalled ? ' not' : ''} installed`);
    return isInstalled;
  } catch (e) {
    throw new Error(`Error finding if '${pkg}' is installed. Original error: ${e.message}`);
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

  const args = [
    "am", "start",
    "-W",
    "-a", "android.intent.action.VIEW",
    "-d", uri.replace(/&/g, '\\&'),
    pkg,
  ];
  try {
    const res = await this.shell(args);
    if (res.toLowerCase().includes('unable to resolve intent')) {
      throw new Error(res);
    }
  } catch (e) {
    throw new Error(`Error attempting to start URI. Original error: ${e}`);
  }
};

/**
 * @typedef {Object} StartAppOptions
 * @property {!string} activity - The name of the main application activity
 * @property {!string} pkg - The name of the application package
 * @property {?boolean} retry [true] - If this property is set to `true`
 * and the activity name does not start with '.' then the method
 * will try to add the missing dot and start the activity once more
 * if the first startup try fails.
 * @property {?boolean} stopApp [true] - Set it to `true` in order to forcefully
 * stop the activity if it is already running.
 * @property {?string} waitPkg - The name of the package to wait to on
 * startup (this only makes sense if this name is different from the one, which is set as `pkg`)
 * @property {?string} waitActivity - The name of the activity to wait to on
 * startup (this only makes sense if this name is different from the one, which is set as `activity`)
 * @property {?number} waitDuration - The number of milliseconds to wait until the
 * `waitActivity` is focused
 * @property {?string|number} user - The number of the user profile to start
 * the given activity with. The default OS user profile (usually zero) is used
 * when this property is unset
 */

/**
 * Start the particular package/activity on the device under test.
 *
 * @param {StartAppOptions} startAppOptions [{}] - Startup options mapping.
 * @return {string} The output of the corresponding adb command.
 * @throws {Error} If there is an error while executing the activity
 */
apkUtilsMethods.startApp = async function (startAppOptions = {}) {
  if (!startAppOptions.activity || !startAppOptions.pkg) {
    throw new Error("activity and pkg are required to start an application");
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

  const apiLevel = await this.getApiLevel();
  const cmd = buildStartCmd(startAppOptions, apiLevel);
  try {
    const shellOpts = {};
    if (_.isInteger(startAppOptions.waitDuration) && startAppOptions.waitDuration > 20000) {
      shellOpts.timeout = startAppOptions.waitDuration;
    }
    const stdout = await this.shell(cmd, shellOpts);
    if (stdout.includes("Error: Activity class") && stdout.includes("does not exist")) {
      if (startAppOptions.retry && !startAppOptions.activity.startsWith(".")) {
        log.debug(`We tried to start an activity that doesn't exist, ` +
                  `retrying with '.${startAppOptions.activity}' activity name`);
        startAppOptions.activity = `.${startAppOptions.activity}`;
        startAppOptions.retry = false;
        return await this.startApp(startAppOptions);
      }
      throw new Error(`Activity name '${startAppOptions.activity}' used to start the app doesn't ` +
                      `exist or cannot be launched! Make sure it exists and is a launchable activity`);
    } else if (stdout.includes("java.lang.SecurityException")) {
      // if the app is disabled on a real device it will throw a security exception
      throw new Error(`The permission to start '${startAppOptions.activity}' activity has been denied.` +
                      `Make sure the activity/package names are correct.`);
    }
    if (startAppOptions.waitActivity) {
      await this.waitForActivity(startAppOptions.waitPkg, startAppOptions.waitActivity, startAppOptions.waitDuration);
    }
    return stdout;
  } catch (e) {
    throw new Error(`Cannot start the '${startAppOptions.pkg}' application. ` +
      `Visit ${ACTIVITIES_TROUBLESHOOTING_LINK} for troubleshooting. ` +
      `Original error: ${e.message}`);
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
  const cmd = ['dumpsys', 'window', 'windows'];
  const nullFocusedAppRe = new RegExp(/^\s*mFocusedApp=null/, 'm');
  // https://regex101.com/r/xZ8vF7/1
  const focusedAppRe = new RegExp('^\\s*mFocusedApp.+Record\\{.*\\s([^\\s\\/\\}]+)' +
                                  '\\/([^\\s\\/\\}\\,]+)\\,?(\\s[^\\s\\/\\}]+)*\\}', 'm');
  const nullCurrentFocusRe = new RegExp(/^\s*mCurrentFocus=null/, 'm');
  const currentFocusAppRe = new RegExp('^\\s*mCurrentFocus.+\\{.+\\s([^\\s\\/]+)\\/([^\\s]+)\\b', 'm');

  try {
    const stdout = await this.shell(cmd);
    // The order matters here
    for (const pattern of [focusedAppRe, currentFocusAppRe]) {
      const match = pattern.exec(stdout);
      if (match) {
        return {
          appPackage: match[1].trim(),
          appActivity: match[2].trim()
        };
      }
    }

    for (const pattern of [nullFocusedAppRe, nullCurrentFocusRe]) {
      if (pattern.exec(stdout)) {
        return {
          appPackage: null,
          appActivity: null
        };
      }
    }

    throw new Error("Could not parse activity from dumpsys");
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
  log.debug(`Possible activities, to be checked: ${possibleActivityNames.map((name) => `'${name}'`).join(', ')}`);

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
    throw new Error(`${possibleActivityNames.map((name) => `'${name}'`).join(' or ')} never ${waitForStop ? 'stopped' : 'started'}. ` +
      `Visit ${ACTIVITIES_TROUBLESHOOTING_LINK} for troubleshooting`);
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
  options = Object.assign({
    timeout: APK_UNINSTALL_TIMEOUT
  }, options);
  log.debug(`Uninstalling ${pkg}`);
  if (!await this.isAppInstalled(pkg)) {
    log.info(`${pkg} was not uninstalled, because it was not present on the device`);
    return false;
  }

  const cmd = ['uninstall'];
  if (options.keepData) {
    cmd.push('-k');
  }
  cmd.push(pkg);

  let stdout;
  try {
    await this.forceStop(pkg);
    stdout = (await this.adbExec(cmd, {timeout: options.timeout})).trim();
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
 * @param {string} appPath - The full path to the local package.
 * @param {?InstallOptions} options - The set of installation options.
 * @throws {Error} If an unexpected error happens during install.
 */
apkUtilsMethods.install = async function (appPath, options = {}) {
  if (appPath.endsWith(APKS_EXTENSION)) {
    return await this.installApks(appPath, options);
  }

  options = Object.assign({
    replace: true,
    timeout: APK_INSTALL_TIMEOUT,
  }, options);

  const installArgs = buildInstallArgs(await this.getApiLevel(), options);
  try {
    const output = await this.adbExec(['install', ...installArgs, appPath], {
      timeout: options.timeout,
    });
    const truncatedOutput = (!_.isString(output) || output.length <= 300) ?
      output : `${output.substr(0, 150)}...${output.substr(output.length - 150)}`;
    log.debug(`Install command stdout: ${truncatedOutput}`);
    if (/\[INSTALL[A-Z_]+FAILED[A-Z_]+\]/.test(output)) {
      throw new Error(output);
    }
  } catch (err) {
    // on some systems this will throw an error if the app already
    // exists
    if (!err.message.includes('INSTALL_FAILED_ALREADY_EXISTS')) {
      throw err;
    }
    log.debug(`Application '${appPath}' already installed. Continuing.`);
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
 * @param {string} appPath - The full path to the local package.
 * @param {?string} pkg - The name of the installed package. The method will
 *                        perform faster if it is set.
 * @param {?InstallOrUpgradeOptions} options - Set of install options.
 * @throws {error} If an unexpected error happens during install.
 */
apkUtilsMethods.installOrUpgrade = async function (appPath, pkg = null, options = {}) {
  if (!util.hasValue(options.timeout)) {
    options.timeout = APK_INSTALL_TIMEOUT;
  }

  let apkInfo = null;
  if (!pkg) {
    apkInfo = await this.getApkInfo(appPath);
    pkg = apkInfo.name;
  }
  if (!pkg) {
    log.warn(`Cannot read the package name of ${appPath}. Assuming correct app version is already installed`);
    return;
  }

  if (!await this.isAppInstalled(pkg)) {
    log.debug(`App '${appPath}' not installed. Installing`);
    await this.install(appPath, Object.assign({}, options, {replace: false}));
    return;
  }

  const {versionCode: pkgVersionCode, versionName: pkgVersionNameStr} = await this.getPackageInfo(pkg);
  const pkgVersionName = semver.valid(semver.coerce(pkgVersionNameStr));
  if (!apkInfo) {
    apkInfo = await this.getApkInfo(appPath);
  }
  const {versionCode: apkVersionCode, versionName: apkVersionNameStr} = apkInfo;
  const apkVersionName = semver.valid(semver.coerce(apkVersionNameStr));

  if (!_.isInteger(apkVersionCode) || !_.isInteger(pkgVersionCode)) {
    log.warn(`Cannot read version codes of '${appPath}' and/or '${pkg}'`);
    if (!_.isString(apkVersionName) || !_.isString(pkgVersionName)) {
      log.warn(`Cannot read version names of '${appPath}' and/or '${pkg}'. Assuming correct app version is already installed`);
      return;
    }
  }
  if (_.isInteger(apkVersionCode) && _.isInteger(pkgVersionCode)) {
    if (pkgVersionCode > apkVersionCode) {
      log.debug(`The installed '${pkg}' package does not require upgrade (${pkgVersionCode} > ${apkVersionCode})`);
      return;
    }
    // Version codes might not be maintained. Check version names.
    if (pkgVersionCode === apkVersionCode) {
      if (_.isString(apkVersionName) && _.isString(pkgVersionName) && semver.satisfies(pkgVersionName, `>=${apkVersionName}`)) {
        log.debug(`The installed '${pkg}' package does not require upgrade ('${pkgVersionName}' >= '${apkVersionName}')`);
        return;
      }
      if (!_.isString(apkVersionName) || !_.isString(pkgVersionName)) {
        log.debug(`The installed '${pkg}' package does not require upgrade (${pkgVersionCode} === ${apkVersionCode})`);
        return;
      }
    }
  } else if (_.isString(apkVersionName) && _.isString(pkgVersionName) && semver.satisfies(pkgVersionName, `>=${apkVersionName}`)) {
    log.debug(`The installed '${pkg}' package does not require upgrade ('${pkgVersionName}' >= '${apkVersionName}')`);
    return;
  }

  log.debug(`The installed '${pkg}' package is older than '${appPath}' ` +
            `(${pkgVersionCode} < ${apkVersionCode} or '${pkgVersionName}' < '${apkVersionName}')'. ` +
            `Executing upgrade`);
  try {
    await this.install(appPath, Object.assign({}, options, {replace: true}));
  } catch (err) {
    log.warn(`Cannot upgrade '${pkg}' because of '${err.message}'. Trying full reinstall`);
    if (!await this.uninstallApk(pkg)) {
      throw new Error(`'${pkg}' package cannot be uninstalled`);
    }
    await this.install(appPath, Object.assign({}, options, {replace: false}));
  }
};

/**
 * Extract string resources from the given package on local file system.
 *
 * @param {string} appPath - The full path to the .apk(s) package.
 * @param {?string} language - The name of the language to extract the resources for.
 *                             The default language is used if this equals to `null`/`undefined`
 * @param {string} out - The name of the destination folder on the local file system to
 *                       store the extracted file to.
 * @return {Object} A mapping object, where properties are: 'apkStrings', containing
 *                  parsed resource file represented as JSON object, and 'localPath',
 *                  containing the path to the extracted file on the local file system.
 */
apkUtilsMethods.extractStringsFromApk = async function (appPath, language, out) {
  log.debug(`Extracting strings from for language: ${language || 'default'}`);
  if (appPath.endsWith(APKS_EXTENSION)) {
    appPath = await this.extractLanguageApk(appPath, language);
  }
  await this.initAapt();
  let rawAaptOutput;
  try {
    const {stdout} = await exec(this.binaries.aapt, [
      'd',
      '--values',
      'resources',
      appPath,
    ]);
    rawAaptOutput = stdout;
  } catch (e) {
    throw new Error(`Cannot extract resources from '${appPath}'. Original error: ${e.message}`);
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
      appPath,
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
    log.warn(`No strings have been found in '${appPath}' resources ` +
             `for '${configMarker}' configuration`);
  } else {
    log.info(`Successfully extracted ${_.keys(apkStrings).length} strings from '${appPath}' resources ` +
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
 * @param {?string} script - Script. The script field is case insensitive but Locale always canonicalizes to title case.
 *
 * @return {boolean} If current locale is language and country as arguments, return true.
 */
apkUtilsMethods.ensureCurrentLocale = async function (language, country, script = null) {
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
        // zh-hans-cn : zh-cn
        const localeCode = script ? `${language}-${script.toLowerCase()}-${country}` : `${language}-${country}`;

        if (localeCode === curLocale) {
          log.debug(`Requested locale is equal to current locale: '${curLocale}'`);
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
 * @param {?string} script - Script. The script field is case insensitive but Locale always canonicalizes to title case.
 *                            format: [a-zA-Z]{4}. e.g. Hans in zh-Hans-CN : https://developer.android.com/reference/java/util/Locale.html
 */
apkUtilsMethods.setDeviceLanguageCountry = async function (language, country, script = null) {
  let hasLanguage = language && _.isString(language);
  let hasCountry = country && _.isString(country);
  if (!hasLanguage || !hasCountry) {
    log.warn(`setDeviceLanguageCountry requires language and country at least`);
    log.warn(`Got language: '${language}' and country: '${country}'`);
    return;
  }
  let apiLevel = await this.getApiLevel();

  language = (language || '').toLowerCase();
  country = (country || '').toUpperCase();

  if (apiLevel < 23) {
    let curLanguage = (await this.getDeviceLanguage()).toLowerCase();
    let curCountry = (await this.getDeviceCountry()).toUpperCase();

    if (language !== curLanguage || country !== curCountry) {
      await this.setDeviceSysLocaleViaSettingApp(language, country);
    }
  } else {
    let curLocale = await this.getDeviceLocale();

    // zh-Hans-CN : zh-CN
    const localeCode = script ? `${language}-${script}-${country}` : `${language}-${country}`;
    log.debug(`Current locale: '${curLocale}'; requested locale: '${localeCode}'`);
    if (localeCode.toLowerCase() !== curLocale.toLowerCase()) {
      await this.setDeviceSysLocaleViaSettingApp(language, country, script);
    }
  }
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
 * @param {string} appPath - The full path to existing .apk(s) package on the local
 *                           file system.
 * @return {?AppInfo} The parsed application information.
 */
apkUtilsMethods.getApkInfo = async function (appPath) {
  if (!await fs.exists(appPath)) {
    throw new Error(`The file at path ${appPath} does not exist or is not accessible`);
  }

  if (appPath.endsWith(APKS_EXTENSION)) {
    appPath = await this.extractBaseApk(appPath);
  }

  await this.initAapt();
  try {
    const {stdout} = await exec(this.binaries.aapt, ['d', 'badging', appPath]);
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
    const versionNameMatch = new RegExp(/versionName=([\d+.]+)/).exec(stdout);
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

apkUtilsMethods.pullApk = async function pullApk (pkg, tmpDir) {
  const pkgPath = (await this.adbExec(['shell', 'pm', 'path', pkg])).replace('package:', '');
  const tmpApp = path.resolve(tmpDir, `${pkg}.apk`);
  await this.pull(pkgPath, tmpApp);
  log.debug(`Pulled app for package '${pkg}' to '${tmpApp}'`);
  return tmpApp;
};

export default apkUtilsMethods;
