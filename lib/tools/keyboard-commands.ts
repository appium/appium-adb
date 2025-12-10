import {log} from '../logger.js';
import _ from 'lodash';
import {waitForCondition} from 'asyncbox';
import B from 'bluebird';
import type {ADB} from '../adb.js';
import type {KeyboardState} from './types.js';

const KEYCODE_ESC = 111;
const KEYCODE_BACK = 4;

/**
 * Hides software keyboard if it is visible.
 * Noop if the keyboard is already hidden.
 *
 * @param timeoutMs - For how long to wait (in milliseconds)
 * until the keyboard is actually hidden.
 * @returns `false` if the keyboard was already hidden
 * @throws {Error} If the keyboard cannot be hidden.
 */
export async function hideKeyboard(this: ADB, timeoutMs: number = 1000): Promise<boolean> {
  const keyboardState = await this.isSoftKeyboardPresent();
  let {isKeyboardShown} = keyboardState;
  const {canCloseKeyboard} = keyboardState;
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
      return await waitForCondition(
        async () => {
          ({isKeyboardShown} = await this.isSoftKeyboardPresent());
          return !isKeyboardShown;
        },
        {waitMs: timeoutMs, intervalMs: 500},
      );
    } catch {}
  }
  throw new Error(`The software keyboard cannot be hidden`);
}

/**
 * Retrieve the state of the software keyboard on the device under test.
 *
 * @return The keyboard state.
 */
export async function isSoftKeyboardPresent(this: ADB): Promise<KeyboardState> {
  try {
    const stdout = await this.shell(['dumpsys', 'input_method']);
    const inputShownMatch = /mInputShown=(\w+)/.exec(stdout);
    const inputViewShownMatch = /mIsInputViewShown=(\w+)/.exec(stdout);
    return {
      isKeyboardShown: !!(inputShownMatch && inputShownMatch[1] === 'true'),
      canCloseKeyboard: !!(inputViewShownMatch && inputViewShownMatch[1] === 'true'),
    };
  } catch (e) {
    throw new Error(`Error finding softkeyboard. Original error: ${(e as Error).message}`);
  }
}

/**
 * Send the particular keycode to the device under test.
 *
 * @param keycode - The actual key code to be sent.
 */
export async function keyevent(this: ADB, keycode: string | number): Promise<void> {
  // keycode must be an int.
  const code = parseInt(`${keycode}`, 10);
  await this.shell(['input', 'keyevent', `${code}`]);
}

/**
 * Retrieve the list of available input methods (IMEs) for the device under test.
 *
 * @return The list of IME names or an empty list.
 */
export async function availableIMEs(this: ADB): Promise<string[]> {
  try {
    return getIMEListFromOutput(await this.shell(['ime', 'list', '-a']));
  } catch (e) {
    const err = e as Error;
    throw new Error(`Error getting available IME's. Original error: ${err.message}`);
  }
}

/**
 * Retrieve the list of enabled input methods (IMEs) for the device under test.
 *
 * @return The list of enabled IME names or an empty list.
 */
export async function enabledIMEs(this: ADB): Promise<string[]> {
  try {
    return getIMEListFromOutput(await this.shell(['ime', 'list']));
  } catch (e) {
    const err = e as Error;
    throw new Error(`Error getting enabled IME's. Original error: ${err.message}`);
  }
}

/**
 * Enable the particular input method on the device under test.
 *
 * @param imeId - One of existing IME ids.
 */
export async function enableIME(this: ADB, imeId: string): Promise<void> {
  await this.shell(['ime', 'enable', imeId]);
}

/**
 * Disable the particular input method on the device under test.
 *
 * @param imeId - One of existing IME ids.
 */
export async function disableIME(this: ADB, imeId: string): Promise<void> {
  await this.shell(['ime', 'disable', imeId]);
}

/**
 * Set the particular input method on the device under test.
 *
 * @param imeId - One of existing IME ids.
 */
export async function setIME(this: ADB, imeId: string): Promise<void> {
  await this.shell(['ime', 'set', imeId]);
}

/**
 * Get the default input method on the device under test.
 *
 * @return The name of the default input method
 */
export async function defaultIME(this: ADB): Promise<string | null> {
  try {
    const engine = await this.getSetting('secure', 'default_input_method');
    if (engine === 'null') {
      return null;
    }
    return engine.trim();
  } catch (e) {
    const err = e as Error;
    throw new Error(`Error getting default IME. Original error: ${err.message}`);
  }
}

/**
 * Send the particular text or a number to the device under test.
 * The text gets properly escaped before being passed to ADB.
 * Noop if the text is empty.
 *
 * @param text - The actual text to be sent.
 * @throws {Error} If it is impossible to escape the given string
 */
export async function inputText(this: ADB, text: string | number): Promise<void> {
  if (text === '') {
    return;
  }

  const originalStr = `${text}`;
  const escapedText = originalStr.replace(/\$/g, '\\$').replace(/ /g, '%s');
  let args: string[] = ['input', 'text', originalStr];
  // https://stackoverflow.com/questions/25791423/adb-shell-input-text-does-not-take-ampersand-character/25791498
  const adbInputEscapePattern = /[()<>|;&*\\~^"']/g;
  if (escapedText !== originalStr || adbInputEscapePattern.test(originalStr)) {
    if (_.every(['"', `'`], (c) => originalStr.includes(c))) {
      throw new Error(
        `Did not know how to escape a string that contains both types of quotes (" and ')`,
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
 * @param ime - Valid IME identifier
 * @param fn - Function to execute
 * @returns The result of the given function
 */
export async function runInImeContext<T>(this: ADB, ime: string, fn: () => Promise<T>): Promise<T> {
  // This is needed to properly apply new IME on some devices
  const cycleImeState = async (name: string) => {
    try {
      await this.disableIME(name);
      await this.enableIME(name);
    } catch {}
  };

  const originalIme = await this.defaultIME();
  if (originalIme === ime) {
    log.debug(`The original IME is the same as '${ime}'. There is no need to reset it`);
  } else {
    await this.enableIME(ime);
    await this.setIME(ime);
    if (originalIme) {
      await cycleImeState(originalIme);
    }
    // https://github.com/appium/appium/issues/15943
    await B.delay(500);
  }
  try {
    return await fn();
  } finally {
    if (originalIme && originalIme !== ime) {
      await this.setIME(originalIme);
      await cycleImeState(ime);
    }
  }
}

// #region Private function

/**
 * @param stdout
 * @returns
 */
function getIMEListFromOutput(stdout: string): string[] {
  const engines: string[] = [];
  for (const line of stdout.split('\n')) {
    if (line.length > 0 && line[0] !== ' ') {
      // remove newline and trailing colon, and add to the list
      engines.push(line.trim().replace(/:$/, ''));
    }
  }
  return engines;
}

// #endregion

