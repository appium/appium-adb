import { log } from '../logger.js';
import _ from 'lodash';
import B from 'bluebird';
import { waitForCondition } from 'asyncbox';

const CREDENTIAL_CANNOT_BE_NULL_OR_EMPTY_ERROR = `Credential can't be null or empty`;
const CREDENTIAL_DID_NOT_MATCH_ERROR = `didn't match`;
const SUPPORTED_LOCK_CREDENTIAL_TYPES = ['password', 'pin', 'pattern'];
const KEYCODE_POWER = 26;
const KEYCODE_WAKEUP = 224; // works over API Level 20
const HIDE_KEYBOARD_WAIT_TIME = 100;

/**
 * @param {string} verb
 * @param {string?} [oldCredential=null]
 * @param {...string} args
 */
function buildCommand (verb, oldCredential = null, ...args) {
  const cmd = ['locksettings', verb];
  if (!_.isEmpty(oldCredential)) {
    cmd.push('--old', /** @type {string} */ (oldCredential));
  }
  if (!_.isEmpty(args)) {
    cmd.push(...args);
  }
  return cmd;
}

/**
 * Performs swipe up gesture on the screen
 *
 * @this {import('../adb.js').ADB}
 * @param {string} windowDumpsys The output of `adb shell dumpsys window` command
 * @throws {Error} If the display size cannot be retrieved
 */
async function swipeUp (windowDumpsys) {
  const dimensionsMatch = /init=(\d+)x(\d+)/.exec(windowDumpsys);
  if (!dimensionsMatch) {
    throw new Error('Cannot retrieve the display size');
  }
  const displayWidth = parseInt(dimensionsMatch[1], 10);
  const displayHeight = parseInt(dimensionsMatch[2], 10);
  const x0 = displayWidth / 2;
  const y0 = displayHeight / 5 * 4;
  const x1 = x0;
  const y1 = displayHeight / 5;
  await this.shell([
    'input', 'touchscreen', 'swipe',
    ...([x0, y0, x1, y1].map((c) => `${Math.trunc(c)}`))
  ]);
}

/**
 * Check whether the device supports lock settings management with `locksettings`
 * command line tool. This tool has been added to Android toolset since  API 27 Oreo
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<boolean>} True if the management is supported. The result is cached per ADB instance
 */
export async function isLockManagementSupported () {
  if (!_.isBoolean(this._isLockManagementSupported)) {
    const passFlag = '__PASS__';
    let output = '';
    try {
      output = await this.shell([`locksettings help && echo ${passFlag}`]);
    } catch {}
    this._isLockManagementSupported = _.includes(output, passFlag);
    log.debug(`Extended lock settings management is ` +
      `${this._isLockManagementSupported ? '' : 'not '}supported`);
  }
  return this._isLockManagementSupported;
}

/**
 * Check whether the given credential is matches to the currently set one.
 *
 * @this {import('../adb.js').ADB}
 * @param {string?} [credential=null] The credential value. It could be either
 * pin, password or a pattern. A pattern is specified by a non-separated list
 * of numbers that index the cell on the pattern in a 1-based manner in left
 * to right and top to bottom order, i.e. the top-left cell is indexed with 1,
 * whereas the bottom-right cell is indexed with 9. Example: 1234.
 * null/empty value assumes the device has no lock currently set.
 * @return {Promise<boolean>} True if the given credential matches to the device's one
 * @throws {Error} If the verification faces an unexpected error
 */
export async function verifyLockCredential (credential = null) {
  try {
    const {stdout, stderr} = await this.shell(buildCommand('verify', credential), {
      outputFormat: this.EXEC_OUTPUT_FORMAT.FULL
    });
    if (_.includes(stdout, 'verified successfully')) {
      return true;
    }
    if ([`didn't match`, CREDENTIAL_CANNOT_BE_NULL_OR_EMPTY_ERROR]
        .some((x) => _.includes(stderr || stdout, x))) {
      return false;
    }
    throw new Error(stderr || stdout);
  } catch (e) {
    throw new Error(`Device lock credential verification failed. ` +
      `Original error: ${e.stderr || e.stdout || e.message}`);
  }
}

/**
 * Clears current lock credentials. Usually it takes several seconds for a device to
 * sync the credential state after this method returns.
 *
 * @this {import('../adb.js').ADB}
 * @param {string?} [credential=null] The credential value. It could be either
 * pin, password or a pattern. A pattern is specified by a non-separated list
 * of numbers that index the cell on the pattern in a 1-based manner in left
 * to right and top to bottom order, i.e. the top-left cell is indexed with 1,
 * whereas the bottom-right cell is indexed with 9. Example: 1234.
 * null/empty value assumes the device has no lock currently set.
 * @throws {Error} If operation faces an unexpected error
 */
export async function clearLockCredential (credential = null) {
  try {
    const {stdout, stderr} = await this.shell(buildCommand('clear', credential), {
      outputFormat: this.EXEC_OUTPUT_FORMAT.FULL
    });
    if (!['user has no password', 'Lock credential cleared']
        .some((x) => _.includes(stderr || stdout, x))) {
      throw new Error(stderr || stdout);
    }
  } catch (e) {
    throw new Error(`Cannot clear device lock credential. ` +
      `Original error: ${e.stderr || e.stdout || e.message}`);
  }
}

/**
 * Checks whether the device is locked with a credential (either pin or a password
 * or a pattern).
 *
 * @this {import('../adb.js').ADB}
 * @returns {Promise<boolean>} `true` if the device is locked
 * @throws {Error} If operation faces an unexpected error
 */
export async function isLockEnabled () {
  try {
    const {stdout, stderr} = await this.shell(buildCommand('get-disabled'), {
      outputFormat: this.EXEC_OUTPUT_FORMAT.FULL
    });
    if (/\bfalse\b/.test(stdout)
        || [CREDENTIAL_DID_NOT_MATCH_ERROR, CREDENTIAL_CANNOT_BE_NULL_OR_EMPTY_ERROR].some(
          (x) => _.includes(stderr || stdout, x))) {
      return true;
    }
    if (/\btrue\b/.test(stdout)) {
      return false;
    }
    throw new Error(stderr || stdout);
  } catch (e) {
    throw new Error(`Cannot check if device lock is enabled. Original error: ${e.message}`);
  }
}

/**
 * Sets the device lock.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} credentialType One of: password, pin, pattern.
 * @param {string} credential A non-empty credential value to be set.
 * Make sure your new credential matches to the actual system security requirements,
 * e.g. a minimum password length. A pattern is specified by a non-separated list
 * of numbers that index the cell on the pattern in a 1-based manner in left
 * to right and top to bottom order, i.e. the top-left cell is indexed with 1,
 * whereas the bottom-right cell is indexed with 9. Example: 1234.
 * @param {string?} [oldCredential=null] An old credential string.
 * It is only required to be set in case you need to change the current
 * credential rather than to set a new one. Setting it to a wrong value will
 * make this method to fail and throw an exception.
 * @throws {Error} If there was a failure while verifying input arguments or setting
 * the credential
 */
export async function setLockCredential (
  credentialType, credential, oldCredential = null) {
  if (!SUPPORTED_LOCK_CREDENTIAL_TYPES.includes(credentialType)) {
    throw new Error(`Device lock credential type '${credentialType}' is unknown. ` +
      `Only the following credential types are supported: ${SUPPORTED_LOCK_CREDENTIAL_TYPES}`);
  }
  if (_.isEmpty(credential) && !_.isInteger(credential)) {
    throw new Error('Device lock credential cannot be empty');
  }
  const cmd = buildCommand(`set-${credentialType}`, oldCredential, credential);
  try {
    const {stdout, stderr} = await this.shell(cmd, {
      outputFormat: this.EXEC_OUTPUT_FORMAT.FULL
    });
    if (!_.includes(stdout, 'set to')) {
      throw new Error(stderr || stdout);
    }
  } catch (e) {
    throw new Error(`Setting of device lock ${credentialType} credential failed. ` +
      `Original error: ${e.stderr || e.stdout || e.message}`);
  }
}

/**
 * Retrieve the screen lock state of the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<boolean>} True if the device is locked.
 */
export async function isScreenLocked () {
  const [windowOutput, powerOutput] = await B.all([
    this.shell(['dumpsys', 'window']),
    this.shell(['dumpsys', 'power']),
  ]);
  return isShowingLockscreen(windowOutput)
    || isCurrentFocusOnKeyguard(windowOutput)
    || !isScreenOnFully(windowOutput)
    || isInDozingMode(powerOutput)
    || isScreenStateOff(windowOutput);
}

/**
 * Dismisses keyguard overlay.
 * @this {import('../adb.js').ADB}
 */
export async function dismissKeyguard () {
  log.info('Waking up the device to dismiss the keyguard');
  // Screen off once to force pre-inputted text field clean after wake-up
  // Just screen on if the screen defaults off
  await this.cycleWakeUp();

  if (await this.getApiLevel() > 21) {
    await this.shell(['wm', 'dismiss-keyguard']);
    return;
  }

  const stdout = await this.shell(['dumpsys', 'window']);
  if (!isCurrentFocusOnKeyguard(stdout)) {
    log.debug('The keyguard seems to be inactive');
    return;
  }

  log.debug('Swiping up to dismiss the keyguard');
  if (await this.hideKeyboard()) {
    await B.delay(HIDE_KEYBOARD_WAIT_TIME);
  }
  log.debug('Dismissing notifications from the unlock view');
  await this.shell(['service', 'call', 'notification', '1']);
  await this.back();
  await swipeUp.bind(this)(stdout);
}

/**
 * Presses the corresponding key combination to make sure the device's screen
 * is not turned off and is locked if the latter is enabled.
 * @this {import('../adb.js').ADB}
 */
export async function cycleWakeUp () {
  await this.keyevent(KEYCODE_POWER);
  await this.keyevent(KEYCODE_WAKEUP);
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

// #region Private functions

/**
 * Checks mScreenOnFully in dumpsys output to determine if screen is showing
 * Default is true.
 * Note: this key
 *
 * @param {string} dumpsys
 * @returns {boolean}
 */
function isScreenOnFully (dumpsys) {
  const m = /mScreenOnFully=\w+/gi.exec(dumpsys);
  return !m || // if information is missing we assume screen is fully on
    (m && m.length > 0 && m[0].split('=')[1] === 'true') || false;
}

/**
 * Checks mCurrentFocus in dumpsys output to determine if Keyguard is activated
 *
 * @param {string} dumpsys
 * @returns {boolean}
 */
function isCurrentFocusOnKeyguard (dumpsys) {
  const m = /mCurrentFocus.+Keyguard/gi.exec(dumpsys);
  return Boolean(m && m.length && m[0]);
}

/**
 * Check the current device power state to determine if it is locked
 *
 * @param {string} dumpsys The `adb shell dumpsys power` output
 * @returns {boolean} True if lock screen is shown
 */
function isInDozingMode(dumpsys) {
  // On some phones/tablets we were observing mWakefulness=Dozing
  // while on others it was getWakefulnessLocked()=Dozing
  return /^[\s\w]+wakefulness[^=]*=Dozing$/im.test(dumpsys);
}

/**
 * Checks mShowingLockscreen or mDreamingLockscreen in dumpsys output to determine
 * if lock screen is showing
 *
 * A note: `adb shell dumpsys trust` performs better while detecting the locked screen state
 * in comparison to `adb dumpsys window` output parsing.
 * But the trust command does not work for `Swipe` unlock pattern.
 *
 * In some Android devices (Probably around Android 10+), `mShowingLockscreen` and `mDreamingLockscreen`
 * do not work to detect lock status. Instead, keyguard preferences helps to detect the lock condition.
 * Some devices such as Android TV do not have keyguard, so we should keep
 * screen condition as this primary method.
 *
 * @param {string} dumpsys - The output of dumpsys window command.
 * @return {boolean} True if lock screen is showing.
 */
export function isShowingLockscreen (dumpsys) {
  return _.some(['mShowingLockscreen=true', 'mDreamingLockscreen=true'], (x) => dumpsys.includes(x))
    // `mIsShowing` and `mInputRestricted` are `true` in lock condition. `false` is unlock condition.
    || _.every([/KeyguardStateMonitor[\n\s]+mIsShowing=true/, /\s+mInputRestricted=true/], (x) => x.test(dumpsys));
}

/**
 * Checks screenState has SCREEN_STATE_OFF in dumpsys output to determine
 * possible lock screen.
 *
 * @param {string} dumpsys - The output of dumpsys window command.
 * @return {boolean} True if lock screen is showing.
 */
export function isScreenStateOff(dumpsys) {
  return /\s+screenState=SCREEN_STATE_OFF/i.test(dumpsys);
}

// #endregion
