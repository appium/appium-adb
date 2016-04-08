import log from '../logger.js';

let emuMethods = {};

emuMethods.isEmulatorConnected = async function(udid) {
  let emulators = await this.getConnectedEmulators();
  if(!emulators.length) return false;
  for(let i in emulators) {
    if(emulators[i].udid === udid) return true;
  }
  return false;
};

emuMethods.fingerprint = async function(fingerprint_id, udid = undefined) {
  try {
    if (fingerprint_id === undefined) {
      log.errorAndThrow(`Fingerprint id param must be defined`);
    }
    if (udid !== undefined && !(await this.isEmulatorConnected(udid)) ) {
      log.errorAndThrow(`Emulator ${udid} is not longer available.`);
    } else {
      let emulators = await this.getConnectedEmulators();
      if(!emulators.length) {
        log.errorAndThrow(`No emulators available.`);
      }
      udid = emulators[0].udid;
    }
    await this.setDeviceId(udid);
    let level = await this.getApiLevel();
    if ((~~level) < 23) {
      log.errorAndThrow(`Emulator Api Level must be >= 23. Current Api level ${level}`);
    }
    await this.adbExec(["emu", "finger", "touch", fingerprint_id]);
      return true;
  } catch(e) {
    log.errorAndThrow(`Error getting emulators. Original error: ${e.message}`);
  }
};
export default emuMethods;