import path from 'path';
import log from '../logger.js';
import B from 'bluebird';
import { system, fs } from 'appium-support';
import { getDirectories, getSdkToolsVersion } from '../helpers';
import { exec, SubProcess } from 'teen_process';
import { sleep, retry, retryInterval } from 'asyncbox';
import _ from 'lodash';


let systemCallMethods = {};

const DEFAULT_ADB_EXEC_TIMEOUT = 20000; // in milliseconds
const DEFAULT_ADB_REBOOT_RETRIES = 90;

systemCallMethods.getSdkBinaryPath = async function (binaryName) {
  log.info(`Checking whether ${binaryName} is present`);
  if (this.sdkRoot) {
    return this.getBinaryFromSdkRoot(binaryName);
  } else {
    log.warn(`The ANDROID_HOME environment variable is not set to the Android SDK ` +
             `root directory path. ANDROID_HOME is required for compatibility ` +
             `with SDK 23+. Checking along PATH for ${binaryName}.`);
    return await this.getBinaryFromPath(binaryName);

  }
};

systemCallMethods.getCommandForOS = function () {
  let cmd = "which";
  if (system.isWindows()) {
    cmd = "where";
  }
  return cmd;
};

systemCallMethods.getBinaryNameForOS = function (binaryName) {
  if (system.isWindows()) {
    if (binaryName === "android") {
      binaryName += ".bat";
    } else {
      if (binaryName.indexOf(".exe", binaryName.length - 4) === -1) {
        binaryName += ".exe";
      }
    }
  }
  return binaryName;
};

systemCallMethods.getBinaryFromSdkRoot = async function (binaryName) {
  let binaryLoc = null;
  binaryName = this.getBinaryNameForOS(binaryName);
  let binaryLocs = [path.resolve(this.sdkRoot, "platform-tools", binaryName),
                    path.resolve(this.sdkRoot, "emulator", binaryName),
                    path.resolve(this.sdkRoot, "tools", binaryName),
                    path.resolve(this.sdkRoot, "tools", "bin", binaryName)];
  // get subpaths for currently installed build tool directories
  let buildToolDirs = [];
  buildToolDirs = await getDirectories(path.resolve(this.sdkRoot, "build-tools"));
  for (let versionDir of buildToolDirs) {
    binaryLocs.push(path.resolve(this.sdkRoot, "build-tools", versionDir, binaryName));
  }
  for (let loc of binaryLocs) {
    if (await fs.exists(loc)) {
      binaryLoc = loc;
      break;
    }
  }
  if (binaryLoc === null) {
    throw new Error(`Could not find ${binaryName} in ${binaryLocs}, ` +
                    `or supported build-tools under ${this.sdkRoot} ` +
                    `do you have the Android SDK installed at this location?`);
  }
  binaryLoc = binaryLoc.trim();
  log.info(`Using ${binaryName} from ${binaryLoc}`);
  return binaryLoc;
};

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
    log.errorAndThrow(`Could not find ${binaryName} Please set the ANDROID_HOME ` +
              `environment variable with the Android SDK root directory path.`);
  }
};

systemCallMethods.getConnectedDevices = async function () {
  log.debug("Getting connected devices...");
  try {
    let {stdout} = await exec(this.executable.path, ['devices']);
    // expecting adb devices to return output as
    // List of devices attached
    // emulator-5554	device
    let startingIndex = stdout.indexOf("List of devices");
    if (startingIndex === -1) {
      throw new Error(`Unexpected output while trying to get devices. output was: ${stdout}`);
    } else {
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
    }
  } catch (e) {
    log.errorAndThrow(`Error while getting connected devices. Original error: ${e.message}`);
  }
};

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

systemCallMethods.restartAdb = async function () {
  if (this.suppressKillServer) {
    log.debug(`Not restarting abd since 'suppressKillServer' is on`);
    return;
  }

  log.debug('Restarting adb');
  try {
    await exec(this.executable.path, ['kill-server']);
  } catch (e) {
    log.error("Error killing ADB server, going to see if it's online anyway");
  }
};

systemCallMethods.resetTelnetAuthToken = _.memoize(async function () {
  // The methods is used to remove telnet auth token
  // See http://tools.android.com/recent/emulator2516releasenotes for more details
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

systemCallMethods.adbExecEmu = async function (cmd) {
  await this.verifyEmulatorConnected();
  await this.resetTelnetAuthToken();
  await this.adbExec(['emu', ...cmd]);
};

systemCallMethods.adbExec = async function (cmd, opts = {}) {
  if (!cmd) {
    throw new Error("You need to pass in a command to adbExec()");
  }
  // setting default timeout for each command to prevent infinite wait.
  opts.timeout = opts.timeout || DEFAULT_ADB_EXEC_TIMEOUT;
  let execFunc = async () => {
    let linkerWarningRe = /^WARNING: linker.+$/m;
    try {
      if (!(cmd instanceof Array)) {
        cmd = [cmd];
      }
      let args = this.executable.defaultArgs.concat(cmd);
      log.debug(`Running '${this.executable.path}' with args: ` +
                `${JSON.stringify(args)}`);
      let {stdout} = await exec(this.executable.path, args, opts);
      // sometimes ADB prints out weird stdout warnings that we don't want
      // to include in any of the response data, so let's strip it out
      stdout = stdout.replace(linkerWarningRe, '').trim();
      return stdout;
    } catch (e) {
      let protocolFaultError = new RegExp("protocol fault \\(no status\\)", "i").test(e);
      let deviceNotFoundError = new RegExp("error: device ('.+' )?not found", "i").test(e);
      if (protocolFaultError || deviceNotFoundError) {
        log.info(`Error sending command, reconnecting device and retrying: ${cmd}`);
        await sleep(1000);
        await this.getDevicesWithRetry();
      }

      if (e.stdout) {
        let stdout = e.stdout;
        stdout = stdout.replace(linkerWarningRe, '').trim();
        return stdout;
      }
      throw new Error(`Error executing adbExec. Original error: '${e.message}'; ` +
                        `Stderr: '${(e.stderr || '').trim()}'; Code: '${e.code}'`);
    }
  };
  return await retry(2, execFunc);
};

systemCallMethods.shell = async function (cmd, opts = {}) {
  if (!await this.isDeviceConnected()) {
    throw new Error(`No device connected, cannot run adb shell command '${cmd.join(' ')}'`);
  }
  let execCmd = ['shell'];
  if (cmd instanceof Array) {
    execCmd = execCmd.concat(cmd);
  } else {
    execCmd.push(cmd);
  }
  return await this.adbExec(execCmd, opts);
};

systemCallMethods.createSubProcess = function (args = []) {
  // add the default arguments
  args = this.executable.defaultArgs.concat(args);
  log.debug(`Creating ADB subprocess with args: ${JSON.stringify(args)}`);
  return new SubProcess(this.getAdbPath(), args);
};

// TODO can probably deprecate this now that the logic is just to read
// this.adbPort
systemCallMethods.getAdbServerPort = function () {
  return this.adbPort;
};

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
    log.errorAndThrow(`No devices connected. Original error: ${e.message}`);
  }
};

systemCallMethods.getPortFromEmulatorString = function (emStr) {
  let portPattern = /emulator-(\d+)/;
  if (portPattern.test(emStr)) {
    return parseInt(portPattern.exec(emStr)[1], 10);
  }
  return false;
};

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
    log.errorAndThrow(`Error getting emulators. Original error: ${e.message}`);
  }
};

systemCallMethods.setEmulatorPort = function (emPort) {
  this.emulatorPort = emPort;
};

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

systemCallMethods.setDevice = function (deviceObj) {
  let deviceId = deviceObj.udid;
  let emPort = this.getPortFromEmulatorString(deviceId);
  this.setEmulatorPort(emPort);
  this.setDeviceId(deviceId);
};

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
    log.errorAndThrow(`Error getting AVD. Original error: ${e.message}`);
  }
};

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
    log.errorAndThrow(`Could not find ${avdName} emulator.`);
  } catch (e) {
    log.errorAndThrow(`Error getting AVD with retry. Original error: ${e.message}`);
  }
};

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
    log.errorAndThrow(`Error killing emulators. Original error: ${e.message}`);
  }
};

systemCallMethods.killEmulator = async function (avdName) {
  log.debug(`killing avd '${avdName}'`);
  let device = await this.getRunningAVD(avdName);
  if (device) {
    await this.adbExec(['emu', 'kill']);
    log.info(`successfully killed emulator '${avdName}'`);
  } else {
    log.info(`no avd with name '${avdName}' running. skipping kill step.`);
  }
};

systemCallMethods.launchAVD = async function (avdName, avdArgs, language, country,
  avdLaunchTimeout = 60000, avdReadyTimeout = 60000, retryTimes = 1) {
  log.debug(`Launching Emulator with AVD ${avdName}, launchTimeout` +
            `${avdLaunchTimeout} ms and readyTimeout ${avdReadyTimeout} ms`);
  let emulatorBinaryPath = await this.getSdkBinaryPath("emulator");
  if (avdName[0] === "@") {
    avdName = avdName.substr(1);
  }
  await this.checkAvdExist(avdName);
  let launchArgs = ["-avd", avdName];
  if (typeof language === "string") {
    log.debug(`Setting Android Device Language to ${language}`);
    launchArgs.push("-prop", `persist.sys.language=${language.toLowerCase()}`);
  }
  if (typeof country === "string") {
    log.debug(`Setting Android Device Country to ${country}`);
    launchArgs.push("-prop", `persist.sys.country=${country.toUpperCase()}`);
  }
  let locale;
  if (typeof language === "string" && typeof country === "string") {
    locale = language.toLowerCase() + "-" + country.toUpperCase();
  } else if (typeof language === "string") {
    locale = language.toLowerCase();
  } else if (typeof country === "string") {
    locale = country;
  }
  if (typeof locale === "string") {
    log.debug(`Setting Android Device Locale to ${locale}`);
    launchArgs.push("-prop", `persist.sys.locale=${locale}`);
  }
  if (typeof avdArgs === "string") {
    avdArgs = avdArgs.split(" ");
    launchArgs = launchArgs.concat(avdArgs);
  }
  log.debug(`Running '${emulatorBinaryPath}' with args: ${JSON.stringify(launchArgs)}`);
  let proc = new SubProcess(emulatorBinaryPath, launchArgs);
  await proc.start(0);
  proc.on('output', (stdout, stderr) => {
    log.info(`[AVD OUTPUT] ${stdout || stderr}`);
  });
  await retry(retryTimes, this.getRunningAVDWithRetry.bind(this), avdName, avdLaunchTimeout);
  await this.waitForEmulatorReady(avdReadyTimeout);
  return proc;
};

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
    log.errorAndThrow(`Error getting adb version. Original error: '${e.message}'; ` +
                        `Stderr: '${(e.stderr || '').trim()}'; Code: '${e.code}'`);
  }
});


systemCallMethods.checkAvdExist = async function (avdName) {
  let cmd, result;
  try {
    cmd = await this.getSdkBinaryPath('emulator');
    result = await exec(cmd, ['-list-avds']);
  } catch (e) {
    let unknownOptionError = new RegExp("unknown option: -list-avds", "i").test(e.stderr);
    if (!unknownOptionError) {
      log.errorAndThrow(`Error executing checkAvdExist. Original error: '${e.message}'; ` +
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
    log.errorAndThrow(`Avd '${avdName}' is not available. please select your avd name from one of these: '${existings}'`);
  }
};

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
  log.errorAndThrow('Emulator not ready');
};

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
      log.errorAndThrow(`Error in waiting for device. Original error: '${e.message}'. ` +
                         `Retrying by restarting ADB`);
    }
  });
};

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
    this.unroot();
  }
};

systemCallMethods.root = async function () {
  try {
    await exec(this.executable.path, ['root']);
    return true;
  } catch (err) {
    log.warn(`Unable to root adb daemon: '${err.message}'. Continuing`);
    return false;
  }
};

systemCallMethods.unroot = async function () {
  try {
    await exec(this.executable.path, ['unroot']);
    return true;
  } catch (err) {
    log.warn(`Unable to unroot adb daemon: '${err.message}'. Continuing`);
    return false;
  }
};

systemCallMethods.fileExists = async function (remotePath) {
  let files = await this.ls(remotePath);
  return files.length > 0;
};

systemCallMethods.ls = async function (remotePath) {
  try {
    let stdout = await this.shell(['ls', remotePath]);
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

export default systemCallMethods;
