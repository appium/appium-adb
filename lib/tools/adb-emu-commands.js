import log from '../logger.js';
import { getAndroidPrefsRoot, dirExists } from '../helpers';
import _ from 'lodash';
import net from 'net';
import { util, fs } from '@appium/support';
import B from 'bluebird';
import path from 'path';
import ini from 'ini';

const emuMethods = {};

emuMethods.POWER_AC_STATES = Object.freeze({
  POWER_AC_ON: 'on',
  POWER_AC_OFF: 'off'
});
emuMethods.GSM_CALL_ACTIONS = Object.freeze({
  GSM_CALL: 'call',
  GSM_ACCEPT: 'accept',
  GSM_CANCEL: 'cancel',
  GSM_HOLD: 'hold'
});
emuMethods.GSM_VOICE_STATES = Object.freeze({
  GSM_VOICE_UNREGISTERED: 'unregistered',
  GSM_VOICE_HOME: 'home',
  GSM_VOICE_ROAMING: 'roaming',
  GSM_VOICE_SEARCHING: 'searching',
  GSM_VOICE_DENIED: 'denied',
  GSM_VOICE_OFF: 'off',
  GSM_VOICE_ON: 'on'
});
/** @typedef {0|1|2|3|4} GsmSignalStrength */
emuMethods.GSM_SIGNAL_STRENGTHS = Object.freeze([0, 1, 2, 3, 4]);

emuMethods.NETWORK_SPEED = Object.freeze({
  GSM: 'gsm', // GSM/CSD (up: 14.4, down: 14.4).
  SCSD: 'scsd', // HSCSD (up: 14.4, down: 57.6).
  GPRS: 'gprs', // GPRS (up: 28.8, down: 57.6).
  EDGE: 'edge', // EDGE/EGPRS (up: 473.6, down: 473.6).
  UMTS: 'umts', // UMTS/3G (up: 384.0, down: 384.0).
  HSDPA: 'hsdpa', // HSDPA (up: 5760.0, down: 13,980.0).
  LTE: 'lte', // LTE (up: 58,000, down: 173,000).
  EVDO: 'evdo', // EVDO (up: 75,000, down: 280,000).
  FULL: 'full' // No limit, the default (up: 0.0, down: 0.0).
});

emuMethods.SENSORS = Object.freeze({
  ACCELERATION: 'acceleration',
  GYROSCOPE: 'gyroscope',
  MAGNETIC_FIELD: 'magnetic-field',
  ORIENTATION: 'orientation',
  TEMPERATURE: 'temperature',
  PROXIMITY: 'proximity',
  LIGHT: 'light',
  PRESSURE: 'pressure',
  HUMIDITY: 'humidity',
  MAGNETIC_FIELD_UNCALIBRATED: 'magnetic-field-uncalibrated',
  GYROSCOPE_UNCALIBRATED: 'gyroscope-uncalibrated',
  HINGE_ANGLE0: 'hinge-angle0',
  HINGE_ANGLE1: 'hinge-angle1',
  HINGE_ANGLE2: 'hinge-angle2',
  HEART_RATE: 'heart-rate',
  RGBC_LIGHT: 'rgbc-light',
});

/**
 * @typedef {import('type-fest').ValueOf<typeof emuMethods.SENSORS>} Sensors
 * @typedef {import('type-fest').ValueOf<typeof emuMethods.NETWORK_SPEED>} NetworkSpeed
 * @typedef {import('type-fest').ValueOf<typeof emuMethods.GSM_VOICE_STATES>} GsmVoiceStates
 * @typedef {import('type-fest').ValueOf<typeof emuMethods.GSM_CALL_ACTIONS>} GsmCallActions
 * @typedef {import('type-fest').ValueOf<typeof emuMethods.POWER_AC_STATES>} PowerAcStates
 *
 */

/**
 * @typedef {Object} EmuInfo
 * @property {string} name Emulator name, for example `Pixel_XL_API_30`
 * @property {string} config Full path to the emulator config .ini file,
 * for example `/Users/user/.android/avd/Pixel_XL_API_30.ini`
 */

/**
 * Retrieves the list of available Android emulators
 *
 * @returns {Promise<EmuInfo[]>}
 */
async function listEmulators () {
  let avdsRoot = process.env.ANDROID_AVD_HOME;
  if (await dirExists(avdsRoot ?? '')) {
    return await getAvdConfigPaths(/** @type {string} */ (avdsRoot));
  }

  if (avdsRoot) {
    log.warn(`The value of the ANDROID_AVD_HOME environment variable '${avdsRoot}' is not an existing directory`);
  }

  const prefsRoot = await getAndroidPrefsRoot();
  if (!prefsRoot) {
    return [];
  }

  avdsRoot = path.resolve(prefsRoot, 'avd');
  if (!await dirExists(avdsRoot)) {
    log.debug(`Virtual devices config root '${avdsRoot}' is not an existing directory`);
    return [];
  }

  return await getAvdConfigPaths(avdsRoot);
}

/**
 * Get configuration paths of all virtual devices
 *
 * @param {string} avdsRoot Path to the directory that contains the AVD .ini files
 * @returns {Promise<EmuInfo[]>}
 */
async function getAvdConfigPaths (avdsRoot) {
  const configs = await fs.glob('*.ini', {
    cwd: avdsRoot,
    absolute: true,
  });
  return configs.map((confPath) => {
    const avdName = path.basename(confPath).split('.').slice(0, -1).join('.');
    return {name: avdName, config: confPath};
  }).filter(({name}) => _.trim(name));
}

/**
 * Check the emulator state.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<boolean>} True if Emulator is visible to adb.
 */
emuMethods.isEmulatorConnected = async function isEmulatorConnected () {
  let emulators = await this.getConnectedEmulators();
  return !!_.find(emulators, (x) => x && x.udid === this.curDeviceId);
};

/**
 * Verify the emulator is connected.
 *
 * @this {import('../adb.js').ADB}
 * @throws {Error} If Emulator is not visible to adb.
 */
emuMethods.verifyEmulatorConnected = async function verifyEmulatorConnected () {
  if (!(await this.isEmulatorConnected())) {
    throw new Error(`The emulator "${this.curDeviceId}" was unexpectedly disconnected`);
  }
};

/**
 * Emulate fingerprint touch event on the connected emulator.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} fingerprintId - The ID of the fingerprint.
 */
emuMethods.fingerprint = async function fingerprint (fingerprintId) {
  if (!fingerprintId) {
    throw new Error('Fingerprint id parameter must be defined');
  }
  // the method used only works for API level 23 and above
  let level = await this.getApiLevel();
  if (level < 23) {
    throw new Error(`Device API Level must be >= 23. Current Api level '${level}'`);
  }
  await this.adbExecEmu(['finger', 'touch', fingerprintId]);
};

/**
 * Change the display orientation on the connected emulator.
 * The orientation is changed (PI/2 is added) every time
 * this method is called.
 * @this {import('../adb.js').ADB}
 */
emuMethods.rotate = async function rotate () {
  await this.adbExecEmu(['rotate']);
};

/**
 * Emulate power state change on the connected emulator.
 *
 * @this {import('../adb.js').ADB}
 * @param {PowerAcStates} [state='on'] - Either 'on' or 'off'.
 */
emuMethods.powerAC = async function powerAC (state = 'on') {
  if (_.values(emuMethods.POWER_AC_STATES).indexOf(state) === -1) {
    throw new TypeError(`Wrong power AC state sent '${state}'. `
      + `Supported values: ${_.values(emuMethods.POWER_AC_STATES)}]`);
  }
  await this.adbExecEmu(['power', 'ac', state]);
};

/**
 * Emulate sensors values on the connected emulator.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} sensor - Sensor type declared in SENSORS items.
 * @param {Sensors} value  - Number to set as the sensor value.
 * @throws {TypeError} - If sensor type or sensor value is not defined
 */
emuMethods.sensorSet = async function sensorSet (sensor, value) {
  if (!_.includes(emuMethods.SENSORS, sensor)) {
    throw new TypeError(`Unsupported sensor sent '${sensor}'. `
      + `Supported values: ${_.values(emuMethods.SENSORS)}]`);
  }
  if (_.isNil(value)) {
    throw new TypeError(`Missing/invalid sensor value argument. `
      + `You need to provide a valid value to set to the sensor in `
      + `format <value-a>[:<value-b>[:<value-c>[...]]].`);
  }
  await this.adbExecEmu(['sensor', 'set', sensor, `${value}`]);
};

/**
 * Emulate power capacity change on the connected emulator.
 *
 * @this {import('../adb.js').ADB}
 * @param {string|number} [percent=100] - Percentage value in range [0, 100].
 */
emuMethods.powerCapacity = async function powerCapacity (percent = 100) {
  percent = parseInt(`${percent}`, 10);
  if (isNaN(percent) || percent < 0 || percent > 100) {
    throw new TypeError(`The percentage value should be valid integer between 0 and 100`);
  }
  await this.adbExecEmu(['power', 'capacity', `${percent}`]);
};

/**
 * Emulate power off event on the connected emulator.
 * @this {import('../adb.js').ADB}
 */
emuMethods.powerOFF = async function powerOFF () {
  await this.powerAC(emuMethods.POWER_AC_STATES.POWER_AC_OFF);
  await this.powerCapacity(0);
};

/**
 * Emulate send SMS event on the connected emulator.
 *
 * @this {import('../adb.js').ADB}
 * @param {string|number} phoneNumber - The phone number of message sender.
 * @param {string} [message=''] - The message content.
 * @throws {TypeError} If phone number has invalid format.
 */
emuMethods.sendSMS = async function sendSMS (phoneNumber, message = '') {
  if (_.isEmpty(message)) {
    throw new TypeError('SMS message must not be empty');
  }
  if (!_.isInteger(phoneNumber) && _.isEmpty(phoneNumber)) {
    throw new TypeError('Phone number most not be empty');
  }
  await this.adbExecEmu(['sms', 'send', `${phoneNumber}`, message]);
};

/**
 * Emulate GSM call event on the connected emulator.
 *
 * @this {import('../adb.js').ADB}
 * @param {string|number} phoneNumber - The phone number of the caller.
 * @param {GsmCallActions} action - One of available GSM call actions.
 * @throws {TypeError} If phone number has invalid format.
 * @throws {TypeError} If _action_ value is invalid.
 */
emuMethods.gsmCall = async function gsmCall (phoneNumber, action) {
  if (!_.values(emuMethods.GSM_CALL_ACTIONS).includes(action)) {
    throw new TypeError(
      `Invalid gsm action param ${action}. Supported values: ${_.values(emuMethods.GSM_CALL_ACTIONS)}`
    );
  }
  if (!_.isInteger(phoneNumber) && _.isEmpty(phoneNumber)) {
    throw new TypeError('Phone number most not be empty');
  }
  await this.adbExecEmu(['gsm', action, `${phoneNumber}`]);
};

/**
 * Emulate GSM signal strength change event on the connected emulator.
 *
 * @this {import('../adb.js').ADB}
 * @param {GsmSignalStrength} [strength=4] - A number in range [0, 4];
 * @throws {TypeError} If _strength_ value is invalid.
 */
emuMethods.gsmSignal = async function gsmSignal (strength = 4) {
  const strengthInt = parseInt(`${strength}`, 10);
  if (!emuMethods.GSM_SIGNAL_STRENGTHS.includes(strengthInt)) {
    throw new TypeError(
      `Invalid signal strength param ${strength}. Supported values: ${_.values(emuMethods.GSM_SIGNAL_STRENGTHS)}`
    );
  }
  log.info('gsm signal-profile <strength> changes the reported strength on next (15s) update.');
  await this.adbExecEmu(['gsm', 'signal-profile', `${strength}`]);
};

/**
 * Emulate GSM voice event on the connected emulator.
 *
 * @this {import('../adb.js').ADB}
 * @param {GsmVoiceStates} [state='on'] - Either 'on' or 'off'.
 * @throws {TypeError} If _state_ value is invalid.
 */
emuMethods.gsmVoice = async function gsmVoice (state = 'on') {
  // gsm voice <state> allows you to change the state of your GPRS connection
  if (!_.values(emuMethods.GSM_VOICE_STATES).includes(state)) {
    throw new TypeError(
      `Invalid gsm voice state param ${state}. Supported values: ${_.values(emuMethods.GSM_VOICE_STATES)}`
    );
  }
  await this.adbExecEmu(['gsm', 'voice', state]);
};

/**
 * Emulate network speed change event on the connected emulator.
 *
 * @this {import('../adb.js').ADB}
 * @param {NetworkSpeed} [speed='full']
 *  One of possible NETWORK_SPEED values.
 * @throws {TypeError} If _speed_ value is invalid.
 */
emuMethods.networkSpeed = async function networkSpeed (speed = 'full') {
  // network speed <speed> allows you to set the network speed emulation.
  if (!_.values(emuMethods.NETWORK_SPEED).includes(speed)) {
    throw new Error(
      `Invalid network speed param ${speed}. Supported values: ${_.values(emuMethods.NETWORK_SPEED)}`
    );
  }
  await this.adbExecEmu(['network', 'speed', speed]);
};

/**
 * @typedef {Object} ExecTelnetOptions
 * @property {number} [execTimeout=60000] A timeout used to wait for a server
 * reply to the given command
 * @property {number} [connTimeout=5000] Console connection timeout in milliseconds
 * @property {number} [initTimeout=5000] Telnet console initialization timeout
 * in milliseconds (the time between connection happens and the command prompt
 * is available)
 * @property {number|string} [port] The emulator port number. The method will try to parse it
 * from the current device identifier if unset
 */

/**
 * Executes a command through emulator telnet console interface and returns its output
 *
 * @this {import('../adb.js').ADB}
 * @param {string[]|string} cmd - The actual command to execute. See
 * https://developer.android.com/studio/run/emulator-console for more details
 * on available commands
 * @param {ExecTelnetOptions} [opts={}]
 * @returns {Promise<string>} The command output
 * @throws {Error} If there was an error while connecting to the Telnet console
 * or if the given command returned non-OK response
 */
emuMethods.execEmuConsoleCommand = async function execTelnet (cmd, opts = {}) {
  let port = parseInt(`${opts.port}`, 10);
  if (!port) {
    const portMatch = /emulator-(\d+)/i.exec(/** @type {string} */(this.curDeviceId));
    if (!portMatch) {
      throw new Error(`Cannot parse the console port number from the device identifier '${this.curDeviceId}'. ` +
        `Is it an emulator?`);
    }
    port = parseInt(portMatch[1], 10);
  }
  const host = '127.0.0.1';
  const {
    execTimeout = 60000,
    connTimeout = 5000,
    initTimeout = 5000,
  } = opts;
  await this.resetTelnetAuthToken();

  const okFlag = /^OK$/m;
  const nokFlag = /^KO\b/m;
  const eol = '\r\n';
  const client = net.connect({
    host,
    port,
  });

  return await new B((resolve, reject) => {
    const connTimeoutObj = setTimeout(
      () => reject(new Error(`Cannot connect to the Emulator console at ${host}:${port} ` +
        `after ${connTimeout}ms`)), connTimeout);
    let execTimeoutObj;
    let initTimeoutObj;
    let isCommandSent = false;
    let serverResponse = [];

    client.once('error', (e) => {
      clearTimeout(connTimeoutObj);
      reject(new Error(`Cannot connect to the Emulator console at ${host}:${port}. ` +
        `Original error: ${e.message}`));
    });

    client.once('connect', () => {
      clearTimeout(connTimeoutObj);
      initTimeoutObj = setTimeout(
        () => reject(new Error(`Did not get the initial response from the Emulator console at ${host}:${port} ` +
          `after ${initTimeout}ms`)), initTimeout);
    });

    client.on('data', (chunk) => {
      serverResponse.push(chunk);
      const output = Buffer.concat(serverResponse).toString('utf8').trim();
      if (okFlag.test(output)) {
        // The initial incoming data chunk confirms the interface is ready for input
        if (!isCommandSent) {
          clearTimeout(initTimeoutObj);
          serverResponse = [];
          const cmdStr = _.isArray(cmd) ? util.quote(cmd) : `${cmd}`;
          log.debug(`Executing Emulator console command: ${cmdStr}`);
          client.write(cmdStr);
          client.write(eol);
          isCommandSent = true;
          execTimeoutObj = setTimeout(
            () => reject(new Error(`Did not get any response from the Emulator console at ${host}:${port} ` +
              `to '${cmd}' command after ${execTimeout}ms`)), execTimeout);
          return;
        }
        clearTimeout(execTimeoutObj);
        client.end();
        const outputArr = output.split(eol);
        // remove the redundant OK flag from the resulting command output
        return resolve(outputArr.slice(0, outputArr.length - 1).join('\n').trim());
      } else if (nokFlag.test(output)) {
        clearTimeout(initTimeoutObj);
        clearTimeout(execTimeoutObj);
        client.end();
        const outputArr = output.split(eol);
        return reject(_.trim(_.last(outputArr)));
      }
    });
  });
};

/**
 * @typedef {Object} EmuVersionInfo
 * @property {string} [revision] The actual revision number, for example '30.0.5'
 * @property {number} [buildId] The build identifier, for example 6306047
 */

/**
 * Retrieves emulator version from the file system
 *
 * @this {import('../adb.js').ADB}
 * @returns {Promise<EmuVersionInfo>} If no version info could be parsed then an empty
 * object is returned
 */
emuMethods.getEmuVersionInfo = async function getEmuVersionInfo () {
  const propsPath = path.join(/** @type {string} */ (this.sdkRoot), 'emulator', 'source.properties');
  if (!await fs.exists(propsPath)) {
    return {};
  }

  const content = await fs.readFile(propsPath, 'utf8');
  const revisionMatch = /^Pkg\.Revision=([\d.]+)$/m.exec(content);
  const result = {};
  if (revisionMatch) {
    result.revision = revisionMatch[1];
  }
  const buildIdMatch = /^Pkg\.BuildId=(\d+)$/m.exec(content);
  if (buildIdMatch) {
    result.buildId = parseInt(buildIdMatch[1], 10);
  }
  return result;
};

/**
 * Retrieves emulator image properties from the local file system
 *
 * @this {import('../adb.js').ADB}
 * @param {string} avdName Emulator name. Should NOT start with '@' character
 * @throws {Error} if there was a failure while extracting the properties
 * @returns {Promise<import('@appium/types').StringRecord>} The content of emulator image properties file.
 * Usually this configuration .ini file has the following content:
 *   avd.ini.encoding=UTF-8
 *   path=/Users/username/.android/avd/Pixel_XL_API_30.avd
 *   path.rel=avd/Pixel_XL_API_30.avd
 *   target=android-30
 */
emuMethods.getEmuImageProperties = async function getEmuImageProperties (avdName) {
  const avds = await listEmulators();
  const avd = avds.find(({name}) => name === avdName);
  if (!avd) {
    let msg = `Cannot find '${avdName}' emulator. `;
    if (_.isEmpty(avds)) {
      msg += `No emulators have been detected on your system`;
    } else {
      msg += `Available avd names are: ${avds.map(({name}) => name)}`;
    }
    throw new Error(msg);
  }
  return ini.parse(await fs.readFile(avd.config, 'utf8'));
};

/**
 * Check if given emulator exists in the list of available avds.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} avdName - The name of emulator to verify for existence.
 * Should NOT start with '@' character
 * @throws {Error} If the emulator with given name does not exist.
 */
emuMethods.checkAvdExist = async function checkAvdExist (avdName) {
  const avds = await listEmulators();
  if (!avds.some(({name}) => name === avdName)) {
    let msg = `Avd '${avdName}' is not available. `;
    if (_.isEmpty(avds)) {
      msg += `No emulators have been detected on your system`;
    } else {
      msg += `Please select your avd name from one of these: '${avds.map(({name}) => name)}'`;
    }
    throw new Error(msg);
  }
  return true;
};


export default emuMethods;

/**
 * @typedef {typeof emuMethods} ADBEmuCommands
 */
