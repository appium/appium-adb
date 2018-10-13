import { exec } from 'teen_process';
import log from '../logger.js';
import path from 'path';
import _ from 'lodash';
import {getJavaForOs} from "../helpers";

let bundletool = {};

/**
 * Check bundletool version
 *
 * @return {string} Version of bundletool. i.e., BundleTool 0.6.0
 * @throws {Error} If get version fails
 */
bundletool.version = async function () {
  try {
    return await exec(getJavaForOs(), [
      '-jar', path.resolve(this.helperJarPath, 'bundletool.jar'), 'version'
    ]);
  } catch (e) {
    throw new Error(`Could not get bundle tool version. Original error ${e.message}`);
  }
};

/**
 * Install apks
 *
 * @param {string} apks - The full path to the local apks file.
 * @param {string} deviceId - The device serial to install the apks to.
 * @param {[string]} modules - List of modules to be installed (defaults to all of them).
 *                           Note that the dependent modules will also be installed.
 *                           Ignored if the device receives a standalone APK.
 * @return {string} Command stdout
 * @throws {Error} If installation fails. e.g. INSTALL_PARSE_FAILED_NO_CERTIFICATES
 */
bundletool.installApks = async function (apks, deviceId, modules = []) {
  // TODO: Append install options after bundletool implement it.
  // https://github.com/google/bundletool/blob/f855ea639a02216780b2813ce29bd6e927ad4503/src/main/java/com/android/tools/build/bundletool/device/DdmlibDevice.java#L89-L107
  let installArgs = [
    '-jar', path.resolve(this.helperJarPath, 'bundletool.jar'), 'install-apks',
    '--apks', apks, '--device-id', deviceId
  ];

  if (!_.isEmpty(modules)) {
    installArgs.push('--modules', modules.join(','));
  }

  log.info(`Install apks with: ${installArgs}`);
  try {
    return await exec(getJavaForOs(), installArgs);
  } catch (e) {
    throw new Error(`Failed to install apks. Original error ${e.message}`);
  }
};

/**
 * Check build version
 *
 * @param {string} bundle - The full path to the local `aab` file.
 * @param {string} deviceId - The device serial to install the apks to.
 * @param {string} output - List of modules to be installed (defaults to all of them).
 *                           Note that the dependent modules will also be installed.
 *                           Ignored if the device receives a standalone APK.
 * @param {object} buildApksOpts - Options
 * @property {string} ks - Path to the keystore that should be used to sign the
 *                         generated APKs. If not set, the APKs will not be signed. If set, the
 *                         flag 'ks-key-alias' must also be set.
 * @property {string} ksKeyAlias - Alias of the key to use in the keystore to sign the generated APKs.
 * @property {string} ksPass - Alias of the key to use in the keystore to sign the generated APKs.
 *                             Password of the keystore to use to sign the generated APKs.
 *                             If provided, must be prefixed with either 'pass:' (if the password
 *                             is passed in clear text, e.g. 'pass:qwerty') or 'file:' (if the password
 *                             is the first line of a file, e.g. 'file:/tmp/myPassword.txt'). If this
 *                             flag is not set, the password will be requested on the prompt.
 * @property {string} overwrite If set, any previous existing output will be overwritten.                           --overwrite
 * @property {string} otherOptions - Add additional option
 * @return {string} A path to apks
 * @throws {Error} If building apks fails.
 */
bundletool.buildApks = async function (bundle, deviceId, output, buildApksOpts = {}) {
  let buildApksArgs = [
    '-jar', path.resolve(this.helperJarPath, 'bundletool.jar'), 'build-apks',
    '--bundle', bundle,
    '--output', output,
    '--connected-device', '--device-id', deviceId
  ];

  if (buildApksOpts.ks && buildApksOpts.ksKeyAlias) {
    buildApksArgs.push('--ks', buildApksOpts.ks);
    buildApksArgs.push('--ks-key-alias', buildApksOpts.ksKeyAlias);
  }

  if (buildApksOpts.ksPass) {
    buildApksArgs.push('--ks-pass', buildApksOpts.ksPass);
  }

  if (buildApksOpts.overwrite) {
    buildApksArgs.push('--overwrite');
  }

  if (buildApksOpts.otherOptions) {
    buildApksArgs.push(buildApksOpts.otherOptions);
  }

  log.info(`Build Apks apks with: ${buildApksArgs}`);
  try {
    await exec(getJavaForOs(), buildApksArgs);
    return output;
  } catch (e) {
    throw new Error(`Failed to build apks. Original error ${e.message}`);
  }
};

export default bundletool;
