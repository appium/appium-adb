import log from '../logger.js';
import {
  extractMatchingPermissions, parseLaunchableActivityNames, matchComponentName,
} from '../helpers.js';
import path from 'path';
import _ from 'lodash';
import { fs, util, tempDir } from '@appium/support';
import { EOL } from 'os';
import { Logcat } from '../logcat';
import { sleep, waitForCondition } from 'asyncbox';
import { SubProcess, exec } from 'teen_process';
import B from 'bluebird';

const MAX_SHELL_BUFFER_LENGTH = 1000;
const NOT_CHANGEABLE_PERM_ERROR = /not a changeable permission type/i;
const IGNORED_PERM_ERRORS = [
  NOT_CHANGEABLE_PERM_ERROR,
  /Unknown permission/i,
];
const MAX_PGREP_PATTERN_LEN = 15;
const PID_COLUMN_TITLE = 'PID';
const PROCESS_NAME_COLUMN_TITLE = 'NAME';
const PS_TITLE_PATTERN = new RegExp(`^(.*\\b${PID_COLUMN_TITLE}\\b.*\\b${PROCESS_NAME_COLUMN_TITLE}\\b.*)$`, 'm');
const MIN_API_LEVEL_WITH_PERMS_SUPPORT = 23;

/**
 * Creates chunks for the given arguments and executes them in `adb shell`.
 * This is faster than calling `adb shell` separately for each arg, however
 * there is a limit for a maximum length of a single adb command. that is why
 * we need all this complicated logic.
 *
 * @this {import('../adb.js').ADB}
 * @param {(x: string) => string[]} argTransformer A function, that receives single argument
 * from the `args` array and transforms it into a shell command. The result
 * of the function must be an array, where each item is a part of a single command.
 * The last item of the array could be ';'. If this is not a semicolon then it is going to
 * be added automatically.
 * @param {string[]} args Array of argument values to create chunks for
 * @throws {Error} If any of the chunks returns non-zero exit code after being executed
 */
export async function shellChunks (argTransformer, args) {
  const commands = [];
  /** @type {string[]} */
  let cmdChunk = [];
  for (const arg of args) {
    const nextCmd = argTransformer(arg);
    if (!_.isArray(nextCmd)) {
      throw new Error('Argument transformer must result in an array');
    }
    if (_.last(nextCmd) !== ';') {
      nextCmd.push(';');
    }
    if (nextCmd.join(' ').length + cmdChunk.join(' ').length >= MAX_SHELL_BUFFER_LENGTH) {
      commands.push(cmdChunk);
      cmdChunk = [];
    }
    cmdChunk = [...cmdChunk, ...nextCmd];
  }
  if (!_.isEmpty(cmdChunk)) {
    commands.push(cmdChunk);
  }
  log.debug(`Got the following command chunks to execute: ${JSON.stringify(commands)}`);
  let lastError = null;
  for (const cmd of commands) {
    try {
      await this.shell(cmd);
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError) {
    throw lastError;
  }
}

/**
 * Get the path to adb executable amd assign it
 * to this.executable.path and this.binaries.adb properties.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<import('../adb.js').ADB>} ADB instance.
 */
export async function getAdbWithCorrectAdbPath () {
  this.executable.path = await this.getSdkBinaryPath('adb');
  return this;
}

/**
 * Get the full path to aapt tool and assign it to
 * this.binaries.aapt property
 * @this {import('../adb.js').ADB}
 */
export async function initAapt () {
  await this.getSdkBinaryPath('aapt');
}

/**
 * Get the full path to aapt2 tool and assign it to
 * this.binaries.aapt2 property
 * @this {import('../adb.js').ADB}
 */
export async function initAapt2 () {
  await this.getSdkBinaryPath('aapt2');
}

/**
 * Get the full path to zipalign tool and assign it to
 * this.binaries.zipalign property
 * @this {import('../adb.js').ADB}
 */
export async function initZipAlign () {
  await this.getSdkBinaryPath('zipalign');
}

/**
 * Get the full path to bundletool binary and assign it to
 * this.binaries.bundletool property
 * @this {import('../adb.js').ADB}
 */
export async function initBundletool () {
  try {
    (/** @type {import('./types').StringRecord} */(this.binaries)).bundletool =
      await fs.which('bundletool.jar');
  } catch {
    throw new Error('bundletool.jar binary is expected to be present in PATH. ' +
      'Visit https://github.com/google/bundletool for more details.');
  }
}

/**
 * Retrieve the API level of the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<number>} The API level as integer number, for example 21 for
 *                  Android Lollipop. The result of this method is cached, so all the further
 * calls return the same value as the first one.
 */
export async function getApiLevel () {
  if (!_.isInteger(this._apiLevel)) {
    try {
      const strOutput = await this.getDeviceProperty('ro.build.version.sdk');
      let apiLevel = parseInt(strOutput.trim(), 10);

      // Workaround for preview/beta platform API level
      const charCodeQ = 'q'.charCodeAt(0);
      // 28 is the first API Level, where Android SDK started returning letters in response to getPlatformVersion
      const apiLevelDiff = apiLevel - 28;
      const codename = String.fromCharCode(charCodeQ + apiLevelDiff);
      if (apiLevelDiff >= 0 && (await this.getPlatformVersion()).toLowerCase() === codename) {
        log.debug(`Release version is ${codename.toUpperCase()} but found API Level ${apiLevel}. Setting API Level to ${apiLevel + 1}`);
        apiLevel++;
      }

      this._apiLevel = apiLevel;
      log.debug(`Device API level: ${this._apiLevel}`);
      if (isNaN(this._apiLevel)) {
        throw new Error(`The actual output '${strOutput}' cannot be converted to an integer`);
      }
    } catch (e) {
      throw new Error(
        `Error getting device API level. Original error: ${(/** @type {Error} */(e)).message}`
      );
    }
  }
  return /** @type {number} */(this._apiLevel);
}

/**
 * Verify whether a device is connected.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<boolean>} True if at least one device is visible to adb.
 */
export async function isDeviceConnected () {
  let devices = await this.getConnectedDevices();
  return devices.length > 0;
}

/**
 * Recursively create a new folder on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} remotePath - The new path to be created.
 * @return {Promise<string>} mkdir command output.
 */
export async function mkdir (remotePath) {
  return await this.shell(['mkdir', '-p', remotePath]);
}

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
 * Clear the active text field on the device under test by sending
 * special keyevents to it.
 *
 * @this {import('../adb.js').ADB}
 * @param {number} [length=100] - The maximum length of the text in the field to be cleared.
 */
export async function clearTextField (length = 100) {
  // assumes that the EditText field already has focus
  log.debug(`Clearing up to ${length} characters`);
  if (length === 0) {
    return;
  }
  let args = ['input', 'keyevent'];
  for (let i = 0; i < length; i++) {
    // we cannot know where the cursor is in the text field, so delete both before
    // and after so that we get rid of everything
    // https://developer.android.com/reference/android/view/KeyEvent.html#KEYCODE_DEL
    // https://developer.android.com/reference/android/view/KeyEvent.html#KEYCODE_FORWARD_DEL
    args.push('67', '112');
  }
  await this.shell(args);
}

/**
 * Send the special keycode to the device under test in order to lock it.
 * @this {import('../adb.js').ADB}
 */
export async function lock () {
  if (await this.isScreenLocked()) {
    log.debug('Screen is already locked. Doing nothing.');
    return;
  }
  log.debug('Pressing the KEYCODE_POWER button to lock screen');
  await this.keyevent(26);

  const timeoutMs = 5000;
  try {
    await waitForCondition(async () => await this.isScreenLocked(), {
      waitMs: timeoutMs,
      intervalMs: 500,
    });
  } catch {
    throw new Error(`The device screen is still not locked after ${timeoutMs}ms timeout`);
  }
}

/**
 * Send the special keycode to the device under test in order to emulate
 * Back button tap.
 * @this {import('../adb.js').ADB}
 */
export async function back () {
  log.debug('Pressing the BACK button');
  await this.keyevent(4);
}

/**
 * Send the special keycode to the device under test in order to emulate
 * Home button tap.
 * @this {import('../adb.js').ADB}
 */
export async function goToHome () {
  log.debug('Pressing the HOME button');
  await this.keyevent(3);
}

/**
 * @this {import('../adb.js').ADB}
 * @return {string} the actual path to adb executable.
 */
export function getAdbPath () {
  return this.executable.path;
}

/**
 * Send an arbitrary Telnet command to the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} command - The command to be sent.
 * @return {Promise<string>} The actual output of the given command.
 */
export async function sendTelnetCommand (command) {
  return await this.execEmuConsoleCommand(command, {port: await this.getEmulatorPort()});
}

/**
 * Forcefully recursively remove a path on the device under test.
 * Be careful while calling this method.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} path - The path to be removed recursively.
 */
export async function rimraf (path) {
  await this.shell(['rm', '-rf', path]);
}

/**
 * Send a file to the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} localPath - The path to the file on the local file system.
 * @param {string} remotePath - The destination path on the remote device.
 * @param {object} [opts] - Additional options mapping. See
 *                        https://github.com/appium/node-teen_process,
 *                        _exec_ method options, for more information about available
 *                        options.
 */
export async function push (localPath, remotePath, opts) {
  await this.mkdir(path.posix.dirname(remotePath));
  await this.adbExec(['push', localPath, remotePath], opts);
}

/**
 * Receive a file from the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} remotePath - The source path on the remote device.
 * @param {string} localPath - The destination path to the file on the local file system.
 * @param {import('teen_process').TeenProcessExecOptions} [opts={}] - Additional options mapping. See
 * https://github.com/appium/node-teen_process,
 * _exec_ method options, for more information about available
 * options.
 */
export async function pull (remotePath, localPath, opts = {}) {
  // pull folder can take more time, increasing time out to 60 secs
  await this.adbExec(['pull', remotePath, localPath], {...opts, timeout: opts.timeout ?? 60000});
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
 * Get TCP port forwarding with adb on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<string[]>} The output of the corresponding adb command.
 * An array contains each forwarding line of output
 */
export async function getForwardList () {
  log.debug(`List forwarding ports`);
  const connections = await this.adbExec(['forward', '--list']);
  return connections.split(EOL).filter((line) => Boolean(line.trim()));
}

/**
 * Setup TCP port forwarding with adb on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string|number} systemPort - The number of the local system port.
 * @param {string|number} devicePort - The number of the remote device port.
 */
export async function forwardPort (systemPort, devicePort) {
  log.debug(`Forwarding system: ${systemPort} to device: ${devicePort}`);
  await this.adbExec(['forward', `tcp:${systemPort}`, `tcp:${devicePort}`]);
}

/**
 * Remove TCP port forwarding with adb on the device under test. The forwarding
 * for the given port should be setup with {@link #forwardPort} first.
 *
 * @this {import('../adb.js').ADB}
 * @param {string|number} systemPort - The number of the local system port
 *                                     to remove forwarding on.
 */
export async function removePortForward (systemPort) {
  log.debug(`Removing forwarded port socket connection: ${systemPort} `);
  await this.adbExec(['forward', `--remove`, `tcp:${systemPort}`]);
}

/**
 * Get TCP port forwarding with adb on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<string[]>} The output of the corresponding adb command.
 * An array contains each forwarding line of output
 */
export async function getReverseList () {
  log.debug(`List reverse forwarding ports`);
  const connections = await this.adbExec(['reverse', '--list']);
  return connections.split(EOL).filter((line) => Boolean(line.trim()));
}

/**
 * Setup TCP port forwarding with adb on the device under test.
 * Only available for API 21+.
 *
 * @this {import('../adb.js').ADB}
 * @param {string|number} devicePort - The number of the remote device port.
 * @param {string|number} systemPort - The number of the local system port.
 */
export async function reversePort (devicePort, systemPort) {
  log.debug(`Forwarding device: ${devicePort} to system: ${systemPort}`);
  await this.adbExec(['reverse', `tcp:${devicePort}`, `tcp:${systemPort}`]);
}

/**
 * Remove TCP port forwarding with adb on the device under test. The forwarding
 * for the given port should be setup with {@link #forwardPort} first.
 *
 * @this {import('../adb.js').ADB}
 * @param {string|number} devicePort - The number of the remote device port
 *                                     to remove forwarding on.
 */
export async function removePortReverse (devicePort) {
  log.debug(`Removing reverse forwarded port socket connection: ${devicePort} `);
  await this.adbExec(['reverse', `--remove`, `tcp:${devicePort}`]);
}

/**
 * Setup TCP port forwarding with adb on the device under test. The difference
 * between {@link #forwardPort} is that this method does setup for an abstract
 * local port.
 *
 * @this {import('../adb.js').ADB}
 * @param {string|number} systemPort - The number of the local system port.
 * @param {string|number} devicePort - The number of the remote device port.
 */
export async function forwardAbstractPort (systemPort, devicePort) {
  log.debug(`Forwarding system: ${systemPort} to abstract device: ${devicePort}`);
  await this.adbExec(['forward', `tcp:${systemPort}`, `localabstract:${devicePort}`]);
}

/**
 * Execute ping shell command on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<boolean>} True if the command output contains 'ping' substring.
 * @throws {Error} If there was an error while executing 'ping' command on the
 *                 device under test.
 */
export async function ping () {
  let stdout = await this.shell(['echo', 'ping']);
  if (stdout.indexOf('ping') === 0) {
    return true;
  }
  throw new Error(`ADB ping failed, returned ${stdout}`);
}

/**
 * Restart the device under test using adb commands.
 *
 * @this {import('../adb.js').ADB}
 * @throws {Error} If start fails.
 */
export async function restart () {
  try {
    await this.stopLogcat();
    await this.restartAdb();
    await this.waitForDevice(60);
    await this.startLogcat(this._logcatStartupParams);
  } catch (e) {
    const err = /** @type {Error} */ (e);
    throw new Error(`Restart failed. Original error: ${err.message}`);
  }
}

/**
 * Start the logcat process to gather logs.
 *
 * @this {import('../adb.js').ADB}
 * @param {import('./types').LogcatOpts} [opts={}]
 * @throws {Error} If restart fails.
 */
export async function startLogcat (opts = {}) {
  if (!_.isEmpty(this.logcat)) {
    throw new Error("Trying to start logcat capture but it's already started!");
  }

  this.logcat = new Logcat({
    adb: this.executable,
    debug: false,
    debugTrace: false,
    clearDeviceLogsOnStart: !!this.clearDeviceLogsOnStart,
  });
  await this.logcat.startCapture(opts);
  this._logcatStartupParams = opts;
}

/**
 * Stop the active logcat process which gathers logs.
 * The call will be ignored if no logcat process is running.
 * @this {import('../adb.js').ADB}
 */
export async function stopLogcat () {
  if (_.isEmpty(this.logcat)) {
    return;
  }
  try {
    await this.logcat.stopCapture();
  } finally {
    this.logcat = undefined;
  }
}

/**
 * Retrieve the output from the currently running logcat process.
 * The logcat process should be executed by {2link #startLogcat} method.
 *
 * @this {import('../adb.js').ADB}
 * @return {import('./types').LogEntry[]} The collected logcat output.
 * @throws {Error} If logcat process is not running.
 */
export function getLogcatLogs () {
  if (_.isEmpty(this.logcat)) {
    throw new Error(`Can't get logcat logs since logcat hasn't started`);
  }
  return this.logcat.getLogs();
}

/**
 * Set the callback for the logcat output event.
 *
 * @this {import('../adb.js').ADB}
 * @param {import('./types').LogcatListener} listener - Listener function
 * @throws {Error} If logcat process is not running.
 */
export function setLogcatListener (listener) {
  if (_.isEmpty(this.logcat)) {
    throw new Error("Logcat process hasn't been started");
  }
  this.logcat.on('output', listener);
}

/**
 * Removes the previously set callback for the logcat output event.
 *
 * @this {import('../adb.js').ADB}
 * @param {import('./types').LogcatListener} listener
 * The listener function, which has been previously
 * passed to `setLogcatListener`
 * @throws {Error} If logcat process is not running.
 */
export function removeLogcatListener (listener) {
  if (_.isEmpty(this.logcat)) {
    throw new Error("Logcat process hasn't been started");
  }
  this.logcat.removeListener('output', listener);
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
 * Retrieve the `adb bugreport` command output. This
 * operation may take up to several minutes.
 *
 * @this {import('../adb.js').ADB}
 * @param {number} [timeout=120000] - Command timeout in milliseconds
 * @returns {Promise<string>} Command stdout
 */
export async function bugreport (timeout = 120000) {
  return await this.adbExec(['bugreport'], {timeout});
}

/**
 * Initiate screenrecord utility on the device
 *
 * @this {import('../adb.js').ADB}
 * @param {string} destination - Full path to the writable media file destination
 *                               on the device file system.
 * @param {import('./types').ScreenrecordOptions} [options={}]
 * @returns {SubProcess} screenrecord process, which can be then controlled by the client code
 */
export function screenrecord (destination, options = {}) {
  const cmd = ['screenrecord'];
  const {
    videoSize,
    bitRate,
    timeLimit,
    bugReport,
  } = options;
  if (util.hasValue(videoSize)) {
    cmd.push('--size', videoSize);
  }
  if (util.hasValue(timeLimit)) {
    cmd.push('--time-limit', `${timeLimit}`);
  }
  if (util.hasValue(bitRate)) {
    cmd.push('--bit-rate', `${bitRate}`);
  }
  if (bugReport) {
    cmd.push('--bugreport');
  }
  cmd.push(destination);

  const fullCmd = [
    ...this.executable.defaultArgs,
    'shell',
    ...cmd
  ];
  log.debug(`Building screenrecord process with the command line: adb ${util.quote(fullCmd)}`);
  return new SubProcess(this.executable.path, fullCmd);
}

/**
 * Retrieves the list of features supported by the device under test
 *
 * @this {import('../adb.js').ADB}
 * @returns {Promise<string[]>} the list of supported feature names or an empty list.
 * An example adb command output:
 * ```
 * cmd
 * ls_v2
 * fixed_push_mkdir
 * shell_v2
 * abb
 * stat_v2
 * apex
 * abb_exec
 * remount_shell
 * fixed_push_symlink_timestamp
 * ```
 * @throws {Error} if there was an error while retrieving the list
 */
export async function listFeatures () {
  this._memoizedFeatures = this._memoizedFeatures
    || _.memoize(async () => await this.adbExec(['features']), () => this.curDeviceId);
  try {
    return (await this._memoizedFeatures())
      .split(/\s+/)
      .map((x) => x.trim())
      .filter(Boolean);
  } catch (e) {
    const err = /** @type {import('teen_process').ExecError} */ (e);
    if (_.includes(err.stderr, 'unknown command')) {
      return [];
    }
    throw err;
  }
}

/**
 * Checks the state of streamed install feature.
 * This feature allows to speed up apk installation
 * since it does not require the original apk to be pushed to
 * the device under test first, which also saves space.
 * Although, it is required that both the device under test
 * and the adb server have the mentioned functionality.
 * See https://github.com/aosp-mirror/platform_system_core/blob/master/adb/client/adb_install.cpp
 * for more details
 *
 * @this {import('../adb.js').ADB}
 * @returns {Promise<boolean>} `true` if the feature is supported by both adb and the
 * device under test
 */
export async function isStreamedInstallSupported () {
  const proto = Object.getPrototypeOf(this);
  proto._helpOutput = proto._helpOutput || await this.adbExec(['help']);
  return proto._helpOutput.includes('--streaming')
    && (await this.listFeatures()).includes('cmd');
}

/**
 * Checks whether incremental install feature is supported by ADB.
 * Read https://developer.android.com/preview/features#incremental
 * for more details on it.
 *
 * @this {import('../adb.js').ADB}
 * @returns {Promise<boolean>} `true` if the feature is supported by both adb and the
 * device under test
 */
export async function isIncrementalInstallSupported () {
  const {binary} = await this.getVersion();
  if (!binary) {
    return false;
  }
  return util.compareVersions(`${binary.version}`, '>=', '30.0.1')
    && (await this.listFeatures()).includes('abb_exec');
}

/**
 * Takes a screenshot of the given display or the default display.
 *
 * @this {import('../adb.js').ADB}
 * @param {number|string?} displayId A valid display identifier. If
 * no identifier is provided then the screenshot of the default display is returned.
 * Note that only recent Android APIs provide multi-screen support.
 * @returns {Promise<Buffer>} PNG screenshot payload
 */
export async function takeScreenshot (displayId) {
  const args = [...this.executable.defaultArgs, 'exec-out', 'screencap', '-p'];
  // @ts-ignore This validation works as expected
  const displayIdStr = isNaN(displayId) ? null : `${displayId}`;
  if (displayIdStr) {
    args.push('-d', displayIdStr);
  }
  const displayDescr = displayIdStr ? 'default display' : `display #${displayIdStr}`;
  let stdout;
  try {
    ({stdout} = await exec(
      this.executable.path, args, {encoding: 'binary', isBuffer: true}
    ));
  } catch (e) {
    const err = /** @type {import('teen_process').ExecError} */ (e);
    throw new Error(
      `Screenshot of the ${displayDescr} failed. ` +
      // @ts-ignore The output is a buffer
      `Code: '${err.code}', output: '${(err.stderr.length ? err.stderr : err.stdout).toString('utf-8')}'`
    );
  }
  if (stdout.length === 0) {
    throw new Error(`Screenshot of the ${displayDescr} returned no data`);
  }
  return stdout;
}

/**
 * Returns the list of TCP port states of the given family.
 * Could be empty if no ports are opened.
 *
 * @this {import('../adb.js').ADB}
 * @param {import('./types').PortFamily} [family='4']
 * @returns {Promise<import('./types').PortInfo[]>}
 */
export async function listPorts(family = '4') {
  const sourceProcName = `/proc/net/tcp${family === '6' ? '6' : ''}`;
  const output = await this.shell(['cat', sourceProcName]);
  const lines = output.split('\n');
  if (_.isEmpty(lines)) {
    log.debug(output);
    throw new Error(`Cannot parse the payload of ${sourceProcName}`);
  }
  //   sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt  uid  timeout inode
  const colHeaders = lines[0].split(/\s+/).filter(Boolean);
  const localAddressCol = colHeaders.findIndex((x) => x === 'local_address');
  const stateCol = colHeaders.findIndex((x) => x === 'st');
  if (localAddressCol < 0 || stateCol < 0) {
    log.debug(lines[0]);
    throw new Error(`Cannot parse the header row of ${sourceProcName} payload`);
  }
  /** @type {import('./types').PortInfo[]} */
  const result = [];
  // 2: 1002000A:D036 24CE3AD8:01BB 08 00000000:00000000 00:00000000 00000000 10132 0 49104 1 0000000000000000 21 4 20 10 -1
  for (const line of lines.slice(1)) {
    const values = line.split(/\s+/).filter(Boolean);
    const portStr = values[localAddressCol]?.split(':')?.[1];
    const stateStr = values[stateCol];
    if (!portStr || !stateStr) {
      continue;
    }
    result.push({
      port: parseInt(portStr, 16),
      family,
      state: parseInt(stateStr, 16),
    });
  };
  return result;
}
