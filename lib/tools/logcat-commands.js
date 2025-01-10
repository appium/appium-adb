import _ from 'lodash';
import { Logcat } from '../logcat';

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
