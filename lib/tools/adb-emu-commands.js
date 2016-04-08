import log from '../logger.js';
import _ from 'lodash';


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


export default emuMethods;
