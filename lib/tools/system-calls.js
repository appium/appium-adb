import path from 'path';
import { log } from '../logger.js';
import B from 'bluebird';
import { system, fs, util, tempDir, timing } from '@appium/support';
import {
  DEFAULT_ADB_EXEC_TIMEOUT, getSdkRootFromEnv
} from '../helpers';
import { exec, SubProcess } from 'teen_process';
import { sleep, retry, retryInterval, waitForCondition } from 'asyncbox';
import _ from 'lodash';
import * as semver from 'semver';


const DEFAULT_ADB_REBOOT_RETRIES = 90;
const LINKER_WARNING_REGEXP = /^WARNING: linker.+$/m;
const ADB_RETRY_ERROR_PATTERNS = [
  /protocol fault \(no status\)/i,
  /error: device ('.+' )?not found/i,
  /error: device still connecting/i,
];
const BINARY_VERSION_PATTERN = /^Version ([\d.]+)-(\d+)/m;
const BRIDGE_VERSION_PATTERN = /^Android Debug Bridge version ([\d.]+)/m;
const CERTS_ROOT = '/system/etc/security/cacerts';
const SDK_BINARY_ROOTS = [
  'platform-tools',
  'emulator',
  ['cmdline-tools', 'latest', 'bin'],
  'tools',
  ['tools', 'bin'],
  '.' // Allow custom sdkRoot to specify full folder path
];
const MIN_DELAY_ADB_API_LEVEL = 28;
const REQUIRED_SERVICES = ['activity', 'package', 'mount'];
const SUBSYSTEM_STATE_OK = 'Subsystem state: true';
const MAX_SHELL_BUFFER_LENGTH = 1000;

/**
 * Retrieve full path to the given binary.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} binaryName - The name of the binary.
 * @return {Promise<string>} Full path to the given binary including current SDK root.
 */
export async function getSdkBinaryPath (binaryName) {
  return await this.getBinaryFromSdkRoot(binaryName);
}

/**
 * Retrieve full binary name for the current operating system.
 *
 * @param {string} binaryName - simple binary name, for example 'android'.
 * @return {string} Formatted binary name depending on the current platform,
 *                  for example, 'android.bat' on Windows.
 */
function _getBinaryNameForOS (binaryName) {
  if (!system.isWindows()) {
    return binaryName;
  }

  if (['android', 'apksigner', 'apkanalyzer'].includes(binaryName)) {
    return `${binaryName}.bat`;
  }
  if (!path.extname(binaryName)) {
    return `${binaryName}.exe`;
  }
  return binaryName;
}

export const getBinaryNameForOS = _.memoize(_getBinaryNameForOS);

/**
 * Retrieve full path to the given binary and caches it into `binaries`
 * property of the current ADB instance.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} binaryName - Simple name of a binary file.
 * @return {Promise<string>} Full path to the given binary. The method tries
 *                  to enumerate all the known locations where the binary
 *                  might be located and stops the search as soon as the first
 *                  match is found on the local file system.
 * @throws {Error} If the binary with given name is not present at any
 *                 of known locations or Android SDK is not installed on the
 *                 local file system.
 */
export async function getBinaryFromSdkRoot (binaryName) {
  if ((/** @type {import('./types').StringRecord} */ (this.binaries))[binaryName]) {
    return (/** @type {import('./types').StringRecord} */ (this.binaries))[binaryName];
  }
  const fullBinaryName = this.getBinaryNameForOS(binaryName);
  const binaryLocs = getSdkBinaryLocationCandidates(
    /** @type {string} */(this.sdkRoot), fullBinaryName
  );

  // get subpaths for currently installed build tool directories
  let buildToolsDirs = await getBuildToolsDirs(/** @type {string} */(this.sdkRoot));
  if (this.buildToolsVersion) {
    buildToolsDirs = buildToolsDirs
      .filter((x) => path.basename(x) === this.buildToolsVersion);
    if (_.isEmpty(buildToolsDirs)) {
      log.info(`Found no build tools whose version matches to '${this.buildToolsVersion}'`);
    } else {
      log.info(`Using build tools at '${buildToolsDirs}'`);
    }
  }
  binaryLocs.push(...(_.flatten(buildToolsDirs
    .map((dir) => [
      path.resolve(dir, fullBinaryName),
      path.resolve(dir, 'lib', fullBinaryName),
    ]))
  ));

  let binaryLoc = null;
  for (const loc of binaryLocs) {
    if (await fs.exists(loc)) {
      binaryLoc = loc;
      break;
    }
  }
  if (_.isNull(binaryLoc)) {
    throw new Error(`Could not find '${fullBinaryName}' in ${JSON.stringify(binaryLocs)}. ` +
      `Do you have Android Build Tools ${this.buildToolsVersion ? `v ${this.buildToolsVersion} ` : ''}` +
      `installed at '${this.sdkRoot}'?`);
  }
  log.info(`Using '${fullBinaryName}' from '${binaryLoc}'`);
  (/** @type {import('./types').StringRecord} */ (this.binaries))[binaryName] = binaryLoc;
  return binaryLoc;
}

/**
 *  Returns the Android binaries locations
 *
 * @param {string} sdkRoot The path to Android SDK root.
 * @param {string} fullBinaryName The name of full binary name.
 * @return {string[]} The list of SDK_BINARY_ROOTS paths
 *                          with sdkRoot and fullBinaryName.
 */
function getSdkBinaryLocationCandidates (sdkRoot, fullBinaryName) {
  return SDK_BINARY_ROOTS.map((x) =>
    path.resolve(sdkRoot, ...(_.isArray(x) ? x : [x]), fullBinaryName));
}

/**
 * Retrieve full path to the given binary.
 * This method does not have cache.
 *
 * @param {string} binaryName - Simple name of a binary file.
 *                              e.g. 'adb', 'android'
 * @return {Promise<string>} Full path to the given binary. The method tries
 *                  to enumerate all the known locations where the binary
 *                  might be located and stops the search as soon as the first
 *                  match is found on the local file system.
 *                  e.g. '/Path/To/Android/sdk/platform-tools/adb'
 * @throws {Error} If the binary with given name is not present at any
 *                 of known locations or Android SDK is not installed on the
 *                 local file system.
 */
export async function getAndroidBinaryPath (binaryName) {
  const fullBinaryName = getBinaryNameForOS(binaryName);
  const sdkRoot = getSdkRootFromEnv();
  const binaryLocs = getSdkBinaryLocationCandidates(sdkRoot ?? '', fullBinaryName);
  for (const loc of binaryLocs) {
    if (await fs.exists(loc)) {
      return loc;
    }
  }
  throw new Error(`Could not find '${fullBinaryName}' in ${JSON.stringify(binaryLocs)}. ` +
    `Do you have Android Build Tools installed at '${sdkRoot}'?`);
}

/**
 * Retrieve full path to a binary file using the standard system lookup tool.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} binaryName - The name of the binary.
 * @return {Promise<string>} Full path to the binary received from 'which'/'where'
 *                  output.
 * @throws {Error} If lookup tool returns non-zero return code.
 */
export async function getBinaryFromPath (binaryName) {
  if ((/** @type {import('./types').StringRecord} */ (this.binaries))[binaryName]) {
    return (/** @type {import('./types').StringRecord} */ (this.binaries))[binaryName];
  }

  const fullBinaryName = this.getBinaryNameForOS(binaryName);
  try {
    const binaryLoc = await fs.which(fullBinaryName);
    log.info(`Using '${fullBinaryName}' from '${binaryLoc}'`);
    (/** @type {import('./types').StringRecord} */ (this.binaries))[binaryName] = binaryLoc;
    return binaryLoc;
  } catch {
    throw new Error(`Could not find '${fullBinaryName}' in PATH. Please set the ANDROID_HOME ` +
      `or ANDROID_SDK_ROOT environment variables to the correct Android SDK root directory path.`);
  }
}

/**
 * Retrieve the list of devices visible to adb.
 *
 * @this {import('../adb.js').ADB}
 * @param {import('./types').ConnectedDevicesOptions} [opts={}] - Additional options mapping.
 * @return {Promise<import('./types').Device[]>} The list of devices or an empty list if
 *                          no devices are connected.
 * @throws {Error} If there was an error while listing devices.
 */
export async function getConnectedDevices (opts = {}) {
  log.debug('Getting connected devices');
  const args = [...this.executable.defaultArgs, 'devices'];
  if (opts.verbose) {
    args.push('-l');
  }

  let stdout;
  try {
    ({stdout} = await exec(this.executable.path, args));
  } catch (e) {
    throw new Error(`Error while getting connected devices. Original error: ${e.message}`);
  }
  const listHeader = 'List of devices';
  // expecting adb devices to return output as
  // List of devices attached
  // emulator-5554	device
  const startingIndex = stdout.indexOf(listHeader);
  if (startingIndex < 0) {
    throw new Error(`Unexpected output while trying to get devices: ${stdout}`);
  }
  // slicing output we care about
  stdout = stdout.slice(startingIndex);
  let excludedLines = [listHeader, 'adb server', '* daemon'];
  if (!this.allowOfflineDevices) {
    excludedLines.push('offline');
  }
  const devices = stdout.split('\n')
    .map(_.trim)
    .filter((line) => line && !excludedLines.some((x) => line.includes(x)))
    .map((line) => {
      // state is "device", afaic
      const [udid, state, ...description] = line.split(/\s+/);
      const device = {udid, state};
      if (opts.verbose) {
        for (const entry of description) {
          if (entry.includes(':')) {
            // each entry looks like key:value
            const [key, value] = entry.split(':');
            device[key] = value;
          }
        }
      }
      return device;
    });
  if (_.isEmpty(devices)) {
    log.debug('No connected devices have been detected');
  } else {
    log.debug(`Connected devices: ${JSON.stringify(devices)}`);
  }
  return devices;
}

/**
 * Retrieve the list of devices visible to adb within the given timeout.
 *
 * @this {import('../adb.js').ADB}
 * @param {number} timeoutMs - The maximum number of milliseconds to get at least
 *                             one list item.
 * @return {Promise<import('./types').Device[]>} The list of connected devices.
 * @throws {Error} If no connected devices can be detected within the given timeout.
 */
export async function getDevicesWithRetry (timeoutMs = 20000) {
  log.debug('Trying to find connected Android devices');
  try {
    let devices;
    await waitForCondition(async () => {
      try {
        devices = await this.getConnectedDevices();
        if (devices.length) {
          return true;
        }
        log.debug('Could not find online devices');
      } catch (err) {
        log.debug(err.stack);
        log.warn(`Got an unexpected error while fetching connected devices list: ${err.message}`);
      }

      try {
        await this.reconnect();
      } catch {
        await this.restartAdb();
      }
      return false;
    }, {
      waitMs: timeoutMs,
      intervalMs: 200,
    });
    return /** @type {any} */ (devices);
  } catch (e) {
    if (/Condition unmet/.test(e.message)) {
      throw new Error(`Could not find a connected Android device in ${timeoutMs}ms`);
    } else {
      throw e;
    }
  }
}

/**
 * Kick current connection from host/device side and make it reconnect
 *
 * @this {import('../adb.js').ADB}
 * @param {string} [target=offline] One of possible targets to reconnect:
 * offline, device or null
 * Providing `null` will cause reconnection to happen from the host side.
 *
 * @throws {Error} If either ADB version is too old and does not support this
 * command or there was a failure during reconnect.
 */
export async function reconnect (target = 'offline') {
  log.debug(`Reconnecting adb (target ${target})`);

  const args = ['reconnect'];
  if (target) {
    args.push(target);
  }
  try {
    await this.adbExec(args);
  } catch (e) {
    throw new Error(`Cannot reconnect adb. Original error: ${e.stderr || e.message}`);
  }
}

/**
 * Restart adb server, unless _this.suppressKillServer_ property is true.
 *
 * @this {import('../adb.js').ADB}
 */
export async function restartAdb () {
  if (this.suppressKillServer) {
    log.debug(`Not restarting abd since 'suppressKillServer' is on`);
    return;
  }

  log.debug('Restarting adb');
  try {
    await this.killServer();
    await this.adbExec(['start-server']);
  } catch {
    log.error(`Error killing ADB server, going to see if it's online anyway`);
  }
}

/**
 * Kill adb server.
 * @this {import('../adb.js').ADB}
 */
export async function killServer () {
  log.debug(`Killing adb server on port '${this.adbPort}'`);
  await this.adbExec(['kill-server'], {
    exclusive: true,
  });
}

/**
 * Reset Telnet authentication token.
 * @see {@link http://tools.android.com/recent/emulator2516releasenotes} for more details.
 *
 * @this {import('../adb.js').ADB}
 * @returns {Promise<boolean>} If token reset was successful.
 */
export const resetTelnetAuthToken = _.memoize(async function resetTelnetAuthToken () {
  // The methods is used to remove telnet auth token
  //
  const homeFolderPath = process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'];
  if (!homeFolderPath) {
    log.warn(`Cannot find the path to user home folder. Ignoring resetting of emulator's telnet authentication token`);
    return false;
  }
  const dstPath = path.resolve(homeFolderPath, '.emulator_console_auth_token');
  log.debug(`Overriding ${dstPath} with an empty string to avoid telnet authentication for emulator commands`);
  try {
    await fs.writeFile(dstPath, '');
  } catch (e) {
    log.warn(`Error ${e.message} while resetting the content of ${dstPath}. Ignoring resetting of emulator's telnet authentication token`);
    return false;
  }
  return true;
});

/**
 * Execute the given emulator command using _adb emu_ tool.
 *
 * @this {import('../adb.js').ADB}
 * @param {string[]} cmd - The array of rest command line parameters.
 */
export async function adbExecEmu (cmd) {
  await this.verifyEmulatorConnected();
  await this.resetTelnetAuthToken();
  await this.adbExec(['emu', ...cmd]);
}

let isExecLocked = false;

/** @type {{STDOUT: 'stdout', FULL: 'full'}} */
export const EXEC_OUTPUT_FORMAT = Object.freeze({
  STDOUT: 'stdout',
  FULL: 'full',
});

/**
 * Execute the given adb command.
 *
 * @template {import('teen_process').TeenProcessExecOptions & import('./types').ShellExecOptions & import('./types').SpecialAdbExecOptions} TExecOpts
 * @this {import('../adb.js').ADB}
 * @param {string|string[]} cmd - The array of rest command line parameters
 *                      or a single string parameter.
 * @param {TExecOpts} [opts] Additional options mapping. See
 * {@link https://github.com/appium/node-teen_process}
 * for more details.
 * You can also set the additional `exclusive` param
 * to `true` that assures no other parallel adb commands
 * are going to be executed while the current one is running
 * You can set the `outputFormat` param to `stdout` to receive just the stdout
 * output (default) or `full` to receive the stdout and stderr response from a
 * command with a zero exit code
 * @return {Promise<TExecOpts extends import('./types').TFullOutputOption ? import('teen_process').TeenProcessExecResult : string>}
 * Command's stdout or an object containing stdout and stderr.
 * @throws {Error} If the command returned non-zero exit code.
 */
export async function adbExec (cmd, opts) {
  if (!cmd) {
    throw new Error('You need to pass in a command to adbExec()');
  }

  const optsCopy = _.cloneDeep(opts) ?? /** @type {TExecOpts} */ ({});
  // setting default timeout for each command to prevent infinite wait.
  optsCopy.timeout = optsCopy.timeout || this.adbExecTimeout || DEFAULT_ADB_EXEC_TIMEOUT;
  optsCopy.timeoutCapName = optsCopy.timeoutCapName || 'adbExecTimeout'; // For error message

  const {outputFormat = this.EXEC_OUTPUT_FORMAT.STDOUT} = optsCopy;

  cmd = _.isArray(cmd) ? cmd : [cmd];
  let adbRetried = false;
  const execFunc = async () => {
    try {
      const args = [...this.executable.defaultArgs, ...cmd];
      log.debug(`Running '${this.executable.path} ` +
        (args.find((arg) => /\s+/.test(arg)) ? util.quote(args) : args.join(' ')) + `'`);
      let {stdout, stderr} = await exec(this.executable.path, args, optsCopy);
      // sometimes ADB prints out weird stdout warnings that we don't want
      // to include in any of the response data, so let's strip it out
      stdout = stdout.replace(LINKER_WARNING_REGEXP, '').trim();
      return outputFormat === this.EXEC_OUTPUT_FORMAT.FULL ? {stdout, stderr} : stdout;
    } catch (e) {
      const errText = `${e.message}, ${e.stdout}, ${e.stderr}`;
      if (ADB_RETRY_ERROR_PATTERNS.some((p) => p.test(errText))) {
        log.info(`Error sending command, reconnecting device and retrying: ${cmd}`);
        await sleep(1000);
        await this.getDevicesWithRetry();

        // try again one time
        if (adbRetried) {
          adbRetried = true;
          return await execFunc();
        }
      }

      if (e.code === 0 && e.stdout) {
        return e.stdout.replace(LINKER_WARNING_REGEXP, '').trim();
      }

      if (_.isNull(e.code)) {
        e.message = `Error executing adbExec. Original error: '${e.message}'. ` +
          `Try to increase the ${optsCopy.timeout}ms adb execution timeout ` +
          `represented by '${optsCopy.timeoutCapName}' capability`;
      } else {
        e.message = `Error executing adbExec. Original error: '${e.message}'; ` +
          `Command output: ${e.stderr || e.stdout || '<empty>'}`;
      }
      throw e;
    }
  };

  if (isExecLocked) {
    log.debug('Waiting until the other exclusive ADB command is completed');
    await waitForCondition(() => !isExecLocked, {
      waitMs: Number.MAX_SAFE_INTEGER,
      intervalMs: 10,
    });
    log.debug('Continuing with the current ADB command');
  }
  if (optsCopy.exclusive) {
    isExecLocked = true;
  }
  try {
    return await execFunc();
  } finally {
    if (optsCopy.exclusive) {
      isExecLocked = false;
    }
  }
}

/**
 * Execute the given command using _adb shell_ prefix.
 *
 * @this {import('../adb.js').ADB}
 * @template {import('./types').ShellExecOptions} TShellExecOpts
 * @param {string|string[]} cmd - The array of rest command line parameters or a single
 *                                      string parameter.
 * @param {TShellExecOpts} [opts] - Additional options mapping.
 * @return {Promise<TShellExecOpts extends import('./types').TFullOutputOption ? import('teen_process').TeenProcessExecResult : string>}
 * Command's stdout.
 * @throws {Error} If the command returned non-zero exit code.
 */
export async function shell (cmd, opts) {
  const {
    privileged,
  } = opts ?? /** @type {TShellExecOpts} */ ({});

  const cmdArr = _.isArray(cmd) ? cmd : [cmd];
  const fullCmd = ['shell'];
  if (privileged) {
    log.info(`'adb shell ${util.quote(cmdArr)}' requires root access`);
    if (await this.isRoot()) {
      log.info('The device already had root access');
      fullCmd.push(...cmdArr);
    } else {
      fullCmd.push('su', 'root', util.quote(cmdArr));
    }
  } else {
    fullCmd.push(...cmdArr);
  }
  return await this.adbExec(fullCmd, opts);
}

/**
 *
 * @this {import('../adb.js').ADB}
 * @param {string[]} [args=[]]
 * @returns {import('teen_process').SubProcess}
 */
export function createSubProcess (args = []) {
  // add the default arguments
  const finalArgs = [...this.executable.defaultArgs, ...args];
  log.debug(`Creating ADB subprocess with args: ${JSON.stringify(finalArgs)}`);
  return new SubProcess(this.getAdbPath(), finalArgs);
}

/**
 * Retrieve the current adb port.
 * @todo can probably deprecate this now that the logic is just to read this.adbPort
 *
 * @this {import('../adb.js').ADB}
 * @return {number} The current adb port number.
 */
export function getAdbServerPort () {
  return /** @type {number} */ (this.adbPort);
}

/**
 * Retrieve the current emulator port from _adb devives_ output.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<number>} The current emulator port.
 * @throws {Error} If there are no connected devices.
 */
export async function getEmulatorPort () {
  log.debug('Getting running emulator port');
  if (this.emulatorPort !== null) {
    return /** @type {number} */ (this.emulatorPort);
  }
  try {
    let devices = await this.getConnectedDevices();
    let port = this.getPortFromEmulatorString(devices[0].udid);
    if (port) {
      return port;
    } else {
      throw new Error(`Emulator port not found`);
    }
  } catch (e) {
    throw new Error(`No devices connected. Original error: ${e.message}`);
  }
}

/**
 * Retrieve the current emulator port by parsing emulator name string.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} emStr - Emulator name string.
 * @return {number|false} Either the current emulator port or
 * _false_ if port number cannot be parsed.
 */
export function getPortFromEmulatorString (emStr) {
  let portPattern = /emulator-(\d+)/;
  if (portPattern.test(emStr)) {
    return parseInt((/** @type {RegExpExecArray} */(portPattern.exec(emStr)))[1], 10);
  }
  return false;
}

/**
 * Retrieve the list of currently connected emulators.
 *
 * @this {import('../adb.js').ADB}
 * @param {import('./types').ConnectedDevicesOptions} [opts={}] - Additional options mapping.
 * @return {Promise<import('./types').Device[]>} The list of connected devices.
 */
export async function getConnectedEmulators (opts = {}) {
  log.debug('Getting connected emulators');
  try {
    let devices = await this.getConnectedDevices(opts);
    let emulators = [];
    for (let device of devices) {
      let port = this.getPortFromEmulatorString(device.udid);
      if (port) {
        device.port = port;
        emulators.push(device);
      }
    }
    log.debug(`${util.pluralize('emulator', emulators.length, true)} connected`);
    return emulators;
  } catch (e) {
    throw new Error(`Error getting emulators. Original error: ${e.message}`);
  }
}

/**
 * Set _emulatorPort_ property of the current class.
 *
 * @this {import('../adb.js').ADB}
 * @param {number} emPort - The emulator port to be set.
 */
export function setEmulatorPort (emPort) {
  this.emulatorPort = emPort;
}

/**
 * Set the identifier of the current device (_this.curDeviceId_).
 *
 * @this {import('../adb.js').ADB}
 * @param {string} deviceId - The device identifier.
 */
export function setDeviceId (deviceId) {
  log.debug(`Setting device id to ${deviceId}`);
  this.curDeviceId = deviceId;
  let argsHasDevice = this.executable.defaultArgs.indexOf('-s');
  if (argsHasDevice !== -1) {
    // remove the old device id from the arguments
    this.executable.defaultArgs.splice(argsHasDevice, 2);
  }
  this.executable.defaultArgs.push('-s', deviceId);
}

/**
 * Set the the current device object.
 *
 * @this {import('../adb.js').ADB}
 * @param {import('./types').Device} deviceObj - The device object to be set.
 */
export function setDevice (deviceObj) {
  const deviceId = deviceObj.udid;
  const emPort = this.getPortFromEmulatorString(deviceId);
  if (_.isNumber(emPort)) {
    this.setEmulatorPort(emPort);
  }
  this.setDeviceId(deviceId);
}

/**
 * Get the object for the currently running emulator.
 * !!! This method has a side effect - it implicitly changes the
 * `deviceId` (only if AVD with a matching name is found)
 * and `emulatorPort` instance properties.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} avdName - Emulator name.
 * @return {Promise<import('./types').Device|null>} Currently running emulator or _null_.
 */
export async function getRunningAVD (avdName) {
  log.debug(`Trying to find '${avdName}' emulator`);
  try {
    const emulators = await this.getConnectedEmulators();
    for (const emulator of emulators) {
      if (_.isNumber(emulator.port)) {
        this.setEmulatorPort(emulator.port);
      }
      const runningAVDName = await this.execEmuConsoleCommand(['avd', 'name'], {
        port: emulator.port,
        execTimeout: 5000,
        connTimeout: 1000,
      });
      if (_.toLower(avdName) === _.toLower(runningAVDName.trim())) {
        log.debug(`Found emulator '${avdName}' on port ${emulator.port}`);
        this.setDeviceId(emulator.udid);
        return emulator;
      }
    }
    log.debug(`Emulator '${avdName}' not running`);
    return null;
  } catch (e) {
    throw new Error(`Error getting AVD. Original error: ${e.message}`);
  }
}

/**
 * Get the object for the currently running emulator.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} avdName - Emulator name.
 * @param {number} [timeoutMs=20000] - The maximum number of milliseconds
 *                                     to wait until at least one running AVD object
 *                                     is detected.
 * @return {Promise<import('./types').Device|null>} Currently running emulator or _null_.
 * @throws {Error} If no device has been detected within the timeout.
 */
export async function getRunningAVDWithRetry (avdName, timeoutMs = 20000) {
  try {
    return /** @type {import('./types').Device|null} */ (await waitForCondition(async () => {
      try {
        return await this.getRunningAVD(avdName.replace('@', ''));
      } catch (e) {
        log.debug(e.message);
        return false;
      }
    }, {
      waitMs: timeoutMs,
      intervalMs: 1000,
    }));
  } catch (e) {
    throw new Error(`Error getting AVD with retry. Original error: ${e.message}`);
  }
}

/**
 * Shutdown all running emulators by killing their processes.
 *
 * @this {import('../adb.js').ADB}
 * @throws {Error} If killing tool returned non-zero return code.
 */
export async function killAllEmulators () {
  let cmd, args;
  if (system.isWindows()) {
    cmd = 'TASKKILL';
    args = ['TASKKILL', '/IM', 'emulator.exe'];
  } else {
    cmd = '/usr/bin/killall';
    args = ['-m', 'emulator*'];
  }
  try {
    await exec(cmd, args);
  } catch (e) {
    throw new Error(`Error killing emulators. Original error: ${e.message}`);
  }
}

/**
 * Kill emulator with the given name. No error
 * is thrown is given avd does not exist/is not running.
 *
 * @this {import('../adb.js').ADB}
 * @param {string?} [avdName=null] - The name of the emulator to be killed. If empty,
 *                            the current emulator will be killed.
 * @param {number} [timeout=60000] - The amount of time to wait before throwing
 *                                    an exception about unsuccessful killing
 * @return {Promise<boolean>} - True if the emulator was killed, false otherwise.
 * @throws {Error} if there was a failure by killing the emulator
 */
export async function killEmulator (avdName = null, timeout = 60000) {
  if (util.hasValue(avdName)) {
    log.debug(`Killing avd '${avdName}'`);
    const device = await this.getRunningAVD(avdName);
    if (!device) {
      log.info(`No avd with name '${avdName}' running. Skipping kill step.`);
      return false;
    }
  } else {
    // killing the current avd
    log.debug(`Killing avd with id '${this.curDeviceId}'`);
    if (!await this.isEmulatorConnected()) {
      log.debug(`Emulator with id '${this.curDeviceId}' not connected. Skipping kill step`);
      return false;
    }
  }
  await this.adbExec(['emu', 'kill']);
  log.debug(`Waiting up to ${timeout}ms until the emulator '${avdName ? avdName : this.curDeviceId}' is killed`);
  try {
    await waitForCondition(async () => {
      try {
        return util.hasValue(avdName)
          ? !await this.getRunningAVD(avdName)
          : !await this.isEmulatorConnected();
      } catch {}
      return false;
    }, {
      waitMs: timeout,
      intervalMs: 2000,
    });
  } catch {
    throw new Error(`The emulator '${avdName ? avdName : this.curDeviceId}' is still running after being killed ${timeout}ms ago`);
  }
  log.info(`Successfully killed the '${avdName ? avdName : this.curDeviceId}' emulator`);
  return true;
}

/**
 * Start an emulator with given parameters and wait until it is fully started.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} avdName - The name of an existing emulator.
 * @param {import('./types').AvdLaunchOptions} [opts={}]
 * @returns {Promise<SubProcess>} Emulator subprocess instance
 * @throws {Error} If the emulator fails to start within the given timeout.
 */
export async function launchAVD (avdName, opts = {}) {
  const {
    args = [],
    env = {},
    language,
    country,
    launchTimeout = 60000,
    readyTimeout = 60000,
    retryTimes = 1,
  } = opts;
  log.debug(`Launching Emulator with AVD ${avdName}, launchTimeout ` +
            `${launchTimeout}ms and readyTimeout ${readyTimeout}ms`);
  const emulatorBinaryPath = await this.getSdkBinaryPath('emulator');
  if (avdName.startsWith('@')) {
    avdName = avdName.slice(1);
  }
  await this.checkAvdExist(avdName);

  /** @type {string[]} */
  const launchArgs = ['-avd', avdName];
  launchArgs.push(...(toAvdLocaleArgs(language ?? null, country ?? null)));

  let isDelayAdbFeatureEnabled = false;
  if (this.allowDelayAdb) {
    const {revision} = await this.getEmuVersionInfo();
    if (revision && util.compareVersions(revision, '>=', '29.0.7')) {
      // https://androidstudio.googleblog.com/2019/05/emulator-2907-canary.html
      try {
        const {target} = await this.getEmuImageProperties(avdName);
        const apiMatch = /\d+/.exec(target);
        // https://issuetracker.google.com/issues/142533355
        if (apiMatch && parseInt(apiMatch[0], 10) >= MIN_DELAY_ADB_API_LEVEL) {
          launchArgs.push('-delay-adb');
          isDelayAdbFeatureEnabled = true;
        } else {
          throw new Error(`The actual image API version is below ${MIN_DELAY_ADB_API_LEVEL}`);
        }
      } catch (e) {
        log.info(`The -delay-adb emulator startup detection feature will not be enabled. ` +
          `Original error: ${e.message}`);
      }
    }
  } else {
    log.info('The -delay-adb emulator startup detection feature has been explicitly disabled');
  }

  if (!_.isEmpty(args)) {
    launchArgs.push(...(_.isArray(args) ? args : /** @type {string[]} */ (util.shellParse(`${args}`))));
  }

  log.debug(`Running '${emulatorBinaryPath}' with args: ${util.quote(launchArgs)}`);
  if (!_.isEmpty(env)) {
    log.debug(`Customized emulator environment: ${JSON.stringify(env)}`);
  }
  const proc = new SubProcess(emulatorBinaryPath, launchArgs, {
    env: { ...process.env, ...env },
  });
  await proc.start(0);
  for (const streamName of ['stderr', 'stdout']) {
    proc.on(`line-${streamName}`, (line) => log.debug(`[AVD OUTPUT] ${line}`));
  }
  proc.on('die', (code, signal) => {
    log.warn(`Emulator avd ${avdName} exited with code ${code}${signal ? `, signal ${signal}` : ''}`);
  });
  await retry(retryTimes, async () => await this.getRunningAVDWithRetry(avdName, launchTimeout));
  // At this point we have deviceId already assigned
  const timer = new timing.Timer().start();
  if (isDelayAdbFeatureEnabled) {
    try {
      await this.adbExec(['wait-for-device'], {timeout: readyTimeout});
    } catch (e) {
      throw new Error(`'${avdName}' Emulator has failed to boot: ${e.stderr || e.message}`);
    }
  }
  await this.waitForEmulatorReady(Math.trunc(readyTimeout - timer.getDuration().asMilliSeconds));
  return proc;
}

/**
 * Get the adb version. The result of this method is cached.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<import('./types').Version>}
 * @throws {Error} If it is not possible to parse adb binary version.
 */
export const getVersion = _.memoize(async function getVersion () {
  let stdout;
  try {
    stdout = await this.adbExec('version');
  } catch (e) {
    throw new Error(`Error getting adb version: ${e.stderr || e.message}`);
  }

  const result = {};
  const binaryVersionMatch = BINARY_VERSION_PATTERN.exec(stdout);
  if (binaryVersionMatch) {
    result.binary = {
      version: semver.coerce(binaryVersionMatch[1]),
      build: parseInt(binaryVersionMatch[2], 10),
    };
  }
  const bridgeVersionMatch = BRIDGE_VERSION_PATTERN.exec(stdout);
  if (bridgeVersionMatch) {
    result.bridge = {
      version: semver.coerce(bridgeVersionMatch[1]),
    };
  }
  return result;
});

/**
 * Check if the current emulator is ready to accept further commands (booting completed).
 *
 * @this {import('../adb.js').ADB}
 * @param {number} [timeoutMs=20000] - The maximum number of milliseconds to wait.
 * @returns {Promise<void>}
 * @throws {Error} If the emulator is not ready within the given timeout.
 */
export async function waitForEmulatorReady (timeoutMs = 20000) {
  log.debug(`Waiting up to ${timeoutMs}ms for the emulator to be ready`);
  if (await this.getApiLevel() >= 31) {
    /** @type {string|undefined} */
    let state;
    try {
      await waitForCondition(async () => {
        try {
          state = await this.shell([
            'cmd', 'reboot_readiness', 'check-subsystems-state', '--list-blocking'
          ]);
        } catch (err) {
          // https://github.com/appium/appium/issues/18717
          state = err.stdout || err.stderr;
        }
        if (_.includes(state, SUBSYSTEM_STATE_OK)) {
          return true;
        }

        log.debug(`Waiting for emulator startup. Intermediate state: ${state}`);
        return false;
      }, {
        waitMs: timeoutMs,
        intervalMs: 1000,
      });
    } catch {
      throw new Error(`Emulator is not ready within ${timeoutMs}ms${state ? ('. Reason: ' + state) : ''}`);
    }
    return;
  }

  /** @type {RegExp[]} */
  const requiredServicesRe = REQUIRED_SERVICES.map((name) => new RegExp(`\\b${name}:`));
  let services;
  try {
    await waitForCondition(async () => {
      try {
        services = await this.shell(['service', 'list']);
        return requiredServicesRe.every((pattern) => pattern.test(services));
      } catch (err) {
        log.debug(`Waiting for emulator startup. Intermediate error: ${err.message}`);
        return false;
      }
    }, {
      waitMs: timeoutMs,
      intervalMs: 3000,
    });
  } catch {
    if (services) {
      log.debug(`Recently listed services:\n${services}`);
    }
    const missingServices = _.zip(REQUIRED_SERVICES, requiredServicesRe)
      .filter(([, pattern]) => !(/** @type {RegExp} */ (pattern)).test(services))
      .map(([name]) => name);
    throw new Error(`Emulator is not ready within ${timeoutMs}ms ` +
      `(${missingServices} service${missingServices.length === 1 ? ' is' : 's are'} not running)`);
  }
}

/**
 * Check if the current device is ready to accept further commands (booting completed).
 *
 * @this {import('../adb.js').ADB}
 * @param {number} [appDeviceReadyTimeout=30] - The maximum number of seconds to wait.
 * @throws {Error} If the device is not ready within the given timeout.
 */
export async function waitForDevice (appDeviceReadyTimeout = 30) {
  this.appDeviceReadyTimeout = appDeviceReadyTimeout;
  const retries = 3;
  const timeout = parseInt(`${this.appDeviceReadyTimeout}`, 10) * 1000 / retries;
  await retry(retries, async () => {
    try {
      await this.adbExec('wait-for-device', {timeout});
      await this.ping();
    } catch (e) {
      try {
        await this.reconnect();
      } catch {
        await this.restartAdb();
      }
      await this.getConnectedDevices();
      throw new Error(`Error waiting for the device to be available. Original error: '${e.message}'`);
    }
  });
}

/**
 * Reboot the current device and wait until it is completed.
 *
 * @this {import('../adb.js').ADB}
 * @param {number} [retries=DEFAULT_ADB_REBOOT_RETRIES] - The maximum number of reboot retries.
 * @throws {Error} If the device failed to reboot and number of retries is exceeded.
 */
export async function reboot (retries = DEFAULT_ADB_REBOOT_RETRIES) {
  // Get root access so we can run the next shell commands which require root access
  const { wasAlreadyRooted } = await this.root();
  try {
    // Stop and re-start the device
    await this.shell(['stop']);
    await B.delay(2000); // let the emu finish stopping;
    await this.setDeviceProperty('sys.boot_completed', '0', {
      privileged: false // no need to set privileged true because device already rooted
    });
    await this.shell(['start']);
  } catch (e) {
    const {message} = e;

    // provide a helpful error message if the reason reboot failed was because ADB couldn't gain root access
    if (message.includes('must be root')) {
      throw new Error(`Could not reboot device. Rebooting requires root access and ` +
        `attempt to get root access on device failed with error: '${message}'`);
    }
    throw e;
  } finally {
    // Return root state to what it was before
    if (!wasAlreadyRooted) {
      await this.unroot();
    }
  }
  const timer = new timing.Timer().start();
  await retryInterval(retries, 1000, async () => {
    if ((await this.getDeviceProperty('sys.boot_completed')) === '1') {
      return;
    }
    const msg = `Reboot is not completed after ${timer.getDuration().asMilliSeconds.toFixed(0)}ms`;
    // we don't want the stack trace
    log.debug(msg);
    throw new Error(msg);
  });
}

/**
 * Switch adb server root privileges.
 *
 * @this {import('../adb.js').ADB}
 * @param {boolean} isElevated - Should we elevate to to root or unroot? (default true)
 * @return {Promise<import('./types').RootResult>}
 */
export async function changeUserPrivileges (isElevated) {
  const cmd = isElevated ? 'root' : 'unroot';

  const retryIfOffline = async (cmdFunc) => {
    try {
      return await cmdFunc();
    } catch (err) {
      // Check the output of the stdErr to see if there's any clues that show that the device went offline
      // and if it did go offline, restart ADB
      if (['closed', 'device offline', 'timeout expired']
          .some((x) => (err.stderr || '').toLowerCase().includes(x))) {
        log.warn(`Attempt to ${cmd} caused ADB to think the device went offline`);
        try {
          await this.reconnect();
        } catch {
          await this.restartAdb();
        }
        return await cmdFunc();
      } else {
        throw err;
      }
    }
  };

  // If it's already rooted, our job is done. No need to root it again.
  const isRoot = await retryIfOffline(async () => await this.isRoot());
  if ((isRoot && isElevated) || (!isRoot && !isElevated)) {
    return {isSuccessful: true, wasAlreadyRooted: isRoot};
  }

  let wasAlreadyRooted = isRoot;
  try {
    const {stdout} = await retryIfOffline(async () => await this.adbExec([cmd]));
    log.debug(stdout);

    // on real devices in some situations we get an error in the stdout
    if (stdout) {
      if (stdout.includes('adbd cannot run as root')) {
        return {isSuccessful: false, wasAlreadyRooted};
      }
      // if the device was already rooted, return that in the result
      if (stdout.includes('already running as root')) {
        wasAlreadyRooted = true;
      }
    }
    return {isSuccessful: true, wasAlreadyRooted};
  } catch (err) {
    const {stderr = '', message} = err;
    log.warn(`Unable to ${cmd} adb daemon. Original error: '${message}'. Stderr: '${stderr}'. Continuing.`);
    return {isSuccessful: false, wasAlreadyRooted};
  }
}

/**
 * Switch adb server to root mode
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<import('./types').RootResult>}
 */
export async function root () {
  return await this.changeUserPrivileges(true);
}

/**
 * Switch adb server to non-root mode.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<import('./types').RootResult>}
 */
export async function unroot () {
  return await this.changeUserPrivileges(false);
}

/**
 * Checks whether the current user is root
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<boolean>} True if the user is root
 * @throws {Error} if there was an error while identifying
 * the user.
 */
export async function isRoot () {
  return (await this.shell(['whoami'])).trim() === 'root';
}

/**
 * Installs the given certificate on a rooted real device or
 * an emulator. The emulator must be executed with `-writable-system`
 * command line option and adb daemon should be running in root
 * mode for this method to work properly. The method also requires
 * openssl tool to be available on the destination system.
 * Read https://github.com/appium/appium/issues/10964
 * for more details on this topic
 *
 * @this {import('../adb.js').ADB}
 * @param {Buffer|string} cert - base64-decoded content of the actual certificate
 * represented as a string or a buffer
 * @throws {Error} If openssl tool is not available on the destination system
 * or if there was an error while installing the certificate
 */
export async function installMitmCertificate (cert) {
  const openSsl = await getOpenSslForOs();

  const tmpRoot = await tempDir.openDir();
  try {
    const srcCert = path.resolve(tmpRoot, 'source.cer');
    await fs.writeFile(srcCert, Buffer.isBuffer(cert) ? cert : Buffer.from(cert, 'base64'));
    const {stdout} = await exec(openSsl, ['x509', '-noout', '-hash', '-in', srcCert]);
    const certHash = stdout.trim();
    log.debug(`Got certificate hash: ${certHash}`);
    log.debug('Preparing certificate content');
    const {stdout: stdoutBuff1} = await exec(openSsl, ['x509', '-in', srcCert], {isBuffer: true});
    const {stdout: stdoutBuff2} = await exec(openSsl, [
      'x509',
      '-in', srcCert,
      '-text',
      '-fingerprint',
      '-noout'
    ], {isBuffer: true});
    const dstCertContent = Buffer.concat([stdoutBuff1, stdoutBuff2]);
    const dstCert = path.resolve(tmpRoot, `${certHash}.0`);
    await fs.writeFile(dstCert, dstCertContent);
    log.debug('Remounting /system in rw mode');
    // Sometimes emulator reboot is still not fully finished on this stage, so retry
    await retryInterval(5, 2000, async () => await this.adbExec(['remount']));
    log.debug(`Uploading the generated certificate from '${dstCert}' to '${CERTS_ROOT}'`);
    await this.push(dstCert, CERTS_ROOT);
    log.debug('Remounting /system to confirm changes');
    await this.adbExec(['remount']);
  } catch (err) {
    throw new Error(`Cannot inject the custom certificate. ` +
                    `Is the certificate properly encoded into base64-string? ` +
                    `Do you have root permissions on the device? ` +
                    `Original error: ${err.message}`);
  } finally {
    await fs.rimraf(tmpRoot);
  }
}

/**
 * Verifies if the given root certificate is already installed on the device.
 *
 * @this {import('../adb.js').ADB}
 * @param {Buffer|string} cert - base64-decoded content of the actual certificate
 * represented as a string or a buffer
 * @throws {Error} If openssl tool is not available on the destination system
 * or if there was an error while checking the certificate
 * @returns {Promise<boolean>} true if the given certificate is already installed
 */
export async function isMitmCertificateInstalled (cert) {
  const openSsl = await getOpenSslForOs();

  const tmpRoot = await tempDir.openDir();
  let certHash;
  try {
    const tmpCert = path.resolve(tmpRoot, 'source.cer');
    await fs.writeFile(tmpCert, Buffer.isBuffer(cert) ? cert : Buffer.from(cert, 'base64'));
    const {stdout} = await exec(openSsl, ['x509', '-noout', '-hash', '-in', tmpCert]);
    certHash = stdout.trim();
  } catch (err) {
    throw new Error(`Cannot retrieve the certificate hash. ` +
                    `Is the certificate properly encoded into base64-string? ` +
                    `Original error: ${err.message}`);
  } finally {
    await fs.rimraf(tmpRoot);
  }
  const dstPath = path.posix.resolve(CERTS_ROOT, `${certHash}.0`);
  log.debug(`Checking if the certificate is already installed at '${dstPath}'`);
  return await this.fileExists(dstPath);
}

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

// #region Private functions

/**
 * Transforms the given language and country abbreviations
 * to AVD arguments array
 *
 * @param {?string} language Language name, for example 'fr'
 * @param {?string} country Country name, for example 'CA'
 * @returns {Array<string>} The generated arguments. The
 * resulting array might be empty if both arguments are empty
 */
export function toAvdLocaleArgs (language, country) {
  const result = [];
  if (language && _.isString(language)) {
    result.push('-prop', `persist.sys.language=${language.toLowerCase()}`);
  }
  if (country && _.isString(country)) {
    result.push('-prop', `persist.sys.country=${country.toUpperCase()}`);
  }
  let locale;
  if (_.isString(language) && _.isString(country) && language && country) {
    locale = language.toLowerCase() + '-' + country.toUpperCase();
  } else if (language && _.isString(language)) {
    locale = language.toLowerCase();
  } else if (country && _.isString(country)) {
    locale = country;
  }
  if (locale) {
    result.push('-prop', `persist.sys.locale=${locale}`);
  }
  return result;
}


/**
 * Retrieves full paths to all 'build-tools' subfolders under the particular
 * SDK root folder
 *
 * @type {(sdkRoot: string) => Promise<string[]>}
 */
export const getBuildToolsDirs = _.memoize(async function getBuildToolsDirs (sdkRoot) {
  let buildToolsDirs = await fs.glob('*/', {
    cwd: path.resolve(sdkRoot, 'build-tools'),
    absolute: true,
  });
  try {
    buildToolsDirs = buildToolsDirs
      .map((dir) => [path.basename(dir), dir])
      .sort((a, b) => semver.rcompare(a[0], b[0]))
      .map((pair) => pair[1]);
  } catch (err) {
    log.warn(`Cannot sort build-tools folders ${JSON.stringify(buildToolsDirs.map((dir) => path.basename(dir)))} ` +
      `by semantic version names.`);
    log.warn(`Falling back to sorting by modification date. Original error: ${err.message}`);
    /** @type {[number, string][]} */
    const pairs = await B.map(buildToolsDirs, async (dir) => [(await fs.stat(dir)).mtime.valueOf(), dir]);
    buildToolsDirs = pairs
      // @ts-ignore This sorting works
      .sort((a, b) => a[0] < b[0])
      .map((pair) => pair[1]);
  }
  log.info(`Found ${buildToolsDirs.length} 'build-tools' folders under '${sdkRoot}' (newest first):`);
  for (let dir of buildToolsDirs) {
    log.info(`    ${dir}`);
  }
  return buildToolsDirs;
});

/**
 *
 * @returns {Promise<string>}
 */
async function getOpenSslForOs () {
  const binaryName = `openssl${system.isWindows() ? '.exe' : ''}`;
  try {
    return await fs.which(binaryName);
  } catch {
    throw new Error('The openssl tool must be installed on the system and available on the path');
  }
}

// #endregion
