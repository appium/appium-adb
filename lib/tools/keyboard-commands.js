import log from '../logger.js';
import { waitForCondition } from 'asyncbox';

const KEYCODE_ESC = 111;
const KEYCODE_BACK = 4;

const keyboardCommands = {};

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
keyboardCommands.hideKeyboard = async function hideKeyboard (timeoutMs = 1000) {
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
    } catch (ign) {}
  }
  throw new Error(`The software keyboard cannot be hidden`);
};

/**
 * @typedef {Object} KeyboardState
 * @property {boolean} isKeyboardShown - Whether soft keyboard is currently visible.
 * @property {boolean} canCloseKeyboard - Whether the keyboard can be closed.
 */

/**
 * Retrieve the state of the software keyboard on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<KeyboardState>} The keyboard state.
 */
keyboardCommands.isSoftKeyboardPresent = async function isSoftKeyboardPresent () {
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

export default keyboardCommands;

/**
 * @typedef {typeof keyboardCommands} KeyboardCommands
 */
