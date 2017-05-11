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

emuMethods.isEmulatorConnected = async function () {
  let emulators = await this.getConnectedEmulators();
  return !!_.find(emulators, (x) => x && x.udid === this.curDeviceId);
};

emuMethods.verifyEmulatorConnected = async function () {
  if (!(await this.isEmulatorConnected())) {
    log.errorAndThrow(`The emulator "${this.curDeviceId}" was unexpectedly disconnected`);
  }
};

emuMethods.fingerprint = async function (fingerprintId) {
  if (!fingerprintId) {
    log.errorAndThrow('Fingerprint id parameter must be defined');
  }
  // the method used only works for API level 23 and above
  let level = await this.getApiLevel();
  if (parseInt(level, 10) < 23) {
    log.errorAndThrow(`Device API Level must be >= 23. Current Api level '${level}'`);
  }
  await this.adbExecEmu(['finger', 'touch', fingerprintId]);
};

emuMethods.rotate = async function () {
  await this.adbExecEmu(['rotate']);
};

emuMethods.powerAC = async function (state = 'on') {
  if (_.values(emuMethods.POWER_AC_STATES).indexOf(state) === -1) {
    log.errorAndThrow(`Wrong power AC state sent '${state}'. Supported values: ${_.values(emuMethods.POWER_AC_STATES)}]`);
  }
  await this.adbExecEmu(['power', 'ac', state]);
};

emuMethods.powerCapacity = async function (percent = 100) {
  percent = parseInt(percent, 10);
  if (isNaN(percent) || percent < 0 || percent > 100) {
    log.errorAndThrow(`The percentage value should be valid integer between 0 and 100`);
  }
  await this.adbExecEmu(['power', 'capacity', percent]);
};

emuMethods.powerOFF = async function () {
  await this.powerAC(emuMethods.POWER_AC_STATES.POWER_AC_OFF);
  await this.powerCapacity(0);
};

emuMethods.sendSMS = async function (phoneNumber, message = '') {
  message = message.trim();
  if (message === "") {
    log.errorAndThrow('Sending an SMS requires a message');
  }
  phoneNumber = `${phoneNumber}`.replace(/\s*/, "");
  if (!PHONE_NUMBER_PATTERN.test(phoneNumber)) {
    log.errorAndThrow(`Invalid sendSMS phoneNumber param ${phoneNumber}`);
  }
  await this.adbExecEmu(['sms', 'send', phoneNumber, message]);
};

emuMethods.gsmCall = async function (phoneNumber, action = '') {
  if (_.values(emuMethods.GSM_CALL_ACTIONS).indexOf(action) === -1) {
    log.errorAndThrow(`Invalid gsm action param ${action}. Supported values: ${_.values(emuMethods.GSM_CALL_ACTIONS)}`);
  }
  phoneNumber = `${phoneNumber}`.replace(/\s*/, "");
  if (!PHONE_NUMBER_PATTERN.test(phoneNumber)) {
    log.errorAndThrow(`Invalid gsmCall phoneNumber param ${phoneNumber}`);
  }
  await this.adbExecEmu(['gsm', action, phoneNumber]);
};

emuMethods.gsmSignal = async function (strength = 4) {
  strength = parseInt(strength, 10);
  if (emuMethods.GSM_SIGNAL_STRENGTHS.indexOf(strength) === -1) {
    log.errorAndThrow(`Invalid signal strength param ${strength}. Supported values: ${_.values(emuMethods.GSM_SIGNAL_STRENGTHS)}`);
  }
  log.info('gsm signal-profile <strength> changes the reported strength on next (15s) update.');
  await this.adbExecEmu(['gsm', 'signal-profile', strength]);
};

emuMethods.gsmVoice = async function (state = 'on') {
  // gsm voice <state> allows you to change the state of your GPRS connection
  if (_.values(emuMethods.GSM_VOICE_STATES).indexOf(state) === -1) {
    log.errorAndThrow(`Invalid gsm voice state param ${state}. Supported values: ${_.values(emuMethods.GSM_VOICE_STATES)}`);
  }
  await this.adbExecEmu(['gsm', 'voice', state]);
};

export default emuMethods;
