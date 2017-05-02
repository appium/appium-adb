import log from '../logger.js';
import _ from 'lodash';
import { fs } from 'appium-support';
import path from 'path';

const PHONE_NUMBER_PATTERN = /^[\+]?[(]?[0-9]*[)]?[-\s\.]?[0-9]*[-\s\.]?[0-9]{2,}$/im;
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
  await this.verifyEmulatorConnected();
  await this.resetTelnetAuthToken();
  await this.adbExec(['emu', 'finger', 'touch', fingerprintId]);
};

emuMethods.rotate = async function () {
  await this.verifyEmulatorConnected();
  await this.resetTelnetAuthToken();
  await this.adbExec(['emu', 'rotate']);
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

  await this.verifyEmulatorConnected();
  await this.resetTelnetAuthToken();
  await this.adbExec(['emu', 'sms', 'send', phoneNumber, message]);
};

emuMethods.resetTelnetAuthToken = async function () {
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
};

export default emuMethods;
