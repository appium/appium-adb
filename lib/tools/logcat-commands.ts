import _ from 'lodash';
import {Logcat} from '../logcat';
import type {ADB} from '../adb.js';
import type {LogcatOpts, LogEntry, LogcatListener} from './types.js';

/**
 * Start the logcat process to gather logs.
 *
 * @param opts - Logcat options
 * @throws {Error} If restart fails.
 */
export async function startLogcat(this: ADB, opts: LogcatOpts = {}): Promise<void> {
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
 */
export async function stopLogcat(this: ADB): Promise<void> {
  const logcat = this.logcat;
  if (!logcat || _.isEmpty(this.logcat)) {
    return;
  }
  try {
    await logcat.stopCapture();
  } finally {
    this.logcat = undefined;
  }
}

/**
 * Retrieve the output from the currently running logcat process.
 * The logcat process should be executed by {2link #startLogcat} method.
 *
 * @return The collected logcat output.
 * @throws {Error} If logcat process is not running.
 */
export function getLogcatLogs(this: ADB): LogEntry[] {
  const logcat = this.logcat;
  if (!logcat || _.isEmpty(this.logcat)) {
    throw new Error(`Can't get logcat logs since logcat hasn't started`);
  }
  return logcat.getLogs();
}

/**
 * Set the callback for the logcat output event.
 *
 * @param listener - Listener function
 * @throws {Error} If logcat process is not running.
 */
export function setLogcatListener(this: ADB, listener: LogcatListener): void {
  const logcat = this.logcat;
  if (!logcat || _.isEmpty(this.logcat)) {
    throw new Error("Logcat process hasn't been started");
  }
  logcat.on('output', listener);
}

/**
 * Removes the previously set callback for the logcat output event.
 *
 * @param listener
 * The listener function, which has been previously
 * passed to `setLogcatListener`
 * @throws {Error} If logcat process is not running.
 */
export function removeLogcatListener(this: ADB, listener: LogcatListener): void {
  const logcat = this.logcat;
  if (!logcat || _.isEmpty(this.logcat)) {
    throw new Error("Logcat process hasn't been started");
  }
  logcat.removeListener('output', listener);
}

