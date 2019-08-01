import log from '../logger.js';
import { getIMEListFromOutput, isShowingLockscreen, isCurrentFocusOnKeyguard,
         getSurfaceOrientation, isScreenOnFully, extractMatchingPermissions } from '../helpers.js';
import path from 'path';
import _ from 'lodash';
import { fs, util } from 'appium-support';
import net from 'net';
import { EOL } from 'os';
import Logcat from '../logcat';
import { sleep, waitForCondition } from 'asyncbox';
import { SubProcess } from 'teen_process';
import B from 'bluebird';
import { quote } from 'shell-quote';


const SETTINGS_HELPER_ID = 'io.appium.settings';
const WIFI_CONNECTION_SETTING_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.WiFiConnectionSettingReceiver`;
const WIFI_CONNECTION_SETTING_ACTION = `${SETTINGS_HELPER_ID}.wifi`;
const DATA_CONNECTION_SETTING_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.DataConnectionSettingReceiver`;
const DATA_CONNECTION_SETTING_ACTION = `${SETTINGS_HELPER_ID}.data_connection`;
const ANIMATION_SETTING_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.AnimationSettingReceiver`;
const ANIMATION_SETTING_ACTION = `${SETTINGS_HELPER_ID}.animation`;
const LOCALE_SETTING_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.LocaleSettingReceiver`;
const LOCALE_SETTING_ACTION = `${SETTINGS_HELPER_ID}.locale`;
const LOCATION_SERVICE = `${SETTINGS_HELPER_ID}/.LocationService`;
const LOCATION_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.LocationInfoReceiver`;
const LOCATION_RETRIEVAL_ACTION = `${SETTINGS_HELPER_ID}.location`;
const APPIUM_IME = `${SETTINGS_HELPER_ID}/.AppiumIME`;
const MAX_SHELL_BUFFER_LENGTH = 1000;
const NOT_CHANGEABLE_PERM_ERROR = 'not a changeable permission type';

let methods = {};

/**
 * Get the path to adb executable amd assign it
 * to this.executable.path and this.binaries.adb properties.
 *
 * @return {string} Full path to adb executable.
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

      // Temp workaround. Android Q beta emulators report SDK 28 when they should be 29
      if (apiLevel === 28 && (await this.getDeviceProperty('ro.build.version.release')).toLowerCase() === 'q') {
        log.debug('Release version is Q but found API Level 28. Setting API Level to 29');
        apiLevel = 29;
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
  const commands = [];
  let cmdChunk = [];
  for (const permission of permissions) {
    const nextCmd = ['pm', 'grant', pkg, permission, ';'];
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
      // this is to give the method a chance to assign all the requested permissions
      // before to quit in case we'd like to ignore the error on the higher level
      if (!e.message.includes(NOT_CHANGEABLE_PERM_ERROR)) {
        lastError = e;
      }
    }
  }
  if (lastError) {
    throw lastError;
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
  } catch (error) {
    if (!error.message.includes(NOT_CHANGEABLE_PERM_ERROR)) {
      throw error;
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
  } catch (error) {
    if (!error.message.includes(NOT_CHANGEABLE_PERM_ERROR)) {
      throw error;
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
 */
methods.setHiddenApiPolicy = async function setHiddenApiPolicy (value) {
  await this.setSetting('global', 'hidden_api_policy_pre_p_apps', value);
  await this.setSetting('global', 'hidden_api_policy_p_apps', value);
  await this.setSetting('global', 'hidden_api_policy', value);
};

/**
 * Reset access to non-SDK APIs to its default setting.
 * https://developer.android.com/preview/restrictions-non-sdk-interfaces
 */
methods.setDefaultHiddenApiPolicy = async function setDefaultHiddenApiPolicy () {
  await this.shell(['settings', 'delete', 'global', 'hidden_api_policy_pre_p_apps']);
  await this.shell(['settings', 'delete', 'global', 'hidden_api_policy_p_apps']);
  await this.shell(['settings', 'delete', 'global', 'hidden_api_policy']);
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
  log.debug(`Sending telnet command to device: ${command}`);
  let port = await this.getEmulatorPort();
  return await new B((resolve, reject) => {
    let conn = net.createConnection(port, 'localhost'),
        connected = false,
        readyRegex = /^OK$/m,
        dataStream = '',
        res = null;
    conn.on('connect', () => {
      log.debug('Socket connection to device created');
    });
    conn.on('data', (data) => {
      data = data.toString('utf8');
      if (!connected) {
        if (readyRegex.test(data)) {
          connected = true;
          log.debug('Socket connection to device ready');
          conn.write(`${command}\n`);
        }
      } else {
        dataStream += data;
        if (readyRegex.test(data)) {
          res = dataStream.replace(readyRegex, '').trim();
          res = _.last(res.trim().split('\n'));
          log.debug(`Telnet command got response: ${res}`);
          conn.write('quit\n');
        }
      }
    });
    conn.on('error', (err) => { // eslint-disable-line promise/prefer-await-to-callbacks
      log.debug(`Telnet command error: ${err.message}`);
      reject(err);
    });
    conn.on('close', () => {
      if (res === null) {
        reject(new Error('Never got a response from command'));
      } else {
        resolve(res);
      }
    });
  });
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
 * Change the state of WiFi on the device under test.
 *
 * @param {boolean} on - True to enable and false to disable it.
 * @param {boolean} isEmulator [false] - Set it to true if the device under test
 *                                       is an emulator rather than a real device.
 */
methods.setWifiState = async function setWifiState (on, isEmulator = false) {
  if (isEmulator) {
    await this.shell(['svc', 'wifi', on ? 'enable' : 'disable'], {
      privileged: true,
    });
  } else {
    await this.shell([
      'am', 'broadcast',
      '-a', WIFI_CONNECTION_SETTING_ACTION,
      '-n', WIFI_CONNECTION_SETTING_RECEIVER,
      '--es', 'setstatus', on ? 'enable' : 'disable'
    ]);
  }
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
 * Change the state of Data transfer on the device under test.
 *
 * @param {boolean} on - True to enable and false to disable it.
 * @param {boolean} isEmulator [false] - Set it to true if the device under test
 *                                       is an emulator rather than a real device.
 */
methods.setDataState = async function setDataState (on, isEmulator = false) {
  if (isEmulator) {
    await this.shell(['svc', 'data', on ? 'enable' : 'disable'], {
      privileged: true,
    });
  } else {
    await this.shell([
      'am', 'broadcast',
      '-a', DATA_CONNECTION_SETTING_ACTION,
      '-n', DATA_CONNECTION_SETTING_RECEIVER,
      '--es', 'setstatus', on ? 'enable' : 'disable'
    ]);
  }
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
 * Change the state of animation on the device under test.
 * Animation on the device is controlled by the following global properties:
 * [ANIMATOR_DURATION_SCALE]{@link https://developer.android.com/reference/android/provider/Settings.Global.html#ANIMATOR_DURATION_SCALE},
 * [TRANSITION_ANIMATION_SCALE]{@link https://developer.android.com/reference/android/provider/Settings.Global.html#TRANSITION_ANIMATION_SCALE},
 * [WINDOW_ANIMATION_SCALE]{@link https://developer.android.com/reference/android/provider/Settings.Global.html#WINDOW_ANIMATION_SCALE}.
 * This method sets all this properties to 0.0 to disable (1.0 to enable) animation.
 *
 * Turning off animation might be useful to improve stability
 * and reduce tests execution time.
 *
 * @param {boolean} on - True to enable and false to disable it.
 */
methods.setAnimationState = async function setAnimationState (on) {
  await this.shell([
    'am', 'broadcast',
    '-a', ANIMATION_SETTING_ACTION,
    '-n', ANIMATION_SETTING_RECEIVER,
    '--es', 'setstatus', on ? 'enable' : 'disable'
  ]);
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
 * Change the locale on the device under test. Don't need to reboot the device after changing the locale.
 * This method sets an arbitrary locale following:
 *   https://developer.android.com/reference/java/util/Locale.html
 *   https://developer.android.com/reference/java/util/Locale.html#Locale(java.lang.String,%20java.lang.String)
 *
 * @param {string} language - Language. e.g. en, ja
 * @param {string} country - Country. e.g. US, JP
 * @param {?string} script - Script. e.g. Hans in `zh-Hans-CN`
 */
methods.setDeviceSysLocaleViaSettingApp = async function setDeviceSysLocaleViaSettingApp (language, country, script = null) {
  const params = [
    'am', 'broadcast',
    '-a', LOCALE_SETTING_ACTION,
    '-n', LOCALE_SETTING_RECEIVER,
    '--es', 'lang', language.toLowerCase(),
    '--es', 'country', country.toUpperCase()
  ];

  if (script) {
    params.push('--es', 'script', script);
  }

  await this.shell(params);
};

/**
 * @typedef {Object} Location
 * @property {number|string} longitude - Valid longitude value.
 * @property {number|string} latitude - Valid latitude value.
 * @property {?number|string} altitude - Valid altitude value.
 */

/**
 * Emulate geolocation coordinates on the device under test.
 *
 * @param {Location} location - Location object. The `altitude` value is ignored
 * while mocking the position.
 * @param {boolean} isEmulator [false] - Set it to true if the device under test
 *                                       is an emulator rather than a real device.
 */
methods.setGeoLocation = async function setGeoLocation (location, isEmulator = false) {
  const formatLocationValue = (valueName, isRequired = true) => {
    if (!util.hasValue(location[valueName])) {
      if (isRequired) {
        throw new Error(`${valueName} must be provided`);
      }
      return null;
    }
    const floatValue = parseFloat(location[valueName]);
    if (!isNaN(floatValue)) {
      return `${_.ceil(floatValue, 5)}`;
    }
    if (isRequired) {
      throw new Error(`${valueName} is expected to be a valid float number. ` +
        `'${location[valueName]}' is given instead`);
    }
    return null;
  };
  const longitude = formatLocationValue('longitude');
  const latitude = formatLocationValue('latitude');
  const altitude = formatLocationValue('altitude', false);
  if (isEmulator) {
    await this.resetTelnetAuthToken();
    await this.adbExec(['emu', 'geo', 'fix', longitude, latitude]);
    // A workaround for https://code.google.com/p/android/issues/detail?id=206180
    await this.adbExec(['emu', 'geo', 'fix', longitude.replace('.', ','), latitude.replace('.', ',')]);
  } else {
    const args = [
      'am', 'startservice',
      '-e', 'longitude', longitude,
      '-e', 'latitude', latitude,
    ];
    if (util.hasValue(altitude)) {
      args.push('-e', 'altitude', altitude);
    }
    args.push(LOCATION_SERVICE);
    await this.shell(args);
  }
};

/**
 * Get the current geo location from the device under test.
 *
 * @returns {Location} The current location
 * @throws {Error} If the current location cannot be retrieved
 */
methods.getGeoLocation = async function getGeoLocation () {
  let output;
  try {
    output = await this.shell([
      'am', 'broadcast',
      '-n', LOCATION_RECEIVER,
      '-a', LOCATION_RETRIEVAL_ACTION,
    ]);
  } catch (err) {
    throw new Error(`Cannot retrieve the current geo coordinates from the device. ` +
      `Make sure the Appium Settings application is up to date and has location permissions. Also the location ` +
      `services must be enabled on the device. Original error: ${err.message}`);
  }

  const match = /data="(-?[\d\.]+)\s+(-?[\d\.]+)\s+(-?[\d\.]+)"/.exec(output);
  if (!match) {
    throw new Error(`Cannot parse the actual location values from the command output: ${output}`);
  }
  const location = {
    latitude: match[1],
    longitude: match[2],
    altitude: match[3],
  };
  log.debug(`Got geo coordinates: ${JSON.stringify(location)}`);
  return location;
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
  if (!this.isValidClass(processName)) {
    throw new Error(`Invalid process name: ${processName}`);
  }
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
    await this.startLogcat();
  } catch (e) {
    throw new Error(`Restart failed. Original error: ${e.message}`);
  }
};

/**
 * Start the logcat process to gather logs.
 *
 * @throws {error} If restart fails.
 */
methods.startLogcat = async function startLogcat () {
  if (!_.isEmpty(this.logcat)) {
    throw new Error("Trying to start logcat capture but it's already started!");
  }
  this.logcat = new Logcat({
    adb: this.executable,
    debug: false,
    debugTrace: false,
    clearDeviceLogsOnStart: !!this.clearDeviceLogsOnStart,
  });
  await this.logcat.startCapture();
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
 * Get the list of process ids for the particular process on the device under test.
 *
 * @param {string} name - The part of process name.
 * @return {Array.<number>} The list of matched process IDs or an empty list.
 */
methods.getPIDsByName = async function getPIDsByName (name) {
  log.debug(`Getting IDs of all '${name}' processes`);
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
        ? ['pgrep', '-f', _.escapeRegExp(name)]
        : ['pgrep', `^${_.escapeRegExp(name.slice(-15))}$`])
      : ['pidof', name];
    try {
      return (await this.shell(shellCommand))
        .split(/\s+/)
        .map((x) => parseInt(x, 10))
        .filter((x) => _.isInteger(x));
    } catch (e) {
      // error code 1 is returned if the utility did not find any processes
      // with the given name
      if (e.code === 1) {
        return [];
      }
      throw new Error(`Could not extract process ID of '${name}': ${e.message}`);
    }
  }

  log.debug('Using ps-based PID detection');
  const pidColumnTitle = 'PID';
  const processNameColumnTitle = 'NAME';
  const stdout = await this.shell(['ps']);
  const titleMatch = new RegExp(`^(.*\\b${pidColumnTitle}\\b.*\\b${processNameColumnTitle}\\b.*)$`, 'm').exec(stdout);
  if (!titleMatch) {
    throw new Error(`Could not extract PID of '${name}' from ps output: ${stdout}`);
  }
  const allTitles = titleMatch[1].trim().split(/\s+/);
  const pidIndex = allTitles.indexOf(pidColumnTitle);
  const pids = [];
  const processNameRegex = new RegExp(`^(.*\\b\\d+\\b.*\\b${_.escapeRegExp(name)}\\b.*)$`, 'gm');
  let matchedLine;
  while ((matchedLine = processNameRegex.exec(stdout))) {
    const items = matchedLine[1].trim().split(/\s+/);
    if (pidIndex >= allTitles.length || isNaN(items[pidIndex])) {
      throw new Error(`Could not extract PID of '${name}' from '${matchedLine[1].trim()}'. ps output: ${stdout}`);
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
    let pids = await this.getPIDsByName(name);
    if (_.isEmpty(pids)) {
      log.info(`No '${name}' process has been found`);
      return;
    }
    for (let pid of pids) {
      await this.killProcessByPID(pid);
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
 * @return {string} Kill command stdout.
 * @throws {Error} If the process with given ID is not present or cannot be killed.
 */
methods.killProcessByPID = async function killProcessByPID (pid) {
  log.debug(`Attempting to kill process ${pid}`);
  let wasRoot = false;
  let becameRoot = false;
  try {
    try {
      // Check if the process exists and throw an exception otherwise
      await this.shell(['kill', '-0', pid]);
    } catch (e) {
      if (!e.message.includes('Operation not permitted')) {
        throw e;
      }
      try {
        wasRoot = await this.isRoot();
      } catch (ign) {}
      if (wasRoot) {
        throw e;
      }
      log.info(`Cannot kill PID ${pid} due to insufficient permissions. Retrying as root`);
      let {isSuccessful} = await this.root();
      becameRoot = isSuccessful;
      await this.shell(['kill', '-0', pid]);
    }
    const timeoutMs = 1000;
    let stdout;
    try {
      await waitForCondition(async () => {
        try {
          stdout = await this.shell(['kill', pid]);
          return false;
        } catch (e) {
          // kill returns non-zero code if the process is already killed
          return true;
        }
      }, {waitMs: timeoutMs, intervalMs: 300});
    } catch (err) {
      log.warn(`Cannot kill process ${pid} in ${timeoutMs} ms. Trying to force kill...`);
      stdout = await this.shell(['kill', '-9', pid]);
    }
    return stdout;
  } finally {
    if (becameRoot) {
      await this.unroot();
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
  log.debug(`Building screenrecord process with the command line: adb ${quote(fullCmd)}`);
  return new SubProcess(this.executable.path, fullCmd);
};

/**
 * Performs the given editor action on the focused input field.
 * This method requires Appium Settings helper to be installed on the device.
 * No exception is thrown if there was a failure while performing the action.
 * You must investigate the logcat output if something did not work as expected.
 *
 * @param {string|number} action - Either action code or name. The following action
 *                                 names are supported: `normal, unspecified, none,
 *                                 go, search, send, next, done, previous`
 */
methods.performEditorAction = async function performEditorAction (action) {
  log.debug(`Performing editor action: ${action}`);
  const defaultIME = await this.defaultIME();
  await this.enableIME(APPIUM_IME);
  try {
    await this.setIME(APPIUM_IME);
    await this.shell(['input', 'text', `/${action}/`]);
  } finally {
    await this.setIME(defaultIME);
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

export default methods;
