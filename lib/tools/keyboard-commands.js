import { log } from '../logger.js';
import _ from 'lodash';
import { waitForCondition } from 'asyncbox';
import B from 'bluebird';

const KEYCODE_ESC = 111;
const KEYCODE_BACK = 4;

/**
 * Hides software keyboard if it is visible.
 * Noop if the keyboard is already hidden.
 *
 * @this {import('../adb.js').ADB}
 * @param {number} [timeoutMs=1000] For how long to wait (in milliseconds)
 * until the keyboard is actually hidden.
 * @returns {Promise<boolean>} `false` if the keyboard was already hidden
 * @throws {Error} If the keyboard cannot be hidden.
 */
export async function hideKeyboard (timeoutMs = 1000) {
  let {isKeyboardShown, canCloseKeyboard} = await this.isSoftKeyboardPresent();
  if (!isKeyboardShown) {
    log.info('Keyboard has no UI; no closing necessary');
    return false;
  }
  // Try ESC then BACK if the first one fails
  for (const keyCode of [KEYCODE_ESC, KEYCODE_BACK]) {
    if (canCloseKeyboard) {
      await this.keyevent(keyCode);
    }
    try {
      return await waitForCondition(async () => {
        ({isKeyboardShown} = await this.isSoftKeyboardPresent());
        return !isKeyboardShown;
      }, {waitMs: timeoutMs, intervalMs: 500});
    } catch {}
  }
  throw new Error(`The software keyboard cannot be hidden`);
}

/**
 * Retrieve the state of the software keyboard on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<import('./types').KeyboardState>} The keyboard state.
 */
export async function isSoftKeyboardPresent () {
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
}

/**
 * Send the particular keycode to the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string|number} keycode - The actual key code to be sent.
 */
export async function keyevent (keycode) {
  // keycode must be an int.
  const code = parseInt(`${keycode}`, 10);
  await this.shell(['input', 'keyevent', `${code}`]);
}


/**
 * Retrieve the list of available input methods (IMEs) for the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<string[]>} The list of IME names or an empty list.
 */
export async function availableIMEs () {
  try {
    return getIMEListFromOutput(await this.shell(['ime', 'list', '-a']));
  } catch (e) {
    const err = /** @type {Error} */ (e);
    throw new Error(`Error getting available IME's. Original error: ${err.message}`);
  }
}

/**
 * Retrieve the list of enabled input methods (IMEs) for the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<string[]>} The list of enabled IME names or an empty list.
 */
export async function enabledIMEs () {
  try {
    return getIMEListFromOutput(await this.shell(['ime', 'list']));
  } catch (e) {
    const err = /** @type {Error} */ (e);
    throw new Error(`Error getting enabled IME's. Original error: ${err.message}`);
  }
}

/**
 * Enable the particular input method on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} imeId - One of existing IME ids.
 */
export async function enableIME (imeId) {
  await this.shell(['ime', 'enable', imeId]);
}

/**
 * Disable the particular input method on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} imeId - One of existing IME ids.
 */
export async function disableIME (imeId) {
  await this.shell(['ime', 'disable', imeId]);
}

/**
 * Set the particular input method on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} imeId - One of existing IME ids.
 */
export async function setIME (imeId) {
  await this.shell(['ime', 'set', imeId]);
}

/**
 * Get the default input method on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<string|null>} The name of the default input method
 */
export async function defaultIME () {
  try {
    let engine = await this.getSetting('secure', 'default_input_method');
    if (engine === 'null') {
      return null;
    }
    return engine.trim();
  } catch (e) {
    const err = /** @type {Error} */ (e);
    throw new Error(`Error getting default IME. Original error: ${err.message}`);
  }
}

/**
 * Send the particular text or a number to the device under test.
 * The text gets properly escaped before being passed to ADB.
 * Noop if the text is empty.
 *
 * @this {import('../adb.js').ADB}
 * @param {string|number} text - The actual text to be sent.
 * @throws {Error} If it is impossible to escape the given string
 */
export async function inputText (text) {
  if (text === '') {
    return;
  }

  const originalStr = `${text}`;
  const escapedText = originalStr.replace(/\$/g, '\\$').replace(/ /g, '%s');
  let args = ['input', 'text', originalStr];
  // https://stackoverflow.com/questions/25791423/adb-shell-input-text-does-not-take-ampersand-character/25791498
  const adbInputEscapePattern = /[()<>|;&*\\~^"']/g;
  if (escapedText !== originalStr || adbInputEscapePattern.test(originalStr)) {
    if (_.every(['"', `'`], (c) => originalStr.includes(c))) {
      throw new Error(
        `Did not know how to escape a string that contains both types of quotes (" and ')`
      );
    }
    const q = originalStr.includes('"') ? `'` : '"';
    args = [`input text ${q}${escapedText}${q}`];
  }
  await this.shell(args);
}

/**
 * Executes the given function with the given input method context
 * and then restores the IME to the original value
 *
 * @this {import('../adb.js').ADB}
 * @param {string} ime - Valid IME identifier
 * @param {Function} fn - Function to execute
 * @returns {Promise<any>} The result of the given function
 */
export async function runInImeContext (ime, fn) {
  const originalIme = await this.defaultIME();
  if (originalIme === ime) {
    log.debug(`The original IME is the same as '${ime}'. There is no need to reset it`);
  } else {
    await this.enableIME(ime);
    await this.setIME(ime);
    // https://github.com/appium/appium/issues/15943
    await B.delay(500);
  }
  try {
    return await fn();
  } finally {
    if (originalIme && originalIme !== ime) {
      await this.setIME(originalIme);
    }
  }
}

// #region Private function

/**
 * @param {string} stdout
 * @returns {string[]}
 */
function getIMEListFromOutput (stdout) {
  /** @type {string[]} */
  const engines = [];
  for (const line of stdout.split('\n')) {
    if (line.length > 0 && line[0] !== ' ') {
      // remove newline and trailing colon, and add to the list
      engines.push(line.trim().replace(/:$/, ''));
    }
  }
  return engines;
}

// #endregion
