import log from '../logger.js';
import { getIMEListFromOutput } from '../helpers.js';

let methods = {};

methods.getAdbWithCorrectAdbPath = async function () {
  this.adb.path = await this.getSdkBinaryPath("adb");
  this.binaries.adb = this.adb.path;
  return this.adb;
};

methods.initAapt = async function () {
  this.binaries.aapt = await this.getSdkBinaryPath("aapt");
};

methods.initZipAlign = async function() {
  this.binaries.zipalign = await this.getSdkBinaryPath("zipalign");
};

methods.getApiLevel = async function () {
  log.info("Getting device API level");
  try {
    return this.shell(['getprop', 'ro.build.version.sdk']);
  } catch (e) {
    throw new Error(`Error getting device API level. Original error: ${e.message}`);
  }
};

methods.isDeviceConnected = async function () {
  let devices = await this.getConnectedDevices();
  return devices.length > 0;
};

methods.mkdir = async function (remotePath) {
  return this.shell(['mkdir', '-p', remotePath]);
};

methods.isValidClass = function (classString) {
  // some.package/some.package.Activity
  return new RegExp(/^[a-zA-Z0-9\./_]+$/).exec(classString);
};

methods.forceStop = async function (pkg) {
  return this.shell(['am', 'force-stop', pkg]);
};

methods.clear = function (pkg) {
  return this.shell(['pm', 'clear', pkg]);
};

methods.stopAndClear = async function (pkg) {
  try {
    await this.forceStop(pkg);
    await this.clear(pkg);
  } catch (e) {
    throw new Error(`Cannot stop and clear ${pkg}. Original error: ${e.message}`);
  }
};

methods.availableIMEs = async function () {
  try {
    return getIMEListFromOutput(await this.shell(['ime', 'list', '-a']));
  } catch (e) {
    throw new Error(`Error getting available IME's. Original error: ${e.message}`);
  }
};

methods.enabledIMEs = async function () {
  try {
    return getIMEListFromOutput(await this.shell(['ime', 'list']));
  } catch (e) {
    throw new Error(`Error getting enabled IME's. Original error: ${e.message}`);
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
  } catch(e) {
    throw new Error(`Error getting default IME. Original error: ${e.message}`);
  }
};

export default methods;
