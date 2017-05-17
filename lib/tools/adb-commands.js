import log from '../logger.js';
import { getIMEListFromOutput, isShowingLockscreen, isCurrentFocusOnKeyguard,
         getSurfaceOrientation, isScreenOnFully } from '../helpers.js';
import path from 'path';
import _ from 'lodash';
import { fs } from 'appium-support';
import net from 'net';
import Logcat from '../logcat';
import { sleep, retryInterval } from 'asyncbox';
import { SubProcess } from 'teen_process';

const SETTINGS_HELPER_ID = 'io.appium.settings';
const MAX_SHELL_BUFFER_LENGTH = 1000;

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

methods.grantAllPermissions = async function (pkg, apk) {
  let apiLevel = await this.getApiLevel();
  let targetSdk = null;
  try {
    if (!apk) {
      /**
       * If apk not provided, considering apk already installed on the device
       * and fetching targetSdk using package name.
       */
      targetSdk = await this.targetSdkVersionUsingPKG(pkg);
    } else {
      targetSdk = await this.targetSdkVersionFromManifest(apk);
    }
  } catch (e) {
    //avoiding logging error stack, as calling library function would have logged
    log.warn(`Ran into problem getting target SDK version; ignoring...`);
  }
  if (apiLevel >= 23 && targetSdk >= 23) {
    /**
     * If the device is running Android 6.0(API 23) or higher, and your app's target SDK is 23 or higher:
     * The app has to list the permissions in the manifest.
     * refer: https://developer.android.com/training/permissions/requesting.html
     */
    const stdout = await this.shell(['pm', 'dump', pkg]);
    const requestedPermissions = await this.getReqPermissions(pkg, stdout);
    const grantedPermissions = await this.getGrantedPermissions(pkg, stdout);
    const permissonsToGrant = requestedPermissions.filter((x) => grantedPermissions.indexOf(x) < 0);
    if (!permissonsToGrant.length) {
      log.info(`${pkg} contains no permissions available for granting.`);
      return true;
    }
    // As it consumes more time for granting each permission,
    // trying to grant all permission by forming equivalent command.
    // Also, it is necessary to split long commands into chunks, since the maximum length of
    // adb shell buffer is limited
    let cmds = [];
    let cmdChunk = [];
    for (let permission of permissonsToGrant) {
      const nextCmd = ['pm', 'grant', pkg, permission, ';'];
      if (nextCmd.join(' ').length + cmdChunk.join(' ').length >= MAX_SHELL_BUFFER_LENGTH) {
        cmds.push(cmdChunk);
        cmdChunk = [];
      }
      cmdChunk = cmdChunk.concat(nextCmd);
    }
    if (cmdChunk.length) {
      cmds.push(cmdChunk);
    }
    log.debug(`Got the following command chunks to execute: ${cmds}`);
    let result = true;
    let lastError = null;
    for (let cmd of cmds) {
      try {
        result = await this.shell(cmd) && result;
      } catch (e) {
        // this is to give the method a chance to assign all the requestsed permissions
        // before to quit in case we'd like to ignore the error on the higher level
        lastError = e;
        result = false;
      }
    }
    if (lastError) {
      throw lastError;
    }
    return result;
  }
};

methods.grantPermission = async function (pkg, permission) {
  try {
    await this.shell(['pm', 'grant', pkg, permission]);
  } catch (error) {
    if (!error.message.includes("not a changeable permission type")) {
      throw error;
    }
  }
};

methods.revokePermission = async function (pkg, permission) {
  try {
    await this.shell(['pm', 'revoke', pkg, permission]);
  } catch (error) {
    if (!error.message.includes("not a changeable permission type")) {
      throw error;
    }
  }
};

methods.getGrantedPermissions = async function (pkg, cmdOutput = null) {
  let stdout = cmdOutput || await this.shell(['pm', 'dump', pkg]);
  let match = new RegExp(/install permissions:([\s\S]*?)DUMP OF SERVICE activity:/g).exec(stdout);
  if (!match) {
    throw new Error('Unable to get granted permissions');
  }
  return (match[0].match(/android\.permission\.\w+:\sgranted=true/g) || [])
    .map((x) => x.replace(/:\sgranted=true/g, ''));
};

methods.getDeniedPermissions = async function (pkg, cmdOutput = null) {
  let stdout = cmdOutput || await this.shell(['pm', 'dump', pkg]);
  let match = new RegExp(/install permissions:([\s\S]*?)DUMP OF SERVICE activity:/g).exec(stdout);
  if (!match) {
    throw new Error('Unable to get denied permissions');
  }
  return (match[0].match(/android\.permission\.\w+:\sgranted=false/g) || [])
    .map((x) => x.replace(/:\sgranted=false/g, ''));
};

methods.getReqPermissions = async function (pkg, cmdOutput = null) {
  let stdout = cmdOutput || await this.shell(['pm', 'dump', pkg]);
  let match = new RegExp(/requested permissions:([\s\S]*?)install permissions:/g).exec(stdout);
  if (!match) {
    throw new Error('Unable to get requested permissions');
  }
  return match[0].match(/android\.permission\.\w+/g) || [];
};

methods.stopAndClear = async function (pkg) {
  try {
    await this.forceStop(pkg);
    await this.clear(pkg);
  } catch (e) {
    log.errorAndThrow(`Cannot stop and clear ${pkg}. Original error: ${e.message}`);
  }
};

methods.getTargetSdkUsingPKG = async function (pkg) {
  let stdout = await this.shell(['pm', 'dump', pkg]);
  let targetSdk = new RegExp(/targetSdk=([^\s\s]+)/g).exec(stdout)[1];
  return targetSdk;
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
  } catch (e) {
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
          .replace(/\\/g, '\\\\')
          .replace(/\(/g, '\(')
          .replace(/\)/g, '\)')
          .replace(/</g, '\<')
          .replace(/>/g, '\>')
          .replace(/\|/g, '\|')
          .replace(/;/g, '\;')
          .replace(/&/g, '\&')
          .replace(/\*/g, '\*')
          .replace(/~/g, '\~')
          .replace(/"/g, '\"')
          .replace(/'/g, "\'")
          .replace(/ /g, '%s');
  /* jshint ignore:end */
  await this.shell(['input', 'text', text]);
};

methods.clearTextField = async function (length = 100) {
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

methods.getScreenOrientation = async function () {
  let stdout = await this.shell(['dumpsys', 'input']);
  return getSurfaceOrientation(stdout);
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
          conn.write(`${command}\n`);
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
    conn.on('error', (err) => {
      log.debug(`Telnet command error: ${err.message}`);
      reject(err);
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
methods.setWifiState = async function (on, isEmulator = false) {
  if (isEmulator) {
    await this.shell(['svc', 'wifi', on ? 'enable' : 'disable']);
  } else {
    await this.shell(['am', 'broadcast', '-a', `${SETTINGS_HELPER_ID}.wifi`,
                      '--es', 'setstatus', on ? 'enable' : 'disable']);
  }
};

methods.isDataOn = async function () {
  let stdout = await this.shell(['settings', 'get', 'global', 'mobile_data']);
  return (parseInt(stdout, 10) !== 0);
};

/*
 * on: true (to turn on) or false (to turn off)
 */
methods.setDataState = async function (on, isEmulator = false) {
  if (isEmulator) {
    await this.shell(['svc', 'data', on ? 'enable' : 'disable']);
  } else {
    await this.shell(['am', 'broadcast', '-a', `${SETTINGS_HELPER_ID}.data_connection`,
                      '--es', 'setstatus', on ? 'enable' : 'disable']);
  }
};

/*
 * opts: { wifi: true/false, data true/false } (true to turn on, false to turn off)
 */
methods.setWifiAndData = async function ({wifi, data}, isEmulator = false) {
  if (!_.isUndefined(wifi)) {
    this.setWifiState(wifi, isEmulator);
  }
  if (!_.isUndefined(data)) {
    this.setDataState(data, isEmulator);
  }
};

methods.setGeoLocation = async function (location, isEmulator = false) {
  let longitude = parseFloat(location.longitude);
  if (isNaN(longitude)) {
    log.errorAndThrow(`location.longitude is expected to be a valid float number. '${location.longitude}' is given instead`);
  }
  longitude = `${_.ceil(longitude, 5)}`;
  let latitude = parseFloat(location.latitude);
  if (isNaN(latitude)) {
    log.errorAndThrow(`location.latitude is expected to be a valid float number. '${location.latitude}' is given instead`);
  }
  latitude = `${_.ceil(latitude, 5)}`;
  if (isEmulator) {
    this.resetTelnetAuthToken();
    this.adbExec(['emu', 'geo', 'fix', longitude, latitude]);
    // A workaround for https://code.google.com/p/android/issues/detail?id=206180
    this.adbExec(['emu', 'geo', 'fix', longitude.replace('.', ','), latitude.replace('.', ',')]);
  } else {
    return await this.shell(['am', 'startservice', '-e', 'longitude', longitude,
                             '-e', 'latitude', latitude, `${SETTINGS_HELPER_ID}/.LocationService`]);
  }
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

methods.removePortForward = async function (systemPort) {
  log.debug(`Removing forwarded port socket connection: ${systemPort} `);
  await this.adbExec(['forward', `--remove`, `tcp:${systemPort}`]);
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
    let stdout = (await this.shell(["ps"])).trim();
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

methods.getModel = async function () {
  return await this.getDeviceProperty("ro.product.model");
};

methods.getManufacturer = async function () {
  return await this.getDeviceProperty("ro.product.manufacturer");
};

methods.getScreenSize = async function() {
  let stdout = await this.shell(['wm', 'size']);
  let size = new RegExp(/Physical size: ([^\r?\n]+)*/g).exec(stdout);
  if (size && size.length >= 2) {
    return size[1].trim();
  }
  return null;
};

methods.setHttpProxy = async function (proxyHost, proxyPort) {
  let proxy = `${proxyHost}:${proxyPort}`;
  if (_.isUndefined(proxyHost)) {
    log.errorAndThrow(`Call to setHttpProxy method with undefined proxy_host: ${proxy}`);
  }
  if (_.isUndefined(proxyPort)) {
    log.errorAndThrow(`Call to setHttpProxy method with undefined proxy_port ${proxy}`);
  }
  await this.shell(['settings', 'put', 'global', 'http_proxy', proxy]);
  await this.shell(['settings', 'put', 'secure', 'http_proxy', proxy]);
  await this.shell(['settings', 'put', 'system', 'http_proxy', proxy]);
  await this.shell(['settings', 'put', 'system', 'global_http_proxy_host', proxyHost]);
  await this.shell(['settings', 'put', 'system', 'global_http_proxy_port', proxyPort]);
};

export default methods;
