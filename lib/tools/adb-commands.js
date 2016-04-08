import log from '../logger.js';
import { getIMEListFromOutput, isShowingLockscreen, isCurrentFocusOnKeyguard,
         isScreenOnFully } from '../helpers.js';
import path from 'path';
import _ from 'lodash';
import { fs } from 'appium-support';
import net from 'net';
import Logcat from '../logcat';
import { sleep, retryInterval } from 'asyncbox';
import { SubProcess } from 'teen_process';


let methods = {};

methods.getAdbWithCorrectAdbPath = async function () {
  this.executable.path = await this.getSdkBinaryPath("adb");
  this.binaries.adb = this.executable.path;
  return this.adb;
};

methods.initAapt = async function () {
  this.binaries.aapt = await this.getSdkBinaryPath("aapt");
};

methods.initZipAlign = async function () {
  this.binaries.zipalign = await this.getSdkBinaryPath("zipalign");
};

methods.getApiLevel = async function () {
  if (!this._apiLevel) {
    try {
      this._apiLevel = await this.shell(['getprop', 'ro.build.version.sdk']);
    } catch (e) {
      log.errorAndThrow(`Error getting device API level. Original error: ${e.message}`);
    }
  }
  log.debug(`Device API level: ${this._apiLevel}`);
  return this._apiLevel;
};

methods.getPlatformVersion = async function () {
  log.info("Getting device platform version");
  try {
    return await this.shell(['getprop', 'ro.build.version.release']);
  } catch (e) {
    log.errorAndThrow(`Error getting device platform version. Original error: ${e.message}`);
  }
};

methods.isDeviceConnected = async function () {
  let devices = await this.getConnectedDevices();
  return devices.length > 0;
};

methods.mkdir = async function (remotePath) {
  return await this.shell(['mkdir', '-p', remotePath]);
};

methods.isValidClass = function (classString) {
  // some.package/some.package.Activity
  return new RegExp(/^[a-zA-Z0-9\./_]+$/).exec(classString);
};

methods.forceStop = async function (pkg) {
  return await this.shell(['am', 'force-stop', pkg]);
};

methods.clear = async function (pkg) {
  return await this.shell(['pm', 'clear', pkg]);
};

methods.stopAndClear = async function (pkg) {
  try {
    await this.forceStop(pkg);
    await this.clear(pkg);
  } catch (e) {
    log.errorAndThrow(`Cannot stop and clear ${pkg}. Original error: ${e.message}`);
  }
};

methods.availableIMEs = async function () {
  try {
    return getIMEListFromOutput(await this.shell(['ime', 'list', '-a']));
  } catch (e) {
    log.errorAndThrow(`Error getting available IME's. Original error: ${e.message}`);
  }
};

methods.enabledIMEs = async function () {
  try {
    return getIMEListFromOutput(await this.shell(['ime', 'list']));
  } catch (e) {
    log.errorAndThrow(`Error getting enabled IME's. Original error: ${e.message}`);
  }
};

methods.enableIME = async function (imeId) {
  await this.shell(['ime', 'enable', imeId]);
};

methods.disableIME = async function (imeId) {
  await this.shell(['ime', 'disable', imeId]);
};

methods.setIME = async function (imeId) {
  await this.shell(['ime', 'set', imeId]);
};

methods.defaultIME = async function () {
  try {
    let engine = await this.shell(['settings', 'get', 'secure', 'default_input_method']);
    return engine.trim();
  } catch(e) {
    log.errorAndThrow(`Error getting default IME. Original error: ${e.message}`);
  }
};

methods.keyevent = async function (keycode) {
  // keycode must be an int.
  let code = parseInt(keycode, 10);
  await this.shell(['input', 'keyevent', code]);
};

methods.inputText = async function (text) {
  /* jshint ignore:start */
  // need to escape whitespace and ( ) < > | ; & * \ ~ " '
  text = text
          .replace('\\', '\\\\')
          .replace('(', '\(')
          .replace(')', '\)')
          .replace('<', '\<')
          .replace('>', '\>')
          .replace('|', '\|')
          .replace(';', '\;')
          .replace('&', '\&')
          .replace('*', '\*')
          .replace('~', '\~')
          .replace('"', '\"')
          .replace("'", "\'")
          .replace(' ', '%s');
  /* jshint ignore:end */
  await this.shell(['input', 'text', text]);
};

methods.lock = async function () {
  let locked = await this.isScreenLocked();
  locked = await this.isScreenLocked();
  if (!locked) {
    log.debug("Pressing the KEYCODE_POWER button to lock screen");
    await this.keyevent(26);

    // wait for the screen to lock
    await retryInterval(10, 500, async () => {
      locked = await this.isScreenLocked();
      if (!locked) {
        log.errorAndThrow("Waiting for screen to lock.");
      }
    });
  } else {
    log.debug("Screen is already locked. Doing nothing.");
  }
};

methods.back = async function () {
  log.debug("Pressing the BACK button");
  await this.keyevent(4);
};

methods.goToHome = async function () {
  log.debug("Pressing the HOME button");
  await this.keyevent(3);
};

methods.getAdbPath = function () {
  return this.executable.path;
};

methods.isScreenLocked = async function () {
  let stdout = await this.shell(['dumpsys', 'window']);
  if (process.env.APPIUM_LOG_DUMPSYS) {
    // optional debugging
    // if the method is not working, turn it on and send us the output
    let dumpsysFile = path.resolve(process.cwd(), "dumpsys.log");
    log.debug(`Writing dumpsys output to ${dumpsysFile}`);
    await fs.writeFile(dumpsysFile, stdout);
  }
  return (isShowingLockscreen(stdout) || isCurrentFocusOnKeyguard(stdout) ||
          !isScreenOnFully(stdout));
};

methods.isSoftKeyboardPresent = async function () {
  try {
    let stdout = await this.shell(['dumpsys', 'input_method']);
    let isKeyboardShown = false,
        canCloseKeyboard = false,
        inputShownMatch = /mInputShown=\w+/gi.exec(stdout);
    if (inputShownMatch && inputShownMatch[0]) {
      isKeyboardShown = inputShownMatch[0].split('=')[1] === 'true';
      let isInputViewShownMatch = /mIsInputViewShown=\w+/gi.exec(stdout);
      if (isInputViewShownMatch && isInputViewShownMatch[0]) {
        canCloseKeyboard = isInputViewShownMatch[0].split('=')[1] === 'true';
      }
    }
    return {isKeyboardShown, canCloseKeyboard};
  } catch (e) {
    log.errorAndThrow(`Error finding softkeyboard. Original error: ${e.message}`);
  }
};

methods.sendTelnetCommand = async function (command) {
  log.debug(`Sending telnet command to device: ${command}`);
  let port = await this.getEmulatorPort();
  return new Promise((resolve, reject) => {
    let conn = net.createConnection(port, 'localhost'),
        connected = false,
        readyRegex = /^OK$/m,
        dataStream = "",
        res = null;
    conn.on('connect', () => {
      log.debug("Socket connection to device created");
    });
    conn.on('data', (data) => {
      data = data.toString('utf8');
      if (!connected) {
        if (readyRegex.test(data)) {
          connected = true;
          log.debug("Socket connection to device ready");
          conn.write(command + "\n");
        }
      } else {
        dataStream += data;
        if (readyRegex.test(data)) {
          res = dataStream.replace(readyRegex, "").trim();
          res = _.last(res.trim().split('\n'));
          log.debug(`Telnet command got response: ${res}`);
          conn.write("quit\n");
        }
      }
    });
    conn.on('close', () => {
      if (res === null) {
        reject(new Error("Never got a response from command"));
      } else {
        resolve(res);
      }
    });
  });
};

methods.isAirplaneModeOn = async function () {
  let stdout = await this.shell(['settings', 'get', 'global', 'airplane_mode_on']);
  return parseInt(stdout, 10) !== 0;
};

/*
 * on: true (to turn on) or false (to turn off)
 */
methods.setAirplaneMode = async function (on) {
  await this.shell(['settings', 'put', 'global', 'airplane_mode_on', on ? 1 : 0]);
};

/*
 * on: true (to turn on) or false (to turn off)
 */
methods.broadcastAirplaneMode = async function (on) {
  let args = ['am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE',
              '--ez', 'state', on ? 'true' : 'false'];
  await this.shell(args);
};

methods.isWifiOn = async function () {
  let stdout = await this.shell(['settings', 'get', 'global', 'wifi_on']);
  return (parseInt(stdout, 10) !== 0);
};

/*
 * on: true (to turn on) or false (to turn off)
 */
methods.setWifiState = async function (on) {
  await this.shell(['am', 'start', '-n', 'io.appium.settings/.Settings', '-e',
                    'wifi', on ? 'on' : 'off']);
};

methods.isDataOn = async function () {
  let stdout = await this.shell(['settings', 'get', 'global', 'mobile_data']);
  return (parseInt(stdout, 10) !== 0);
};

/*
 * on: true (to turn on) or false (to turn off)
 */
methods.setDataState = async function (on) {
  await this.shell(['am', 'start', '-n', 'io.appium.settings/.Settings', '-e',
                    'data', on ? 'on' : 'off']);
};

/*
 * opts: { wifi: true/false, data true/false } (true to turn on, false to turn off)
 */
methods.setWifiAndData = async function ({wifi, data}) {
  let wifiOpts = [],
      dataOpts = [];
  if (!_.isUndefined(wifi)) {
    wifiOpts = ['-e', 'wifi', (wifi ? 'on' : 'off')];
  }
  if (!_.isUndefined(data)) {
    dataOpts = ['-e', 'data', (data ? 'on' : 'off')];
  }
  let opts = ['am', 'start', '-n', 'io.appium.settings/.Settings'];
  await this.shell(opts.concat(wifiOpts, dataOpts));
};

methods.rimraf = async function (path) {
  await this.shell(['rm', '-rf', path]);
};

methods.push = async function (localPath, remotePath, opts) {
  await this.adbExec(['push', localPath, remotePath], opts);
};

methods.pull = async function (remotePath, localPath) {
  // pull folder can take more time, increasing time out to 60 secs
  await this.adbExec(['pull', remotePath, localPath], {timeout: 60000});
};

methods.processExists = async function (processName) {
  try {
    if (!this.isValidClass(processName)) {
      throw new Error(`Invalid process name: ${processName}`);
    }
    let stdout = await this.shell("ps");
    for (let line of stdout.split(/\r?\n/)) {
      line = line.trim().split(/\s+/);
      let pkgColumn = line[line.length - 1];
      if (pkgColumn && pkgColumn.indexOf(processName) !== -1) {
        return true;
      }
    }
    return false;
  } catch (e) {
    log.errorAndThrow(`Error finding if process exists. Original error: ${e.message}`);
  }
};

methods.forwardPort = async function (systemPort, devicePort) {
  log.debug(`Forwarding system: ${systemPort} to device: ${devicePort}`);
  await this.adbExec(['forward', `tcp:${systemPort}`, `tcp:${devicePort}`]);
};

methods.forwardAbstractPort = async function (systemPort, devicePort) {
  log.debug(`Forwarding system: ${systemPort} to abstract device: ${devicePort}`);
  await this.adbExec(['forward', `tcp:${systemPort}`, `localabstract:${devicePort}`]);
};

methods.ping = async function () {
  let stdout = await this.shell(["echo", "ping"]);
  if (stdout.indexOf("ping") === 0) {
    return true;
  }
  throw new Error(`ADB ping failed, returned ${stdout}`);
};

methods.restart = async function () {
  try {
    await this.stopLogcat();
    await this.restartAdb();
    await this.waitForDevice(60);
    await this.startLogcat();
  } catch (e) {
    log.errorAndThrow(`Restart failed. Orginial error: ${e.message}`);
  }
};

methods.startLogcat = async function () {
  if (this.logcat !== null) {
    log.errorAndThrow("Trying to start logcat capture but it's already started!");
  }
  this.logcat = new Logcat({
    adb: this.executable
  , debug: false
  , debugTrace: false
  });
  await this.logcat.startCapture();
};

methods.stopLogcat = async function () {
  if (this.logcat !== null) {
    await this.logcat.stopCapture();
    this.logcat = null;
  }
};

methods.getLogcatLogs = function () {
  if (this.logcat === null) {
    log.errorAndThrow("Can't get logcat logs since logcat hasn't started");
  }
  return this.logcat.getLogs();
};

methods.getPIDsByName = async function (name) {
  log.debug(`Getting all processes with ${name}`);
  try {
    // ps <comm> where comm is last 15 characters of package name
    if (name.length > 15) {
      name = name.substr(name.length - 15);
    }
    let stdout = await this.shell(["ps", name]);
    stdout = stdout.trim();
    let pids = [];
    for (let line of stdout.split("\n")) {
      if (line.indexOf(name) !== -1) {
        let match = /[^\t ]+[\t ]+([0-9]+)/.exec(line);
        if (match) {
          pids.push(parseInt(match[1], 10));
        } else {
          throw new Error(`Could not extract PID from ps output: ${line}`);
        }
      }
    }
    return pids;
  } catch (e) {
    log.errorAndThrow(`Unable to get pids for ${name}. Orginial error: ${e.message}`);
  }
};

methods.killProcessesByName = async function (name) {
  try {
    log.debug(`Attempting to kill all ${name} processes`);
    let pids = await this.getPIDsByName(name);
    if (pids.length < 1) {
      log.info(`No ${name} process found to kill, continuing...`);
      return;
    }
    for (let pid of pids) {
      await this.killProcessByPID(pid);
    }
  } catch (e) {
    log.errorAndThrow(`Unable to kill ${name} processes. Original error: ${e.message}`);
  }
};

methods.killProcessByPID = async function (pid) {
  log.debug(`Attempting to kill process ${pid}`);
  return await this.shell(['kill', pid]);
};

methods.broadcastProcessEnd = async function (intent, processName) {
  // start the broadcast without waiting for it to finish.
  this.broadcast(intent);
  // wait for the process to end
  let start = Date.now();
  let timeoutMs = 40000;
  try {
    while ((Date.now() - start) < timeoutMs) {
      if (await this.processExists(processName)) {
        // cool down
        await sleep(400);
        continue;
      }
      return;
    }
    throw new Error(`Process never died within ${timeoutMs} ms`);
  } catch (e) {
    log.errorAndThrow(`Unable to broadcast process end. Original error: ${e.message}`);
  }
};

methods.broadcast = async function (intent) {
  if (!this.isValidClass(intent)) {
    log.errorAndThrow(`Invalid intent ${intent}`);
  }
  log.debug(`Broadcasting: ${intent}`);
  await this.shell(['am', 'broadcast', '-a', intent]);
};

methods.endAndroidCoverage = async function () {
  if (this.instrumentProc) {
    await this.instrumentProc.stop();
  }
};

methods.instrument = async function (pkg, activity, instrumentWith) {
  if (activity[0] !== ".") {
    pkg = "";
  }
  let pkgActivity = (pkg + activity).replace(/\.+/g, '.'); // Fix pkg..activity error
  let stdout = await this.shell(['am', 'instrument', '-e', 'main_activity',
                                 pkgActivity, instrumentWith]);
  if (stdout.indexOf("Exception") !== -1) {
    log.errorAndThrow(`Unknown exception during instrumentation. ` +
                      `Original error ${stdout.split("\n")[0]}`);
  }
};

methods.androidCoverage = async function (instrumentClass, waitPkg, waitActivity) {
  if (!this.isValidClass(instrumentClass)) {
    log.errorAndThrow(`Invalid class ${instrumentClass}`);
  }
  return new Promise(async (resolve, reject) => {
    let args = this.executable.defaultArgs
      .concat(['shell', 'am', 'instrument', '-e', 'coverage', 'true', '-w'])
      .concat([instrumentClass]);
    log.debug(`Collecting coverage data with: ${[this.executable.path].concat(args).join(' ')}`);
    try {
      // am instrument runs for the life of the app process.
      this.instrumentProc = new SubProcess(this.executable.path, args);
      await this.instrumentProc.start(0);
      this.instrumentProc.on('output', (stdout, stderr) => {
        if (stderr) {
          reject(new Error(`Failed to run instrumentation. Original error: ${stderr}`));
        }
      });
      await this.waitForActivity(waitPkg, waitActivity);
      resolve();
    } catch (e) {
      reject(new Error(`Android coverage failed. Original error: ${e.message}`));
    }
  });
};

methods.getDeviceProperty = async function (property) {
  let stdout = await this.shell(['getprop', property]);
  let val = stdout.trim();
  log.debug(`Current device property '${property}': ${val}`);
  return val;
};

methods.setDeviceProperty = async function (prop, val) {
  log.debug(`Setting device property '${prop}' to '${val}'`);
  await this.shell(['setprop', prop, val]);
};

methods.getDeviceSysLanguage = async function () {
  return await this.getDeviceProperty("persist.sys.language");
};

methods.setDeviceSysLanguage = async function (language) {
  return await this.setDeviceProperty("persist.sys.language", language.toLowerCase());
};

methods.getDeviceSysCountry = async function () {
  return await this.getDeviceProperty("persist.sys.country");
};

methods.setDeviceSysCountry = async function (country) {
  return await this.setDeviceProperty("persist.sys.country", country.toUpperCase());
};

methods.getDeviceSysLocale = async function () {
  return await this.getDeviceProperty("persist.sys.locale");
};

methods.setDeviceSysLocale = async function (locale) {
  return await this.setDeviceProperty("persist.sys.locale", locale);
};

methods.getDeviceProductLanguage = async function () {
  return await this.getDeviceProperty("ro.product.locale.language");
};

methods.getDeviceProductCountry = async function () {
  return await this.getDeviceProperty("ro.product.locale.region");
};

methods.getDeviceProductLocale = async function () {
  return await this.getDeviceProperty("ro.product.locale");
};

export default methods;
