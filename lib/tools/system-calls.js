import path from 'path';
import log from '../logger.js';
import B from 'bluebird';
import { system, fs, util, tempDir, timing } from 'appium-support';
import {
  getBuildToolsDirs, toAvdLocaleArgs,
  getOpenSslForOs, DEFAULT_ADB_EXEC_TIMEOUT, getSdkRootFromEnv
} from '../helpers';
import { exec, SubProcess } from 'teen_process';
import { sleep, retry, retryInterval, waitForCondition } from 'asyncbox';
import _ from 'lodash';
import semver from 'semver';


let systemCallMethods = {};

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

/**
 * Retrieve full path to the given binary.
 *
 * @param {string} binaryName - The name of the binary.
 * @return {string} Full path to the given binary including current SDK root.
 */
systemCallMethods.getSdkBinaryPath = async function getSdkBinaryPath (binaryName) {
  return await this.getBinaryFromSdkRoot(binaryName);
};

/**
 * Retrieve full binary name for the current operating system as memotize.
 *
 * @param {string} binaryName - simple binary name, for example 'android'.
 * @return {string} Formatted binary name depending on the current platform,
 *                  for example, 'android.bat' on Windows.
 */
systemCallMethods.getBinaryNameForOS = _.memoize(function getBinaryNameForOSMemorize (binaryName) {
  return getBinaryNameForOS(binaryName);
});

/**
 * Retrieve full binary name for the current operating system.
 *
 * @param {string} binaryName - simple binary name, for example 'android'.
 * @return {string} Formatted binary name depending on the current platform,
 *                  for example, 'android.bat' on Windows.
 */
function getBinaryNameForOS (binaryName) {
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

/**
 * Retrieve full path to the given binary and caches it into `binaries`
 * property of the current ADB instance.
 *
 * @param {string} binaryName - Simple name of a binary file.
 * @return {string} Full path to the given binary. The method tries
 *                  to enumerate all the known locations where the binary
 *                  might be located and stops the search as soon as the first
 *                  match is found on the local file system.
 * @throws {Error} If the binary with given name is not present at any
 *                 of known locations or Android SDK is not installed on the
 *                 local file system.
 */
systemCallMethods.getBinaryFromSdkRoot = async function getBinaryFromSdkRoot (binaryName) {
  if (this.binaries[binaryName]) {
    return this.binaries[binaryName];
  }
  const fullBinaryName = this.getBinaryNameForOS(binaryName);
  const binaryLocs = getSdkBinaryLocationCandidates(this.sdkRoot, fullBinaryName);

  // get subpaths for currently installed build tool directories
  let buildToolsDirs = await getBuildToolsDirs(this.sdkRoot);
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
  this.binaries[binaryName] = binaryLoc;
  return binaryLoc;
};

/**
 *  Returns the Android binaries locations
 *
 * @param {string} sdkRoot The path to Android SDK root.
 * @param {string} fullBinaryName The name of full binary name.
 * @return {Array<string>} The list of SDK_BINARY_ROOTS paths
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
 * @return {string} Full path to the given binary. The method tries
 *                  to enumerate all the known locations where the binary
 *                  might be located and stops the search as soon as the first
 *                  match is found on the local file system.
 *                  e.g. '/Path/To/Android/sdk/platform-tools/adb'
 * @throws {Error} If the binary with given name is not present at any
 *                 of known locations or Android SDK is not installed on the
 *                 local file system.
 */
async function getAndroidBinaryPath (binaryName) {
  const fullBinaryName = getBinaryNameForOS(binaryName);
  const sdkRoot = getSdkRootFromEnv();
  const binaryLocs = getSdkBinaryLocationCandidates(sdkRoot, fullBinaryName);
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
 * @param {string} binaryName - The name of the binary.
 * @return {string} Full path to the binary received from 'which'/'where'
 *                  output.
 * @throws {Error} If lookup tool returns non-zero return code.
 */
systemCallMethods.getBinaryFromPath = async function getBinaryFromPath (binaryName) {
  if (this.binaries[binaryName]) {
    return this.binaries[binaryName];
  }

  const fullBinaryName = this.getBinaryNameForOS(binaryName);
  try {
    const binaryLoc = await fs.which(fullBinaryName);
    log.info(`Using '${fullBinaryName}' from '${binaryLoc}'`);
    this.binaries[binaryName] = binaryLoc;
    return binaryLoc;
  } catch (e) {
    throw new Error(`Could not find '${fullBinaryName}' in PATH. Please set the ANDROID_HOME ` +
      `or ANDROID_SDK_ROOT environment variables to the correct Android SDK root directory path.`);
  }
};

/**
 * @typedef {Object} Device
 * @property {string} udid - The device udid.
 * @property {string} state - Current device state, as it is visible in
 *                            _adb devices -l_ output.
 */

/**
 * Retrieve the list of devices visible to adb.
 *
 * @return {Array.<Device>} The list of devices or an empty list if
 *                          no devices are connected.
 * @throws {Error} If there was an error while listing devices.
 */
systemCallMethods.getConnectedDevices = async function getConnectedDevices () {
  log.debug('Getting connected devices');
  let stdout;
  try {
    ({stdout} = await exec(this.executable.path, [...this.executable.defaultArgs, 'devices']));
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
    .reduce((acc, line) => {
      // state is "device", afaic
      const [udid, state] = line.split(/\s+/);
      acc.push({udid, state});
      return acc;
    }, []);
  if (_.isEmpty(devices)) {
    log.debug('No connected devices have been detected');
  } else {
    log.debug(`Connected devices: ${JSON.stringify(devices)}`);
  }
  return devices;
};

/**
 * Retrieve the list of devices visible to adb within the given timeout.
 *
 * @param {number} timeoutMs - The maximum number of milliseconds to get at least
 *                             one list item.
 * @return {Array.<Device>} The list of connected devices.
 * @throws {Error} If no connected devices can be detected within the given timeout.
 */
systemCallMethods.getDevicesWithRetry = async function getDevicesWithRetry (timeoutMs = 20000) {
  const timer = new timing.Timer().start();
  log.debug('Trying to find a connected android device');
  const getDevices = async () => {
    if (timer.getDuration().asMilliSeconds > timeoutMs) {
      throw new Error(`Could not find a connected Android device in ${timer.getDuration().asMilliSeconds.toFixed(0)}ms.`);
    }
    try {
      const devices = await this.getConnectedDevices();
      if (devices.length > 0) {
        return devices;
      }
    } catch (ign) {}

    log.debug('Could not find online devices');
    try {
      await this.reconnect();
    } catch (ign) {
      await this.restartAdb();
    }
    // cool down
    await sleep(200);
    return await getDevices();
  };
  return await getDevices();
};

/**
 * Kick current connection from host/device side and make it reconnect
 *
 * @param {?string} target [offline] One of possible targets to reconnect:
 * offline, device or null
 * Providing `null` will cause reconnection to happen from the host side.
 *
 * @throws {Error} If either ADB version is too old and does not support this
 * command or there was a failure during reconnect.
 */
systemCallMethods.reconnect = async function reconnect (target = 'offline') {
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
};

/**
 * Restart adb server, unless _this.suppressKillServer_ property is true.
 */
systemCallMethods.restartAdb = async function restartAdb () {
  if (this.suppressKillServer) {
    log.debug(`Not restarting abd since 'suppressKillServer' is on`);
    return;
  }

  log.debug('Restarting adb');
  try {
    await this.killServer();
    await this.adbExec(['start-server']);
  } catch (e) {
    log.error(`Error killing ADB server, going to see if it's online anyway`);
  }
};

/**
 * Kill adb server.
 */
systemCallMethods.killServer = async function killServer () {
  log.debug(`Killing adb server on port '${this.adbPort}'`);
  await this.adbExec(['kill-server'], {
    exclusive: true,
  });
};

/**
 * Reset Telnet authentication token.
 * @see {@link http://tools.android.com/recent/emulator2516releasenotes} for more details.
 *
 * @returns {boolean} If token reset was successful.
 */
systemCallMethods.resetTelnetAuthToken = _.memoize(async function resetTelnetAuthToken () {
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
 * @param {Array.<string>} cmd - The array of rest command line parameters.
 */
systemCallMethods.adbExecEmu = async function adbExecEmu (cmd) {
  await this.verifyEmulatorConnected();
  await this.resetTelnetAuthToken();
  await this.adbExec(['emu', ...cmd]);
};

let isExecLocked = false;

/**
 * Execute the given adb command.
 *
 * @param {Array.<string>} cmd - The array of rest command line parameters
 *                      or a single string parameter.
 * @param {Object} opts - Additional options mapping. See
 *                        {@link https://github.com/appium/node-teen_process}
 *                        for more details.
 *                        You can also set the additional `exclusive` param
 *                        to `true` that assures no other parallel adb commands
 *                        are going to be executed while the current one is running
 * @return {string} - Command's stdout.
 * @throws {Error} If the command returned non-zero exit code.
 */
systemCallMethods.adbExec = async function adbExec (cmd, opts = {}) {
  if (!cmd) {
    throw new Error('You need to pass in a command to adbExec()');
  }

  opts = _.cloneDeep(opts);
  // setting default timeout for each command to prevent infinite wait.
  opts.timeout = opts.timeout || this.adbExecTimeout || DEFAULT_ADB_EXEC_TIMEOUT;
  opts.timeoutCapName = opts.timeoutCapName || 'adbExecTimeout'; // For error message

  cmd = _.isArray(cmd) ? cmd : [cmd];
  let adbRetried = false;
  const execFunc = async () => {
    try {
      const args = [...this.executable.defaultArgs, ...cmd];
      log.debug(`Running '${this.executable.path} ` +
        (args.find((arg) => /\s+/.test(arg)) ? util.quote(args) : args.join(' ')) + `'`);
      let {stdout} = await exec(this.executable.path, args, opts);
      // sometimes ADB prints out weird stdout warnings that we don't want
      // to include in any of the response data, so let's strip it out
      stdout = stdout.replace(LINKER_WARNING_REGEXP, '').trim();
      return stdout;
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
          `Try to increase the ${opts.timeout}ms adb execution timeout represented by '${opts.timeoutCapName}' capability`;
      } else {
        e.message = `Error executing adbExec. Original error: '${e.message}'; ` +
          `Stderr: '${(e.stderr || '').trim()}'; Code: '${e.code}'`;
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
  if (opts.exclusive) {
    isExecLocked = true;
  }
  try {
    return await execFunc();
  } finally {
    if (opts.exclusive) {
      isExecLocked = false;
    }
  }
};

/**
 * @typedef {Object} ShellExecOptions
 * @property {?string} timeoutCapName [adbExecTimeout] - the name of the corresponding Appium's timeout capability
 * (used in the error messages).
 * @property {?number} timeout [adbExecTimeout] - command execution timeout.
 * @property {?boolean} privileged [falsy] - Whether to run the given command as root.
 *
 * All other properties are the same as for `exec` call from {@link https://github.com/appium/node-teen_process}
 * module
 */

/**
 * Execute the given command using _adb shell_ prefix.
 *
 * @param {!Array.<string>|string} cmd - The array of rest command line parameters or a single
 *                                      string parameter.
 * @param {?ShellExecOptions} opts [{}] - Additional options mapping.
 * @return {string} - Command's stdout.
 * @throws {Error} If the command returned non-zero exit code.
 */
systemCallMethods.shell = async function shell (cmd, opts = {}) {
  const {
    privileged,
  } = opts;

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
};

systemCallMethods.createSubProcess = function createSubProcess (args = []) {
  // add the default arguments
  args = [...this.executable.defaultArgs, ...args];
  log.debug(`Creating ADB subprocess with args: ${JSON.stringify(args)}`);
  return new SubProcess(this.getAdbPath(), args);
};

/**
 * Retrieve the current adb port.
 * @todo can probably deprecate this now that the logic is just to read this.adbPort
 * @return {number} The current adb port number.
 */
systemCallMethods.getAdbServerPort = function getAdbServerPort () {
  return this.adbPort;
};

/**
 * Retrieve the current emulator port from _adb devives_ output.
 *
 * @return {number} The current emulator port.
 * @throws {Error} If there are no connected devices.
 */
systemCallMethods.getEmulatorPort = async function getEmulatorPort () {
  log.debug('Getting running emulator port');
  if (this.emulatorPort !== null) {
    return this.emulatorPort;
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
};

/**
 * Retrieve the current emulator port by parsing emulator name string.
 *
 * @param {string} emStr - Emulator name string.
 * @return {number|boolean} Either the current emulator port or
 *                          _false_ if port number cannot be parsed.
 */
systemCallMethods.getPortFromEmulatorString = function getPortFromEmulatorString (emStr) {
  let portPattern = /emulator-(\d+)/;
  if (portPattern.test(emStr)) {
    return parseInt(portPattern.exec(emStr)[1], 10);
  }
  return false;
};

/**
 * Retrieve the list of currently connected emulators.
 *
 * @return {Array.<Device>} The list of connected devices.
 */
systemCallMethods.getConnectedEmulators = async function getConnectedEmulators () {
  log.debug('Getting connected emulators');
  try {
    let devices = await this.getConnectedDevices();
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
};

/**
 * Set _emulatorPort_ property of the current class.
 *
 * @param {number} emPort - The emulator port to be set.
 */
systemCallMethods.setEmulatorPort = function setEmulatorPort (emPort) {
  this.emulatorPort = emPort;
};

/**
 * Set the identifier of the current device (_this.curDeviceId_).
 *
 * @param {string} - The device identifier.
 */
systemCallMethods.setDeviceId = function setDeviceId (deviceId) {
  log.debug(`Setting device id to ${deviceId}`);
  this.curDeviceId = deviceId;
  let argsHasDevice = this.executable.defaultArgs.indexOf('-s');
  if (argsHasDevice !== -1) {
    // remove the old device id from the arguments
    this.executable.defaultArgs.splice(argsHasDevice, 2);
  }
  this.executable.defaultArgs.push('-s', deviceId);
};

/**
 * Set the the current device object.
 *
 * @param {Device} deviceObj - The device object to be set.
 */
systemCallMethods.setDevice = function setDevice (deviceObj) {
  let deviceId = deviceObj.udid;
  let emPort = this.getPortFromEmulatorString(deviceId);
  this.setEmulatorPort(emPort);
  this.setDeviceId(deviceId);
};

/**
 * Get the object for the currently running emulator.
 * !!! This method has a side effect - it implicitly changes the
 * `deviceId` (only if AVD with a matching name is found)
 * and `emulatorPort` instance properties.
 *
 * @param {string} avdName - Emulator name.
 * @return {?Device} Currently running emulator or _null_.
 */
systemCallMethods.getRunningAVD = async function getRunningAVD (avdName) {
  log.debug(`Trying to find '${avdName}' emulator`);
  try {
    const emulators = await this.getConnectedEmulators();
    for (const emulator of emulators) {
      this.setEmulatorPort(emulator.port);
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
};

/**
 * Get the object for the currently running emulator.
 *
 * @param {string} avdName - Emulator name.
 * @param {number} timeoutMs [20000] - The maximum number of milliseconds
 *                                     to wait until at least one running AVD object
 *                                     is detected.
 * @return {?Device} Currently running emulator or _null_.
 * @throws {Error} If no device has been detected within the timeout.
 */
systemCallMethods.getRunningAVDWithRetry = async function getRunningAVDWithRetry (avdName, timeoutMs = 20000) {
  try {
    return await waitForCondition(async () => {
      try {
        return await this.getRunningAVD(avdName.replace('@', ''));
      } catch (e) {
        log.debug(e.message);
        return false;
      }
    }, {
      waitMs: timeoutMs,
      intervalMs: 1000,
    });
  } catch (e) {
    throw new Error(`Error getting AVD with retry. Original error: ${e.message}`);
  }
};

/**
 * Shutdown all running emulators by killing their processes.
 *
 * @throws {Error} If killing tool returned non-zero return code.
 */
systemCallMethods.killAllEmulators = async function killAllEmulators () {
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
};

/**
 * Kill emulator with the given name. No error
 * is thrown is given avd does not exist/is not running.
 *
 * @param {?string} avdName - The name of the emulator to be killed. If empty,
 *                            the current emulator will be killed.
 * @param {?number} timeout [60000] - The amount of time to wait before throwing
 *                                    an exception about unsuccessful killing
 * @return {boolean} - True if the emulator was killed, false otherwise.
 * @throws {Error} if there was a failure by killing the emulator
 */
systemCallMethods.killEmulator = async function killEmulator (avdName = null, timeout = 60000) {
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
      } catch (ign) {}
      return false;
    }, {
      waitMs: timeout,
      intervalMs: 2000,
    });
  } catch (e) {
    throw new Error(`The emulator '${avdName ? avdName : this.curDeviceId}' is still running after being killed ${timeout}ms ago`);
  }
  log.info(`Successfully killed the '${avdName ? avdName : this.curDeviceId}' emulator`);
  return true;
};

/**
 * @typedef {Object} AvdLaunchOptions
 * @property {string|Array<string>} args Additional emulator command line arguments
 * @property {Object} env Additional emulator environment variables
 * @property {string} language Emulator system language
 * @property {string} country Emulator system country
 * @property {number} launchTimeout [60000] Emulator startup timeout in milliseconds
 * @property {number} readyTimeout [60000] The maximum period of time to wait until Emulator
 * is ready for usage in milliseconds
 * @property {number} retryTimes [1] The maximum number of startup retries
 */

/**
 * Start an emulator with given parameters and wait until it is fully started.
 *
 * @param {string} avdName - The name of an existing emulator.
 * @param {?AvdLaunchOptions} opts
 * @returns {SubProcess} Emulator subprocess instance
 * @throws {Error} If the emulator fails to start within the given timeout.
 */
systemCallMethods.launchAVD = async function launchAVD (avdName, opts = {}) {
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
  if (avdName[0] === '@') {
    avdName = avdName.substr(1);
  }
  await this.checkAvdExist(avdName);

  const launchArgs = ['-avd', avdName];
  launchArgs.push(...(toAvdLocaleArgs(language, country)));

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
    launchArgs.push(...(_.isArray(args) ? args : util.shellParse(`${args}`)));
  }

  log.debug(`Running '${emulatorBinaryPath}' with args: ${util.quote(launchArgs)}`);
  if (!_.isEmpty(env)) {
    log.debug(`Customized emulator environment: ${JSON.stringify(env)}`);
  }
  const proc = new SubProcess(emulatorBinaryPath, launchArgs, {
    env: Object.assign({}, process.env, env),
  });
  await proc.start(0);
  proc.on('output', (stdout, stderr) => {
    for (let line of (stdout || stderr || '').split('\n').filter(Boolean)) {
      log.info(`[AVD OUTPUT] ${line}`);
    }
  });
  proc.on('die', (code, signal) => {
    log.warn(`Emulator avd ${avdName} exited with code ${code}${signal ? `, signal ${signal}` : ''}`);
  });
  await retry(retryTimes, async () => await this.getRunningAVDWithRetry(avdName, launchTimeout));
  // At this point we have deviceId already assigned
  if (isDelayAdbFeatureEnabled) {
    try {
      await this.adbExec(['wait-for-device'], {timeout: readyTimeout});
    } catch (e) {
      throw new Error(`'${avdName}' Emulator has failed to boot: ${e.stderr || e.message}`);
    }
  } else {
    await this.waitForEmulatorReady(readyTimeout);
  }
  return proc;
};

/**
 * @typedef {Object} BinaryVersion
 * @property {SemVer} version - The ADB binary version number
 * @property {number} build - The ADB binary build number
 */

/**
 * @typedef {Object} BridgeVersion
 * @property {SemVer} version - The Android Debug Bridge version number
 */

/**
 * @typedef {Object} Version
 * @property {?BinaryVersion} binary This version number might not be
 * be present for older ADB releases.
 * @property {BridgeVersion} bridge
 */

/**
 * Get the adb version. The result of this method is cached.
 *
 * @return {Version}
 * @throws {Error} If it is not possible to parse adb binary version.
 */
systemCallMethods.getVersion = _.memoize(async function getVersion () {
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
 * @param {number} timeoutMs [20000] - The maximum number of milliseconds to wait.
 * @throws {Error} If the emulator is not ready within the given timeout.
 */
systemCallMethods.waitForEmulatorReady = async function waitForEmulatorReady (timeoutMs = 20000) {
  try {
    await waitForCondition(async () => {
      try {
        if (!(await this.shell(['getprop', 'init.svc.bootanim'])).includes('stopped')) {
          return false;
        }
        // Sometimes the package manager service might still being initialized
        // on slow systems even after emulator booting is completed.
        // The usual output of `pm get-install-location` command looks like `0[auto]`
        return /\d+\[\w+\]/.test(await this.shell(['pm', 'get-install-location']));
      } catch (err) {
        log.debug(`Waiting for emulator startup. Intermediate error: ${err.message}`);
        return false;
      }
    }, {
      waitMs: timeoutMs,
      intervalMs: 3000,
    });
  } catch (e) {
    throw new Error(`Emulator is not ready within ${timeoutMs}ms`);
  }
};

/**
 * Check if the current device is ready to accept further commands (booting completed).
 *
 * @param {number} appDeviceReadyTimeout [30] - The maximum number of seconds to wait.
 * @throws {Error} If the device is not ready within the given timeout.
 */
systemCallMethods.waitForDevice = async function waitForDevice (appDeviceReadyTimeout = 30) {
  this.appDeviceReadyTimeout = appDeviceReadyTimeout;
  const retries = 3;
  const timeout = parseInt(this.appDeviceReadyTimeout, 10) * 1000 / retries;
  await retry(retries, async () => {
    try {
      await this.adbExec('wait-for-device', {timeout});
      await this.ping();
    } catch (e) {
      try {
        await this.reconnect();
      } catch (ign) {
        await this.restartAdb();
      }
      await this.getConnectedDevices();
      throw new Error(`Error waiting for the device to be available. Original error: '${e.message}'`);
    }
  });
};

/**
 * Reboot the current device and wait until it is completed.
 *
 * @param {number} retries [DEFAULT_ADB_REBOOT_RETRIES] - The maximum number of reboot retries.
 * @throws {Error} If the device failed to reboot and number of retries is exceeded.
 */
systemCallMethods.reboot = async function reboot (retries = DEFAULT_ADB_REBOOT_RETRIES) {
  // Get root access so we can run the next shell commands which require root access
  const { wasAlreadyRooted } = await this.root();
  try {
    // Stop and re-start the device
    await this.shell(['stop']);
    await B.delay(2000); // let the emu finish stopping;
    await this.setDeviceProperty('sys.boot_completed', 0, {
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
    // we don't want the stack trace, so no log.errorAndThrow
    const msg = `Reboot is not completed after ${timer.getDuration().asMilliSeconds.toFixed(0)}ms`;
    log.debug(msg);
    throw new Error(msg);
  });
};

/**
 * @typedef {Object} rootResult
 * @property {boolean} isSuccessful True if the call to root/unroot was successful
 * @property {boolean} wasAlreadyRooted True if the device was already rooted
 */

/**
 * Switch adb server root privileges.
 * @param {boolean} isElevated - Should we elevate to to root or unroot? (default true)
 * @return {rootResult}
 */
systemCallMethods.changeUserPrivileges = async function changeUserPrivileges (isElevated) {
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
        } catch (ign) {
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
};

/**
 * Switch adb server to root mode
 * @return {rootResult}
 */
systemCallMethods.root = async function root () {
  return await this.changeUserPrivileges(true);
};

/**
 * Switch adb server to non-root mode.
 *
 * @return {rootResult}
 */
systemCallMethods.unroot = async function unroot () {
  return await this.changeUserPrivileges(false);
};

/**
 * Checks whether the current user is root
 *
 * @return {boolean} True if the user is root
 * @throws {Error} if there was an error while identifying
 * the user.
 */
systemCallMethods.isRoot = async function isRoot () {
  return (await this.shell(['whoami'])).trim() === 'root';
};

/**
 * Verify whether a remote path exists on the device under test.
 *
 * @param {string} remotePath - The remote path to verify.
 * @return {boolean} True if the given path exists on the device.
 */
systemCallMethods.fileExists = async function fileExists (remotePath) {
  const passFlag = '__PASS__';
  const checkCmd = `[ -e '${remotePath.replace(/'/g, `\\'`)}' ] && echo ${passFlag}`;
  try {
    return _.includes(await this.shell([checkCmd]), passFlag);
  } catch (ign) {
    return false;
  }
};

/**
 * Get the output of _ls_ command on the device under test.
 *
 * @param {string} remotePath - The remote path (the first argument to the _ls_ command).
 * @param {Array.<String>} opts [[]] - Additional _ls_ options.
 * @return {Array.<String>} The _ls_ output as an array of split lines.
 *                          An empty array is returned of the given _remotePath_
 *                          does not exist.
 */
systemCallMethods.ls = async function ls (remotePath, opts = []) {
  try {
    let args = ['ls', ...opts, remotePath];
    let stdout = await this.shell(args);
    let lines = stdout.split('\n');
    return lines.map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => l.indexOf('No such file') === -1);
  } catch (err) {
    if (err.message.indexOf('No such file or directory') === -1) {
      throw err;
    }
    return [];
  }
};

/**
 * Get the size of the particular file located on the device under test.
 *
 * @param {string} remotePath - The remote path to the file.
 * @return {number} File size in bytes.
 * @throws {Error} If there was an error while getting the size of the given file.
 */
systemCallMethods.fileSize = async function fileSize (remotePath) {
  try {
    const files = await this.ls(remotePath, ['-la']);
    if (files.length !== 1) {
      throw new Error(`Remote path is not a file`);
    }
    // https://regex101.com/r/fOs4P4/8
    const match = /[rwxsStT\-+]{10}[\s\d]*\s[^\s]+\s+[^\s]+\s+(\d+)/.exec(files[0]);
    if (!match || _.isNaN(parseInt(match[1], 10))) {
      throw new Error(`Unable to parse size from list output: '${files[0]}'`);
    }
    return parseInt(match[1], 10);
  } catch (err) {
    throw new Error(`Unable to get file size for '${remotePath}': ${err.message}`);
  }
};

/**
 * Installs the given certificate on a rooted real device or
 * an emulator. The emulator must be executed with `-writable-system`
 * command line option and adb daemon should be running in root
 * mode for this method to work properly. The method also requires
 * openssl tool to be available on the destination system.
 * Read https://github.com/appium/appium/issues/10964
 * for more details on this topic
 *
 * @param {Buffer|string} cert - base64-decoded content of the actual certificate
 * represented as a string or a buffer
 * @throws {Error} If openssl tool is not available on the destination system
 * or if there was an error while installing the certificate
 */
systemCallMethods.installMitmCertificate = async function installMitmCertificate (cert) {
  const openSsl = await getOpenSslForOs();

  if (!_.isBuffer(cert)) {
    cert = Buffer.from(cert, 'base64');
  }

  const tmpRoot = await tempDir.openDir();
  try {
    const srcCert = path.resolve(tmpRoot, 'source.cer');
    await fs.writeFile(srcCert, cert);
    let {stdout} = await exec(openSsl, ['x509', '-noout', '-hash', '-in', srcCert]);
    const certHash = stdout.trim();
    log.debug(`Got certificate hash: ${certHash}`);
    log.debug('Preparing certificate content');
    ({stdout} = await exec(openSsl, ['x509', '-in', srcCert], {isBuffer: true}));
    let dstCertContent = stdout;
    ({stdout} = await exec(openSsl, ['x509',
      '-in', srcCert,
      '-text',
      '-fingerprint',
      '-noout'], {isBuffer: true}));
    dstCertContent = Buffer.concat([dstCertContent, stdout]);
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
};

/**
 * Verifies if the given root certificate is already installed on the device.
 *
 * @param {Buffer|string} cert - base64-decoded content of the actual certificate
 * represented as a string or a buffer
 * @throws {Error} If openssl tool is not available on the destination system
 * or if there was an error while checking the certificate
 * @returns {boolean} true if the given certificate is already installed
 */
systemCallMethods.isMitmCertificateInstalled = async function isMitmCertificateInstalled (cert) {
  const openSsl = await getOpenSslForOs();

  if (!_.isBuffer(cert)) {
    cert = Buffer.from(cert, 'base64');
  }

  const tmpRoot = await tempDir.openDir();
  let certHash;
  try {
    const tmpCert = path.resolve(tmpRoot, 'source.cer');
    await fs.writeFile(tmpCert, cert);
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
};

export default systemCallMethods;
export { DEFAULT_ADB_EXEC_TIMEOUT, getAndroidBinaryPath };
