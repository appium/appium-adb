import log from '../logger.js';
import _ from 'lodash';
import { fs } from 'appium-support';
import path from 'path';

let emuMethods = {};

emuMethods.isEmulatorConnected = async function (udid) {
  let emulators = await this.getConnectedEmulators();
  if (!emulators.length) {
    return false;
  }
  for (let emulator of emulators) {
    if (emulator.udid === udid) {
      return true;
    }
  }
  return false;
};

emuMethods.fingerprint = async function (fingerprintId, udid = undefined) {
  if (!fingerprintId) {
    log.errorAndThrow('Fingerprint id parameter must be defined');
  }

  // the method used only works for API level 23 and above
  let level = await this.getApiLevel();
  if (parseInt(level, 10) < 23) {
    log.errorAndThrow(`Device API Level must be >= 23. Current Api level '${level}'`);
  }

  if (!_.isUndefined(udid) && !(await this.isEmulatorConnected(udid)) ) {
    log.errorAndThrow(`Device '${udid}' is not available.`);
  } else if ((await this.getConnectedEmulators()).length === 0) {
    log.errorAndThrow('No devices connected');
  }

  if (udid) {
    await this.setDeviceId(udid);
  }
  await this.adbExec(['emu', 'finger', 'touch', fingerprintId]);
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
