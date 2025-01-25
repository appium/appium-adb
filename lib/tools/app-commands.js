import _ from 'lodash';
import { fs, tempDir, util, system } from '@appium/support';
import { log } from '../logger.js';
import { sleep, waitForCondition } from 'asyncbox';
import B from 'bluebird';
import path from 'path';

/** @type {import('./types').StringRecord<import('./types').InstallState>} */
export const APP_INSTALL_STATE = {
  UNKNOWN: 'unknown',
  NOT_INSTALLED: 'notInstalled',
  NEWER_VERSION_INSTALLED: 'newerVersionInstalled',
  SAME_VERSION_INSTALLED: 'sameVersionInstalled',
  OLDER_VERSION_INSTALLED: 'olderVersionInstalled',
};
const NOT_CHANGEABLE_PERM_ERROR = /not a changeable permission type/i;
const IGNORED_PERM_ERRORS = [
  NOT_CHANGEABLE_PERM_ERROR,
  /Unknown permission/i,
];
const MIN_API_LEVEL_WITH_PERMS_SUPPORT = 23;
const MAX_PGREP_PATTERN_LEN = 15;
const PID_COLUMN_TITLE = 'PID';
const PROCESS_NAME_COLUMN_TITLE = 'NAME';
const PS_TITLE_PATTERN = new RegExp(`^(.*\\b${PID_COLUMN_TITLE}\\b.*\\b${PROCESS_NAME_COLUMN_TITLE}\\b.*)$`, 'm');
const RESOLVER_ACTIVITY_NAME = 'android/com.android.internal.app.ResolverActivity';
const MAIN_ACTION = 'android.intent.action.MAIN';
const LAUNCHER_CATEGORY = 'android.intent.category.LAUNCHER';


/**
 * Verify whether the given argument is a
 * valid class name.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} classString - The actual class name to be verified.
 * @return {boolean} The result of Regexp.exec operation
 * or _null_ if no matches are found.
 */
export function isValidClass (classString) {
  // some.package/some.package.Activity
  return !!matchComponentName(classString);
}

/**
 * Fetches the fully qualified name of the launchable activity for the
 * given package. It is expected the package is already installed on
 * the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The target package identifier
 * @param {import('./types').ResolveActivityOptions} opts
 * @return {Promise<string>} Fully qualified name of the launchable activity
 * @throws {Error} If there was an error while resolving the activity name
 */
export async function resolveLaunchableActivity (pkg, opts = {}) {
  const { preferCmd = true } = opts;
  if (!preferCmd || await this.getApiLevel() < 24) {
    const stdout = await this.shell(['dumpsys', 'package', pkg]);
    const names = parseLaunchableActivityNames(stdout);
    if (_.isEmpty(names)) {
      log.debug(stdout);
      throw new Error(`Unable to resolve the launchable activity of '${pkg}'. Is it installed on the device?`);
    }
    if (names.length === 1) {
      return names[0];
    }

    const tmpRoot = await tempDir.openDir();
    try {
      const tmpApp = await this.pullApk(pkg, tmpRoot);
      const {apkActivity} = await this.packageAndLaunchActivityFromManifest(tmpApp);
      return /** @type {string} */ (apkActivity);
    } catch (e) {
      const err = /** @type {Error} */ (e);
      log.debug(err.stack);
      log.warn(`Unable to resolve the launchable activity of '${pkg}'. ` +
        `The very first match of the dumpsys output is going to be used. ` +
        `Original error: ${err.message}`);
      return names[0];
    } finally {
      await fs.rimraf(tmpRoot);
    }
  }
  const {stdout, stderr} = await this.shell(['cmd', 'package', 'resolve-activity', '--brief', pkg], {
    outputFormat: this.EXEC_OUTPUT_FORMAT.FULL
  });
  for (const line of (stdout || '').split('\n').map(_.trim)) {
    if (this.isValidClass(line)) {
      return line;
    }
  }
  throw new Error(
    `Unable to resolve the launchable activity of '${pkg}'. Original error: ${stderr || stdout}`
  );
}

/**
 * Force application to stop on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The package name to be stopped.
 * @return {Promise<string>} The output of the corresponding adb command.
 */
export async function forceStop (pkg) {
  return await this.shell(['am', 'force-stop', pkg]);
}

/**
 * Kill application
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The package name to be stopped.
 * @return {Promise<string>} The output of the corresponding adb command.
 */
export async function killPackage (pkg) {
  return await this.shell(['am', 'kill', pkg]);
}

/**
 * Clear the user data of the particular application on the device
 * under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The package name to be cleared.
 * @return {Promise<string>} The output of the corresponding adb command.
 */
export async function clear (pkg) {
  return await this.shell(['pm', 'clear', pkg]);
}

/**
 * Grant all permissions requested by the particular package.
 * This method is only useful on Android 6.0+ and for applications
 * that support components-based permissions setting.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The package name to be processed.
 * @param {string} [apk] - The path to the actual apk file.
 * @throws {Error} If there was an error while granting permissions
 */
export async function grantAllPermissions (pkg, apk) {
  const apiLevel = await this.getApiLevel();
  let targetSdk = 0;
  let dumpsysOutput = null;
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
  if (apiLevel >= MIN_API_LEVEL_WITH_PERMS_SUPPORT && targetSdk >= MIN_API_LEVEL_WITH_PERMS_SUPPORT) {
    /**
     * If the device is running Android 6.0(API 23) or higher, and your app's target SDK is 23 or higher:
     * The app has to list the permissions in the manifest.
     * refer: https://developer.android.com/training/permissions/requesting.html
     */
    dumpsysOutput = dumpsysOutput || await this.shell(['dumpsys', 'package', pkg]);
    const requestedPermissions = await this.getReqPermissions(pkg, dumpsysOutput);
    const grantedPermissions = await this.getGrantedPermissions(pkg, dumpsysOutput);
    const permissionsToGrant = _.difference(requestedPermissions, grantedPermissions);
    if (_.isEmpty(permissionsToGrant)) {
      log.info(`${pkg} contains no permissions available for granting`);
    } else {
      await this.grantPermissions(pkg, permissionsToGrant);
    }
  } else if (targetSdk < MIN_API_LEVEL_WITH_PERMS_SUPPORT) {
    log.info(`It is only possible to grant permissions in runtime for ` +
      `apps whose targetSdkVersion in the manifest is set to ${MIN_API_LEVEL_WITH_PERMS_SUPPORT} or above. ` +
      `The current ${pkg} targetSdkVersion is ${targetSdk || 'unset'}.`);
  } else if (apiLevel < MIN_API_LEVEL_WITH_PERMS_SUPPORT) {
    log.info(`The device's OS API level is ${apiLevel}. ` +
      `It is only possible to grant permissions on devices running Android 6 or above.`);
  }
}

/**
 * Grant multiple permissions for the particular package.
 * This call is more performant than `grantPermission` one, since it combines
 * multiple `adb shell` calls into a single command.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The package name to be processed.
 * @param {Array<string>} permissions - The list of permissions to be granted.
 * @throws {Error} If there was an error while changing permissions.
 */
export async function grantPermissions (pkg, permissions) {
  // As it consumes more time for granting each permission,
  // trying to grant all permission by forming equivalent command.
  // Also, it is necessary to split long commands into chunks, since the maximum length of
  // adb shell buffer is limited
  log.debug(`Granting permissions ${JSON.stringify(permissions)} to '${pkg}'`);
  try {
    await this.shellChunks((perm) => ['pm', 'grant', pkg, perm], permissions);
  } catch (e) {
    const err = /** @type {import('teen_process').ExecError} */(e);
    if (!IGNORED_PERM_ERRORS.some((pattern) => pattern.test(err.stderr || err.message))) {
      throw err;
    }
  }
}

/**
 * Grant single permission for the particular package.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The package name to be processed.
 * @param {string} permission - The full name of the permission to be granted.
 * @throws {Error} If there was an error while changing permissions.
 */
export async function grantPermission (pkg, permission) {
  try {
    await this.shell(['pm', 'grant', pkg, permission]);
  } catch (e) {
    const err = /** @type {import('teen_process').ExecError} */(e);
    if (!NOT_CHANGEABLE_PERM_ERROR.test(err.stderr || err.message)) {
      throw err;
    }
  }
}

/**
 * Revoke single permission from the particular package.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The package name to be processed.
 * @param {string} permission - The full name of the permission to be revoked.
 * @throws {Error} If there was an error while changing permissions.
 */
export async function revokePermission (pkg, permission) {
  try {
    await this.shell(['pm', 'revoke', pkg, permission]);
  } catch (e) {
    const err = /** @type {import('teen_process').ExecError} */(e);
    if (!NOT_CHANGEABLE_PERM_ERROR.test(err.stderr || err.message)) {
      throw err;
    }
  }
}

/**
 * Retrieve the list of granted permissions for the particular package.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The package name to be processed.
 * @param {string?} [cmdOutput=null] - Optional parameter containing command output of
 * _dumpsys package_ command. It may speed up the method execution.
 * @return {Promise<string[]>} The list of granted permissions or an empty list.
 * @throws {Error} If there was an error while changing permissions.
 */
export async function getGrantedPermissions (pkg, cmdOutput = null) {
  log.debug('Retrieving granted permissions');
  const stdout = cmdOutput || await this.shell(['dumpsys', 'package', pkg]);
  return extractMatchingPermissions(stdout, ['install', 'runtime'], true);
}

/**
 * Retrieve the list of denied permissions for the particular package.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The package name to be processed.
 * @param {string?} [cmdOutput=null] - Optional parameter containing command output of
 * _dumpsys package_ command. It may speed up the method execution.
 * @return {Promise<string[]>} The list of denied permissions or an empty list.
 */
export async function getDeniedPermissions (pkg, cmdOutput = null) {
  log.debug('Retrieving denied permissions');
  const stdout = cmdOutput || await this.shell(['dumpsys', 'package', pkg]);
  return extractMatchingPermissions(stdout, ['install', 'runtime'], false);
}

/**
 * Retrieve the list of requested permissions for the particular package.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The package name to be processed.
 * @param {string?} [cmdOutput=null] - Optional parameter containing command output of
 *                                    _dumpsys package_ command. It may speed up the method execution.
 * @return {Promise<string[]>} The list of requested permissions or an empty list.
 */
export async function getReqPermissions (pkg, cmdOutput = null) {
  log.debug('Retrieving requested permissions');
  const stdout = cmdOutput || await this.shell(['dumpsys', 'package', pkg]);
  return extractMatchingPermissions(stdout, ['requested']);
}

/**
 * Stop the particular package if it is running and clears its application data.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The package name to be processed.
 */
export async function stopAndClear (pkg) {
  try {
    await this.forceStop(pkg);
    await this.clear(pkg);
  } catch (e) {
    const err = /** @type {Error} */ (e);
    throw new Error(`Cannot stop and clear ${pkg}. Original error: ${err.message}`);
  }
}


/**
 * At some point of time Google has changed the default `ps` behaviour, so it only
 * lists processes that belong to the current shell user rather to all
 * users. It is necessary to execute ps with -A command line argument
 * to mimic the previous behaviour.
 *
 * @this {import('../adb.js').ADB}
 * @returns {Promise<string>} the output of `ps` command where all processes are included
 */
export async function listProcessStatus () {
  if (!_.isBoolean(this._doesPsSupportAOption)) {
    try {
      this._doesPsSupportAOption = /^-A\b/m.test(await this.shell(['ps', '--help']));
    } catch (e) {
      log.debug((/** @type {Error} */ (e)).stack);
      this._doesPsSupportAOption = false;
    }
  }
  return await this.shell(this._doesPsSupportAOption ? ['ps', '-A'] : ['ps']);
}

/**
 * Returns process name for the given process identifier
 *
 * @this {import('../adb.js').ADB}
 * @param {string|number} pid - The valid process identifier
 * @throws {Error} If the given PID is either invalid or is not present
 * in the active processes list
 * @returns {Promise<string>} The process name
 */
export async function getNameByPid (pid) {
  // @ts-ignore This validation works as expected
  if (isNaN(pid)) {
    throw new Error(`The PID value must be a valid number. '${pid}' is given instead`);
  }
  pid = parseInt(`${pid}`, 10);

  const stdout = await this.listProcessStatus();
  const titleMatch = PS_TITLE_PATTERN.exec(stdout);
  if (!titleMatch) {
    log.debug(stdout);
    throw new Error(`Could not get the process name for PID '${pid}'`);
  }
  const allTitles = titleMatch[1].trim().split(/\s+/);
  const pidIndex = allTitles.indexOf(PID_COLUMN_TITLE);
  // it might not be stable to take NAME by index, because depending on the
  // actual SDK the ps output might not contain an abbreviation for the S flag:
  // USER     PID   PPID  VSIZE  RSS     WCHAN    PC        NAME
  // USER     PID   PPID  VSIZE  RSS     WCHAN    PC   S    NAME
  const nameOffset = allTitles.indexOf(PROCESS_NAME_COLUMN_TITLE) - allTitles.length;
  const pidRegex = new RegExp(`^(.*\\b${pid}\\b.*)$`, 'gm');
  let matchedLine;
  while ((matchedLine = pidRegex.exec(stdout))) {
    const items = matchedLine[1].trim().split(/\s+/);
    if (parseInt(items[pidIndex], 10) === pid && items[items.length + nameOffset]) {
      return items[items.length + nameOffset];
    }
  }
  log.debug(stdout);
  throw new Error(`Could not get the process name for PID '${pid}'`);
}

/**
 * Get the list of process ids for the particular process on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} name - The part of process name.
 * @return {Promise<number[]>} The list of matched process IDs or an empty list.
 * @throws {Error} If the passed process name is not a valid one
 */
export async function getPIDsByName (name) {
  log.debug(`Getting IDs of all '${name}' processes`);
  if (!this.isValidClass(name)) {
    throw new Error(`Invalid process name: '${name}'`);
  }
  // https://github.com/appium/appium/issues/13567
  if (await this.getApiLevel() >= 23) {
    if (!_.isBoolean(this._isPgrepAvailable)) {
      // pgrep is in priority, since pidof has been reported of having bugs on some platforms
      const pgrepOutput = _.trim(await this.shell(['pgrep --help; echo $?']));
      this._isPgrepAvailable = parseInt(`${_.last(pgrepOutput.split(/\s+/))}`, 10) === 0;
      if (this._isPgrepAvailable) {
        this._canPgrepUseFullCmdLineSearch = /^-f\b/m.test(pgrepOutput);
      } else {
        this._isPidofAvailable = parseInt(await this.shell(['pidof --help > /dev/null; echo $?']), 10) === 0;
      }
    }
    if (this._isPgrepAvailable || this._isPidofAvailable) {
      const shellCommand = this._isPgrepAvailable
        ? (this._canPgrepUseFullCmdLineSearch
          ? ['pgrep', '-f', _.escapeRegExp(`([[:blank:]]|^)${name}(:[a-zA-Z0-9_-]+)?([[:blank:]]|$)`)]
          // https://github.com/appium/appium/issues/13872
          : [`pgrep ^${_.escapeRegExp(name.slice(-MAX_PGREP_PATTERN_LEN))}$ ` +
              `|| pgrep ^${_.escapeRegExp(name.slice(0, MAX_PGREP_PATTERN_LEN))}$`])
        : ['pidof', name];
      try {
        return (await this.shell(shellCommand))
          .split(/\s+/)
          .map((x) => parseInt(x, 10))
          .filter((x) => _.isInteger(x));
      } catch (e) {
        const err = /** @type {import('teen_process').ExecError} */ (e);
        // error code 1 is returned if the utility did not find any processes
        // with the given name
        if (err.code !== 1) {
          throw new Error(`Could not extract process ID of '${name}': ${err.message}`);
        }
        if (_.includes(err.stderr || err.stdout, 'syntax error')) {
          log.warn(`Got an unexpected response from the shell interpreter: ${err.stderr || err.stdout}`);
        } else {
          return [];
        }
      }
    }
  }

  log.debug('Using ps-based PID detection');
  const stdout = await this.listProcessStatus();
  const titleMatch = PS_TITLE_PATTERN.exec(stdout);
  if (!titleMatch) {
    log.debug(stdout);
    throw new Error(`Could not extract PID of '${name}' from ps output`);
  }
  const allTitles = titleMatch[1].trim().split(/\s+/);
  const pidIndex = allTitles.indexOf(PID_COLUMN_TITLE);
  const pids = [];
  const processNameRegex = new RegExp(`^(.*\\b\\d+\\b.*\\b${_.escapeRegExp(name)}\\b.*)$`, 'gm');
  let matchedLine;
  while ((matchedLine = processNameRegex.exec(stdout))) {
    const items = matchedLine[1].trim().split(/\s+/);
    // @ts-ignore This validation worka as expected
    if (pidIndex >= allTitles.length || isNaN(items[pidIndex])) {
      log.debug(stdout);
      throw new Error(`Could not extract PID of '${name}' from '${matchedLine[1].trim()}'`);
    }
    pids.push(parseInt(items[pidIndex], 10));
  }
  return pids;
}

/**
 * Get the list of process ids for the particular process on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} name - The part of process name.
 */
export async function killProcessesByName (name) {
  try {
    log.debug(`Attempting to kill all ${name} processes`);
    const pids = await this.getPIDsByName(name);
    if (_.isEmpty(pids)) {
      log.info(`No '${name}' process has been found`);
    } else {
      await B.all(pids.map((p) => this.killProcessByPID(p)));
    }
  } catch (e) {
    const err = /** @type {Error} */ (e);
    throw new Error(`Unable to kill ${name} processes. Original error: ${err.message}`);
  }
}

/**
 * Kill the particular process on the device under test.
 * The current user is automatically switched to root if necessary in order
 * to properly kill the process.
 *
 * @this {import('../adb.js').ADB}
 * @param {string|number} pid - The ID of the process to be killed.
 * @throws {Error} If the process cannot be killed.
 */
export async function killProcessByPID (pid) {
  log.debug(`Attempting to kill process ${pid}`);
  const noProcessFlag = 'No such process';
  try {
    // Check if the process exists and throw an exception otherwise
    await this.shell(['kill', `${pid}`]);
  } catch (e) {
    const err = /** @type {import('teen_process').ExecError} */ (e);
    if (_.includes(err.stderr, noProcessFlag)) {
      return;
    }
    if (!_.includes(err.stderr, 'Operation not permitted')) {
      throw err;
    }
    log.info(`Cannot kill PID ${pid} due to insufficient permissions. Retrying as root`);
    try {
      await this.shell(['kill', `${pid}`], {
        privileged: true
      });
    } catch (e1) {
      const err1 = /** @type {import('teen_process').ExecError} */ (e1);
      if (_.includes(err1.stderr, noProcessFlag)) {
        return;
      }
      throw err1;
    }
  }
}

/**
 * Broadcast process killing on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} intent - The name of the intent to broadcast to.
 * @param {string} processName - The name of the killed process.
 * @throws {error} If the process was not killed.
 */
export async function broadcastProcessEnd (intent, processName) {
  // start the broadcast without waiting for it to finish.
  this.broadcast(intent);
  // wait for the process to end
  let start = Date.now();
  let timeoutMs = 40000;
  try {
    while ((Date.now() - start) < timeoutMs) {
      if (await this.processExists(processName)) {
        // cool down
        await sleep(400);
        continue;
      }
      return;
    }
    throw new Error(`Process never died within ${timeoutMs} ms`);
  } catch (e) {
    const err = /** @type {Error} */ (e);
    throw new Error(`Unable to broadcast process end. Original error: ${err.message}`);
  }
}

/**
 * Broadcast a message to the given intent.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} intent - The name of the intent to broadcast to.
 * @throws {error} If intent name is not a valid class name.
 */
export async function broadcast (intent) {
  if (!this.isValidClass(intent)) {
    throw new Error(`Invalid intent ${intent}`);
  }
  log.debug(`Broadcasting: ${intent}`);
  await this.shell(['am', 'broadcast', '-a', intent]);
}

/**
 * Check whether the process with the particular name is running on the device
 * under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} processName - The name of the process to be checked.
 * @return {Promise<boolean>} True if the given process is running.
 * @throws {Error} If the given process name is not a valid class name.
 */
export async function processExists (processName) {
  return !_.isEmpty(await this.getPIDsByName(processName));
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

  const splitNames = (/** @type {string} */ names) => names.split(',').map(_.trim);
  const allPackages = splitNames(pkg);
  const allActivities = splitNames(activity);

  const toFullyQualifiedActivityName = (/** @type {string} */ prefix, /** @type {string} */ suffix) =>
    `${prefix}${suffix}`.replace(/\/\.?/g, '.').replace(/\.{2,}/g, '.');
  /** @type {Set<string>} */
  const possibleActivityNamesSet = new Set();
  for (const oneActivity of allActivities) {
    if (oneActivity.startsWith('.')) {
      // add the package name if activity is not full qualified
      for (const onePkg of allPackages) {
        possibleActivityNamesSet.add(toFullyQualifiedActivityName(onePkg, oneActivity));
      }
    } else {
      // accept fully qualified activity name.
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
    allPackages.map((name) => `'${name}'`).join(', ')
  );
  const possibleActivityNames = [...possibleActivityNamesSet];
  const possibleActivityPatterns = possibleActivityNames.map(
    (actName) => new RegExp(`^${actName.replace(/\./g, '\\.').replace(/\*/g, '.*?').replace(/\$/g, '\\$')}$`)
  );
  log.debug(
    `Expected activity name patterns to ${waitForStop ? 'not ' : ''}be focused within ${waitMs}ms: ` +
    possibleActivityPatterns.map((name) => `'${name}'`).join(', ')
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
      log.debug(`Focused package: ${appPackage}`);
      const fullyQualifiedActivity = toFullyQualifiedActivityName(
        appActivity.startsWith('.') ? appPackage : '',
        appActivity
      );
      log.debug(`Focused fully qualified activity name: ${fullyQualifiedActivity}`);
      const isFound = _.includes(allPackages, appPackage)
        && possibleActivityPatterns.some((p) => p.test(fullyQualifiedActivity));
      if ((!waitForStop && isFound) || (waitForStop && !isFound)) {
        return true;
      }
    }
    log.debug(
      'None of the expected package/activity combinations matched to the currently focused one. Retrying'
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
      `Consider checking the driver's troubleshooting documentation.`
    );
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

// #region Private functions

/**
 * Builds command line representation for the given
 * application startup options
 *
 * @param {StartCmdOptions} startAppOptions - Application options mapping
 * @param {number} apiLevel - The actual OS API level
 * @returns {string[]} The actual command line array
 */
export function buildStartCmd (startAppOptions, apiLevel) {
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
  const cmd = ['am', (apiLevel < 26) ? 'start' : 'start-activity'];
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
 *
 * @param {string} value expect optionalIntentArguments to be a single string of the form:
 *     "-flag key"
 *     "-flag key value"
 * or a combination of these (e.g., "-flag1 key1 -flag2 key2 value2")
 * @returns {string[]}
 */
function parseOptionalIntentArguments(value) {
  // take a string and parse out the part before any spaces, and anything after
  // the first space
  /** @type {(str: string) => string[]} */
  const parseKeyValue = (str) => {
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
  /** @type {string[]} */
  const result = [];
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
 * Parses the name of launchable package activity
 * from dumpsys output.
 *
 * @param {string} dumpsys the actual dumpsys output
 * @returns {string[]} Either the fully qualified
 * activity name as a single list item or an empty list if nothing could be parsed.
 * In Android 6 and older there is no reliable way to determine
 * the category name for the given activity, so this API just
 * returns all activity names belonging to 'android.intent.action.MAIN'
 * with the expectation that the app manifest could be parsed next
 * in order to determine category names for these.
 */
export function parseLaunchableActivityNames (dumpsys) {
  const mainActivityNameRe = new RegExp(`^\\s*${_.escapeRegExp(MAIN_ACTION)}:$`);
  const categoryNameRe = /^\s*Category:\s+"([a-zA-Z0-9._/-]+)"$/;
  const blocks = [];
  let blockStartIndent;
  let block = [];
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

  const result = [];
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
 * @param {string} classString The string to verify
 * @return {RegExpExecArray?} The result of Regexp.exec operation
 * or _null_ if no matches are found
 */
export function matchComponentName (classString) {
  // some.package/some.package.Activity
  return /^[\p{L}0-9./_]+$/u.exec(classString);
}

/**
 * Escapes special characters in command line arguments.
 * This is needed to avoid possible issues with how system `spawn`
 * call handles them.
 * See https://discuss.appium.io/t/how-to-modify-wd-proxy-and-uiautomator2-source-code-to-support-unicode/33466
 * for more details.
 *
 * @param {string} arg Non-escaped argument string
 * @returns The escaped argument
 */
function escapeShellArg (arg) {
  arg = `${arg}`;
  if (system.isWindows()) {
    return /[&|^\s]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
  }
  return arg.replace(/&/g, '\\&');
}

/**
 * Retrieves the list of permission names encoded in `dumpsys package` command output.
 *
 * @param {string} dumpsysOutput - The actual command output.
 * @param {string[]} groupNames - The list of group names to list permissions for.
 * @param {boolean?} [grantedState=null] - The expected state of `granted` attribute to filter with.
 *  No filtering is done if the parameter is not set.
 * @returns {string[]} The list of matched permission names or an empty list if no matches were found.
 */
export function extractMatchingPermissions (dumpsysOutput, groupNames, grantedState = null) {
  const groupPatternByName = (groupName) => new RegExp(`^(\\s*${_.escapeRegExp(groupName)} permissions:[\\s\\S]+)`, 'm');
  const indentPattern = /\S|$/;
  const permissionNamePattern = /android\.\w*\.?permission\.\w+/;
  const grantedStatePattern = /\bgranted=(\w+)/;
  const result = [];
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
      const item = {
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
  log.debug(`Retrieved ${util.pluralize('permission', filteredResult.length, true)} ` +
    `from ${groupNames} ${util.pluralize('group', groupNames.length, false)}`);
  return filteredResult;
};

/**
 * @typedef {Object} StartCmdOptions
 * @property {number|string} [user]
 * @property {boolean} [waitForLaunch]
 * @property {string} [pkg]
 * @property {string} [activity]
 * @property {string} [action]
 * @property {string} [category]
 * @property {boolean} [stopApp]
 * @property {string} [flags]
 * @property {string} [optionalIntentArguments]
 */

// #endregion
