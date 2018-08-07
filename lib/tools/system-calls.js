import path from 'path';
import log from '../logger.js';
import B from 'bluebird';
import { system, fs, util, tempDir } from 'appium-support';
import { getSdkToolsVersion, getBuildToolsDirs,
  getOpenSslForOs } from '../helpers';
import { exec, SubProcess } from 'teen_process';
import { sleep, retry, retryInterval, waitForCondition } from 'asyncbox';
import _ from 'lodash';
import { quote } from 'shell-quote';


let systemCallMethods = {};

const DEFAULT_ADB_EXEC_TIMEOUT = 20000; // in milliseconds
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
systemCallMethods.getSdkBinaryPath = _.memoize(async function (binaryName) {
  log.info(`Checking whether ${binaryName} is present`);
  if (this.sdkRoot) {
    return await this.getBinaryFromSdkRoot(binaryName);
  }
  log.warn(`The ANDROID_HOME environment variable is not set to the Android SDK ` +
           `root directory path. ANDROID_HOME is required for compatibility ` +
           `with SDK 23+. Checking along PATH for ${binaryName}.`);
  return await this.getBinaryFromPath(binaryName);
});

/**
 * Retrieve the name of the tool,
 * which prints full path to the given command shortcut.
 *
 * @return {string} Depending on the current platform this is
 *                  supposed to be either 'which' or 'where'.
 */
systemCallMethods.getCommandForOS = _.memoize(function () {
  return system.isWindows() ? 'where' : 'which';
});

/**
 * Retrieve full binary name for the current operating system.
 *
 * @param {string} binaryName - simple binary name, for example 'android'.
 * @return {string} Formatted binary name depending on the current platform,
 *                  for example, 'android.bat' on Windows.
 */
systemCallMethods.getBinaryNameForOS = _.memoize(function (binaryName) {
  if (!system.isWindows()) {
    return binaryName;
  }

  if (['android', 'apksigner', 'apkanalyzer'].indexOf(binaryName) >= 0 &&
      !binaryName.toLowerCase().endsWith('.bat')) {
    return `${binaryName}.bat`;
  }
  if (!binaryName.toLowerCase().endsWith('.exe')) {
    return `${binaryName}.exe`;
  }
  return binaryName;
});

/**
 * Retrieve full path to the given binary.
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
systemCallMethods.getBinaryFromSdkRoot = _.memoize(async function (binaryName) {
  let binaryLoc = null;
  binaryName = this.getBinaryNameForOS(binaryName);
  let binaryLocs = [
    path.resolve(this.sdkRoot, "platform-tools", binaryName),
    path.resolve(this.sdkRoot, "emulator", binaryName),
    path.resolve(this.sdkRoot, "tools", binaryName),
    path.resolve(this.sdkRoot, "tools", "bin", binaryName)
  ];
  // get subpaths for currently installed build tool directories
  _.forEach(await getBuildToolsDirs(this.sdkRoot),
            (dir) => binaryLocs.push(path.resolve(dir, binaryName)));
  for (let loc of binaryLocs) {
    if (await fs.exists(loc)) {
      binaryLoc = loc;
      break;
    }
  }
  if (_.isNull(binaryLoc)) {
    throw new Error(`Could not find ${binaryName} in ${binaryLocs}. ` +
                    `Do you have the Android SDK installed at '${this.sdkRoot}'?`);
  }
  binaryLoc = binaryLoc.trim();
  log.info(`Using ${binaryName} from ${binaryLoc}`);
  return binaryLoc;
});

/**
 * Retrieve full path to a binary file using the standard system lookup tool.
 *
 * @param {string} binaryName - The name of the binary.
 * @return {string} Full path to the binary received from 'which'/'where'
 *                  output.
 * @throws {Error} If lookup tool returns non-zero return code.
 */
systemCallMethods.getBinaryFromPath = async function (binaryName) {
  let binaryLoc = null;
  let cmd = this.getCommandForOS();
  try {
    let {stdout} = await exec(cmd, [binaryName]);
    log.info(`Using ${binaryName} from ${stdout}`);
    // TODO write a test for binaries with spaces.
    binaryLoc = stdout.trim();
    return binaryLoc;
  } catch (e) {
    throw new Error(`Could not find ${binaryName} Please set the ANDROID_HOME ` +
              `environment variable with the Android SDK root directory path.`);
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
systemCallMethods.getConnectedDevices = async function () {
  log.debug("Getting connected devices...");
  try {
    let {stdout} = await exec(this.executable.path, this.executable.defaultArgs.concat(['devices']));
    // expecting adb devices to return output as
    // List of devices attached
    // emulator-5554	device
    let startingIndex = stdout.indexOf("List of devices");
    if (startingIndex === -1) {
      throw new Error(`Unexpected output while trying to get devices. output was: ${stdout}`);
    }
    // slicing ouput we care about.
    stdout = stdout.slice(startingIndex);
    let devices = [];
    for (let line of stdout.split("\n")) {
      if (line.trim() !== "" &&
          line.indexOf("List of devices") === -1 &&
          line.indexOf("adb server") === -1 &&
          line.indexOf("* daemon") === -1 &&
          line.indexOf("offline") === -1) {
        let lineInfo = line.split("\t");
        // state is either "device" or "offline", afaict
        devices.push({udid: lineInfo[0], state: lineInfo[1]});
      }
    }
    log.debug(`${devices.length} device(s) connected`);
    return devices;
  } catch (e) {
    throw new Error(`Error while getting connected devices. Original error: ${e.message}`);
  }
};

/**
 * Retrieve the list of devices visible to adb within the given timeout.
 *
 * @param {number} timeoutMs - The maximum number of milliseconds to get at least
 *                             one list item.
 * @return {Array.<Device>} The list of connected devices.
 * @throws {Error} If no connected devices can be detected within the given timeout.
 */
systemCallMethods.getDevicesWithRetry = async function (timeoutMs = 20000) {
  let start = Date.now();
  log.debug("Trying to find a connected android device");
  let getDevices = async () => {
    if ((Date.now() - start) > timeoutMs) {
      throw new Error("Could not find a connected Android device.");
    }
    try {
      let devices = await this.getConnectedDevices();
      if (devices.length < 1) {
        log.debug("Could not find devices, restarting adb server...");
        await this.restartAdb();
        // cool down
        await sleep(200);
        return await getDevices();
      }
      return devices;
    } catch (e) {
      log.debug("Could not find devices, restarting adb server...");
      await this.restartAdb();
      // cool down
      await sleep(200);
      return await getDevices();
    }
  };
  return await getDevices();
};

/**
 * Restart adb server if _this.suppressKillServer_ property is true.
 */
systemCallMethods.restartAdb = async function () {
  if (this.suppressKillServer) {
    log.debug(`Not restarting abd since 'suppressKillServer' is on`);
    return;
  }

  log.debug('Restarting adb');
  try {
    await this.killServer();
  } catch (e) {
    log.error("Error killing ADB server, going to see if it's online anyway");
  }
};

/**
 * Kill adb server.
 */
systemCallMethods.killServer = async function () {
  log.debug(`Killing adb server on port ${this.adbPort}`);
  await exec(this.executable.path, [...this.executable.defaultArgs, 'kill-server']);
};

/**
 * Reset Telnet authentication token.
 * @see {@link http://tools.android.com/recent/emulator2516releasenotes} for more details.
 *
 * @returns {boolean} If token reset was successful.
 */
systemCallMethods.resetTelnetAuthToken = _.memoize(async function () {
  // The methods is used to remove telnet auth token
  //
  const homeFolderPath = process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'];
  if (!homeFolderPath) {
    log.warn('Cannot find the path to user home folder. Ignoring resetting of emulator\'s telnet authentication token');
    return false;
  }
  const dstPath = path.resolve(homeFolderPath, '.emulator_console_auth_token');
  log.debug(`Overriding ${dstPath} with an empty string to avoid telnet authentication for emulator commands`);
  try {
    await fs.writeFile(dstPath, '');
  } catch (e) {
    log.warn(`Error ${e.message} while resetting the content of ${dstPath}. Ignoring resetting of emulator\'s telnet authentication token`);
    return false;
  }
  return true;
});

/**
 * Execute the given emulator command using _adb emu_ tool.
 *
 * @param {Array.<string>} cmd - The array of rest command line parameters.
 */
systemCallMethods.adbExecEmu = async function (cmd) {
  await this.verifyEmulatorConnected();
  await this.resetTelnetAuthToken();
  await this.adbExec(['emu', ...cmd]);
};

/**
 * Execute the given adb command.
 *
 * @param {Array.<string>} cmd - The array of rest command line parameters
 *                      or a single string parameter.
 * @param {Object} opts - Additional options mapping. See
 *                        {@link https://github.com/appium/node-teen_process}
 *                        for more details.
 * @return {string} - Command's stdout.
 * @throws {Error} If the command returned non-zero exit code.
 */
systemCallMethods.adbExec = async function (cmd, opts = {}) {
  if (!cmd) {
    throw new Error("You need to pass in a command to adbExec()");
  }
  // setting default timeout for each command to prevent infinite wait.
  opts.timeout = opts.timeout || this.execTimeout || DEFAULT_ADB_EXEC_TIMEOUT;

  let execFunc = async () => {
    try {
      if (!(cmd instanceof Array)) {
        cmd = [cmd];
      }
      let args = this.executable.defaultArgs.concat(cmd);
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
      }

      if (e.code === 0 && e.stdout) {
        let stdout = e.stdout;
        stdout = stdout.replace(LINKER_WARNING_REGEXP, '').trim();
        return stdout;
      }

      throw new Error(`Error executing adbExec. Original error: '${e.message}'; ` +
                      `Stderr: '${(e.stderr || '').trim()}'; Code: '${e.code}'`);
    }
  };

  return await retry(2, execFunc);
};

/**
 * Execute the given command using _adb shell_ prefix.
 *
 * @param {Array.<string>|string} cmd - The array of rest command line parameters or a single
 *                                      string parameter.
 * @param {Object} opts - Additional options mapping. See
 *                        {@link https://github.com/appium/node-teen_process}
 *                        for more details.
 * @return {string} - Command's stdout.
 * @throws {Error} If the command returned non-zero exit code.
 */
systemCallMethods.shell = async function (cmd, opts = {}) {
  return await this.adbExec(_.isArray(cmd) ? ['shell', ...cmd] : ['shell', cmd], opts);
};

systemCallMethods.createSubProcess = function (args = []) {
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
systemCallMethods.getAdbServerPort = function () {
  return this.adbPort;
};

/**
 * Retrieve the current emulator port from _adb devives_ output.
 *
 * @return {number} The current emulator port.
 * @throws {Error} If there are no connected devices.
 */
systemCallMethods.getEmulatorPort = async function () {
  log.debug("Getting running emulator port");
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
systemCallMethods.getPortFromEmulatorString = function (emStr) {
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
systemCallMethods.getConnectedEmulators = async function () {
  try {
    log.debug("Getting connected emulators");
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
systemCallMethods.setEmulatorPort = function (emPort) {
  this.emulatorPort = emPort;
};

/**
 * Set the identifier of the current device (_this.curDeviceId_).
 *
 * @param {string} - The device identifier.
 */
systemCallMethods.setDeviceId = function (deviceId) {
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
systemCallMethods.setDevice = function (deviceObj) {
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
systemCallMethods.getRunningAVD = async function (avdName) {
  try {
    log.debug(`Trying to find ${avdName} emulator`);
    let emulators = await this.getConnectedEmulators();
    for (let emulator of emulators) {
      this.setEmulatorPort(emulator.port);
      let runningAVDName = await this.sendTelnetCommand("avd name");
      if (avdName === runningAVDName) {
        log.debug(`Found emulator ${avdName} in port ${emulator.port}`);
        this.setDeviceId(emulator.udid);
        return emulator;
      }
    }
    log.debug(`Emulator ${avdName} not running`);
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
systemCallMethods.getRunningAVDWithRetry = async function (avdName, timeoutMs = 20000) {
  try {
    let start = Date.now();
    while ((Date.now() - start) < timeoutMs) {
      try {
        let runningAVD = await this.getRunningAVD(avdName.replace('@', ''));
        if (runningAVD) {
          return runningAVD;
        }
      } catch (e) {
        // Do nothing.
        log.info(`Couldn't get running AVD, will retry. Error was: ${e.message}`);
      }
      // cool down
      await sleep(200);
    }
    throw new Error(`Could not find ${avdName} emulator.`);
  } catch (e) {
    throw new Error(`Error getting AVD with retry. Original error: ${e.message}`);
  }
};

/**
 * Shutdown all running emulators by killing their processes.
 *
 * @throws {Error} If killing tool returned non-zero return code.
 */
systemCallMethods.killAllEmulators = async function () {
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
systemCallMethods.killEmulator = async function (avdName = null, timeout = 60000) {
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
 * @param {?contry} country - Emulator system country.
 * @param {number} avdLaunchTimeout [60000] - Emulator startup timeout in milliseconds.
 * @param {number} retryTimes [1] - The maximum number of startup retries.
 * @throws {Error} If the emulator fails to start within the given timeout.
 */
systemCallMethods.launchAVD = async function (avdName, avdArgs, language, country,
  avdLaunchTimeout = 60000, avdReadyTimeout = 60000, retryTimes = 1) {
  log.debug(`Launching Emulator with AVD ${avdName}, launchTimeout ` +
            `${avdLaunchTimeout}ms and readyTimeout ${avdReadyTimeout}ms`);
  let emulatorBinaryPath = await this.getSdkBinaryPath("emulator");
  if (avdName[0] === "@") {
    avdName = avdName.substr(1);
  }
  await this.checkAvdExist(avdName);
  let launchArgs = ["-avd", avdName];
  if (_.isString(language)) {
    log.debug(`Setting Android Device Language to ${language}`);
    launchArgs.push("-prop", `persist.sys.language=${language.toLowerCase()}`);
  }
  if (_.isString(country)) {
    log.debug(`Setting Android Device Country to ${country}`);
    launchArgs.push("-prop", `persist.sys.country=${country.toUpperCase()}`);
  }
  let locale;
  if (_.isString(language) && _.isString(country)) {
    locale = language.toLowerCase() + "-" + country.toUpperCase();
  } else if (_.isString(language)) {
    locale = language.toLowerCase();
  } else if (_.isString(country)) {
    locale = country;
  }
  if (_.isString(locale)) {
    log.debug(`Setting Android Device Locale to ${locale}`);
    launchArgs.push("-prop", `persist.sys.locale=${locale}`);
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
  await retry(retryTimes, this.getRunningAVDWithRetry.bind(this), avdName, avdLaunchTimeout);
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
systemCallMethods.getAdbVersion = _.memoize(async function () {
  try {
    let adbVersion = (await this.adbExec('version'))
      .replace(/Android\sDebug\sBridge\sversion\s([\d\.]*)[\s\w\-]*/, "$1");
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
systemCallMethods.checkAvdExist = async function (avdName) {
  let cmd, result;
  try {
    cmd = await this.getSdkBinaryPath('emulator');
    result = await exec(cmd, ['-list-avds']);
  } catch (e) {
    let unknownOptionError = new RegExp("unknown option: -list-avds", "i").test(e.stderr);
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
systemCallMethods.waitForEmulatorReady = async function (timeoutMs = 20000) {
  let start = Date.now();
  log.debug("Waiting until emulator is ready");
  while ((Date.now() - start) < timeoutMs) {
    try {
      let stdout = await this.shell(["getprop", "init.svc.bootanim"]);
      if (stdout.indexOf('stopped') > -1) {
        return;
      }
    } catch (e) {
      // do nothing
    }
    await sleep(3000);
  }
  throw new Error('Emulator not ready');
};

/**
 * Check if the current device is ready to accept further commands (booting completed).
 *
 * @param {number} appDeviceReadyTimeout [30] - The maximum number of seconds to wait.
 * @throws {Error} If the device is not ready within the given timeout.
 */
systemCallMethods.waitForDevice = async function (appDeviceReadyTimeout = 30) {
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
      throw new Error(`Error in waiting for device. Original error: '${e.message}'. ` +
                         `Retrying by restarting ADB`);
    }
  });
};

/**
 * Reboot the current device and wait until it is completed.
 *
 * @param {number} retries [DEFAULT_ADB_REBOOT_RETRIES] - The maximum number of reboot retries.
 * @throws {Error} If the device failed to reboot and number of retries is exceeded.
 */
systemCallMethods.reboot = async function (retries = DEFAULT_ADB_REBOOT_RETRIES) {
  try {
    try {
      await this.shell(['stop']);
    } catch (err) {
      if (err.message.indexOf('must be root') === -1) {
        throw err;
      }
      // this device needs adb to be running as root to stop.
      // so try to restart the daemon
      log.debug('Device requires adb to be running as root in order to reboot. Restarting daemon');
      await this.root();
      await this.shell(['stop']);
    }
    await B.delay(2000); // let the emu finish stopping;
    await this.setDeviceProperty('sys.boot_completed', 0);
    await this.shell(['start']);
    await retryInterval(retries, 1000, async () => {
      let booted = await this.getDeviceProperty('sys.boot_completed');
      if (booted === '1') {
        return;
      } else {
        // we don't want the stack trace, so no log.errorAndThrow
        let msg = 'Waiting for reboot. This takes time';
        log.debug(msg);
        throw new Error(msg);
      }
    });
  } finally {
    await this.unroot();
  }
};

/**
 * Switch adb server to root mode.
 *
 * @return {boolean} True of the switch was successful or false
 *                   if the switch failed.
 */
systemCallMethods.root = async function () {
  try {
    let {stdout} = await exec(this.executable.path, ['root']);

    // on real devices in some situations we get an error in the stdout
    if (stdout && stdout.indexOf('adbd cannot run as root') !== -1) {
      throw new Error(stdout.trim());
    }

    return true;
  } catch (err) {
    log.warn(`Unable to root adb daemon: '${err.message}'. Continuing`);
    return false;
  }
};

/**
 * Switch adb server to non-root mode.
 *
 * @return {boolean} True of the switch was successful or false
 *                   if the switch failed.
 */
systemCallMethods.unroot = async function () {
  try {
    await exec(this.executable.path, ['unroot']);
    return true;
  } catch (err) {
    log.warn(`Unable to unroot adb daemon: '${err.message}'. Continuing`);
    return false;
  }
};

/**
 * Verify whether a remote path exists on the device under test.
 *
 * @param {string} remotePath - The remote path to verify.
 * @return {boolean} True if the given path exists on the device.
 */
systemCallMethods.fileExists = async function (remotePath) {
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
systemCallMethods.ls = async function (remotePath, opts = []) {
  try {
    let args = ['ls', ...opts, remotePath];
    let stdout = await this.shell(args);
    let lines = stdout.split("\n");
    return lines.map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => l.indexOf("No such file") === -1);
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
systemCallMethods.fileSize = async function (remotePath) {
  try {
    const files = await this.ls(remotePath, ['-la']);
    if (files.length !== 1) {
      throw new Error(`Remote path is not a file`);
    }
    // https://regex101.com/r/fOs4P4/8
    const match = /[rwxsStT\-\+]{10}[\s\d]*\s[^\s]+\s+[^\s]+\s+(\d+)/.exec(files[0]);
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
systemCallMethods.installMitmCertificate = async function (cert) {
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
    log.debug('Mounting /system endpoint');
    // Sometimes emulator reboot is still not fully finished on this stage, so retry
    await retryInterval(5, 2000, async () => await this.shell(['mount', '-o', 'rw,remount', '/system']));
    log.debug(`Uploading the generated certificate from '${dstCert}' to '${CERTS_ROOT}'`);
    await this.push(dstCert, CERTS_ROOT);
    log.debug('Remounting the remote file system');
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
systemCallMethods.isMitmCertificateInstalled = async function (cert) {
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
