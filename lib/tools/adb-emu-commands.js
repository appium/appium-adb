import log from '../logger.js';
import _ from 'lodash';

const PHONE_NUMBER_PATTERN = /^[\+]?[(]?[0-9]*[)]?[-\s\.]?[0-9]*[-\s\.]?[0-9]{2,}$/im;

let emuMethods = {};
emuMethods.POWER_AC_STATES = {
  POWER_AC_ON: 'on',
  POWER_AC_OFF: 'off'
};
emuMethods.GSM_CALL_ACTIONS = {
  GSM_CALL : 'call',
  GSM_ACCEPT: 'accept',
  GSM_CANCEL: 'cancel',
  GSM_HOLD: 'hold'
};
emuMethods.GSM_VOICE_STATES = {
  GSM_VOICE_UNREGISTERED: 'unregistered',
  GSM_VOICE_HOME: 'home',
  GSM_VOICE_ROAMING: 'roaming',
  GSM_VOICE_SEARCHING: 'searching',
  GSM_VOICE_DENIED: 'denied',
  GSM_VOICE_OFF: 'off',
  GSM_VOICE_ON: 'on'
};
emuMethods.GSM_SIGNAL_STRENGTHS = [0, 1, 2, 3, 4];

emuMethods.NETWORK_SPEED = {
  GSM: 'gsm', // GSM/CSD (up: 14.4, down: 14.4).
  SCSD: 'scsd', // HSCSD (up: 14.4, down: 57.6).
  GPRS: 'gprs', // GPRS (up: 28.8, down: 57.6).
  EDGE: 'edge', // EDGE/EGPRS (up: 473.6, down: 473.6).
  UMTS: 'umts', // UMTS/3G (up: 384.0, down: 384.0).
  HSDPA: 'hsdpa', // HSDPA (up: 5760.0, down: 13,980.0).
  LTE: 'lte', // LTE (up: 58,000, down: 173,000).
  EVDO: 'evdo', // EVDO (up: 75,000, down: 280,000).
  FULL: 'full' // No limit, the default (up: 0.0, down: 0.0).
};

/**
 * Check the emulator state.
 *
 * @return {boolean} True if Emulator is visible to adb.
 */
emuMethods.isEmulatorConnected = async function () {
  let emulators = await this.getConnectedEmulators();
  return !!_.find(emulators, (x) => x && x.udid === this.curDeviceId);
};

/**
 * Verify the emulator is connected.
 *
 * @throws {error} If Emulator is not visible to adb.
 */
emuMethods.verifyEmulatorConnected = async function () {
  if (!(await this.isEmulatorConnected())) {
    throw new Error(`The emulator "${this.curDeviceId}" was unexpectedly disconnected`);
  }
};

/**
 * Emulate fingerprint touch event on the connected emulator.
 *
 * @param {string} fingerprintId - The ID of the fingerprint.
 */
emuMethods.fingerprint = async function (fingerprintId) {
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
 */
emuMethods.rotate = async function () {
  await this.adbExecEmu(['rotate']);
};

/**
 * Emulate power state change on the connected emulator.
 *
 * @param {string} state ['on'] - Either 'on' or 'off'.
 */
emuMethods.powerAC = async function (state = 'on') {
  if (_.values(emuMethods.POWER_AC_STATES).indexOf(state) === -1) {
    throw new Error(`Wrong power AC state sent '${state}'. Supported values: ${_.values(emuMethods.POWER_AC_STATES)}]`);
  }
  await this.adbExecEmu(['power', 'ac', state]);
};

/**
 * Emulate power capacity change on the connected emulator.
 *
 * @param {string|number} percent [100] - Percentage value in range [0, 100].
 */
emuMethods.powerCapacity = async function (percent = 100) {
  percent = parseInt(percent, 10);
  if (isNaN(percent) || percent < 0 || percent > 100) {
    throw new Error(`The percentage value should be valid integer between 0 and 100`);
  }
  await this.adbExecEmu(['power', 'capacity', percent]);
};

/**
 * Emulate power off event on the connected emulator.
 */
emuMethods.powerOFF = async function () {
  await this.powerAC(emuMethods.POWER_AC_STATES.POWER_AC_OFF);
  await this.powerCapacity(0);
};

/**
 * Emulate send SMS event on the connected emulator.
 *
 * @param {string|number} phoneNumber - The phone number of message sender.
 * @param {string} message [''] - The message content.
 * @throws {error} If phone number has invalid format.
 */
emuMethods.sendSMS = async function (phoneNumber, message = '') {
  message = message.trim();
  if (message === "") {
    throw new Error('Sending an SMS requires a message');
  }
  phoneNumber = `${phoneNumber}`.replace(/\s*/, "");
  if (!PHONE_NUMBER_PATTERN.test(phoneNumber)) {
    throw new Error(`Invalid sendSMS phoneNumber param ${phoneNumber}`);
  }
  await this.adbExecEmu(['sms', 'send', phoneNumber, message]);
};

/**
 * Emulate GSM call event on the connected emulator.
 *
 * @param {string|number} phoneNumber - The phone number of the caller.
 * @param {string} action [''] - One of available GSM call actions.
 * @throws {error} If phone number has invalid format.
 * @throws {error} If _action_ value is invalid.
 */
emuMethods.gsmCall = async function (phoneNumber, action = '') {
  if (_.values(emuMethods.GSM_CALL_ACTIONS).indexOf(action) === -1) {
    throw new Error(`Invalid gsm action param ${action}. Supported values: ${_.values(emuMethods.GSM_CALL_ACTIONS)}`);
  }
  phoneNumber = `${phoneNumber}`.replace(/\s*/, "");
  if (!PHONE_NUMBER_PATTERN.test(phoneNumber)) {
    throw new Error(`Invalid gsmCall phoneNumber param ${phoneNumber}`);
  }
  await this.adbExecEmu(['gsm', action, phoneNumber]);
};

/**
 * Emulate GSM signal strength change event on the connected emulator.
 *
 * @param {string|number} strength [4] - A number in range [0, 4];
 * @throws {error} If _strength_ value is invalid.
 */
emuMethods.gsmSignal = async function (strength = 4) {
  strength = parseInt(strength, 10);
  if (emuMethods.GSM_SIGNAL_STRENGTHS.indexOf(strength) === -1) {
    throw new Error(`Invalid signal strength param ${strength}. Supported values: ${_.values(emuMethods.GSM_SIGNAL_STRENGTHS)}`);
  }
  log.info('gsm signal-profile <strength> changes the reported strength on next (15s) update.');
  await this.adbExecEmu(['gsm', 'signal-profile', strength]);
};

/**
 * Emulate GSM voice event on the connected emulator.
 *
 * @param {string} state ['on'] - Either 'on' or 'off'.
 * @throws {error} If _state_ value is invalid.
 */
emuMethods.gsmVoice = async function (state = 'on') {
  // gsm voice <state> allows you to change the state of your GPRS connection
  if (_.values(emuMethods.GSM_VOICE_STATES).indexOf(state) === -1) {
    throw new Error(`Invalid gsm voice state param ${state}. Supported values: ${_.values(emuMethods.GSM_VOICE_STATES)}`);
  }
  await this.adbExecEmu(['gsm', 'voice', state]);
};

/**
 * Emulate network speed change event on the connected emulator.
 *
 * @param {string} speed ['full'] - One of possible NETWORK_SPEED values.
 * @throws {error} If _speed_ value is invalid.
 */
emuMethods.networkSpeed = async function (speed = 'full') {
  // network speed <speed> allows you to set the network speed emulation.
  if (_.values(emuMethods.NETWORK_SPEED).indexOf(speed) === -1) {
    throw new Error(`Invalid network speed param ${speed}. Supported values: ${_.values(emuMethods.NETWORK_SPEED)}`);
  }
  await this.adbExecEmu(['network', 'speed', speed]);
};

export default emuMethods;
