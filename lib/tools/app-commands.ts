import _ from 'lodash';
import {fs, tempDir, util, system} from '@appium/support';
import {log} from '../logger.js';
import {waitForCondition} from 'asyncbox';
import path from 'node:path';
import type {ADB} from '../adb.js';
import type {ExecError} from 'teen_process';
import type {
  StringRecord,
  InstallState,
  ResolveActivityOptions,
  IsAppInstalledOptions,
  StartUriOptions,
  StartAppOptions,
  AppInfo,
  PackageActivityInfo,
} from './types.js';

// Constants
export const APP_INSTALL_STATE: StringRecord<InstallState> = {
  UNKNOWN: 'unknown',
  NOT_INSTALLED: 'notInstalled',
  NEWER_VERSION_INSTALLED: 'newerVersionInstalled',
  SAME_VERSION_INSTALLED: 'sameVersionInstalled',
  OLDER_VERSION_INSTALLED: 'olderVersionInstalled',
};
const NOT_CHANGEABLE_PERM_ERROR = /not a changeable permission type/i;
const IGNORED_PERM_ERRORS = [NOT_CHANGEABLE_PERM_ERROR, /Unknown permission/i];
const MIN_API_LEVEL_WITH_PERMS_SUPPORT = 23;
const RESOLVER_ACTIVITY_NAME = 'android/com.android.internal.app.ResolverActivity';
const MAIN_ACTION = 'android.intent.action.MAIN';
const LAUNCHER_CATEGORY = 'android.intent.category.LAUNCHER';

// Public methods

/**
 * Verify whether the given argument is a
 * valid class name.
 *
 * @param classString - The actual class name to be verified.
 * @returns The result of Regexp.exec operation
 * or _null_ if no matches are found.
 */
export function isValidClass(this: ADB, classString: string): boolean {
  // some.package/some.package.Activity
  return !!matchComponentName(classString);
}

/**
 * Fetches the fully qualified name of the launchable activity for the
 * given package. It is expected the package is already installed on
 * the device under test.
 *
 * @param pkg - The target package identifier
 * @param opts - Options for resolving the activity
 * @returns Fully qualified name of the launchable activity
 * @throws {Error} If there was an error while resolving the activity name
 */
export async function resolveLaunchableActivity(
  this: ADB,
  pkg: string,
  opts: ResolveActivityOptions = {},
): Promise<string> {
  const {preferCmd = true} = opts;
  if (!preferCmd || (await this.getApiLevel()) < 24) {
    const stdout = await this.shell(['dumpsys', 'package', pkg]);
    const names = parseLaunchableActivityNames(stdout);
    if (_.isEmpty(names)) {
      log.debug(stdout);
      throw new Error(
        `Unable to resolve the launchable activity of '${pkg}'. Is it installed on the device?`,
      );
    }
    if (names.length === 1) {
      return names[0];
    }

    const tmpRoot = await tempDir.openDir();
    try {
      const tmpApp = await this.pullApk(pkg, tmpRoot);
      const {apkActivity} = await this.packageAndLaunchActivityFromManifest(tmpApp);
      return apkActivity as string;
    } catch (e) {
      const err = e as Error;
      log.debug(err.stack);
      log.warn(
        `Unable to resolve the launchable activity of '${pkg}'. ` +
          `The very first match of the dumpsys output is going to be used. ` +
          `Original error: ${err.message}`,
      );
      return names[0];
    } finally {
      await fs.rimraf(tmpRoot);
    }
  }
  const {stdout, stderr} = await this.shell(
    ['cmd', 'package', 'resolve-activity', '--brief', pkg],
    {
      outputFormat: this.EXEC_OUTPUT_FORMAT.FULL,
    },
  );
  for (const line of (stdout || '').split('\n').map(_.trim)) {
    if (this.isValidClass(line)) {
      return line;
    }
  }
  throw new Error(
    `Unable to resolve the launchable activity of '${pkg}'. Original error: ${stderr || stdout}`,
  );
}

/**
 * Forcefully stops the app and puts it in the "stopped" state.
 * Android treats a "stopped" app as if it was never launched since boot:
 * - It cannot receive broadcast intents (except for explicit ones).
 * - Scheduled jobs, alarms, and services are cancelled.
 * - The app won't restart until the user explicitly launches it again.
 * It's the same as when a user swipes an app away from Settings → Apps → Force Stop.
 *
 * @param pkg - The package name to be stopped.
 * @returns The output of the corresponding adb command.
 */
export async function forceStop(this: ADB, pkg: string): Promise<string> {
  return await this.shell(['am', 'force-stop', pkg]);
}

/**
 * Gracefully kills the app's process, similar to how Android would do it
 * automatically when low on memory.
 * It only kills the process, without changing the app's "stopped" state.
 * Background services or broadcast receivers may restart soon after,
 * if they are still scheduled or registered.
 * No data or state (like alarms, jobs, etc.) are cleared.
 *
 * @param pkg - The package name to be stopped.
 * @returns The output of the corresponding adb command.
 */
export async function killPackage(this: ADB, pkg: string): Promise<string> {
  return await this.shell(['am', 'kill', pkg]);
}

/**
 * Clear the user data of the particular application on the device
 * under test.
 *
 * @param pkg - The package name to be cleared.
 * @returns The output of the corresponding adb command.
 */
export async function clear(this: ADB, pkg: string): Promise<string> {
  return await this.shell(['pm', 'clear', pkg]);
}

/**
 * Grant all permissions requested by the particular package.
 * This method is only useful on Android 6.0+ and for applications
 * that support components-based permissions setting.
 *
 * @param pkg - The package name to be processed.
 * @param apk - The path to the actual apk file.
 * @throws {Error} If there was an error while granting permissions
 */
export async function grantAllPermissions(this: ADB, pkg: string, apk?: string): Promise<void> {
  const apiLevel = await this.getApiLevel();
  let targetSdk = 0;
  let dumpsysOutput: string | null = null;
  try {
    if (!apk) {
      /**
       * If apk not provided, considering apk already installed on the device
       * and fetching targetSdk using package name.
       */
      dumpsysOutput = await this.shell(['dumpsys', 'package', pkg]);
      targetSdk = await this.targetSdkVersionUsingPKG(pkg, dumpsysOutput);
    } else {
      targetSdk = await this.targetSdkVersionFromManifest(apk);
    }
  } catch {
    //avoiding logging error stack, as calling library function would have logged
    log.warn(`Ran into problem getting target SDK version; ignoring...`);
  }
  if (
    apiLevel >= MIN_API_LEVEL_WITH_PERMS_SUPPORT &&
    targetSdk >= MIN_API_LEVEL_WITH_PERMS_SUPPORT
  ) {
    /**
     * If the device is running Android 6.0(API 23) or higher, and your app's target SDK is 23 or higher:
     * The app has to list the permissions in the manifest.
     * refer: https://developer.android.com/training/permissions/requesting.html
     */
    dumpsysOutput = dumpsysOutput || (await this.shell(['dumpsys', 'package', pkg]));
    const requestedPermissions = await this.getReqPermissions(pkg, dumpsysOutput);
    const grantedPermissions = await this.getGrantedPermissions(pkg, dumpsysOutput);
    const permissionsToGrant = _.difference(requestedPermissions, grantedPermissions);
    if (_.isEmpty(permissionsToGrant)) {
      log.info(`${pkg} contains no permissions available for granting`);
    } else {
      await this.grantPermissions(pkg, permissionsToGrant);
    }
  } else if (targetSdk < MIN_API_LEVEL_WITH_PERMS_SUPPORT) {
    log.info(
      `It is only possible to grant permissions in runtime for ` +
        `apps whose targetSdkVersion in the manifest is set to ${MIN_API_LEVEL_WITH_PERMS_SUPPORT} or above. ` +
        `The current ${pkg} targetSdkVersion is ${targetSdk || 'unset'}.`,
    );
  } else if (apiLevel < MIN_API_LEVEL_WITH_PERMS_SUPPORT) {
    log.info(
      `The device's OS API level is ${apiLevel}. ` +
        `It is only possible to grant permissions on devices running Android 6 or above.`,
    );
  }
}

/**
 * Grant multiple permissions for the particular package.
 * This call is more performant than `grantPermission` one, since it combines
 * multiple `adb shell` calls into a single command.
 *
 * @param pkg - The package name to be processed.
 * @param permissions - The list of permissions to be granted.
 * @throws {Error} If there was an error while changing permissions.
 */
export async function grantPermissions(
  this: ADB,
  pkg: string,
  permissions: string[],
): Promise<void> {
  // As it consumes more time for granting each permission,
  // trying to grant all permission by forming equivalent command.
  // Also, it is necessary to split long commands into chunks, since the maximum length of
  // adb shell buffer is limited
  log.debug(`Granting permissions ${JSON.stringify(permissions)} to '${pkg}'`);
  try {
    await this.shellChunks((perm) => ['pm', 'grant', pkg, perm], permissions);
  } catch (e) {
    const err = e as ExecError;
    if (!IGNORED_PERM_ERRORS.some((pattern) => pattern.test(err.stderr || err.message))) {
      throw err;
    }
  }
}

/**
 * Grant single permission for the particular package.
 *
 * @param pkg - The package name to be processed.
 * @param permission - The full name of the permission to be granted.
 * @throws {Error} If there was an error while changing permissions.
 */
export async function grantPermission(this: ADB, pkg: string, permission: string): Promise<void> {
  try {
    await this.shell(['pm', 'grant', pkg, permission]);
  } catch (e) {
    const err = e as ExecError;
    if (!NOT_CHANGEABLE_PERM_ERROR.test(err.stderr || err.message)) {
      throw err;
    }
  }
}

/**
 * Revoke single permission from the particular package.
 *
 * @param pkg - The package name to be processed.
 * @param permission - The full name of the permission to be revoked.
 * @throws {Error} If there was an error while changing permissions.
 */
export async function revokePermission(this: ADB, pkg: string, permission: string): Promise<void> {
  try {
    await this.shell(['pm', 'revoke', pkg, permission]);
  } catch (e) {
    const err = e as ExecError;
    if (!NOT_CHANGEABLE_PERM_ERROR.test(err.stderr || err.message)) {
      throw err;
    }
  }
}

/**
 * Retrieve the list of granted permissions for the particular package.
 *
 * @param pkg - The package name to be processed.
 * @param cmdOutput - Optional parameter containing command output of
 * _dumpsys package_ command. It may speed up the method execution.
 * @returns The list of granted permissions or an empty list.
 * @throws {Error} If there was an error while changing permissions.
 */
export async function getGrantedPermissions(
  this: ADB,
  pkg: string,
  cmdOutput: string | null = null,
): Promise<string[]> {
  log.debug('Retrieving granted permissions');
  const stdout = cmdOutput || (await this.shell(['dumpsys', 'package', pkg]));
  return extractMatchingPermissions(stdout, ['install', 'runtime'], true);
}

/**
 * Retrieve the list of denied permissions for the particular package.
 *
 * @param pkg - The package name to be processed.
 * @param cmdOutput - Optional parameter containing command output of
 * _dumpsys package_ command. It may speed up the method execution.
 * @returns The list of denied permissions or an empty list.
 */
export async function getDeniedPermissions(
  this: ADB,
  pkg: string,
  cmdOutput: string | null = null,
): Promise<string[]> {
  log.debug('Retrieving denied permissions');
  const stdout = cmdOutput || (await this.shell(['dumpsys', 'package', pkg]));
  return extractMatchingPermissions(stdout, ['install', 'runtime'], false);
}

/**
 * Retrieve the list of requested permissions for the particular package.
 *
 * @param pkg - The package name to be processed.
 * @param cmdOutput - Optional parameter containing command output of
 *                                    _dumpsys package_ command. It may speed up the method execution.
 * @returns The list of requested permissions or an empty list.
 */
export async function getReqPermissions(
  this: ADB,
  pkg: string,
  cmdOutput: string | null = null,
): Promise<string[]> {
  log.debug('Retrieving requested permissions');
  const stdout = cmdOutput || (await this.shell(['dumpsys', 'package', pkg]));
  return extractMatchingPermissions(stdout, ['requested']);
}

/**
 * Stop the particular package if it is running and clears its application data.
 *
 * @param pkg - The package name to be processed.
 */
export async function stopAndClear(this: ADB, pkg: string): Promise<void> {
  try {
    await this.forceStop(pkg);
    await this.clear(pkg);
  } catch (e) {
    const err = e as Error;
    throw new Error(`Cannot stop and clear ${pkg}. Original error: ${err.message}`);
  }
}

/**
 * Get the package info from the installed application.
 *
 * @param pkg - The name of the installed package.
 * @returns The parsed application information.
 */
export async function getPackageInfo(this: ADB, pkg: string): Promise<AppInfo> {
  log.debug(`Getting package info for '${pkg}'`);
  const result: AppInfo = {name: pkg};
  let stdout: string;
  try {
    stdout = await this.shell(['dumpsys', 'package', pkg]);
  } catch (err) {
    const error = err as Error;
    log.debug(error.stack);
    log.warn(`Got an unexpected error while dumping package info: ${error.message}`);
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
 * @param pkg - The package identifier (must be already installed on the device)
 * @param tmpDir - The destination folder path
 * @returns Full path to the downloaded file
 * @throws {Error} If there was an error while fetching the .apk
 */
export async function pullApk(this: ADB, pkg: string, tmpDir: string): Promise<string> {
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
 * @param appId - Application package identifier
 * @throws {Error} If the app cannot be activated
 */
export async function activateApp(this: ADB, appId: string): Promise<void> {
  log.debug(`Activating '${appId}'`);
  const apiLevel = await this.getApiLevel();
  // Fallback to Monkey in older APIs
  if (apiLevel < 24) {
    // The monkey command could raise an issue as https://stackoverflow.com/questions/44860475/how-to-use-the-monkey-command-with-an-android-system-that-doesnt-have-physical
    // but '--pct-syskeys 0' could cause another background process issue. https://github.com/appium/appium/issues/16941#issuecomment-1129837285
    const cmd = ['monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1'];
    let output = '';
    try {
      output = await this.shell(cmd);
      log.debug(`Command stdout: ${output}`);
    } catch (e) {
      const error = e as Error;
      throw log.errorWithException(`Cannot activate '${appId}'. Original error: ${error.message}`);
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
        `Switching the resolver to not use cmd`,
    );
    activityName = await this.resolveLaunchableActivity(appId, {preferCmd: false});
  }

  const stdout = await this.shell([
    'am',
    apiLevel < 26 ? 'start' : 'start-activity',
    '-a',
    'android.intent.action.MAIN',
    '-c',
    'android.intent.category.LAUNCHER',
    // FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
    // https://developer.android.com/reference/android/content/Intent#FLAG_ACTIVITY_NEW_TASK
    // https://developer.android.com/reference/android/content/Intent#FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
    '-f',
    '0x10200000',
    '-n',
    activityName,
  ]);
  log.debug(stdout);
  if (/^error:/im.test(stdout)) {
    throw new Error(`Cannot activate '${appId}'. Original error: ${stdout}`);
  }
}

/**
 * Check whether the particular package is present on the device under test.
 *
 * @param pkg - The name of the package to check.
 * @param opts - Options for checking installation
 * @returns True if the package is installed.
 */
export async function isAppInstalled(
  this: ADB,
  pkg: string,
  opts: IsAppInstalledOptions = {},
): Promise<boolean> {
  const {user} = opts;

  log.debug(`Getting install status for ${pkg}`);
  let isInstalled: boolean;
  if ((await this.getApiLevel()) < 26) {
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
    let stdout: string;
    try {
      stdout = await this.shell(cmd);
    } catch (e) {
      const error = e as ExecError;
      // https://github.com/appium/appium-uiautomator2-driver/issues/810
      if (
        _.includes(error.stderr || error.stdout || error.message, 'access user') &&
        _.isEmpty(user)
      ) {
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
 * @param uri - The name of URI to start.
 * @param pkg - The name of the package to start the URI with.
 * @param opts - Options for starting the URI
 */
export async function startUri(
  this: ADB,
  uri: string,
  pkg: string | null = null,
  opts: StartUriOptions = {},
): Promise<void> {
  const {waitForLaunch = true} = opts;

  if (!uri) {
    throw new Error('URI argument is required');
  }

  const args = ['am', 'start'];
  if (waitForLaunch) {
    args.push('-W');
  }
  args.push('-a', 'android.intent.action.VIEW', '-d', escapeShellArg(uri));
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
 * @param startAppOptions - Startup options mapping.
 * @returns The output of the corresponding adb command.
 * @throws {Error} If there is an error while executing the activity
 */
export async function startApp(this: ADB, startAppOptions: StartAppOptions): Promise<string> {
  if (!startAppOptions.pkg || !(startAppOptions.activity || startAppOptions.action)) {
    throw new Error('pkg, and activity or intent action, are required to start an application');
  }

  const options = _.clone(startAppOptions);
  if (options.activity) {
    options.activity = options.activity.replace('$', '\\$');
  }
  // initializing defaults
  _.defaults(options, {
    waitPkg: options.pkg,
    waitForLaunch: true,
    waitActivity: false,
    retry: true,
    stopApp: true,
  });
  // preventing null waitpkg
  options.waitPkg = options.waitPkg || options.pkg;

  const apiLevel = await this.getApiLevel();
  const cmd = buildStartCmd(options, apiLevel);
  const intentName = `${options.action}${
    options.optionalIntentArguments ? ' ' + options.optionalIntentArguments : ''
  }`;
  try {
    const shellOpts: {timeout?: number} = {};
    if (
      options.waitDuration !== undefined &&
      _.isInteger(options.waitDuration) &&
      options.waitDuration >= 0
    ) {
      shellOpts.timeout = options.waitDuration;
    }
    const stdout = await this.shell(cmd, shellOpts);
    if (stdout.includes('Error: Activity class') && stdout.includes('does not exist')) {
      if (options.retry && options.activity && !options.activity.startsWith('.')) {
        log.debug(
          `We tried to start an activity that doesn't exist, ` +
            `retrying with '.${options.activity}' activity name`,
        );
        options.activity = `.${options.activity}`;
        options.retry = false;
        return await this.startApp(options);
      }
      throw new Error(
        `Activity name '${options.activity}' used to start the app doesn't ` +
          `exist or cannot be launched! Make sure it exists and is a launchable activity`,
      );
    } else if (
      stdout.includes('Error: Intent does not match any activities') ||
      stdout.includes('Error: Activity not started, unable to resolve Intent')
    ) {
      throw new Error(
        `Activity for intent '${intentName}' used to start the app doesn't ` +
          `exist or cannot be launched! Make sure it exists and is a launchable activity`,
      );
    } else if (stdout.includes('java.lang.SecurityException')) {
      // if the app is disabled on a real device it will throw a security exception
      throw new Error(
        `The permission to start '${options.activity}' activity has been denied.` +
          `Make sure the activity/package names are correct.`,
      );
    }
    if (options.waitActivity) {
      await this.waitForActivity(options.waitPkg, options.waitActivity, options.waitDuration);
    }
    return stdout;
  } catch (e) {
    const error = e as Error;
    const appDescriptor = options.pkg || intentName;
    throw new Error(
      `Cannot start the '${appDescriptor}' application. ` +
        `Consider checking the driver's troubleshooting documentation. ` +
        `Original error: ${error.message}`,
    );
  }
}

/**
 * Helper method to call `adb dumpsys window windows/displays`
 *
 * @returns The output of the dumpsys command
 */
export async function dumpWindows(this: ADB): Promise<string> {
  const apiLevel = await this.getApiLevel();

  // With version 29, Android changed the dumpsys syntax
  const dumpsysArg = apiLevel >= 29 ? 'displays' : 'windows';
  const cmd = ['dumpsys', 'window', dumpsysArg];

  return await this.shell(cmd);
}

/**
 * Get the name of currently focused package and activity.
 *
 * @returns The focused package and activity information
 * @throws {Error} If there is an error while parsing the data.
 */
export async function getFocusedPackageAndActivity(this: ADB): Promise<PackageActivityInfo> {
  log.debug('Getting focused package and activity');
  let stdout: string;
  try {
    stdout = await this.dumpWindows();
  } catch (e) {
    const error = e as Error;
    throw new Error(
      `Could not retrieve the currently focused package and activity. Original error: ${error.message}`,
    );
  }

  const nullFocusedAppRe = /^\s*mFocusedApp=null/m;
  // https://regex101.com/r/xZ8vF7/1
  const focusedAppRe = new RegExp(
    '^\\s*mFocusedApp.+Record\\{.*\\s([^\\s\\/\\}]+)\\/([^\\s\\/\\}\\,]+)\\,?(\\s[^\\s\\/\\}]+)*\\}',
    'mg',
  );
  const nullCurrentFocusRe = /^\s*mCurrentFocus=null/m;
  const currentFocusAppRe = new RegExp(
    '^\\s*mCurrentFocus.+\\{.+\\s([^\\s\\/]+)\\/([^\\s]+)\\b',
    'mg',
  );

  const focusedAppCandidates: PackageActivityInfo[] = [];
  const currentFocusAppCandidates: PackageActivityInfo[] = [];
  const pairs: [PackageActivityInfo[], RegExp][] = [
    [focusedAppCandidates, focusedAppRe],
    [currentFocusAppCandidates, currentFocusAppRe],
  ];
  for (const [candidates, pattern] of pairs) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(stdout))) {
      candidates.push({
        appPackage: match[1].trim(),
        appActivity: match[2].trim(),
      });
    }
  }
  if (focusedAppCandidates.length > 1 && currentFocusAppCandidates.length > 0) {
    // https://github.com/appium/appium/issues/17106
    return (
      _.intersectionWith(focusedAppCandidates, currentFocusAppCandidates, (value, other) => {
        if (!_.isEqual(value.appPackage, other.appPackage)) {
          return false;
        }
        // https://github.com/appium/appium-adb/issues/797
        const [thisActivity, otherActivity] = [value.appActivity, other.appActivity].map((name) =>
          name?.replace(value.appPackage || '', ''),
        );
        return Boolean(thisActivity && otherActivity && _.isEqual(thisActivity, otherActivity));
      })[0] ?? focusedAppCandidates[0]
    );
  }
  if (focusedAppCandidates.length > 0 || currentFocusAppCandidates.length > 0) {
    return focusedAppCandidates[0] ?? currentFocusAppCandidates[0];
  }

  for (const pattern of [nullFocusedAppRe, nullCurrentFocusRe]) {
    if (pattern.exec(stdout)) {
      return {
        appPackage: null,
        appActivity: null,
      };
    }
  }

  log.debug(stdout);
  throw new Error('Could not retrieve the currently focused package and activity');
}

/**
 * Wait for the given activity to be focused/non-focused.
 *
 * @param pkg - The name of the package to wait for.
 * @param activity - The name of the activity, belonging to that package,
 *                            to wait for.
 * @param waitForStop - Whether to wait until the activity is focused (true)
 *                                or is not focused (false).
 * @param waitMs - Number of milliseconds to wait before timeout occurs.
 * @throws {Error} If timeout happens.
 */
export async function waitForActivityOrNot(
  this: ADB,
  pkg: string,
  activity: string,
  waitForStop: boolean,
  waitMs: number = 20000,
): Promise<void> {
  if (!pkg || !activity) {
    throw new Error('Package and activity required.');
  }

  const splitNames = (names: string) => names.split(',').map(_.trim);
  const allPackages = splitNames(pkg);
  const allActivities = splitNames(activity);

  const toFullyQualifiedActivityName = (prefix: string, suffix: string) =>
    `${prefix}${suffix}`.replace(/\/\.?/g, '.').replace(/\.{2,}/g, '.');
  const possibleActivityNamesSet = new Set<string>();
  for (const oneActivity of allActivities) {
    if (oneActivity.startsWith('.')) {
      // add the package name if activity is not full qualified
      for (const onePkg of allPackages) {
        possibleActivityNamesSet.add(toFullyQualifiedActivityName(onePkg, oneActivity));
      }
    } else {
      // accept fully qualified activity name.
      if (oneActivity.includes('/')) {
        possibleActivityNamesSet.add(oneActivity.split('/')[1]); // Add the activity component after '/' for a case the fully qualified name starts with a different package name
      }
      possibleActivityNamesSet.add(toFullyQualifiedActivityName(oneActivity, ''));
      const doesIncludePackage = allPackages.some((p) => oneActivity.startsWith(p));
      if (!doesIncludePackage) {
        for (const onePkg of allPackages) {
          possibleActivityNamesSet.add(toFullyQualifiedActivityName(onePkg, `.${oneActivity}`));
        }
      }
    }
  }
  log.debug(
    `Expected package names to ${waitForStop ? 'not ' : ''}be focused within ${waitMs}ms: ` +
      allPackages.map((name) => `'${name}'`).join(', '),
  );
  const possibleActivityNames = [...possibleActivityNamesSet];
  const possibleActivityPatterns = possibleActivityNames.map(
    (actName) =>
      new RegExp(`^${actName.replace(/\./g, '\\.').replace(/\*/g, '.*?').replace(/\$/g, '\\$')}$`),
  );
  log.debug(
    `Expected activity name patterns to ${waitForStop ? 'not ' : ''}be focused within ${waitMs}ms: ` +
      possibleActivityPatterns.map((name) => `'${name}'`).join(', '),
  );

  const conditionFunc = async () => {
    let appPackage: string | null | undefined;
    let appActivity: string | null | undefined;
    try {
      ({appPackage, appActivity} = await this.getFocusedPackageAndActivity());
    } catch (e) {
      const error = e as Error;
      log.debug(error.message);
      return false;
    }
    if (appActivity && appPackage) {
      log.debug(`Focused package: ${appPackage}`);
      const fullyQualifiedActivity = toFullyQualifiedActivityName(
        appActivity.startsWith('.') ? appPackage : '',
        appActivity,
      );
      log.debug(`Focused fully qualified activity name: ${fullyQualifiedActivity}`);
      const isFound =
        _.includes(allPackages, appPackage) &&
        possibleActivityPatterns.some((p) => p.test(fullyQualifiedActivity));
      if ((!waitForStop && isFound) || (waitForStop && !isFound)) {
        return true;
      }
    }
    log.debug(
      'None of the expected package/activity combinations matched to the currently focused one. Retrying',
    );
    return false;
  };

  try {
    await waitForCondition(conditionFunc, {
      waitMs: parseInt(`${waitMs}`, 10),
      intervalMs: 500,
    });
  } catch {
    throw new Error(
      `${possibleActivityNames.map((name) => `'${name}'`).join(' or ')} ` +
        `never ${waitForStop ? 'stopped' : 'started'}. ` +
        `Consider checking the driver's troubleshooting documentation.`,
    );
  }
}

/**
 * Wait for the given activity to be focused
 *
 * @param pkg - The name of the package to wait for.
 * @param act - The name of the activity, belonging to that package,
 *                            to wait for.
 * @param waitMs - Number of milliseconds to wait before timeout occurs.
 * @throws {Error} If timeout happens.
 */
export async function waitForActivity(
  this: ADB,
  pkg: string,
  act: string,
  waitMs: number = 20000,
): Promise<void> {
  await this.waitForActivityOrNot(pkg, act, false, waitMs);
}

/**
 * Wait for the given activity to be non-focused.
 *
 * @param pkg - The name of the package to wait for.
 * @param act - The name of the activity, belonging to that package,
 *                            to wait for.
 * @param waitMs - Number of milliseconds to wait before timeout occurs.
 * @throws {Error} If timeout happens.
 */
export async function waitForNotActivity(
  this: ADB,
  pkg: string,
  act: string,
  waitMs: number = 20000,
): Promise<void> {
  await this.waitForActivityOrNot(pkg, act, true, waitMs);
}

/**
 * Builds command line representation for the given
 * application startup options
 *
 * @param startAppOptions - Application options mapping
 * @param apiLevel - The actual OS API level
 * @returns The actual command line array
 */
export function buildStartCmd(startAppOptions: StartCmdOptions, apiLevel: number): string[] {
  const {
    user,
    waitForLaunch,
    pkg,
    activity,
    action,
    category,
    stopApp,
    flags,
    optionalIntentArguments,
  } = startAppOptions;
  const cmd = ['am', apiLevel < 26 ? 'start' : 'start-activity'];
  if (util.hasValue(user)) {
    cmd.push('--user', `${user}`);
  }
  if (waitForLaunch) {
    cmd.push('-W');
  }
  if (activity && pkg) {
    cmd.push('-n', activity.startsWith(`${pkg}/`) ? activity : `${pkg}/${activity}`);
  }
  if (stopApp && apiLevel >= 15) {
    cmd.push('-S');
  }
  if (action) {
    cmd.push('-a', action);
  }
  if (category) {
    cmd.push('-c', category);
  }
  if (flags) {
    cmd.push('-f', flags);
  }
  if (optionalIntentArguments) {
    cmd.push(...parseOptionalIntentArguments(optionalIntentArguments));
  }
  return cmd;
}

/**
 * Parses the name of launchable package activity
 * from dumpsys output.
 *
 * @param dumpsys - The actual dumpsys output
 * @returns Either the fully qualified
 * activity name as a single list item or an empty list if nothing could be parsed.
 * In Android 6 and older there is no reliable way to determine
 * the category name for the given activity, so this API just
 * returns all activity names belonging to 'android.intent.action.MAIN'
 * with the expectation that the app manifest could be parsed next
 * in order to determine category names for these.
 */
export function parseLaunchableActivityNames(dumpsys: string): string[] {
  const mainActivityNameRe = new RegExp(`^\\s*${_.escapeRegExp(MAIN_ACTION)}:$`);
  const categoryNameRe = /^\s*Category:\s+"([a-zA-Z0-9._/-]+)"$/;
  const blocks: string[][] = [];
  let blockStartIndent: number | null | undefined;
  let block: string[] = [];
  for (const line of dumpsys.split('\n').map(_.trimEnd)) {
    const currentIndent = line.length - _.trimStart(line).length;
    if (mainActivityNameRe.test(line)) {
      blockStartIndent = currentIndent;
      if (!_.isEmpty(block)) {
        blocks.push(block);
        block = [];
      }
      continue;
    }
    if (_.isNil(blockStartIndent)) {
      continue;
    }

    if (currentIndent > blockStartIndent) {
      block.push(line);
    } else {
      if (!_.isEmpty(block)) {
        blocks.push(block);
        block = [];
      }
      blockStartIndent = null;
    }
  }
  if (!_.isEmpty(block)) {
    blocks.push(block);
  }

  const result: string[] = [];
  for (const item of blocks) {
    let hasCategory = false;
    let isLauncherCategory = false;
    for (const line of item) {
      const match = categoryNameRe.exec(line);
      if (!match) {
        continue;
      }

      hasCategory = true;
      isLauncherCategory = match[1] === LAUNCHER_CATEGORY;
      break;
    }
    // On older Android versions the category name
    // might not be listed, so we just try to fetch
    // all matches instead
    if (hasCategory && !isLauncherCategory) {
      continue;
    }

    for (const activityNameStr of item.map(_.trim).filter(Boolean)) {
      const fqActivityName = activityNameStr.split(/\s+/)[1];
      if (!matchComponentName(fqActivityName)) {
        continue;
      }

      if (isLauncherCategory) {
        return [fqActivityName];
      }
      result.push(fqActivityName);
    }
  }
  return result;
}

/**
 * Check if the given string is a valid component name
 *
 * @param classString - The string to verify
 * @returns The result of Regexp.exec operation
 * or _null_ if no matches are found
 */
export function matchComponentName(classString: string): RegExpExecArray | null {
  // some.package/some.package.Activity
  return /^[\p{L}0-9./_]+$/u.exec(classString);
}

/**
 * Retrieves the list of permission names encoded in `dumpsys package` command output.
 *
 * @param dumpsysOutput - The actual command output.
 * @param groupNames - The list of group names to list permissions for.
 * @param grantedState - The expected state of `granted` attribute to filter with.
 *  No filtering is done if the parameter is not set.
 * @returns The list of matched permission names or an empty list if no matches were found.
 */
export function extractMatchingPermissions(
  dumpsysOutput: string,
  groupNames: string[],
  grantedState: boolean | null = null,
): string[] {
  const groupPatternByName = (groupName: string) =>
    new RegExp(`^(\\s*${_.escapeRegExp(groupName)} permissions:[\\s\\S]+)`, 'm');
  const indentPattern = /\S|$/;
  const permissionNamePattern = /android\.\w*\.?permission\.\w+/;
  const grantedStatePattern = /\bgranted=(\w+)/;
  const result: Array<{permission: string; granted?: boolean}> = [];
  for (const groupName of groupNames) {
    const groupMatch = groupPatternByName(groupName).exec(dumpsysOutput);
    if (!groupMatch) {
      continue;
    }

    const lines = groupMatch[1].split('\n');
    if (lines.length < 2) {
      continue;
    }

    const titleIndent = lines[0].search(indentPattern);
    for (const line of lines.slice(1)) {
      const currentIndent = line.search(indentPattern);
      if (currentIndent <= titleIndent) {
        break;
      }

      const permissionNameMatch = permissionNamePattern.exec(line);
      if (!permissionNameMatch) {
        continue;
      }
      const item: {permission: string; granted?: boolean} = {
        permission: permissionNameMatch[0],
      };
      const grantedStateMatch = grantedStatePattern.exec(line);
      if (grantedStateMatch) {
        item.granted = grantedStateMatch[1] === 'true';
      }
      result.push(item);
    }
  }

  const filteredResult = result
    .filter((item) => !_.isBoolean(grantedState) || item.granted === grantedState)
    .map((item) => item.permission);
  log.debug(
    `Retrieved ${util.pluralize('permission', filteredResult.length, true)} ` +
      `from ${groupNames} ${util.pluralize('group', groupNames.length, false)}`,
  );
  return filteredResult;
}

/**
 * Broadcast a message to the given intent.
 *
 * @param intent - The name of the intent to broadcast to.
 * @throws {Error} If intent name is not a valid class name.
 */
export async function broadcast(this: ADB, intent: string): Promise<void> {
  if (!this.isValidClass(intent)) {
    throw new Error(`Invalid intent ${intent}`);
  }
  log.debug(`Broadcasting: ${intent}`);
  await this.shell(['am', 'broadcast', '-a', intent]);
}

/**
 * Get the list of process ids for the particular package on the device under test.
 *
 * @param pkg - The package name
 * @returns The list of matched process IDs or an empty list.
 */
export async function listAppProcessIds(this: ADB, pkg: string): Promise<number[]> {
  log.debug(`Getting IDs of all '${pkg}' package`);
  const pidRegex = new RegExp(`ProcessRecord\\{[\\w]+\\s+(\\d+):${_.escapeRegExp(pkg)}\\/`);
  const processesInfo = await this.shell(['dumpsys', 'activity', 'processes']);
  const pids = processesInfo
    .split('\n')
    .map((line) => line.match(pidRegex))
    .filter((match) => !!match)
    .map(([, pidStr]) => parseInt(pidStr, 10));
  return _.uniq(pids);
}

/**
 * Check whether the process with the particular name is running on the device
 * under test.
 *
 * @param pkg - The id of the package to be checked.
 * @returns True if the given package is running.
 */
export async function isAppRunning(this: ADB, pkg: string): Promise<boolean> {
  return !_.isEmpty(await this.listAppProcessIds(pkg));
}

// Private methods

/**
 * Parses optional intent arguments from a string.
 *
 * @param value - Expect optionalIntentArguments to be a single string of the form:
 *     "-flag key"
 *     "-flag key value"
 * or a combination of these (e.g., "-flag1 key1 -flag2 key2 value2")
 * @returns Parsed arguments array
 */
function parseOptionalIntentArguments(value: string): string[] {
  // take a string and parse out the part before any spaces, and anything after
  // the first space
  const parseKeyValue = (str: string): string[] => {
    str = str.trim();
    const spacePos = str.indexOf(' ');
    if (spacePos < 0) {
      return str.length ? [str] : [];
    } else {
      return [str.substring(0, spacePos).trim(), str.substring(spacePos + 1).trim()];
    }
  };

  // cycle through the optionalIntentArguments and pull out the arguments
  // add a space initially so flags can be distinguished from arguments that
  // have internal hyphens
  let optionalIntentArguments = ` ${value}`;
  const re = / (-[^\s]+) (.+)/;
  const result: string[] = [];
  while (true) {
    const args = re.exec(optionalIntentArguments);
    if (!args) {
      if (optionalIntentArguments.length) {
        // no more flags, so the remainder can be treated as 'key' or 'key value'
        result.push(...parseKeyValue(optionalIntentArguments));
      }
      // we are done
      return result;
    }

    // take the flag and see if it is at the beginning of the string
    // if it is not, then it means we have been through already, and
    // what is before the flag is the argument for the previous flag
    const flag = args[1];
    const flagPos = optionalIntentArguments.indexOf(flag);
    if (flagPos !== 0) {
      const prevArgs = optionalIntentArguments.substring(0, flagPos);
      result.push(...parseKeyValue(prevArgs));
    }

    // add the flag, as there are no more earlier arguments
    result.push(flag);

    // make optionalIntentArguments hold the remainder
    optionalIntentArguments = args[2];
  }
}

/**
 * Escapes special characters in command line arguments.
 * This is needed to avoid possible issues with how system `spawn`
 * call handles them.
 * See https://discuss.appium.io/t/how-to-modify-wd-proxy-and-uiautomator2-source-code-to-support-unicode/33466
 * for more details.
 *
 * @param arg - Non-escaped argument string
 * @returns The escaped argument
 */
function escapeShellArg(arg: string): string {
  arg = `${arg}`;
  if (system.isWindows()) {
    return /[&|^\s]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
  }
  return arg.replace(/&/g, '\\&');
}

// Type definitions

export interface StartCmdOptions {
  user?: number | string;
  waitForLaunch?: boolean;
  pkg?: string;
  activity?: string;
  action?: string;
  category?: string;
  stopApp?: boolean;
  flags?: string;
  optionalIntentArguments?: string;
}
