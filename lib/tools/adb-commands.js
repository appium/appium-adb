import log from '../logger.js';
import _ from 'lodash';
import { fs, util } from '@appium/support';
import { EOL } from 'os';
import { Logcat } from '../logcat';
import { SubProcess, exec } from 'teen_process';
import { waitForCondition } from 'asyncbox';

const MAX_SHELL_BUFFER_LENGTH = 1000;


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
