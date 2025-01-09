import {
  buildStartCmd, APKS_EXTENSION, buildInstallArgs,
  APK_INSTALL_TIMEOUT, DEFAULT_ADB_EXEC_TIMEOUT,
  parseAaptStrings, parseAapt2Strings, formatConfigMarker,
  escapeShellArg, readPackageManifest
} from '../helpers.js';
import { exec } from 'teen_process';
import log from '../logger.js';
import path from 'path';
import _ from 'lodash';
import { waitForCondition } from 'asyncbox';
import { fs, util, mkdirp, timing } from '@appium/support';
import * as semver from 'semver';
import os from 'os';
import { LRUCache } from 'lru-cache';

/** @type {import('./types').StringRecord<import('./types').InstallState>} */
export const APP_INSTALL_STATE = {
  UNKNOWN: 'unknown',
  NOT_INSTALLED: 'notInstalled',
  NEWER_VERSION_INSTALLED: 'newerVersionInstalled',
  SAME_VERSION_INSTALLED: 'sameVersionInstalled',
  OLDER_VERSION_INSTALLED: 'olderVersionInstalled',
};
export const REMOTE_CACHE_ROOT = '/data/local/tmp/appium_cache';
const RESOLVER_ACTIVITY_NAME = 'android/com.android.internal.app.ResolverActivity';

/**
 * Check whether the particular package is present on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The name of the package to check.
 * @param {import('./types').IsAppInstalledOptions} [opts={}]
 * @return {Promise<boolean>} True if the package is installed.
 */
export async function isAppInstalled (pkg, opts = {}) {
  const {
    user,
  } = opts;

  log.debug(`Getting install status for ${pkg}`);
  /** @type {boolean} */
  let isInstalled;
  if (await this.getApiLevel() < 26) {
    try {
      const cmd = ['pm', 'path'];
      if (util.hasValue(user)) {
        cmd.push('--user', user);
      }
      cmd.push(pkg);
      const stdout = await this.shell(cmd);
      isInstalled = /^package:/m.test(stdout);
    } catch {
      isInstalled = false;
    }
  } else {
    const cmd = ['cmd', 'package', 'list', 'packages'];
    if (util.hasValue(user)) {
      cmd.push('--user', user);
    }
    /** @type {string} */
    let stdout;
    try {
      stdout = await this.shell(cmd);
    } catch (e) {
      // https://github.com/appium/appium-uiautomator2-driver/issues/810
      if (_.includes(e.stderr || e.stdout || e.message, 'access user') && _.isEmpty(user)) {
        stdout = await this.shell([...cmd, '--user', '0']);
      } else {
        throw e;
      }
    }
    isInstalled = new RegExp(`^package:${_.escapeRegExp(pkg)}$`, 'm').test(stdout);
  }
  log.debug(`'${pkg}' is${!isInstalled ? ' not' : ''} installed`);
  return isInstalled;
}

/**
 * Start the particular URI on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} uri - The name of URI to start.
 * @param {string?} [pkg=null] - The name of the package to start the URI with.
 * @param {import('./types').StartUriOptions} [opts={}]
 */
export async function startUri (uri, pkg = null, opts = {}) {
  const {
    waitForLaunch = true,
  } = opts;

  if (!uri) {
    throw new Error('URI argument is required');
  }

  const args = ['am', 'start'];
  if (waitForLaunch) {
    args.push('-W');
  }
  args.push('-a', 'android.intent.action.VIEW',
    '-d', escapeShellArg(uri));
  if (pkg) {
    args.push(pkg);
  }

  try {
    const res = await this.shell(args);
    if (res.toLowerCase().includes('unable to resolve intent')) {
      throw new Error(res);
    }
  } catch (e) {
    throw new Error(`Error attempting to start URI. Original error: ${e}`);
  }
}

/**
 * Start the particular package/activity on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {import('./types').StartAppOptions} startAppOptions - Startup options mapping.
 * @return {Promise<string>} The output of the corresponding adb command.
 * @throws {Error} If there is an error while executing the activity
 */
export async function startApp (startAppOptions) {
  if (!startAppOptions.pkg || !(startAppOptions.activity || startAppOptions.action)) {
    throw new Error('pkg, and activity or intent action, are required to start an application');
  }

  startAppOptions = _.clone(startAppOptions);
  if (startAppOptions.activity) {
    startAppOptions.activity = startAppOptions.activity.replace('$', '\\$');
  }
  // initializing defaults
  _.defaults(startAppOptions, {
    waitPkg: startAppOptions.pkg,
    waitForLaunch: true,
    waitActivity: false,
    retry: true,
    stopApp: true
  });
  // preventing null waitpkg
  startAppOptions.waitPkg = startAppOptions.waitPkg || startAppOptions.pkg;

  const apiLevel = await this.getApiLevel();
  const cmd = buildStartCmd(startAppOptions, apiLevel);
  const intentName = `${startAppOptions.action}${startAppOptions.optionalIntentArguments
    ? ' ' + startAppOptions.optionalIntentArguments
    : ''}`;
  try {
    const shellOpts = {};
    if (_.isInteger(startAppOptions.waitDuration)
      // @ts-ignore waitDuration is an integer here
      && startAppOptions.waitDuration >= 0) {
      shellOpts.timeout = startAppOptions.waitDuration;
    }
    const stdout = await this.shell(cmd, shellOpts);
    if (stdout.includes('Error: Activity class') && stdout.includes('does not exist')) {
      if (startAppOptions.retry && startAppOptions.activity && !startAppOptions.activity.startsWith('.')) {
        log.debug(`We tried to start an activity that doesn't exist, ` +
                  `retrying with '.${startAppOptions.activity}' activity name`);
        startAppOptions.activity = `.${startAppOptions.activity}`;
        startAppOptions.retry = false;
        return await this.startApp(startAppOptions);
      }
      throw new Error(`Activity name '${startAppOptions.activity}' used to start the app doesn't ` +
                      `exist or cannot be launched! Make sure it exists and is a launchable activity`);
    } else if (stdout.includes('Error: Intent does not match any activities')
    || stdout.includes('Error: Activity not started, unable to resolve Intent')) {
      throw new Error(`Activity for intent '${intentName}' used to start the app doesn't ` +
                      `exist or cannot be launched! Make sure it exists and is a launchable activity`);
    } else if (stdout.includes('java.lang.SecurityException')) {
      // if the app is disabled on a real device it will throw a security exception
      throw new Error(`The permission to start '${startAppOptions.activity}' activity has been denied.` +
                      `Make sure the activity/package names are correct.`);
    }
    if (startAppOptions.waitActivity) {
      await this.waitForActivity(startAppOptions.waitPkg, startAppOptions.waitActivity, startAppOptions.waitDuration);
    }
    return stdout;
  } catch (e) {
    const appDescriptor = startAppOptions.pkg || intentName;
    throw new Error(`Cannot start the '${appDescriptor}' application. ` +
      `Consider checking the driver's troubleshooting documentation. ` +
      `Original error: ${e.message}`);
  }
}

/**
 * Helper method to call `adb dumpsys window windows/displays`
 * @this {import('../adb.js').ADB}
 * @returns {Promise<string>}
 */
export async function dumpWindows () {
  const apiLevel = await this.getApiLevel();

  // With version 29, Android changed the dumpsys syntax
  const dumpsysArg = apiLevel >= 29 ? 'displays' : 'windows';
  const cmd = ['dumpsys', 'window', dumpsysArg];

  return await this.shell(cmd);
}

/**
 * Get the name of currently focused package and activity.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<import('./types').PackageActivityInfo>}
 * @throws {Error} If there is an error while parsing the data.
 */
export async function getFocusedPackageAndActivity () {
  log.debug('Getting focused package and activity');
  let stdout;
  try {
    stdout = await this.dumpWindows();
  } catch (e) {
    throw new Error(
      `Could not retrieve the currently focused package and activity. Original error: ${e.message}`
    );
  }

  const nullFocusedAppRe = /^\s*mFocusedApp=null/m;
  // https://regex101.com/r/xZ8vF7/1
  const focusedAppRe = new RegExp(
    '^\\s*mFocusedApp.+Record\\{.*\\s([^\\s\\/\\}]+)\\/([^\\s\\/\\}\\,]+)\\,?(\\s[^\\s\\/\\}]+)*\\}',
    'mg'
  );
  const nullCurrentFocusRe = /^\s*mCurrentFocus=null/m;
  const currentFocusAppRe = new RegExp('^\\s*mCurrentFocus.+\\{.+\\s([^\\s\\/]+)\\/([^\\s]+)\\b', 'mg');

  /** @type {import('./types').PackageActivityInfo[]} */
  const focusedAppCandidates = [];
  /** @type {import('./types').PackageActivityInfo[]} */
  const currentFocusAppCandidates = [];
  /** @type {[import('./types').PackageActivityInfo[], RegExp][]} */
  const pairs = [
    [focusedAppCandidates, focusedAppRe],
    [currentFocusAppCandidates, currentFocusAppRe]
  ];
  for (const [candidates, pattern] of pairs) {
    let match;
    while ((match = pattern.exec(stdout))) {
      candidates.push({
        appPackage: match[1].trim(),
        appActivity: match[2].trim()
      });
    }
  }
  if (focusedAppCandidates.length > 1 && currentFocusAppCandidates.length > 0) {
    // https://github.com/appium/appium/issues/17106
    return _.intersectionWith(focusedAppCandidates, currentFocusAppCandidates, _.isEqual)[0]
      ?? focusedAppCandidates[0];
  }
  if (focusedAppCandidates.length > 0 || currentFocusAppCandidates.length > 0) {
    return focusedAppCandidates[0] ?? currentFocusAppCandidates[0];
  }

  for (const pattern of [nullFocusedAppRe, nullCurrentFocusRe]) {
    if (pattern.exec(stdout)) {
      return {
        appPackage: null,
        appActivity: null
      };
    }
  }

  log.debug(stdout);
  throw new Error('Could not retrieve the currently focused package and activity');
}

/**
 * Wait for the given activity to be focused/non-focused.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The name of the package to wait for.
 * @param {string} activity - The name of the activity, belonging to that package,
 *                            to wait for.
 * @param {boolean} waitForStop - Whether to wait until the activity is focused (true)
 *                                or is not focused (false).
 * @param {number} [waitMs=20000] - Number of milliseconds to wait before timeout occurs.
 * @throws {error} If timeout happens.
 */
export async function waitForActivityOrNot (pkg, activity, waitForStop, waitMs = 20000) {
  if (!pkg || !activity) {
    throw new Error('Package and activity required.');
  }
  log.debug(`Waiting up to ${waitMs}ms for activity matching pkg: '${pkg}' and ` +
            `activity: '${activity}' to${waitForStop ? ' not' : ''} be focused`);

  const splitNames = (names) => names.split(',').map((name) => name.trim());
  const allPackages = splitNames(pkg);
  const allActivities = splitNames(activity);

  const possibleActivityNames = [];
  for (const oneActivity of allActivities) {
    if (oneActivity.startsWith('.')) {
      // add the package name if activity is not full qualified
      for (const currentPkg of allPackages) {
        possibleActivityNames.push(`${currentPkg}${oneActivity}`.replace(/\.+/g, '.'));
      }
    } else {
      // accept fully qualified activity name.
      possibleActivityNames.push(oneActivity);
      possibleActivityNames.push(`${pkg}.${oneActivity}`);
    }
  }
  log.debug(`Possible activities, to be checked: ${possibleActivityNames.map((name) => `'${name}'`).join(', ')}`);

  const possibleActivityPatterns = possibleActivityNames.map(
    (actName) => new RegExp(`^${actName.replace(/\./g, '\\.').replace(/\*/g, '.*?').replace(/\$/g, '\\$')}$`)
  );

  const conditionFunc = async () => {
    let appPackage;
    let appActivity;
    try {
      ({appPackage, appActivity} = await this.getFocusedPackageAndActivity());
    } catch (e) {
      log.debug(e.message);
      return false;
    }
    if (appActivity && appPackage) {
      const fullyQualifiedActivity = appActivity.startsWith('.') ? `${appPackage}${appActivity}` : appActivity;
      log.debug(`Found package: '${appPackage}' and fully qualified activity name : '${fullyQualifiedActivity}'`);
      const isActivityFound = _.includes(allPackages, appPackage)
        && possibleActivityPatterns.some((p) => p.test(fullyQualifiedActivity));
      if ((!waitForStop && isActivityFound) || (waitForStop && !isActivityFound)) {
        return true;
      }
    }
    log.debug('Incorrect package and activity. Retrying.');
    return false;
  };

  try {
    await waitForCondition(conditionFunc, {
      waitMs: parseInt(`${waitMs}`, 10),
      intervalMs: 500,
    });
  } catch {
    throw new Error(`${possibleActivityNames.map((name) => `'${name}'`).join(' or ')} never ${waitForStop ? 'stopped' : 'started'}. ` +
      `Consider checking the driver's troubleshooting documentation.`);
  }
}

/**
 * Wait for the given activity to be focused
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The name of the package to wait for.
 * @param {string} act - The name of the activity, belonging to that package,
 *                            to wait for.
 * @param {number} [waitMs=20000] - Number of milliseconds to wait before timeout occurs.
 * @throws {error} If timeout happens.
 */
export async function waitForActivity (pkg, act, waitMs = 20000) {
  await this.waitForActivityOrNot(pkg, act, false, waitMs);
}

/**
 * Wait for the given activity to be non-focused.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The name of the package to wait for.
 * @param {string} act - The name of the activity, belonging to that package,
 *                            to wait for.
 * @param {number} [waitMs=20000] - Number of milliseconds to wait before timeout occurs.
 * @throws {error} If timeout happens.
 */
export async function waitForNotActivity (pkg, act, waitMs = 20000) {
  await this.waitForActivityOrNot(pkg, act, true, waitMs);
}

/**
 * Uninstall the given package from the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The name of the package to be uninstalled.
 * @param {import('./types').UninstallOptions} [options={}] - The set of uninstall options.
 * @return {Promise<boolean>} True if the package was found on the device and
 *                   successfully uninstalled.
 */
export async function uninstallApk (pkg, options = {}) {
  log.debug(`Uninstalling ${pkg}`);
  if (!options.skipInstallCheck && !await this.isAppInstalled(pkg)) {
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
  if (stdout.includes('Success')) {
    log.info(`${pkg} was successfully uninstalled`);
    return true;
  }
  log.info(`${pkg} was not uninstalled`);
  return false;
}

/**
 * Install the package after it was pushed to the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} apkPathOnDevice - The full path to the package on the device file system.
 * @param {import('./types').ShellExecOptions} [opts={}] Additional exec options.
 * @throws {error} If there was a failure during application install.
 */
export async function installFromDevicePath (apkPathOnDevice, opts = {}) {
  const stdout = /** @type {string} */ (await this.shell(['pm', 'install', '-r', apkPathOnDevice], opts));
  if (stdout.includes('Failure')) {
    throw new Error(`Remote install failed: ${stdout}`);
  }
}

/**
 * Caches the given APK at a remote location to speed up further APK deployments.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} apkPath - Full path to the apk on the local FS
 * @param {import('./types').CachingOptions} [options={}] - Caching options
 * @returns {Promise<string>} - Full path to the cached apk on the remote file system
 * @throws {Error} if there was a failure while caching the app
 */
export async function cacheApk (apkPath, options = {}) {
  const appHash = await fs.hash(apkPath);
  const remotePath = path.posix.join(REMOTE_CACHE_ROOT, `${appHash}.apk`);
  const remoteCachedFiles = [];
  // Get current contents of the remote cache or create it for the first time
  try {
    const errorMarker = '_ERROR_';
    let lsOutput = null;
    if (this._areExtendedLsOptionsSupported === true || !_.isBoolean(this._areExtendedLsOptionsSupported)) {
      lsOutput = await this.shell([`ls -t -1 ${REMOTE_CACHE_ROOT} 2>&1 || echo ${errorMarker}`]);
    }
    if (!_.isString(lsOutput) || (lsOutput.includes(errorMarker) && !lsOutput.includes(REMOTE_CACHE_ROOT))) {
      if (!_.isBoolean(this._areExtendedLsOptionsSupported)) {
        log.debug('The current Android API does not support extended ls options. ' +
          'Defaulting to no-options call');
      }
      lsOutput = await this.shell([`ls ${REMOTE_CACHE_ROOT} 2>&1 || echo ${errorMarker}`]);
      this._areExtendedLsOptionsSupported = false;
    } else {
      this._areExtendedLsOptionsSupported = true;
    }
    if (lsOutput.includes(errorMarker)) {
      throw new Error(lsOutput.substring(0, lsOutput.indexOf(errorMarker)));
    }
    remoteCachedFiles.push(...(
      lsOutput.split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
    ));
  } catch (e) {
    log.debug(`Got an error '${e.message.trim()}' while getting the list of files in the cache. ` +
      `Assuming the cache does not exist yet`);
    await this.shell(['mkdir', '-p', REMOTE_CACHE_ROOT]);
  }
  log.debug(`The count of applications in the cache: ${remoteCachedFiles.length}`);
  const toHash = (remotePath) => path.posix.parse(remotePath).name;
  // Push the apk to the remote cache if needed
  if (remoteCachedFiles.some((x) => toHash(x) === appHash)) {
    log.info(`The application at '${apkPath}' is already cached to '${remotePath}'`);
    // Update the application timestamp asynchronously in order to bump its position
    // in the sorted ls output
    // eslint-disable-next-line promise/prefer-await-to-then
    this.shell(['touch', '-am', remotePath]).catch(() => {});
  } else {
    log.info(`Caching the application at '${apkPath}' to '${remotePath}'`);
    const timer = new timing.Timer().start();
    await this.push(apkPath, remotePath, {timeout: options.timeout});
    const {size} = await fs.stat(apkPath);
    log.info(`The upload of '${path.basename(apkPath)}' (${util.toReadableSizeString(size)}) ` +
      `took ${timer.getDuration().asMilliSeconds.toFixed(0)}ms`);
  }
  if (!this.remoteAppsCache) {
    this.remoteAppsCache = new LRUCache({
      max: /** @type {number} */ (this.remoteAppsCacheLimit),
    });
  }
  // Cleanup the invalid entries from the cache
  _.difference([...this.remoteAppsCache.keys()], remoteCachedFiles.map(toHash))
    .forEach((hash) => (/** @type {LRUCache} */ (this.remoteAppsCache)).delete(hash));
  // Bump the cache record for the recently cached item
  this.remoteAppsCache.set(appHash, remotePath);
  // If the remote cache exceeds this.remoteAppsCacheLimit, remove the least recently used entries
  const entriesToCleanup = remoteCachedFiles
    .map((x) => path.posix.join(REMOTE_CACHE_ROOT, x))
    .filter((x) => !(/** @type {LRUCache} */ (this.remoteAppsCache)).has(toHash(x)))
    .slice((/** @type {number} */ (this.remoteAppsCacheLimit)) - [...this.remoteAppsCache.keys()].length);
  if (!_.isEmpty(entriesToCleanup)) {
    try {
      await this.shell(['rm', '-f', ...entriesToCleanup]);
      log.debug(`Deleted ${entriesToCleanup.length} expired application cache entries`);
    } catch (e) {
      log.warn(`Cannot delete ${entriesToCleanup.length} expired application cache entries. ` +
        `Original error: ${e.message}`);
    }
  }
  return remotePath;
}

/**
 * Install the package from the local file system.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} appPath - The full path to the local package.
 * @param {import('./types').InstallOptions} [options={}] - The set of installation options.
 * @throws {Error} If an unexpected error happens during install.
 */
export async function install (appPath, options = {}) {
  if (appPath.endsWith(APKS_EXTENSION)) {
    return await this.installApks(appPath, options);
  }

  options = _.cloneDeep(options);
  _.defaults(options, {
    replace: true,
    timeout: this.adbExecTimeout === DEFAULT_ADB_EXEC_TIMEOUT ? APK_INSTALL_TIMEOUT : this.adbExecTimeout,
    timeoutCapName: 'androidInstallTimeout',
  });

  const installArgs = buildInstallArgs(await this.getApiLevel(), options);
  if (options.noIncremental && await this.isIncrementalInstallSupported()) {
    // Adb throws an error if it does not know about an arg,
    // which is the case here for older adb versions.
    installArgs.push('--no-incremental');
  }
  const installOpts = {
    timeout: options.timeout,
    timeoutCapName: options.timeoutCapName,
  };
  const installCmd = [
    'install',
    ...installArgs,
    appPath,
  ];
  let performAppInstall = async () => await this.adbExec(installCmd, installOpts);
  // this.remoteAppsCacheLimit <= 0 means no caching should be applied
  let shouldCacheApp = (/** @type {number} */ (this.remoteAppsCacheLimit)) > 0;
  if (shouldCacheApp) {
    shouldCacheApp = !(await this.isStreamedInstallSupported());
    if (!shouldCacheApp) {
      log.info(`The application at '${appPath}' will not be cached, because the device under test has ` +
        `confirmed the support of streamed installs`);
    }
  }
  if (shouldCacheApp) {
    const clearCache = async () => {
      log.info(`Clearing the cache at '${REMOTE_CACHE_ROOT}'`);
      await this.shell(['rm', '-rf', `${REMOTE_CACHE_ROOT}/*`]);
    };
    const cacheApp = async () => await this.cacheApk(appPath, {
      timeout: options.timeout,
    });
    try {
      const cachedAppPath = await cacheApp();
      performAppInstall = async () => {
        const pmInstallCmdByRemotePath = (remotePath) => [
          'pm', 'install',
          ...installArgs,
          remotePath,
        ];
        const output = await this.shell(pmInstallCmdByRemotePath(cachedAppPath), installOpts);
        // https://github.com/appium/appium/issues/13970
        if (/\bINSTALL_FAILED_INSUFFICIENT_STORAGE\b/.test(output)) {
          log.warn(`There was a failure while installing '${appPath}' ` +
            `because of the insufficient device storage space`);
          await clearCache();
          log.info(`Consider decreasing the maximum amount of cached apps ` +
            `(currently ${this.remoteAppsCacheLimit}) to avoid such issues in the future`);
          const newCachedAppPath = await cacheApp();
          return await this.shell(pmInstallCmdByRemotePath(newCachedAppPath), installOpts);
        }
        return output;
      };
    } catch (e) {
      log.debug(e);
      log.warn(`There was a failure while caching '${appPath}': ${e.message}`);
      log.warn('Falling back to the default installation procedure');
      await clearCache();
    }
  }
  try {
    const timer = new timing.Timer().start();
    const output = /** @type {string} */(await performAppInstall());
    log.info(`The installation of '${path.basename(appPath)}' took ${timer.getDuration().asMilliSeconds.toFixed(0)}ms`);
    const truncatedOutput = (!_.isString(output) || output.length <= 300) ?
      output : `${output.substring(0, 150)}...${output.substring(output.length - 150)}`;
    log.debug(`Install command stdout: ${truncatedOutput}`);
    if (/\[INSTALL[A-Z_]+FAILED[A-Z_]+\]/.test(output)) {
      if (this.isTestPackageOnlyError(output)) {
        const msg = `Set 'allowTestPackages' capability to true in order to allow test packages installation.`;
        log.warn(msg);
        throw new Error(`${output}\n${msg}`);
      }
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
}

/**
 * Retrieves the current installation state of the particular application
 *
 * @this {import('../adb.js').ADB}
 * @param {string} appPath - Full path to the application
 * @param {string?} [pkg=null] - Package identifier. If omitted then the script will
 * try to extract it on its own
 * @returns {Promise<import('./types').InstallState>} One of `APP_INSTALL_STATE` constants
 */
export async function getApplicationInstallState (appPath, pkg = null) {
  let apkInfo = null;
  if (!pkg) {
    apkInfo = await this.getApkInfo(appPath);
    // @ts-ignore We are ok if this prop does not exist
    pkg = apkInfo.name;
  }
  if (!pkg) {
    log.warn(`Cannot read the package name of '${appPath}'`);
    return this.APP_INSTALL_STATE.UNKNOWN;
  }

  const {
    versionCode: pkgVersionCode,
    versionName: pkgVersionNameStr,
    isInstalled,
  } = await this.getPackageInfo(pkg);
  if (!isInstalled) {
    log.debug(`App '${appPath}' is not installed`);
    return this.APP_INSTALL_STATE.NOT_INSTALLED;
  }
  const pkgVersionName = semver.valid(semver.coerce(pkgVersionNameStr));
  if (!apkInfo) {
    apkInfo = await this.getApkInfo(appPath);
  }
  // @ts-ignore We validate the valus below
  const {versionCode: apkVersionCode, versionName: apkVersionNameStr} = apkInfo;
  const apkVersionName = semver.valid(semver.coerce(apkVersionNameStr));

  if (!_.isInteger(apkVersionCode) || !_.isInteger(pkgVersionCode)) {
    log.warn(`Cannot read version codes of '${appPath}' and/or '${pkg}'`);
    if (!_.isString(apkVersionName) || !_.isString(pkgVersionName)) {
      log.warn(`Cannot read version names of '${appPath}' and/or '${pkg}'`);
      return this.APP_INSTALL_STATE.UNKNOWN;
    }
  }
  if (_.isInteger(apkVersionCode) && _.isInteger(pkgVersionCode)) {
    if ((/** @type {number} */ (pkgVersionCode)) > apkVersionCode) {
      log.debug(`The version code of the installed '${pkg}' is greater than the application version code (${pkgVersionCode} > ${apkVersionCode})`);
      return this.APP_INSTALL_STATE.NEWER_VERSION_INSTALLED;
    }
    // Version codes might not be maintained. Check version names.
    if (pkgVersionCode === apkVersionCode) {
      if (_.isString(apkVersionName) && _.isString(pkgVersionName) && semver.satisfies(pkgVersionName, `>=${apkVersionName}`)) {
        log.debug(`The version name of the installed '${pkg}' is greater or equal to the application version name ('${pkgVersionName}' >= '${apkVersionName}')`);
        return semver.satisfies(pkgVersionName, `>${apkVersionName}`)
          ? this.APP_INSTALL_STATE.NEWER_VERSION_INSTALLED
          : this.APP_INSTALL_STATE.SAME_VERSION_INSTALLED;
      }
      if (!_.isString(apkVersionName) || !_.isString(pkgVersionName)) {
        log.debug(`The version name of the installed '${pkg}' is equal to application version name (${pkgVersionCode} === ${apkVersionCode})`);
        return this.APP_INSTALL_STATE.SAME_VERSION_INSTALLED;
      }
    }
  } else if (_.isString(apkVersionName) && _.isString(pkgVersionName) && semver.satisfies(pkgVersionName, `>=${apkVersionName}`)) {
    log.debug(`The version name of the installed '${pkg}' is greater or equal to the application version name ('${pkgVersionName}' >= '${apkVersionName}')`);
    return semver.satisfies(pkgVersionName, `>${apkVersionName}`)
      ? this.APP_INSTALL_STATE.NEWER_VERSION_INSTALLED
      : this.APP_INSTALL_STATE.SAME_VERSION_INSTALLED;
  }

  log.debug(`The installed '${pkg}' package is older than '${appPath}' (${pkgVersionCode} < ${apkVersionCode} or '${pkgVersionName}' < '${apkVersionName}')'`);
  return this.APP_INSTALL_STATE.OLDER_VERSION_INSTALLED;
}

/**
 * Install the package from the local file system or upgrade it if an older
 * version of the same package is already installed.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} appPath - The full path to the local package.
 * @param {string?} [pkg=null] - The name of the installed package. The method will
 * perform faster if it is set.
 * @param {import('./types').InstallOrUpgradeOptions} [options={}] - Set of install options.
 * @throws {Error} If an unexpected error happens during install.
 * @returns {Promise<import('./types').InstallOrUpgradeResult>}
 */
export async function installOrUpgrade (appPath, pkg = null, options = {}) {
  if (!pkg) {
    const apkInfo = await this.getApkInfo(appPath);
    if ('name' in apkInfo) {
      pkg = apkInfo.name;
    } else {
      log.warn(
        `Cannot determine the package name of '${appPath}'. ` +
        `Continuing with the install anyway`
      );
    }
  }

  const {
    enforceCurrentBuild,
  } = options;
  const appState = await this.getApplicationInstallState(appPath, pkg);
  let wasUninstalled = false;
  const uninstallPackage = async () => {
    if (!await this.uninstallApk(/** @type {string} */ (pkg), {skipInstallCheck: true})) {
      throw new Error(`'${pkg}' package cannot be uninstalled`);
    }
    wasUninstalled = true;
  };
  switch (appState) {
    case this.APP_INSTALL_STATE.NOT_INSTALLED:
      log.debug(`Installing '${appPath}'`);
      await this.install(appPath, Object.assign({}, options, {replace: false}));
      return {
        appState,
        wasUninstalled,
      };
    case this.APP_INSTALL_STATE.NEWER_VERSION_INSTALLED:
      if (enforceCurrentBuild) {
        log.info(`Downgrading '${pkg}' as requested`);
        await uninstallPackage();
        break;
      }
      log.debug(`There is no need to downgrade '${pkg}'`);
      return {
        appState,
        wasUninstalled,
      };
    case this.APP_INSTALL_STATE.SAME_VERSION_INSTALLED:
      if (enforceCurrentBuild) {
        break;
      }
      log.debug(`There is no need to install/upgrade '${appPath}'`);
      return {
        appState,
        wasUninstalled,
      };
    case this.APP_INSTALL_STATE.OLDER_VERSION_INSTALLED:
      log.debug(`Executing upgrade of '${appPath}'`);
      break;
    default:
      log.debug(`The current install state of '${appPath}' is unknown. Installing anyway`);
      break;
  }

  try {
    await this.install(appPath, Object.assign({}, options, {replace: true}));
  } catch (err) {
    log.warn(`Cannot install/upgrade '${pkg}' because of '${err.message}'. Trying full reinstall`);
    await uninstallPackage();
    await this.install(appPath, Object.assign({}, options, {replace: false}));
  }
  return {
    appState,
    wasUninstalled,
  };
}

/**
 * Extract string resources from the given package on local file system.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} appPath - The full path to the .apk(s) package.
 * @param {string?} [language=null] - The name of the language to extract the resources for.
 * The default language is used if this equals to `null`
 * @param {string?} [outRoot=null] - The name of the destination folder on the local file system to
 * store the extracted file to. If not provided then the `localPath` property in the returned object
 * will be undefined.
 * @return {Promise<import('./types').ApkStrings>}
 */
export async function extractStringsFromApk (
  appPath,
  language = null,
  outRoot = null
) {
  log.debug(`Extracting strings from for language: ${language || 'default'}`);
  const originalAppPath = appPath;
  if (appPath.endsWith(APKS_EXTENSION)) {
    appPath = await this.extractLanguageApk(appPath, language);
  }

  let apkStrings = {};
  let configMarker;
  try {
    await this.initAapt();

    configMarker = await formatConfigMarker(async () => {
      const {stdout} = await exec((/** @type {import('./types').StringRecord} */ (this.binaries)).aapt, [
        'd', 'configurations', appPath,
      ]);
      return _.uniq(stdout.split(os.EOL));
    }, language, '(default)');

    const {stdout} = await exec((/** @type {import('./types').StringRecord} */ (this.binaries)).aapt, [
      'd', '--values', 'resources', appPath,
    ]);
    apkStrings = parseAaptStrings(stdout, configMarker);
  } catch (e) {
    log.debug('Cannot extract resources using aapt. Trying aapt2. ' +
      `Original error: ${e.stderr || e.message}`);

    await this.initAapt2();

    configMarker = await formatConfigMarker(async () => {
      const {stdout} = await exec((/** @type {import('./types').StringRecord} */ (this.binaries)).aapt2, [
        'd', 'configurations', appPath,
      ]);
      return _.uniq(stdout.split(os.EOL));
    }, language, '');

    try {
      const {stdout} = await exec((/** @type {import('./types').StringRecord} */ (this.binaries)).aapt2, [
        'd', 'resources', appPath,
      ]);
      apkStrings = parseAapt2Strings(stdout, configMarker);
    } catch (e) {
      throw new Error(`Cannot extract resources from '${originalAppPath}'. ` +
        `Original error: ${e.message}`);
    }
  }

  if (_.isEmpty(apkStrings)) {
    log.warn(`No strings have been found in '${originalAppPath}' resources ` +
      `for '${configMarker || 'default'}' configuration`);
  } else {
    log.info(`Successfully extracted ${_.keys(apkStrings).length} strings from ` +
      `'${originalAppPath}' resources for '${configMarker || 'default'}' configuration`);
  }

  if (!outRoot) {
    return {apkStrings};
  }

  const localPath = path.resolve(outRoot, 'strings.json');
  await mkdirp(outRoot);
  await fs.writeFile(localPath, JSON.stringify(apkStrings, null, 2), 'utf-8');
  return {apkStrings, localPath};
}

/**
 * Get the package info from local apk file.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} appPath - The full path to existing .apk(s) package on the local
 *                           file system.
 * @return {Promise<import('./types').AppInfo|{}>} The parsed application information.
 */
export async function getApkInfo (appPath) {
  if (!await fs.exists(appPath)) {
    throw new Error(`The file at path ${appPath} does not exist or is not accessible`);
  }

  if (appPath.endsWith(APKS_EXTENSION)) {
    appPath = await this.extractBaseApk(appPath);
  }

  try {
    const {name, versionCode, versionName} = await readPackageManifest.bind(this)(appPath);
    return {
      name,
      versionCode,
      versionName,
    };
  } catch (e) {
    log.warn(`Error '${e.message}' while getting badging info`);
  }
  return {};
}

/**
 * Get the package info from the installed application.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The name of the installed package.
 * @return {Promise<import('./types').AppInfo>} The parsed application information.
 */
export async function getPackageInfo (pkg) {
  log.debug(`Getting package info for '${pkg}'`);
  const result = {name: pkg};
  let stdout;
  try {
    stdout = await this.shell(['dumpsys', 'package', pkg]);
  } catch (err) {
    log.debug(err.stack);
    log.warn(`Got an unexpected error while dumping package info: ${err.message}`);
    return result;
  }

  const installedPattern = new RegExp(`^\\s*Package\\s+\\[${_.escapeRegExp(pkg)}\\][^:]+:$`, 'm');
  result.isInstalled = installedPattern.test(stdout);
  if (!result.isInstalled) {
    return result;
  }

  const versionNameMatch = new RegExp(/versionName=([\d+.]+)/).exec(stdout);
  if (versionNameMatch) {
    result.versionName = versionNameMatch[1];
  }
  const versionCodeMatch = new RegExp(/versionCode=(\d+)/).exec(stdout);
  if (versionCodeMatch) {
    result.versionCode = parseInt(versionCodeMatch[1], 10);
  }
  return result;
}

/**
 * Fetches base.apk of the given package to the local file system
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg The package identifier (must be already installed on the device)
 * @param {string} tmpDir The destination folder path
 * @returns {Promise<string>} Full path to the downloaded file
 * @throws {Error} If there was an error while fetching the .apk
 */
export async function pullApk (pkg, tmpDir) {
  const stdout = _.trim(await this.shell(['pm', 'path', pkg]));
  const packageMarker = 'package:';
  if (!_.startsWith(stdout, packageMarker)) {
    throw new Error(`Cannot pull the .apk package for '${pkg}'. Original error: ${stdout}`);
  }

  const remotePath = stdout.replace(packageMarker, '');
  const tmpApp = path.resolve(tmpDir, `${pkg}.apk`);
  await this.pull(remotePath, tmpApp);
  log.debug(`Pulled app for package '${pkg}' to '${tmpApp}'`);
  return tmpApp;
}

/**
 * Activates the given application or launches it if necessary.
 * The action literally simulates
 * clicking the corresponding application icon on the dashboard.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} appId - Application package identifier
 * @throws {Error} If the app cannot be activated
 */
export async function activateApp (appId) {
  log.debug(`Activating '${appId}'`);
  const apiLevel = await this.getApiLevel();
  // Fallback to Monkey in older APIs
  if (apiLevel < 24) {
    // The monkey command could raise an issue as https://stackoverflow.com/questions/44860475/how-to-use-the-monkey-command-with-an-android-system-that-doesnt-have-physical
    // but '--pct-syskeys 0' could cause another background process issue. https://github.com/appium/appium/issues/16941#issuecomment-1129837285
    const cmd = ['monkey',
      '-p', appId,
      '-c', 'android.intent.category.LAUNCHER',
      '1'];
    let output = '';
    try {
      output = await this.shell(cmd);
      log.debug(`Command stdout: ${output}`);
    } catch (e) {
      throw log.errorWithException(`Cannot activate '${appId}'. Original error: ${e.message}`);
    }
    if (output.includes('monkey aborted')) {
      throw log.errorWithException(`Cannot activate '${appId}'. Are you sure it is installed?`);
    }
    return;
  }

  let activityName = await this.resolveLaunchableActivity(appId);
  if (activityName === RESOLVER_ACTIVITY_NAME) {
    // https://github.com/appium/appium/issues/17128
    log.debug(
      `The launchable activity name of '${appId}' was resolved to '${activityName}'. ` +
      `Switching the resolver to not use cmd`
    );
    activityName = await this.resolveLaunchableActivity(appId, {preferCmd: false});
  }

  const stdout = await this.shell([
    'am', (apiLevel < 26) ? 'start' : 'start-activity',
    '-a', 'android.intent.action.MAIN',
    '-c', 'android.intent.category.LAUNCHER',
    // FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
    // https://developer.android.com/reference/android/content/Intent#FLAG_ACTIVITY_NEW_TASK
    // https://developer.android.com/reference/android/content/Intent#FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
    '-f', '0x10200000',
    '-n', activityName,
  ]);
  log.debug(stdout);
  if (/^error:/mi.test(stdout)) {
    throw new Error(`Cannot activate '${appId}'. Original error: ${stdout}`);
  }
}
