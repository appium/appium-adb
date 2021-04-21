import log from '../logger.js';
import {
  getIMEListFromOutput, isShowingLockscreen, isCurrentFocusOnKeyguard,
  getSurfaceOrientation, isScreenOnFully, extractMatchingPermissions,
} from '../helpers.js';
import path from 'path';
import _ from 'lodash';
import { fs, util } from 'appium-support';
import { EOL } from 'os';
import Logcat from '../logcat';
import { sleep, waitForCondition } from 'asyncbox';
import { SubProcess } from 'teen_process';
import B from 'bluebird';

const MAX_SHELL_BUFFER_LENGTH = 1000;
const NOT_CHANGEABLE_PERM_ERROR = /not a changeable permission type/i;
const IGNORED_PERM_ERRORS = [
  NOT_CHANGEABLE_PERM_ERROR,
  /Unknown permission/i,
];
const MAX_PGREP_PATTERN_LEN = 15;
const HIDDEN_API_POLICY_KEYS = [
  'hidden_api_policy_pre_p_apps',
  'hidden_api_policy_p_apps',
  'hidden_api_policy'
];
const PID_COLUMN_TITLE = 'PID';
const PROCESS_NAME_COLUMN_TITLE = 'NAME';
const PS_TITLE_PATTERN = new RegExp(`^(.*\\b${PID_COLUMN_TITLE}\\b.*\\b${PROCESS_NAME_COLUMN_TITLE}\\b.*)$`, 'm');


const methods = {};

/**
 * Creates chunks for the given arguments and executes them in `adb shell`.
 * This is faster than calling `adb shell` separately for each arg, however
 * there is a limit for a maximum length of a single adb command. that is why
 * we need all this complicated logic.
 *
 * @param {Function} argTransformer A function, that receives single argument
 * from the `args` array and transforms it into a shell command. The result
 * of the function must be an array, where each item is a part of a single command.
 * The last item of the array could be ';'. If this is not a semicolon then it is going to
 * be added automatically.
 * @param {Array<number|string>} args Array of argument values to create chunks for
 * @throws {Error} If any of the chunks returns non-zero exit code after being executed
 */
methods.shellChunks = async function shellChunks (argTransformer, args) {
  const commands = [];
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
};

/**
 * Get the path to adb executable amd assign it
 * to this.executable.path and this.binaries.adb properties.
 *
 * @return {ADB} ADB instance.
 */
methods.getAdbWithCorrectAdbPath = async function getAdbWithCorrectAdbPath () {
  this.executable.path = await this.getSdkBinaryPath('adb');
  return this.adb;
};

/**
 * Get the full path to aapt tool and assign it to
 * this.binaries.aapt property
 */
methods.initAapt = async function initAapt () {
  await this.getSdkBinaryPath('aapt');
};

/**
 * Get the full path to aapt2 tool and assign it to
 * this.binaries.aapt2 property
 */
methods.initAapt2 = async function initAapt2 () {
  await this.getSdkBinaryPath('aapt2');
};

/**
 * Get the full path to zipalign tool and assign it to
 * this.binaries.zipalign property
 */
methods.initZipAlign = async function initZipAlign () {
  await this.getSdkBinaryPath('zipalign');
};

/**
 * Get the full path to bundletool binary and assign it to
 * this.binaries.bundletool property
 */
methods.initBundletool = async function initBundletool () {
  try {
    this.binaries.bundletool = await fs.which('bundletool.jar');
  } catch (err) {
    throw new Error('bundletool.jar binary is expected to be present in PATH. ' +
      'Visit https://github.com/google/bundletool for more details.');
  }
};

/**
 * Retrieve the API level of the device under test.
 *
 * @return {number} The API level as integer number, for example 21 for
 *                  Android Lollipop. The result of this method is cached, so all the further
 * calls return the same value as the first one.
 */
methods.getApiLevel = async function getApiLevel () {
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
      throw new Error(`Error getting device API level. Original error: ${e.message}`);
    }
  }
  return this._apiLevel;
};

/**
 * Retrieve the platform version of the device under test.
 *
 * @return {string} The platform version as a string, for example '5.0' for
 * Android Lollipop.
 */
methods.getPlatformVersion = async function getPlatformVersion () {
  log.info('Getting device platform version');
  try {
    return await this.getDeviceProperty('ro.build.version.release');
  } catch (e) {
    throw new Error(`Error getting device platform version. Original error: ${e.message}`);
  }
};

/**
 * Verify whether a device is connected.
 *
 * @return {boolean} True if at least one device is visible to adb.
 */
methods.isDeviceConnected = async function isDeviceConnected () {
  let devices = await this.getConnectedDevices();
  return devices.length > 0;
};

/**
 * Recursively create a new folder on the device under test.
 *
 * @param {string} remotePath - The new path to be created.
 * @return {string} mkdir command output.
 */
methods.mkdir = async function mkdir (remotePath) {
  return await this.shell(['mkdir', '-p', remotePath]);
};

/**
 * Verify whether the given argument is a
 * valid class name.
 *
 * @param {string} classString - The actual class name to be verified.
 * @return {?Array.<Match>} The result of Regexp.exec operation
 *                          or _null_ if no matches are found.
 */
methods.isValidClass = function isValidClass (classString) {
  // some.package/some.package.Activity
  return new RegExp(/^[a-zA-Z0-9./_]+$/).exec(classString);
};

/**
 * Force application to stop on the device under test.
 *
 * @param {string} pkg - The package name to be stopped.
 * @return {string} The output of the corresponding adb command.
 */
methods.forceStop = async function forceStop (pkg) {
  return await this.shell(['am', 'force-stop', pkg]);
};

/*
 * Kill application
 *
 * @param {string} pkg - The package name to be stopped.
 * @return {string} The output of the corresponding adb command.
 */
methods.killPackage = async function killPackage (pkg) {
  return await this.shell(['am', 'kill', pkg]);
};

/**
 * Clear the user data of the particular application on the device
 * under test.
 *
 * @param {string} pkg - The package name to be cleared.
 * @return {string} The output of the corresponding adb command.
 */
methods.clear = async function clear (pkg) {
  return await this.shell(['pm', 'clear', pkg]);
};

/**
 * Grant all permissions requested by the particular package.
 * This method is only useful on Android 6.0+ and for applications
 * that support components-based permissions setting.
 *
 * @param {string} pkg - The package name to be processed.
 * @param {string} apk - The path to the actual apk file.
 * @throws {Error} If there was an error while granting permissions
 */
methods.grantAllPermissions = async function grantAllPermissions (pkg, apk) {
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
  } catch (e) {
    //avoiding logging error stack, as calling library function would have logged
    log.warn(`Ran into problem getting target SDK version; ignoring...`);
  }
  if (apiLevel >= 23 && targetSdk >= 23) {
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
  }
};

/**
 * Grant multiple permissions for the particular package.
 * This call is more performant than `grantPermission` one, since it combines
 * multiple `adb shell` calls into a single command.
 *
 * @param {string} pkg - The package name to be processed.
 * @param {Array<string>} permissions - The list of permissions to be granted.
 * @throws {Error} If there was an error while changing permissions.
 */
methods.grantPermissions = async function grantPermissions (pkg, permissions) {
  // As it consumes more time for granting each permission,
  // trying to grant all permission by forming equivalent command.
  // Also, it is necessary to split long commands into chunks, since the maximum length of
  // adb shell buffer is limited
  log.debug(`Granting permissions ${JSON.stringify(permissions)} to '${pkg}'`);
  try {
    await this.shellChunks((perm) => ['pm', 'grant', pkg, perm], permissions);
  } catch (e) {
    if (!IGNORED_PERM_ERRORS.some((pattern) => pattern.test(e.stderr || e.message))) {
      throw e;
    }
  }
};

/**
 * Grant single permission for the particular package.
 *
 * @param {string} pkg - The package name to be processed.
 * @param {string} permission - The full name of the permission to be granted.
 * @throws {Error} If there was an error while changing permissions.
 */
methods.grantPermission = async function grantPermission (pkg, permission) {
  try {
    await this.shell(['pm', 'grant', pkg, permission]);
  } catch (e) {
    if (!NOT_CHANGEABLE_PERM_ERROR.test(e.stderr || e.message)) {
      throw e;
    }
  }
};

/**
 * Revoke single permission from the particular package.
 *
 * @param {string} pkg - The package name to be processed.
 * @param {string} permission - The full name of the permission to be revoked.
 * @throws {Error} If there was an error while changing permissions.
 */
methods.revokePermission = async function revokePermission (pkg, permission) {
  try {
    await this.shell(['pm', 'revoke', pkg, permission]);
  } catch (e) {
    if (!NOT_CHANGEABLE_PERM_ERROR.test(e.stderr || e.message)) {
      throw e;
    }
  }
};

/**
 * Retrieve the list of granted permissions for the particular package.
 *
 * @param {string} pkg - The package name to be processed.
 * @param {string} cmdOutput [null] - Optional parameter containing command output of
 *                                    _dumpsys package_ command. It may speed up the method execution.
 * @return {Array<String>} The list of granted permissions or an empty list.
 * @throws {Error} If there was an error while changing permissions.
 */
methods.getGrantedPermissions = async function getGrantedPermissions (pkg, cmdOutput = null) {
  log.debug('Retrieving granted permissions');
  const stdout = cmdOutput || await this.shell(['dumpsys', 'package', pkg]);
  return extractMatchingPermissions(stdout, ['install', 'runtime'], true);
};

/**
 * Retrieve the list of denied permissions for the particular package.
 *
 * @param {string} pkg - The package name to be processed.
 * @param {string} cmdOutput [null] - Optional parameter containing command output of
 *                                    _dumpsys package_ command. It may speed up the method execution.
 * @return {Array<String>} The list of denied permissions or an empty list.
 */
methods.getDeniedPermissions = async function getDeniedPermissions (pkg, cmdOutput = null) {
  log.debug('Retrieving denied permissions');
  const stdout = cmdOutput || await this.shell(['dumpsys', 'package', pkg]);
  return extractMatchingPermissions(stdout, ['install', 'runtime'], false);
};

/**
 * Retrieve the list of requested permissions for the particular package.
 *
 * @param {string} pkg - The package name to be processed.
 * @param {string} cmdOutput [null] - Optional parameter containing command output of
 *                                    _dumpsys package_ command. It may speed up the method execution.
 * @return {Array<String>} The list of requested permissions or an empty list.
 */
methods.getReqPermissions = async function getReqPermissions (pkg, cmdOutput = null) {
  log.debug('Retrieving requested permissions');
  const stdout = cmdOutput || await this.shell(['dumpsys', 'package', pkg]);
  return extractMatchingPermissions(stdout, ['requested']);
};

/**
 * Retrieve the list of location providers for the device under test.
 *
 * @return {Array.<String>} The list of available location providers or an empty list.
 */
methods.getLocationProviders = async function getLocationProviders () {
  let stdout = await this.getSetting('secure', 'location_providers_allowed');
  return stdout.trim().split(',')
    .map((p) => p.trim())
    .filter(Boolean);
};

/**
 * Toggle the state of GPS location provider.
 *
 * @param {boolean} enabled - Whether to enable (true) or disable (false) the GPS provider.
 */
methods.toggleGPSLocationProvider = async function toggleGPSLocationProvider (enabled) {
  await this.setSetting('secure', 'location_providers_allowed', `${enabled ? '+' : '-'}gps`);
};

/**
 * Set hidden api policy to manage access to non-SDK APIs.
 * https://developer.android.com/preview/restrictions-non-sdk-interfaces
 *
 * @param {number|string} value - The API enforcement policy.
 *     For Android P
 *     0: Disable non-SDK API usage detection. This will also disable logging, and also break the strict mode API,
 *        detectNonSdkApiUsage(). Not recommended.
 *     1: "Just warn" - permit access to all non-SDK APIs, but keep warnings in the log.
 *        The strict mode API will keep working.
 *     2: Disallow usage of dark grey and black listed APIs.
 *     3: Disallow usage of blacklisted APIs, but allow usage of dark grey listed APIs.
 *
 *     For Android Q
 *     https://developer.android.com/preview/non-sdk-q#enable-non-sdk-access
 *     0: Disable all detection of non-SDK interfaces. Using this setting disables all log messages for non-SDK interface usage
 *        and prevents you from testing your app using the StrictMode API. This setting is not recommended.
 *     1: Enable access to all non-SDK interfaces, but print log messages with warnings for any non-SDK interface usage.
 *        Using this setting also allows you to test your app using the StrictMode API.
 *     2: Disallow usage of non-SDK interfaces that belong to either the black list
 *        or to a restricted greylist for your target API level.
 *
 * @param {boolean} ignoreError [false] Whether to ignore an exception in 'adb shell settings put global' command
 * @throws {error} If there was an error and ignoreError was true while executing 'adb shell settings put global'
 *                 command on the device under test.
 */
methods.setHiddenApiPolicy = async function setHiddenApiPolicy (value, ignoreError = false) {
  try {
    await this.shell(HIDDEN_API_POLICY_KEYS.map((k) => `settings put global ${k} ${value}`).join(';'));
  } catch (e) {
    if (!ignoreError) {
      throw e;
    }
    log.info(`Failed to set setting keys '${HIDDEN_API_POLICY_KEYS}' to '${value}'. Original error: ${e.message}`);
  }
};

/**
 * Reset access to non-SDK APIs to its default setting.
 * https://developer.android.com/preview/restrictions-non-sdk-interfaces
 *
 * @param {boolean} ignoreError [false] Whether to ignore an exception in 'adb shell settings delete global' command
 * @throws {error} If there was an error and ignoreError was true while executing 'adb shell settings delete global'
 *                 command on the device under test.
 */
methods.setDefaultHiddenApiPolicy = async function setDefaultHiddenApiPolicy (ignoreError = false) {
  try {
    await this.shell(HIDDEN_API_POLICY_KEYS.map((k) => `settings delete global ${k}`).join(';'));
  } catch (e) {
    if (!ignoreError) {
      throw e;
    }
    log.info(`Failed to delete keys '${HIDDEN_API_POLICY_KEYS}'. Original error: ${e.message}`);
  }
};

/**
 * Stop the particular package if it is running and clears its application data.
 *
 * @param {string} pkg - The package name to be processed.
 */
methods.stopAndClear = async function stopAndClear (pkg) {
  try {
    await this.forceStop(pkg);
    await this.clear(pkg);
  } catch (e) {
    throw new Error(`Cannot stop and clear ${pkg}. Original error: ${e.message}`);
  }
};

/**
 * Retrieve the list of available input methods (IMEs) for the device under test.
 *
 * @return {Array.<String>} The list of IME names or an empty list.
 */
methods.availableIMEs = async function availableIMEs () {
  try {
    return getIMEListFromOutput(await this.shell(['ime', 'list', '-a']));
  } catch (e) {
    throw new Error(`Error getting available IME's. Original error: ${e.message}`);
  }
};

/**
 * Retrieve the list of enabled input methods (IMEs) for the device under test.
 *
 * @return {Array.<String>} The list of enabled IME names or an empty list.
 */
methods.enabledIMEs = async function enabledIMEs () {
  try {
    return getIMEListFromOutput(await this.shell(['ime', 'list']));
  } catch (e) {
    throw new Error(`Error getting enabled IME's. Original error: ${e.message}`);
  }
};

/**
 * Enable the particular input method on the device under test.
 *
 * @param {string} imeId - One of existing IME ids.
 */
methods.enableIME = async function enableIME (imeId) {
  await this.shell(['ime', 'enable', imeId]);
};

/**
 * Disable the particular input method on the device under test.
 *
 * @param {string} imeId - One of existing IME ids.
 */
methods.disableIME = async function disableIME (imeId) {
  await this.shell(['ime', 'disable', imeId]);
};

/**
 * Set the particular input method on the device under test.
 *
 * @param {string} imeId - One of existing IME ids.
 */
methods.setIME = async function setIME (imeId) {
  await this.shell(['ime', 'set', imeId]);
};

/**
 * Get the default input method on the device under test.
 *
 * @return {?string} The name of the default input method
 */
methods.defaultIME = async function defaultIME () {
  try {
    let engine = await this.getSetting('secure', 'default_input_method');
    if (engine === 'null') {
      return null;
    }
    return engine.trim();
  } catch (e) {
    throw new Error(`Error getting default IME. Original error: ${e.message}`);
  }
};

/**
 * Send the particular keycode to the device under test.
 *
 * @param {string|number} keycode - The actual key code to be sent.
 */
methods.keyevent = async function keyevent (keycode) {
  // keycode must be an int.
  let code = parseInt(keycode, 10);
  await this.shell(['input', 'keyevent', code]);
};

/**
 * Send the particular text to the device under test.
 *
 * @param {string} text - The actual text to be sent.
 */
methods.inputText = async function inputText (text) {
  /* eslint-disable no-useless-escape */
  // need to escape whitespace and ( ) < > | ; & * \ ~ " '
  text = text
          .replace(/\\/g, '\\\\')
          .replace(/\(/g, '\(')
          .replace(/\)/g, '\)')
          .replace(/</g, '\<')
          .replace(/>/g, '\>')
          .replace(/\|/g, '\|')
          .replace(/;/g, '\;')
          .replace(/&/g, '\&')
          .replace(/\*/g, '\*')
          .replace(/~/g, '\~')
          .replace(/"/g, '\"')
          .replace(/'/g, "\'")
          .replace(/ /g, '%s');
  /* eslint-disable no-useless-escape */
  await this.shell(['input', 'text', text]);
};

/**
 * Clear the active text field on the device under test by sending
 * special keyevents to it.
 *
 * @param {number} length [100] - The maximum length of the text in the field to be cleared.
 */
methods.clearTextField = async function clearTextField (length = 100) {
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
};

/**
 * Send the special keycode to the device under test in order to lock it.
 */
methods.lock = async function lock () {
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
  } catch (e) {
    throw new Error(`The device screen is still locked after ${timeoutMs}ms timeout`);
  }
};

/**
 * Send the special keycode to the device under test in order to emulate
 * Back button tap.
 */
methods.back = async function back () {
  log.debug('Pressing the BACK button');
  await this.keyevent(4);
};

/**
 * Send the special keycode to the device under test in order to emulate
 * Home button tap.
 */
methods.goToHome = async function goToHome () {
  log.debug('Pressing the HOME button');
  await this.keyevent(3);
};

/**
 * @return {string} the actual path to adb executable.
 */
methods.getAdbPath = function getAdbPath () {
  return this.executable.path;
};

/**
 * Retrieve current screen orientation of the device under test.
 *
 * @return {number} The current orientation encoded as an integer number.
 */
methods.getScreenOrientation = async function getScreenOrientation () {
  let stdout = await this.shell(['dumpsys', 'input']);
  return getSurfaceOrientation(stdout);
};

/**
 * Retrieve the screen lock state of the device under test.
 *
 * @return {boolean} True if the device is locked.
 */
methods.isScreenLocked = async function isScreenLocked () {
  let stdout = await this.shell(['dumpsys', 'window']);
  if (process.env.APPIUM_LOG_DUMPSYS) {
    // optional debugging
    // if the method is not working, turn it on and send us the output
    let dumpsysFile = path.resolve(process.cwd(), 'dumpsys.log');
    log.debug(`Writing dumpsys output to ${dumpsysFile}`);
    await fs.writeFile(dumpsysFile, stdout);
  }
  return (isShowingLockscreen(stdout) || isCurrentFocusOnKeyguard(stdout) ||
          !isScreenOnFully(stdout));
};

/**
 * @typedef {Object} KeyboardState
 * @property {boolean} isKeyboardShown - Whether soft keyboard is currently visible.
 * @property {boolean} canCloseKeyboard - Whether the keyboard can be closed.
 */

/**
 * Retrieve the state of the software keyboard on the device under test.
 *
 * @return {KeyboardState} The keyboard state.
 */
methods.isSoftKeyboardPresent = async function isSoftKeyboardPresent () {
  try {
    const stdout = await this.shell(['dumpsys', 'input_method']);
    const inputShownMatch = /mInputShown=(\w+)/.exec(stdout);
    const inputViewShownMatch = /mIsInputViewShown=(\w+)/.exec(stdout);
    return {
      isKeyboardShown: !!(inputShownMatch && inputShownMatch[1] === 'true'),
      canCloseKeyboard: !!(inputViewShownMatch && inputViewShownMatch[1] === 'true'),
    };
  } catch (e) {
    throw new Error(`Error finding softkeyboard. Original error: ${e.message}`);
  }
};

/**
 * Send an arbitrary Telnet command to the device under test.
 *
 * @param {string} command - The command to be sent.
 *
 * @return {string} The actual output of the given command.
 */
methods.sendTelnetCommand = async function sendTelnetCommand (command) {
  return await this.execEmuConsoleCommand(command, {port: await this.getEmulatorPort()});
};

/**
 * Check the state of Airplane mode on the device under test.
 *
 * @return {boolean} True if Airplane mode is enabled.
 */
methods.isAirplaneModeOn = async function isAirplaneModeOn () {
  let stdout = await this.getSetting('global', 'airplane_mode_on');
  return parseInt(stdout, 10) !== 0;
};

/**
 * Change the state of Airplane mode in Settings on the device under test.
 *
 * @param {boolean} on - True to enable the Airplane mode in Settings and false to disable it.
 */
methods.setAirplaneMode = async function setAirplaneMode (on) {
  await this.setSetting('global', 'airplane_mode_on', on ? 1 : 0);
};

/**
 * Broadcast the state of Airplane mode on the device under test.
 * This method should be called after {@link #setAirplaneMode}, otherwise
 * the mode change is not going to be applied for the device.
 *
 * @param {boolean} on - True to broadcast enable and false to broadcast disable.
 */
methods.broadcastAirplaneMode = async function broadcastAirplaneMode (on) {
  await this.shell([
    'am', 'broadcast',
    '-a', 'android.intent.action.AIRPLANE_MODE',
    '--ez', 'state', on ? 'true' : 'false'
  ]);
};

/**
 * Check the state of WiFi on the device under test.
 *
 * @return {boolean} True if WiFi is enabled.
 */
methods.isWifiOn = async function isWifiOn () {
  let stdout = await this.getSetting('global', 'wifi_on');
  return (parseInt(stdout, 10) !== 0);
};

/**
 * Check the state of Data transfer on the device under test.
 *
 * @return {boolean} True if Data transfer is enabled.
 */
methods.isDataOn = async function isDataOn () {
  let stdout = await this.getSetting('global', 'mobile_data');
  return (parseInt(stdout, 10) !== 0);
};

/**
 * Change the state of WiFi and/or Data transfer on the device under test.
 *
 * @param {boolean} wifi - True to enable and false to disable WiFi.
 * @param {boolean} data - True to enable and false to disable Data transfer.
 * @param {boolean} isEmulator [false] - Set it to true if the device under test
 *                                       is an emulator rather than a real device.
 */
methods.setWifiAndData = async function setWifiAndData ({wifi, data}, isEmulator = false) {
  if (util.hasValue(wifi)) {
    await this.setWifiState(wifi, isEmulator);
  }
  if (util.hasValue(data)) {
    await this.setDataState(data, isEmulator);
  }
};

/**
 * Check the state of animation on the device under test.
 *
 * @return {boolean} True if at least one of animation scale settings
 *                   is not equal to '0.0'.
 */
methods.isAnimationOn = async function isAnimationOn () {
  let animator_duration_scale = await this.getSetting('global', 'animator_duration_scale');
  let transition_animation_scale = await this.getSetting('global', 'transition_animation_scale');
  let window_animation_scale = await this.getSetting('global', 'window_animation_scale');
  return _.some([animator_duration_scale, transition_animation_scale, window_animation_scale],
                (setting) => setting !== '0.0');
};

/**
 * Forcefully recursively remove a path on the device under test.
 * Be careful while calling this method.
 *
 * @param {string} path - The path to be removed recursively.
 */
methods.rimraf = async function rimraf (path) {
  await this.shell(['rm', '-rf', path]);
};

/**
 * Send a file to the device under test.
 *
 * @param {string} localPath - The path to the file on the local file system.
 * @param {string} remotePath - The destination path on the remote device.
 * @param {object} opts - Additional options mapping. See
 *                        https://github.com/appium/node-teen_process,
 *                        _exec_ method options, for more information about available
 *                        options.
 */
methods.push = async function push (localPath, remotePath, opts) {
  await this.mkdir(path.posix.dirname(remotePath));
  await this.adbExec(['push', localPath, remotePath], opts);
};

/**
 * Receive a file from the device under test.
 *
 * @param {string} remotePath - The source path on the remote device.
 * @param {string} localPath - The destination path to the file on the local file system.
 */
methods.pull = async function pull (remotePath, localPath) {
  // pull folder can take more time, increasing time out to 60 secs
  await this.adbExec(['pull', remotePath, localPath], {timeout: 60000});
};

/**
 * Check whether the process with the particular name is running on the device
 * under test.
 *
 * @param {string} processName - The name of the process to be checked.
 * @return {boolean} True if the given process is running.
 * @throws {Error} If the given process name is not a valid class name.
 */
methods.processExists = async function processExists (processName) {
  return !_.isEmpty(await this.getPIDsByName(processName));
};

/**
 * Get TCP port forwarding with adb on the device under test.
 * @return {Array.<String>} The output of the corresponding adb command. An array contains each forwarding line of output
 */
methods.getForwardList = async function getForwardList () {
  log.debug(`List forwarding ports`);
  const connections = await this.adbExec(['forward', '--list']);
  return connections.split(EOL).filter((line) => Boolean(line.trim()));
};

/**
 * Setup TCP port forwarding with adb on the device under test.
 *
 * @param {string|number} systemPort - The number of the local system port.
 * @param {string|number} devicePort - The number of the remote device port.
 */
methods.forwardPort = async function forwardPort (systemPort, devicePort) {
  log.debug(`Forwarding system: ${systemPort} to device: ${devicePort}`);
  await this.adbExec(['forward', `tcp:${systemPort}`, `tcp:${devicePort}`]);
};

/**
 * Remove TCP port forwarding with adb on the device under test. The forwarding
 * for the given port should be setup with {@link #forwardPort} first.
 *
 * @param {string|number} systemPort - The number of the local system port
 *                                     to remove forwarding on.
 */
methods.removePortForward = async function removePortForward (systemPort) {
  log.debug(`Removing forwarded port socket connection: ${systemPort} `);
  await this.adbExec(['forward', `--remove`, `tcp:${systemPort}`]);
};

/**
 * Get TCP port forwarding with adb on the device under test.
 * @return {Array.<String>} The output of the corresponding adb command. An array contains each forwarding line of output
 */
methods.getReverseList = async function getReverseList () {
  log.debug(`List reverse forwarding ports`);
  const connections = await this.adbExec(['reverse', '--list']);
  return connections.split(EOL).filter((line) => Boolean(line.trim()));
};

/**
 * Setup TCP port forwarding with adb on the device under test.
 * Only available for API 21+.
 *
 * @param {string|number} devicePort - The number of the remote device port.
 * @param {string|number} systemPort - The number of the local system port.
 */
methods.reversePort = async function reversePort (devicePort, systemPort) {
  log.debug(`Forwarding device: ${devicePort} to system: ${systemPort}`);
  await this.adbExec(['reverse', `tcp:${devicePort}`, `tcp:${systemPort}`]);
};

/**
 * Remove TCP port forwarding with adb on the device under test. The forwarding
 * for the given port should be setup with {@link #forwardPort} first.
 *
 * @param {string|number} devicePort - The number of the remote device port
 *                                     to remove forwarding on.
 */
methods.removePortReverse = async function removePortReverse (devicePort) {
  log.debug(`Removing reverse forwarded port socket connection: ${devicePort} `);
  await this.adbExec(['reverse', `--remove`, `tcp:${devicePort}`]);
};

/**
 * Setup TCP port forwarding with adb on the device under test. The difference
 * between {@link #forwardPort} is that this method does setup for an abstract
 * local port.
 *
 * @param {string|number} systemPort - The number of the local system port.
 * @param {string|number} devicePort - The number of the remote device port.
 */
methods.forwardAbstractPort = async function forwardAbstractPort (systemPort, devicePort) {
  log.debug(`Forwarding system: ${systemPort} to abstract device: ${devicePort}`);
  await this.adbExec(['forward', `tcp:${systemPort}`, `localabstract:${devicePort}`]);
};

/**
 * Execute ping shell command on the device under test.
 *
 * @return {boolean} True if the command output contains 'ping' substring.
 * @throws {error} If there was an error while executing 'ping' command on the
 *                 device under test.
 */
methods.ping = async function ping () {
  let stdout = await this.shell(['echo', 'ping']);
  if (stdout.indexOf('ping') === 0) {
    return true;
  }
  throw new Error(`ADB ping failed, returned ${stdout}`);
};

/**
 * Restart the device under test using adb commands.
 *
 * @throws {error} If start fails.
 */
methods.restart = async function restart () {
  try {
    await this.stopLogcat();
    await this.restartAdb();
    await this.waitForDevice(60);
    await this.startLogcat(this._logcatStartupParams);
  } catch (e) {
    throw new Error(`Restart failed. Original error: ${e.message}`);
  }
};

/**
 * @typedef {Object} LogcatOpts
 * @property {string} format The log print format, where <format> is one of:
 *   brief process tag thread raw time threadtime long
 * `threadtime` is the default value.
 * @property {Array<string>} filterSpecs Series of <tag>[:priority]
 * where <tag> is a log component tag (or * for all) and priority is:
 *  V    Verbose
 *  D    Debug
 *  I    Info
 *  W    Warn
 *  E    Error
 *  F    Fatal
 *  S    Silent (supress all output)
 *
 * '*' means '*:d' and <tag> by itself means <tag>:v
 *
 * If not specified on the commandline, filterspec is set from ANDROID_LOG_TAGS.
 * If no filterspec is found, filter defaults to '*:I'
 */

/**
 * Start the logcat process to gather logs.
 *
 * @param {?LogcatOpts} opts
 * @throws {Error} If restart fails.
 */
methods.startLogcat = async function startLogcat (opts = {}) {
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
};

/**
 * Stop the active logcat process which gathers logs.
 * The call will be ignored if no logcat process is running.
 */
methods.stopLogcat = async function stopLogcat () {
  if (_.isEmpty(this.logcat)) {
    return;
  }
  try {
    await this.logcat.stopCapture();
  } finally {
    this.logcat = null;
  }
};

/**
 * Retrieve the output from the currently running logcat process.
 * The logcat process should be executed by {2link #startLogcat} method.
 *
 * @return {string} The collected logcat output.
 * @throws {Error} If logcat process is not running.
 */
methods.getLogcatLogs = function getLogcatLogs () {
  if (_.isEmpty(this.logcat)) {
    throw new Error("Can't get logcat logs since logcat hasn't started");
  }
  return this.logcat.getLogs();
};

/**
 * Set the callback for the logcat output event.
 *
 * @param {Function} listener - The listener function, which accepts one argument. The argument is
 *                              a log record object with `timestamp`, `level` and `message` properties.
 * @throws {Error} If logcat process is not running.
 */
methods.setLogcatListener = function setLogcatListener (listener) {
  if (_.isEmpty(this.logcat)) {
    throw new Error("Logcat process hasn't been started");
  }
  this.logcat.on('output', listener);
};

/**
 * Removes the previously set callback for the logcat output event.
 *
 * @param {Function} listener - The listener function, which has been previously
 *                              passed to `setLogcatListener`
 * @throws {Error} If logcat process is not running.
 */
methods.removeLogcatListener = function removeLogcatListener (listener) {
  if (_.isEmpty(this.logcat)) {
    throw new Error("Logcat process hasn't been started");
  }
  this.logcat.removeListener('output', listener);
};

/**
 * At some point of time Google has changed the default `ps` behaviour, so it only
 * lists processes that belong to the current shell user rather to all
 * users. It is necessary to execute ps with -A command line argument
 * to mimic the previous behaviour.
 *
 * @returns {string} the output of `ps` command where all processes are included
 */
methods.listProcessStatus = async function listProcessStatus () {
  if (!_.isBoolean(this._doesPsSupportAOption)) {
    try {
      this._doesPsSupportAOption = /^-A\b/m.test(await this.shell(['ps', '--help']));
    } catch (e) {
      log.debug(e.stack);
      this._doesPsSupportAOption = false;
    }
  }
  return await this.shell(this._doesPsSupportAOption ? ['ps', '-A'] : ['ps']);
};

/**
 * Returns process name for the given process identifier
 *
 * @param {string|number} pid - The valid process identifier
 * @throws {Error} If the given PID is either invalid or is not present
 * in the active processes list
 * @returns {string} The process name
 */
methods.getNameByPid = async function getNameByPid (pid) {
  if (isNaN(pid)) {
    throw new Error(`The PID value must be a valid number. '${pid}' is given instead`);
  }
  pid = parseInt(pid, 10);

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
};

/**
 * Get the list of process ids for the particular process on the device under test.
 *
 * @param {string} name - The part of process name.
 * @return {Array.<number>} The list of matched process IDs or an empty list.
 * @throws {Error} If the passed process name is not a valid one
 */
methods.getPIDsByName = async function getPIDsByName (name) {
  log.debug(`Getting IDs of all '${name}' processes`);
  if (!this.isValidClass(name)) {
    throw new Error(`Invalid process name: '${name}'`);
  }
  // https://github.com/appium/appium/issues/13567
  if (await this.getApiLevel() >= 23) {
    if (!_.isBoolean(this._isPgrepAvailable)) {
      // pgrep is in priority, since pidof has been reported of having bugs on some platforms
      const pgrepOutput = _.trim(await this.shell(['pgrep --help; echo $?']));
      this._isPgrepAvailable = parseInt(_.last(pgrepOutput.split(/\s+/)), 10) === 0;
      if (this._isPgrepAvailable) {
        this._canPgrepUseFullCmdLineSearch = /^-f\b/m.test(pgrepOutput);
      } else {
        this._isPidofAvailable = parseInt(await this.shell(['pidof --help > /dev/null; echo $?']), 10) === 0;
      }
    }
    if (this._isPgrepAvailable || this._isPidofAvailable) {
      const shellCommand = this._isPgrepAvailable
        ? (this._canPgrepUseFullCmdLineSearch
          ? ['pgrep', '-f', _.escapeRegExp(`([[:blank:]]|^)${name}([[:blank:]]|$)`)]
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
        // error code 1 is returned if the utility did not find any processes
        // with the given name
        if (e.code !== 1) {
          throw new Error(`Could not extract process ID of '${name}': ${e.message}`);
        }
        if (_.includes(e.stderr || e.stdout, 'syntax error')) {
          log.warn(`Got an unexpected response from the shell interpreter: ${e.stderr || e.stdout}`);
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
    if (pidIndex >= allTitles.length || isNaN(items[pidIndex])) {
      log.debug(stdout);
      throw new Error(`Could not extract PID of '${name}' from '${matchedLine[1].trim()}'`);
    }
    pids.push(parseInt(items[pidIndex], 10));
  }
  return pids;
};

/**
 * Get the list of process ids for the particular process on the device under test.
 *
 * @param {string} name - The part of process name.
 * @return {Array.<number>} The list of matched process IDs or an empty list.
 */
methods.killProcessesByName = async function killProcessesByName (name) {
  try {
    log.debug(`Attempting to kill all ${name} processes`);
    const pids = await this.getPIDsByName(name);
    if (_.isEmpty(pids)) {
      log.info(`No '${name}' process has been found`);
    } else {
      await B.all(pids.map((p) => this.killProcessByPID(p)));
    }
  } catch (e) {
    throw new Error(`Unable to kill ${name} processes. Original error: ${e.message}`);
  }
};

/**
 * Kill the particular process on the device under test.
 * The current user is automatically switched to root if necessary in order
 * to properly kill the process.
 *
 * @param {string|number} pid - The ID of the process to be killed.
 * @throws {Error} If the process cannot be killed.
 */
methods.killProcessByPID = async function killProcessByPID (pid) {
  log.debug(`Attempting to kill process ${pid}`);
  const noProcessFlag = 'No such process';
  try {
    // Check if the process exists and throw an exception otherwise
    await this.shell(['kill', pid]);
  } catch (e) {
    if (_.includes(e.stderr, noProcessFlag)) {
      return;
    }
    if (!_.includes(e.stderr, 'Operation not permitted')) {
      throw e;
    }
    log.info(`Cannot kill PID ${pid} due to insufficient permissions. Retrying as root`);
    try {
      await this.shell(['kill', pid], {
        privileged: true
      });
    } catch (e1) {
      if (_.includes(e1.stderr, noProcessFlag)) {
        return;
      }
      throw e1;
    }
  }
};

/**
 * Broadcast process killing on the device under test.
 *
 * @param {string} intent - The name of the intent to broadcast to.
 * @param {string} processName - The name of the killed process.
 * @throws {error} If the process was not killed.
 */
methods.broadcastProcessEnd = async function broadcastProcessEnd (intent, processName) {
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
    throw new Error(`Unable to broadcast process end. Original error: ${e.message}`);
  }
};

/**
 * Broadcast a message to the given intent.
 *
 * @param {string} intent - The name of the intent to broadcast to.
 * @throws {error} If intent name is not a valid class name.
 */
methods.broadcast = async function broadcast (intent) {
  if (!this.isValidClass(intent)) {
    throw new Error(`Invalid intent ${intent}`);
  }
  log.debug(`Broadcasting: ${intent}`);
  await this.shell(['am', 'broadcast', '-a', intent]);
};

/**
 * Kill Android instruments if they are currently running.
 */
methods.endAndroidCoverage = async function endAndroidCoverage () {
  if (this.instrumentProc && this.instrumentProc.isRunning) {
    await this.instrumentProc.stop();
  }
};

/**
 * Instrument the particular activity.
 *
 * @param {string} pkg - The name of the package to be instrumented.
 * @param {string} activity - The name of the main activity in this package.
 * @param {string} instrumentWith - The name of the package to instrument
 *                                  the activity with.
 * @throws {error} If any exception is reported by adb shell.
 */
methods.instrument = async function instrument (pkg, activity, instrumentWith) {
  if (activity[0] !== '.') {
    pkg = '';
  }
  let pkgActivity = (pkg + activity).replace(/\.+/g, '.'); // Fix pkg..activity error
  let stdout = await this.shell([
    'am', 'instrument',
    '-e', 'main_activity',
    pkgActivity,
    instrumentWith,
  ]);
  if (stdout.indexOf('Exception') !== -1) {
    throw new Error(`Unknown exception during instrumentation. Original error ${stdout.split('\n')[0]}`);
  }
};

/**
 * Collect Android coverage by instrumenting the particular activity.
 *
 * @param {string} instrumentClass - The name of the instrumentation class.
 * @param {string} waitPkg - The name of the package to be instrumented.
 * @param {string} waitActivity - The name of the main activity in this package.
 *
 * @return {promise} The promise is successfully resolved if the instrumentation starts
 *                   without errors.
 */
methods.androidCoverage = async function androidCoverage (instrumentClass, waitPkg, waitActivity) {
  if (!this.isValidClass(instrumentClass)) {
    throw new Error(`Invalid class ${instrumentClass}`);
  }
  return await new B(async (resolve, reject) => {
    let args = this.executable.defaultArgs
      .concat(['shell', 'am', 'instrument', '-e', 'coverage', 'true', '-w'])
      .concat([instrumentClass]);
    log.debug(`Collecting coverage data with: ${[this.executable.path].concat(args).join(' ')}`);
    try {
      // am instrument runs for the life of the app process.
      this.instrumentProc = new SubProcess(this.executable.path, args);
      await this.instrumentProc.start(0);
      this.instrumentProc.on('output', (stdout, stderr) => {
        if (stderr) {
          reject(new Error(`Failed to run instrumentation. Original error: ${stderr}`));
        }
      });
      await this.waitForActivity(waitPkg, waitActivity);
      resolve();
    } catch (e) {
      reject(new Error(`Android coverage failed. Original error: ${e.message}`));
    }
  });
};

/**
 * Get the particular property of the device under test.
 *
 * @param {string} property - The name of the property. This name should
 *                            be known to _adb shell getprop_ tool.
 *
 * @return {string} The value of the given property.
 */
methods.getDeviceProperty = async function getDeviceProperty (property) {
  let stdout = await this.shell(['getprop', property]);
  let val = stdout.trim();
  log.debug(`Current device property '${property}': ${val}`);
  return val;
};

/**
 * @typedef {object} setPropOpts
 * @property {boolean} privileged - Do we run setProp as a privileged command? Default true.
 */

/**
 * Set the particular property of the device under test.
 *
 * @param {string} property - The name of the property. This name should
 *                            be known to _adb shell setprop_ tool.
 * @param {string} val - The new property value.
 * @param {setPropOpts} opts
 *
 * @throws {error} If _setprop_ utility fails to change property value.
 */
methods.setDeviceProperty = async function setDeviceProperty (prop, val, opts = {}) {
  const {privileged = true} = opts;
  log.debug(`Setting device property '${prop}' to '${val}'`);
  await this.shell(['setprop', prop, val], {
    privileged,
  });
};

/**
 * @return {string} Current system language on the device under test.
 */
methods.getDeviceSysLanguage = async function getDeviceSysLanguage () {
  return await this.getDeviceProperty('persist.sys.language');
};

/**
 * @return {string} Current country name on the device under test.
 */
methods.getDeviceSysCountry = async function getDeviceSysCountry () {
  return await this.getDeviceProperty('persist.sys.country');
};

/**
 * @return {string} Current system locale name on the device under test.
 */
methods.getDeviceSysLocale = async function getDeviceSysLocale () {
  return await this.getDeviceProperty('persist.sys.locale');
};

/**
 * @return {string} Current product language name on the device under test.
 */
methods.getDeviceProductLanguage = async function getDeviceProductLanguage () {
  return await this.getDeviceProperty('ro.product.locale.language');
};

/**
 * @return {string} Current product country name on the device under test.
 */
methods.getDeviceProductCountry = async function getDeviceProductCountry () {
  return await this.getDeviceProperty('ro.product.locale.region');
};

/**
 * @return {string} Current product locale name on the device under test.
 */
methods.getDeviceProductLocale = async function getDeviceProductLocale () {
  return await this.getDeviceProperty('ro.product.locale');
};

/**
 * @return {string} The model name of the device under test.
 */
methods.getModel = async function getModel () {
  return await this.getDeviceProperty('ro.product.model');
};

/**
 * @return {string} The manufacturer name of the device under test.
 */
methods.getManufacturer = async function getManufacturer () {
  return await this.getDeviceProperty('ro.product.manufacturer');
};

/**
 * Get the current screen size.
 *
 * @return {string} Device screen size as string in format 'WxH' or
 *                  _null_ if it cannot be determined.
 */
methods.getScreenSize = async function getScreenSize () {
  let stdout = await this.shell(['wm', 'size']);
  let size = new RegExp(/Physical size: ([^\r?\n]+)*/g).exec(stdout);
  if (size && size.length >= 2) {
    return size[1].trim();
  }
  return null;
};

/**
 * Get the current screen density in dpi
 *
 * @return {?number} Device screen density as a number or _null_ if it
 *                  cannot be determined
 */
methods.getScreenDensity = async function getScreenDensity () {
  let stdout = await this.shell(['wm', 'density']);
  let density = new RegExp(/Physical density: ([^\r?\n]+)*/g).exec(stdout);
  if (density && density.length >= 2) {
    let densityNumber = parseInt(density[1].trim(), 10);
    return isNaN(densityNumber) ? null : densityNumber;
  }
  return null;
};

/**
 * Setup HTTP proxy in device global settings.
 * Read https://android.googlesource.com/platform/frameworks/base/+/android-9.0.0_r21/core/java/android/provider/Settings.java for each property
 *
 * @param {string} proxyHost - The host name of the proxy.
 * @param {string|number} proxyPort - The port number to be set.
 */
methods.setHttpProxy = async function setHttpProxy (proxyHost, proxyPort) {
  let proxy = `${proxyHost}:${proxyPort}`;
  if (_.isUndefined(proxyHost)) {
    throw new Error(`Call to setHttpProxy method with undefined proxy_host: ${proxy}`);
  }
  if (_.isUndefined(proxyPort)) {
    throw new Error(`Call to setHttpProxy method with undefined proxy_port ${proxy}`);
  }

  const httpProxySettins = [
    ['http_proxy', proxy],
    ['global_http_proxy_host', proxyHost],
    ['global_http_proxy_port', proxyPort]
  ];
  for (const [settingKey, settingValue] of httpProxySettins) {
    await this.setSetting('global', settingKey, settingValue);
  }
};

/**
 * Delete HTTP proxy in device global settings.
 * Rebooting the test device is necessary to apply the change.
 */
methods.deleteHttpProxy = async function deleteHttpProxy () {
  const httpProxySettins = [
    'http_proxy',
    'global_http_proxy_host',
    'global_http_proxy_port',
    'global_http_proxy_exclusion_list' // `global_http_proxy_exclusion_list=` was generated by `settings global htto_proxy xxxx`
  ];
  for (const setting of httpProxySettins) {
    await this.shell(['settings', 'delete', 'global', setting]);
  }
};

/**
 * Set device property.
 * [android.provider.Settings]{@link https://developer.android.com/reference/android/provider/Settings.html}
 *
 * @param {string} namespace - one of {system, secure, global}, case-insensitive.
 * @param {string} setting - property name.
 * @param {string|number} value - property value.
 * @return {string} command output.
 */
methods.setSetting = async function setSetting (namespace, setting, value) {
  return await this.shell(['settings', 'put', namespace, setting, value]);
};

/**
 * Get device property.
 * [android.provider.Settings]{@link https://developer.android.com/reference/android/provider/Settings.html}
 *
 * @param {string} namespace - one of {system, secure, global}, case-insensitive.
 * @param {string} setting - property name.
 * @return {string} property value.
 */
methods.getSetting = async function getSetting (namespace, setting) {
  return await this.shell(['settings', 'get', namespace, setting]);
};

/**
 * Retrieve the `adb bugreport` command output. This
 * operation may take up to several minutes.
 *
 * @param {?number} timeout [120000] - Command timeout in milliseconds
 * @returns {string} Command stdout
 */
methods.bugreport = async function bugreport (timeout = 120000) {
  return await this.adbExec(['bugreport'], {timeout});
};

/**
 * @typedef {Object} ScreenrecordOptions
 * @property {?string} videoSize - The format is widthxheight.
 *                  The default value is the device's native display resolution (if supported),
 *                  1280x720 if not. For best results,
 *                  use a size supported by your device's Advanced Video Coding (AVC) encoder.
 *                  For example, "1280x720"
 * @property {?boolean} bugReport - Set it to `true` in order to display additional information on the video overlay,
 *                                  such as a timestamp, that is helpful in videos captured to illustrate bugs.
 *                                  This option is only supported since API level 27 (Android P).
 * @property {?string|number} timeLimit - The maximum recording time, in seconds.
 *                                        The default (and maximum) value is 180 (3 minutes).
 * @property {?string|number} bitRate - The video bit rate for the video, in megabits per second.
 *                The default value is 4. You can increase the bit rate to improve video quality,
 *                but doing so results in larger movie files.
 */

/**
 * Initiate screenrecord utility on the device
 *
 * @param {string} destination - Full path to the writable media file destination
 *                               on the device file system.
 * @param {?ScreenrecordOptions} options [{}]
 * @returns {SubProcess} screenrecord process, which can be then controlled by the client code
 */
methods.screenrecord = function screenrecord (destination, options = {}) {
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
    cmd.push('--time-limit', timeLimit);
  }
  if (util.hasValue(bitRate)) {
    cmd.push('--bit-rate', bitRate);
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
};

/**
 * Executes the given function with the given input method context
 * and then restores the IME to the original value
 *
 * @param {string} ime - Valid IME identifier
 * @param {Function} fn - Function to execute
 * @returns {*} The result of the given function
 */
methods.runInImeContext = async function runInImeContext (ime, fn) {
  const originalIme = await this.defaultIME();
  if (originalIme === ime) {
    log.debug(`The original IME is the same as '${ime}'. There is no need to reset it`);
  } else {
    await this.enableIME(ime);
    await this.setIME(ime);
  }
  try {
    return await fn();
  } finally {
    if (originalIme !== ime) {
      await this.setIME(originalIme);
    }
  }
};

/**
 * Get tz database time zone formatted timezone
 *
 * @returns {string} TZ database Time Zones format
 *
 * @throws {error} If any exception is reported by adb shell.
 */
methods.getTimeZone = async function getTimeZone () {
  log.debug('Getting current timezone');
  try {
    return await this.getDeviceProperty('persist.sys.timezone');
  } catch (e) {
    throw new Error(`Error getting timezone. Original error: ${e.message}`);
  }
};

/**
 * Retrieves the list of features supported by the device under test
 *
 * @returns {Array<string>} the list of supported feature names or an empty list.
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
methods.listFeatures = async function listFeatures () {
  this._memoizedFeatures = this._memoizedFeatures
    || _.memoize(async () => await this.adbExec(['features']), () => this.curDeviceId);
  try {
    return (await this._memoizedFeatures())
      .split(/\s+/)
      .map((x) => x.trim())
      .filter(Boolean);
  } catch (e) {
    if (_.includes(e.stderr, 'unknown command')) {
      return [];
    }
    throw e;
  }
};

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
 * @returns {boolean} `true` if the feature is supported by both adb and the
 * device under test
 */
methods.isStreamedInstallSupported = async function isStreamedInstallSupported () {
  const proto = Object.getPrototypeOf(this);
  proto._helpOutput = proto._helpOutput || await this.adbExec(['help']);
  return proto._helpOutput.includes('--streaming')
    && (await this.listFeatures()).includes('cmd');
};

/**
 * Checks whether incremental install feature is supported by ADB.
 * Read https://developer.android.com/preview/features#incremental
 * for more details on it.
 *
 * @returns {boolean} `true` if the feature is supported by both adb and the
 * device under test
 */
methods.isIncrementalInstallSupported = async function isIncrementalInstallSupported () {
  const {binary} = await this.getVersion();
  if (!binary) {
    return false;
  }
  return util.compareVersions(binary.version, '>=', '30.0.1')
    && (await this.listFeatures()).includes('abb_exec');
};

/**
 * Retrieves the list of packages from Doze whitelist on Android 8+
 *
 * @returns {Array<string>} The list of whitelisted packages. An example output:
 * system,com.android.shell,2000
 * system,com.google.android.cellbroadcastreceiver,10143
 * user,io.appium.settings,10157
 */
methods.getDeviceIdleWhitelist = async function getDeviceIdleWhitelist () {
  if (await this.getApiLevel() < 23) {
    // Doze mode has only been added since Android 6
    return [];
  }

  log.info('Listing packages in Doze whitelist');
  const output = await this.shell(['dumpsys', 'deviceidle', 'whitelist']);
  return _.trim(output).split(/\n/)
    .map((line) => _.trim(line))
    .filter(Boolean);
};

/**
 * Adds an existing package(s) into the Doze whitelist on Android 8+
 *
 * @param  {...string} packages One or more packages to add. If the package
 * already exists in the whitelist then it is only going to be added once.
 * If the package with the given name is not installed/not known then an error
 * will be thrown.
 * @returns {Boolean} `true` if the command to add package(s) has been executed
 */
methods.addToDeviceIdleWhitelist = async function addToDeviceIdleWhitelist (...packages) {
  if (_.isEmpty(packages) || await this.getApiLevel() < 23) {
    // Doze mode has only been added since Android 6
    return false;
  }

  log.info(`Adding ${util.pluralize('package', packages.length)} ${JSON.stringify(packages)} to Doze whitelist`);
  await this.shellChunks((pkg) => ['dumpsys', 'deviceidle', 'whitelist', `+${pkg}`], packages);
  return true;
};

export default methods;
