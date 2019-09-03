import path from 'path';
import log from '../logger.js';
import B from 'bluebird';
import { system, fs, util, tempDir } from 'appium-support';
import {
  getSdkToolsVersion,
  getBuildToolsDirs,
  getOpenSslForOs,
  DEFAULT_ADB_EXEC_TIMEOUT } from '../helpers';
import { exec, SubProcess } from 'teen_process';
import { sleep, retry, retryInterval, waitForCondition } from 'asyncbox';
import _ from 'lodash';
import { quote } from 'shell-quote';


let systemCallMethods = {};

const DEFAULT_ADB_REBOOT_RETRIES = 90;

const LINKER_WARNING_REGEXP = /^WARNING: linker.+$/m;
const PROTOCOL_FAULT_ERROR_REGEXP = new RegExp('protocol fault \\(no status\\)', 'i');
const DEVICE_NOT_FOUND_ERROR_REGEXP = new RegExp(`error: device ('.+' )?not found`, 'i');
const DEVICE_CONNECTING_ERROR_REGEXP = new RegExp('error: device still connecting', 'i');

const CERTS_ROOT = '/system/etc/security/cacerts';

/**
 * Retrieve full path to the given binary.
 *
 * @param {string} binaryName - The name of the binary.
 * @return {string} Full path to the given binary including current SDK root.
 */
systemCallMethods.getSdkBinaryPath = async function getSdkBinaryPath (binaryName) {
  if (this.sdkRoot) {
    return await this.getBinaryFromSdkRoot(binaryName);
  }
  log.warn(`The ANDROID_HOME environment variable is not set to the Android SDK ` +
    `root directory path. ANDROID_HOME is required for compatibility ` +
    `with SDK 23+. Checking along PATH for ${binaryName}.`);
  return await this.getBinaryFromPath(binaryName);
};

/**
 * Retrieve full binary name for the current operating system.
 *
 * @param {string} binaryName - simple binary name, for example 'android'.
 * @return {string} Formatted binary name depending on the current platform,
 *                  for example, 'android.bat' on Windows.
 */
systemCallMethods.getBinaryNameForOS = _.memoize(function getBinaryNameForOS (binaryName) {
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
});

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
  const binaryLocs = ['platform-tools', 'emulator', 'tools', `tools${path.sep}bin`]
    .map((x) => path.resolve(this.sdkRoot, x, fullBinaryName));
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
  binaryLocs.push(...(buildToolsDirs.map((dir) => path.resolve(dir, fullBinaryName))));

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
      `or ANDROID_SDK_ROOT environment variables to the corect Android SDK root directory path.`);
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
  log.debug('Getting connected devices...');
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
  const excludedLines = [listHeader, 'adb server', '* daemon', 'offline'];
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
  let start = Date.now();
  log.debug('Trying to find a connected android device');
  let getDevices = async () => {
    if ((Date.now() - start) > timeoutMs) {
      throw new Error('Could not find a connected Android device.');
    }
    try {
      let devices = await this.getConnectedDevices();
      if (devices.length < 1) {
        log.debug('Could not find devices, restarting adb server...');
        await this.restartAdb();
        // cool down
        await sleep(200);
        return await getDevices();
      }
      return devices;
    } catch (e) {
      log.debug('Could not find devices, restarting adb server...');
      await this.restartAdb();
      // cool down
      await sleep(200);
      return await getDevices();
    }
  };
  return await getDevices();
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
  } catch (e) {
    log.error(`Error killing ADB server, going to see if it's online anyway`);
  }
};

/**
 * Kill adb server.
 */
systemCallMethods.killServer = async function killServer () {
  log.debug(`Killing adb server on port ${this.adbPort}`);
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
      log.debug(`Running '${this.executable.path} ${quote(args)}'`);
      let {stdout} = await exec(this.executable.path, args, opts);
      // sometimes ADB prints out weird stdout warnings that we don't want
      // to include in any of the response data, so let's strip it out
      stdout = stdout.replace(LINKER_WARNING_REGEXP, '').trim();
      return stdout;
    } catch (e) {
      const errText = `${e.message}, ${e.stdout}, ${e.stderr}`;
      const protocolFaultError = PROTOCOL_FAULT_ERROR_REGEXP.test(errText);
      const deviceNotFoundError = DEVICE_NOT_FOUND_ERROR_REGEXP.test(errText);
      const deviceConnectingError = DEVICE_CONNECTING_ERROR_REGEXP.test(errText);
      if (protocolFaultError || deviceNotFoundError || deviceConnectingError) {
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
 * @property {?boolean} keepPrivileged [falsy] - Whether to keep root mode after command execution is completed.
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
    keepPrivileged,
  } = opts;

  // If the command requires privileges, root this device
  let shouldRestoreUser = false;
  if (privileged) {
    log.info(`'adb shell ${cmd}' requires root access. Attempting to gain root access now.`);
    const {wasAlreadyRooted, isSuccessful} = await this.root();
    shouldRestoreUser = !wasAlreadyRooted;
    if (wasAlreadyRooted) {
      log.info('Device already had root access');
    } else {
      log.info(isSuccessful ? 'Root access successfully gained' : 'Could not gain root access');
    }
  }
  let didCommandFail = false;
  try {
    try {
      return await this.adbExec(_.isArray(cmd) ? ['shell', ...cmd] : ['shell', cmd], opts);
    } catch (err) {
      didCommandFail = true;
      throw err;
    }
  } finally {
    // Return the 'root' state to what it was before 'shell' was called
    if (privileged && shouldRestoreUser && (!keepPrivileged || didCommandFail)) {
      const {isSuccessful} = await this.unroot();
      log.debug(isSuccessful ? 'Returned device to unrooted state' : 'Could not return device to unrooted state');
    }
  }
};

systemCallMethods.createSubProcess = function createSubProcess (args = []) {
  // add the default arguments
  args = this.executable.defaultArgs.concat(args);
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
    log.debug(`${emulators.length} emulator(s) connected`);
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
      const runningAVDName = await this.sendTelnetCommand('avd name');
      if (_.toLower(avdName) === _.toLower(runningAVDName)) {
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
  let runningAvd;
  try {
    await waitForCondition(async () => {
      try {
        runningAvd = await this.getRunningAVD(avdName.replace('@', ''));
        return runningAvd;
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
  return runningAvd;
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
 * Start an emulator with given parameters and wait until it is full started.
 *
 * @param {string} avdName - The name of an existing emulator.
 * @param {Array.<string>|string} avdArgs - Additional emulator command line argument.
 * @param {?string} language - Emulator system language.
 * @param {?country} country - Emulator system country.
 * @param {number} avdLaunchTimeout [60000] - Emulator startup timeout in milliseconds.
 * @param {number} retryTimes [1] - The maximum number of startup retries.
 * @throws {Error} If the emulator fails to start within the given timeout.
 */
systemCallMethods.launchAVD = async function launchAVD (avdName, avdArgs, language, country,
  avdLaunchTimeout = 60000, avdReadyTimeout = 60000, retryTimes = 1) {
  log.debug(`Launching Emulator with AVD ${avdName}, launchTimeout ` +
            `${avdLaunchTimeout}ms and readyTimeout ${avdReadyTimeout}ms`);
  let emulatorBinaryPath = await this.getSdkBinaryPath('emulator');
  if (avdName[0] === '@') {
    avdName = avdName.substr(1);
  }
  await this.checkAvdExist(avdName);
  let launchArgs = ['-avd', avdName];
  if (_.isString(language)) {
    log.debug(`Setting Android Device Language to ${language}`);
    launchArgs.push('-prop', `persist.sys.language=${language.toLowerCase()}`);
  }
  if (_.isString(country)) {
    log.debug(`Setting Android Device Country to ${country}`);
    launchArgs.push('-prop', `persist.sys.country=${country.toUpperCase()}`);
  }
  let locale;
  if (_.isString(language) && _.isString(country)) {
    locale = language.toLowerCase() + '-' + country.toUpperCase();
  } else if (_.isString(language)) {
    locale = language.toLowerCase();
  } else if (_.isString(country)) {
    locale = country;
  }
  if (_.isString(locale)) {
    log.debug(`Setting Android Device Locale to ${locale}`);
    launchArgs.push('-prop', `persist.sys.locale=${locale}`);
  }
  if (!_.isEmpty(avdArgs)) {
    launchArgs.push(...(_.isArray(avdArgs) ? avdArgs : avdArgs.split(' ')));
  }
  log.debug(`Running '${emulatorBinaryPath}' with args: ${JSON.stringify(launchArgs)}`);
  let proc = new SubProcess(emulatorBinaryPath, launchArgs);
  await proc.start(0);
  proc.on('output', (stdout, stderr) => {
    for (let line of (stdout || stderr || '').split('\n').filter(Boolean)) {
      log.info(`[AVD OUTPUT] ${line}`);
    }
  });
  proc.on('die', (code, signal) => {
    log.warn(`Emulator avd ${avdName} exited with code ${code}${signal ? `, signal ${signal}` : ''}`);
  });
  await retry(retryTimes, async () => await this.getRunningAVDWithRetry(avdName, avdLaunchTimeout));
  await this.waitForEmulatorReady(avdReadyTimeout);
  return proc;
};

/**
 * @typedef {Object} ADBVersion
 * @property {string} versionString - ADB version as a string.
 * @property {float} versionFloat - Version number as float value (useful for comparison).
 * @property {number} major - Major version number.
 * @property {number} minor - Minor version number.
 * @property {number} patch - Patch version number.
 */

/**
 * Get the adb version. The result of this method is cached.
 *
 * @return {ADBVersion} The current adb version.
 * @throws {Error} If it is not possible to parse adb version.
 */
systemCallMethods.getAdbVersion = _.memoize(async function getAdbVersion () {
  try {
    let adbVersion = (await this.adbExec('version'))
      .replace(/Android\sDebug\sBridge\sversion\s([\d.]*)[\s\w-]*/, '$1');
    let parts = adbVersion.split('.');
    return {
      versionString: adbVersion,
      versionFloat: parseFloat(adbVersion),
      major: parseInt(parts[0], 10),
      minor: parseInt(parts[1], 10),
      patch: parts[2] ? parseInt(parts[2], 10) : undefined,
    };
  } catch (e) {
    throw new Error(`Error getting adb version. Original error: '${e.message}'; ` +
                        `Stderr: '${(e.stderr || '').trim()}'; Code: '${e.code}'`);
  }
});

/**
 * Check if given emulator exists in the list of available avds.
 *
 * @param {string} avdName - The name of emulator to verify for existence.
 * @throws {Error} If the emulator with given name does not exist.
 */
systemCallMethods.checkAvdExist = async function checkAvdExist (avdName) {
  let cmd, result;
  try {
    cmd = await this.getSdkBinaryPath('emulator');
    result = await exec(cmd, ['-list-avds']);
  } catch (e) {
    let unknownOptionError = new RegExp('unknown option: -list-avds', 'i').test(e.stderr);
    if (!unknownOptionError) {
      throw new Error(`Error executing checkAvdExist. Original error: '${e.message}'; ` +
                      `Stderr: '${(e.stderr || '').trim()}'; Code: '${e.code}'`);

    }
    const sdkVersion = await getSdkToolsVersion();
    let binaryName = 'android';
    if (sdkVersion) {
      if (sdkVersion.major >= 25) {
        binaryName = 'avdmanager';
      }
    } else {
      log.warn(`Defaulting binary name to '${binaryName}', because SDK version cannot be parsed`);
    }
    // If -list-avds option is not available, use android command as an alternative
    cmd = await this.getSdkBinaryPath(binaryName);
    result = await exec(cmd, ['list', 'avd', '-c']);
  }
  if (result.stdout.indexOf(avdName) === -1) {
    let existings = `(${result.stdout.trim().replace(/[\n]/g, '), (')})`;
    throw new Error(`Avd '${avdName}' is not available. please select your avd name from one of these: '${existings}'`);
  }
};

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
  const timeout = parseInt(this.appDeviceReadyTimeout, 10) / retries * 1000;
  await retry(retries, async () => {
    try {
      await this.adbExec('wait-for-device', {timeout});
      await this.ping();
    } catch (e) {
      await this.restartAdb();
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
  const started = process.hrtime();
  await retryInterval(retries, 1000, async () => {
    if ((await this.getDeviceProperty('sys.boot_completed')) === '1') {
      return;
    }
    // we don't want the stack trace, so no log.errorAndThrow
    const msg = `Reboot is not completed after ${process.hrtime(started)[0]}s`;
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

  // If it's already rooted, our job is done. No need to root it again.
  const isRoot = await this.isRoot();
  if ((isRoot && isElevated) || (!isRoot && !isElevated)) {
    return {isSuccessful: true, wasAlreadyRooted: isRoot};
  }

  let wasAlreadyRooted = isRoot;
  try {
    let {stdout} = await this.adbExec([cmd]);

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

    // Check the output of the stdErr to see if there's any clues that show that the device went offline
    // and if it did go offline, restart ADB
    if (['closed', 'device offline', 'timeout expired'].some((x) => stderr.toLowerCase().includes(x))) {
      log.warn(`Attempt to 'adb ${cmd}' caused device to go offline. Restarting adb.`);
      await this.restartAdb();
    }

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
  let files = await this.ls(remotePath);
  return files.length > 0;
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
export { DEFAULT_ADB_EXEC_TIMEOUT };
