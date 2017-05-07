import log from '../logger.js';
import _ from 'lodash';

const PHONE_NUMBER_PATTERN = /^[\+]?[(]?[0-9]*[)]?[-\s\.]?[0-9]*[-\s\.]?[0-9]{2,}$/im;
const POWER_AC_ON = 'on';
const POWER_AC_OFF = 'off';
const POWER_AC_STATES = [POWER_AC_ON, POWER_AC_OFF];
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

emuMethods.powerAC = async function (state = 'on') {
  if (POWER_AC_STATES.indexOf(state) === -1) {
    log.errorAndThrow(`Wrong power AC state sent ${state}`);
  }
  await this.adbExecEmu(['power', 'ac', state]);
};

emuMethods.powerCapacity = async function (percent = 100) {
  if (!parseInt(percent) || percent < 0 || percent > 100) {
    log.errorAndThrow(`Wrong power percent: ${percent}`);
  }
  await this.adbExecEmu(['power', 'capacity', parseInt(percent)]);
};

emuMethods.powerOFF = async function () {
  await this.powerAC(POWER_AC_OFF);
  await this.powerCapacity(0);
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

emuMethods.POWER_AC_ON = POWER_AC_ON;
emuMethods.POWER_AC_OFF = POWER_AC_OFF;

export default emuMethods;
