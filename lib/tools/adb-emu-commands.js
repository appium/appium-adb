import log from '../logger.js';
import _ from 'lodash';

const PHONE_NUMBER_PATTERN = /^[\+]?[(]?[0-9]*[)]?[-\s\.]?[0-9]*[-\s\.]?[0-9]{2,}$/im;
const GSM_CALL = 'call';
const GSM_ACCEPT = 'accept';
const GSM_CANCEL = 'cancel';
const GSM_HOLD = 'hold';
const GSM_CALL_ACTIONS = [
  GSM_CALL, GSM_ACCEPT,
  GSM_CANCEL, GSM_HOLD
];
const GSM_VOICE_UNREGISTERED = 'unregistered';
const GSM_VOICE_HOME = 'home';
const GSM_VOICE_ROAMING = 'roaming';
const GSM_VOICE_SEARCHING = 'searching';
const GSM_VOICE_DENIED = 'denied';
const GSM_VOICE_OFF = 'off';
const GSM_VOICE_ON = 'on';
const GSM_VOICE_STATES = [
  GSM_VOICE_UNREGISTERED, GSM_VOICE_HOME,
  GSM_VOICE_ROAMING, GSM_VOICE_SEARCHING,
  GSM_VOICE_DENIED, GSM_VOICE_OFF,
  GSM_VOICE_ON
];
const GSM_SIGNAL_STRENGTH = [0, 1, 2, 3, 4];
let emuMethods = {};

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

emuMethods.sendSMS = async function (phoneNumber, message = '') {
  message = message.trim();
  if (message === "") {
    log.errorAndThrow('Sending an SMS requires a message');
  }
  phoneNumber = `${phoneNumber}`.replace(/\s*/, "");
  if (!PHONE_NUMBER_PATTERN.test(phoneNumber)) {
    log.errorAndThrow(`Invalid phoneNumber param ${phoneNumber}`);
  }
  await this.adbExecEmu(['sms', 'send', phoneNumber, message]);
};

emuMethods.gsmCall = async function (phoneNumber, action = '') {
  if (GSM_CALL_ACTIONS.indexOf(action) === -1) {
    log.errorAndThrow(`Invalid gsm action param ${action}`);
  }
  phoneNumber = `${phoneNumber}`.replace(/\s*/, "");
  if (!PHONE_NUMBER_PATTERN.test(phoneNumber)) {
    log.errorAndThrow(`Invalid phoneNumber param ${phoneNumber}`);
  }
  await this.adbExecEmu(['gsm', action, phoneNumber]);
};

emuMethods.gsmSignal = async function (strength = 4) {
  if (!(strength in GSM_SIGNAL_STRENGTH)) {
    log.errorAndThrow(`Invalid signal strength param ${strength}`);
  }
  log.info('gsm signal-profile <strength> changes the reported strength on next (15s) update.');
  await this.adbExecEmu(['gsm', 'signal-profile', strength]);
};

emuMethods.gsmVoice = async function (state = 'on') {
  // gsm voice <state> allows you to change the state of your GPRS connection
  if (GSM_VOICE_STATES.indexOf(state) === -1) {
    log.errorAndThrow(`Invalid gsm voice state param ${state}`);
  }
  await this.adbExecEmu(['gsm', 'voice', state]);
};

emuMethods.GSM_CALL = GSM_CALL;
emuMethods.GSM_ACCEPT = GSM_ACCEPT;
emuMethods.GSM_CANCEL = GSM_CANCEL;
emuMethods.GSM_HOLD = GSM_HOLD;
emuMethods.GSM_CALL_ACTIONS = GSM_CALL_ACTIONS;
emuMethods.GSM_VOICE_UNREGISTERED = GSM_VOICE_UNREGISTERED;
emuMethods.GSM_VOICE_HOME = GSM_VOICE_HOME;
emuMethods.GSM_VOICE_ROAMING = GSM_VOICE_ROAMING;
emuMethods.GSM_VOICE_SEARCHING = GSM_VOICE_SEARCHING;
emuMethods.GSM_VOICE_DENIED = GSM_VOICE_DENIED;
emuMethods.GSM_VOICE_OFF = GSM_VOICE_OFF;
emuMethods.GSM_VOICE_ON = GSM_VOICE_ON;
emuMethods.GSM_VOICE_STATES = GSM_VOICE_STATES;

export default emuMethods;
