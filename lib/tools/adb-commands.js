import log from '../logger.js';
import { getIMEListFromOutput, isShowingLockscreen, isCurrentFocusOnKeyguard,
         isScreenOnFully } from '../helpers.js';
import path from 'path';
import { fs } from '../utils.js';
import net from 'net';

let methods = {};

methods.getAdbWithCorrectAdbPath = async function () {
  this.adb.path = await this.getSdkBinaryPath("adb");
  this.binaries.adb = this.adb.path;
  return this.adb;
};

methods.initAapt = async function () {
  this.binaries.aapt = await this.getSdkBinaryPath("aapt");
};

methods.initZipAlign = async function () {
  this.binaries.zipalign = await this.getSdkBinaryPath("zipalign");
};

methods.getApiLevel = async function () {
  log.info("Getting device API level");
  try {
    return this.shell(['getprop', 'ro.build.version.sdk']);
  } catch (e) {
    log.errorAndThrow(`Error getting device API level. Original error: ${e.message}`);
  }
};

methods.isDeviceConnected = async function () {
  let devices = await this.getConnectedDevices();
  return devices.length > 0;
};

methods.mkdir = async function (remotePath) {
  return this.shell(['mkdir', '-p', remotePath]);
};

methods.isValidClass = function (classString) {
  // some.package/some.package.Activity
  return new RegExp(/^[a-zA-Z0-9\./_]+$/).exec(classString);
};

methods.forceStop = async function (pkg) {
  return this.shell(['am', 'force-stop', pkg]);
};

methods.clear = async function (pkg) {
  return this.shell(['pm', 'clear', pkg]);
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

methods.lock = async function () {
  log.debug("Pressing the KEYCODE_POWER button to lock screen");
  await this.keyevent(26);
};

methods.back = async function () {
  log.debug("Pressing the BACK button");
  await this.keyevent(4);
};

methods.goToHome = async function () {
  log.debug("Pressing the HOME button");
  await this.keyevent(3);
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
methods.setWifiAndData = async function ({wifi:w, data:d}) {
  let wifiOpts = [],
      dataOpts = [];
  if (w) {
    wifiOpts = ['-e', 'wifi', (w ? 'on' : 'off')];
  }
  if (d) {
    dataOpts = ['-e', 'data', (d ? 'on' : 'off')];
  }
  let opts = ['am', 'start', '-n', 'io.appium.settings/.Settings'];
  await this.shell(opts.concat(wifiOpts, dataOpts));
};

export default methods;
