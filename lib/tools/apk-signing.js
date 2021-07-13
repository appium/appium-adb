import _ from 'lodash';
import _fs from 'fs';
import { exec } from 'teen_process';
import path from 'path';
import log from '../logger.js';
import { tempDir, system, mkdirp, fs, util } from 'appium-support';
import LRU from 'lru-cache';
import {
  getJavaForOs, getApksignerForOs, getJavaHome,
  rootDir, APKS_EXTENSION, unsignApk,
} from '../helpers.js';

const DEFAULT_PRIVATE_KEY = path.resolve(rootDir, 'keys', 'testkey.pk8');
const DEFAULT_CERTIFICATE = path.resolve(rootDir, 'keys', 'testkey.x509.pem');
const BUNDLETOOL_TUTORIAL = 'https://developer.android.com/studio/command-line/bundletool';
const APKSIGNER_VERIFY_FAIL = 'DOES NOT VERIFY';
const SHA1 = 'sha1';
const SHA256 = 'sha256';
const SHA512 = 'sha512';
const MD5 = 'md5';
const DEFAULT_CERT_HASH = {
  [SHA256]: 'a40da80a59d170caa950cf15c18c454d47a39b26989d8b640ecd745ba71bf5dc'
};
const JAVA_PROPS_INIT_ERROR = 'java.lang.Error: Properties init';
const SIGNED_APPS_CACHE = new LRU({
  max: 30,
});


const apkSigningMethods = {};

/**
 * Execute apksigner utility with given arguments.
 *
 * @param {?Array<String>} args - The list of tool arguments.
 * @return {string} - Command stdout
 * @throws {Error} If apksigner binary is not present on the local file system
 *                 or the return code is not equal to zero.
 */
apkSigningMethods.executeApksigner = async function executeApksigner (args = []) {
  const apkSignerJar = await getApksignerForOs(this);
  const fullCmd = [
    await getJavaForOs(), '-Xmx1024M', '-Xss1m',
    '-jar', apkSignerJar,
    ...args
  ];
  log.debug(`Starting apksigner: ${util.quote(fullCmd)}`);
  // It is necessary to specify CWD explicitly; see https://github.com/appium/appium/issues/14724#issuecomment-737446715
  const {stdout, stderr} = await exec(fullCmd[0], fullCmd.slice(1), {
    cwd: path.dirname(apkSignerJar)
  });
  for (let [name, stream] of [['stdout', stdout], ['stderr', stderr]]) {
    if (!_.trim(stream)) {
      continue;
    }

    if (name === 'stdout') {
      // Make the output less talkative
      stream = stream.split('\n')
        .filter((line) => !line.includes('WARNING:'))
        .join('\n');
    }
    log.debug(`apksigner ${name}: ${stream}`);
  }
  return stdout;
};

/**
 * (Re)sign the given apk file on the local file system with the default certificate.
 *
 * @param {string} apk - The full path to the local apk file.
 * @throws {Error} If signing fails.
 */
apkSigningMethods.signWithDefaultCert = async function signWithDefaultCert (apk) {
  log.debug(`Signing '${apk}' with default cert`);
  if (!(await fs.exists(apk))) {
    throw new Error(`${apk} file doesn't exist.`);
  }

  const args = [
    'sign',
    '--key', DEFAULT_PRIVATE_KEY,
    '--cert', DEFAULT_CERTIFICATE,
    apk,
  ];
  try {
    await this.executeApksigner(args);
  } catch (e) {
    throw new Error(`Could not sign '${apk}' with the default certificate. ` +
      `Original error: ${e.stderr || e.stdout || e.message}`);
  }
};

/**
 * (Re)sign the given apk file on the local file system with a custom certificate.
 *
 * @param {string} apk - The full path to the local apk file.
 * @throws {Error} If signing fails.
 */
apkSigningMethods.signWithCustomCert = async function signWithCustomCert (apk) {
  log.debug(`Signing '${apk}' with custom cert`);
  if (!(await fs.exists(this.keystorePath))) {
    throw new Error(`Keystore: ${this.keystorePath} doesn't exist.`);
  }
  if (!(await fs.exists(apk))) {
    throw new Error(`'${apk}' doesn't exist.`);
  }

  try {
    await this.executeApksigner(['sign',
      '--ks', this.keystorePath,
      '--ks-key-alias', this.keyAlias,
      '--ks-pass', `pass:${this.keystorePassword}`,
      '--key-pass', `pass:${this.keyPassword}`,
      apk]);
  } catch (err) {
    log.warn(`Cannot use apksigner tool for signing. Defaulting to jarsigner. ` +
      `Original error: ${err.stderr || err.stdout || err.message}`);
    try {
      if (await unsignApk(apk)) {
        log.debug(`'${apk}' has been successfully unsigned`);
      } else {
        log.debug(`'${apk}' does not need to be unsigned`);
      }
      const jarsigner = path.resolve(await getJavaHome(), 'bin',
        `jarsigner${system.isWindows() ? '.exe' : ''}`);
      const fullCmd = [jarsigner,
        '-sigalg', 'MD5withRSA',
        '-digestalg', 'SHA1',
        '-keystore', this.keystorePath,
        '-storepass', this.keystorePassword,
        '-keypass', this.keyPassword,
        apk, this.keyAlias];
      log.debug(`Starting jarsigner: ${util.quote(fullCmd)}`);
      await exec(fullCmd[0], fullCmd.slice(1));
    } catch (e) {
      throw new Error(`Could not sign with custom certificate. ` +
        `Original error: ${e.stderr || e.message}`);
    }
  }
};

/**
 * (Re)sign the given apk file on the local file system with either
 * custom or default certificate based on _this.useKeystore_ property value
 * and Zip-aligns it after signing.
 *
 * @param {string} appPath - The full path to the local .apk(s) file.
 * @throws {Error} If signing fails.
 */
apkSigningMethods.sign = async function sign (appPath) {
  if (appPath.endsWith(APKS_EXTENSION)) {
    let message = 'Signing of .apks-files is not supported. ';
    if (this.useKeystore) {
      message += 'Consider manual application bundle signing with the custom keystore ' +
        `like it is described at ${BUNDLETOOL_TUTORIAL}`;
    } else {
      message += `Consider manual application bundle signing with the key at '${DEFAULT_PRIVATE_KEY}' ` +
        `and the certificate at '${DEFAULT_CERTIFICATE}'. Read ${BUNDLETOOL_TUTORIAL} for more details.`;
    }
    log.warn(message);
    return;
  }

  // it is necessary to apply zipalign only before signing
  // if apksigner is used
  await this.zipAlignApk(appPath);

  if (this.useKeystore) {
    await this.signWithCustomCert(appPath);
  } else {
    await this.signWithDefaultCert(appPath);
  }
};

/**
 * Perform zip-aligning to the given local apk file.
 *
 * @param {string} apk - The full path to the local apk file.
 * @returns {boolean} True if the apk has been successfully aligned
 * or false if the apk has been already aligned.
 * @throws {Error} If zip-align fails.
 */
apkSigningMethods.zipAlignApk = async function zipAlignApk (apk) {
  await this.initZipAlign();
  try {
    await exec(this.binaries.zipalign, ['-c', '4', apk]);
    log.debug(`${apk}' is already zip-aligned. Doing nothing`);
    return false;
  } catch (e) {
    log.debug(`'${apk}' is not zip-aligned. Aligning`);
  }
  try {
    await fs.access(apk, _fs.W_OK);
  } catch (e) {
    throw new Error(`The file at '${apk}' is not writeable. ` +
      `Please grant write permissions to this file or to its parent folder '${path.dirname(apk)}' ` +
      `for the Appium process, so it can zip-align the file`);
  }
  const alignedApk = await tempDir.path({prefix: 'appium', suffix: '.tmp'});
  await mkdirp(path.dirname(alignedApk));
  try {
    await exec(this.binaries.zipalign, ['-f', '4', apk, alignedApk]);
    await fs.mv(alignedApk, apk, { mkdirp: true });
    return true;
  } catch (e) {
    if (await fs.exists(alignedApk)) {
      await fs.unlink(alignedApk);
    }
    throw new Error(`zipAlignApk failed. Original error: ${e.stderr || e.message}`);
  }
};

/**
 * @typedef {Object} CertCheckOptions
 * @property {boolean} requireDefaultCert [true] Whether to require that the destination APK
 * is signed with the default Appium certificate or any valid certificate. This option
 * only has effect if `useKeystore` property is unset.
 */

/**
 * Check if the app is already signed with the default Appium certificate.
 *
 * @param {string} appPath - The full path to the local .apk(s) file.
 * @param {string} pgk - The name of application package.
 * @param {CertCheckOptions} opts - Certificate checking options
 * @return {boolean} True if given application is already signed.
 */
apkSigningMethods.checkApkCert = async function checkApkCert (appPath, pkg, opts = {}) {
  log.debug(`Checking app cert for ${appPath}`);
  if (!await fs.exists(appPath)) {
    log.debug(`'${appPath}' does not exist`);
    return false;
  }

  if (path.extname(appPath) === APKS_EXTENSION) {
    appPath = await this.extractBaseApk(appPath);
  }

  const hashMatches = (apksignerOutput, expectedHashes) => {
    for (const [name, value] of _.toPairs(expectedHashes)) {
      if (new RegExp(`digest:\\s+${value}\\b`, 'i').test(apksignerOutput)) {
        log.debug(`${name} hash did match for '${path.basename(appPath)}'`);
        return true;
      }
    }
    return false;
  };

  const {
    requireDefaultCert = true,
  } = opts;

  const appHash = await fs.hash(appPath);
  if (SIGNED_APPS_CACHE.has(appHash)) {
    log.debug(`Using the previously cached signature entry for '${path.basename(appPath)}'`);
    const {keystorePath, output, expected} = SIGNED_APPS_CACHE.get(appHash);
    if (this.useKeystore && this.keystorePath === keystorePath || !this.useKeystore) {
      return (!this.useKeystore && !requireDefaultCert) || hashMatches(output, expected);
    }
  }

  const expected = this.useKeystore
    ? await this.getKeystoreHash(appPath, pkg)
    : DEFAULT_CERT_HASH;
  try {
    await getApksignerForOs(this);
    const output = await this.executeApksigner(['verify', '--print-certs', appPath]);
    const hasMatch = hashMatches(output, expected);
    if (hasMatch) {
      log.info(`'${appPath}' is signed with the ` +
        `${this.useKeystore ? 'keystore' : 'default'} certificate`);
    } else {
      log.info(`'${appPath}' is signed with a ` +
        `non-${this.useKeystore ? 'keystore' : 'default'} certificate`);
    }
    const isSigned = (!this.useKeystore && !requireDefaultCert) || hasMatch;
    if (isSigned) {
      SIGNED_APPS_CACHE.set(appHash, {
        output,
        expected,
        keystorePath: this.keystorePath,
      });
    }
    return isSigned;
  } catch (err) {
    // check if there is no signature
    if (_.includes(err.stderr, APKSIGNER_VERIFY_FAIL)) {
      log.info(`'${appPath}' is not signed`);
      return false;
    }
    const errMsg = err.stderr || err.stdout || err.message;
    if (_.includes(errMsg, JAVA_PROPS_INIT_ERROR)) {
      // This error pops up randomly and we are not quite sure why.
      // My guess - a race condition in java vm initialization.
      // Nevertheless, lets make Appium to believe the file is already signed,
      // because it would be true for 99% of UIAutomator2-based
      // tests, where we presign server binaries while publishing their NPM module.
      // If these are not signed, e.g. in case of Espresso, then the next step(s)
      // would anyway fail.
      // See https://github.com/appium/appium/issues/14724 for more details.
      log.warn(errMsg);
      log.warn(`Assuming '${appPath}' is already signed and continuing anyway`);
      return true;
    }
    throw new Error(`Cannot verify the signature of '${appPath}'. ` +
      `Original error: ${errMsg}`);
  }
};

/**
 * @typedef {Object} KeystoreHash
 * @property {?string} md5 the md5 hash value of the keystore
 * @property {?string} sha1 the sha1 hash value of the keystore
 * @property {?string} sha256 the sha256 hash value of the keystore
 * @property {?string} sha512 the sha512 hash value of the keystore
 */

/**
 * Retrieve the the hash of the given keystore.
 *
 * @return {KeystoreHash}
 * @throws {Error} If getting keystore hash fails.
 */
apkSigningMethods.getKeystoreHash = async function getKeystoreHash () {
  log.debug(`Getting hash of the '${this.keystorePath}' keystore`);
  const keytool = path.resolve(await getJavaHome(), 'bin',
    `keytool${system.isWindows() ? '.exe' : ''}`);
  if (!await fs.exists(keytool)) {
    throw new Error(`The keytool utility cannot be found at '${keytool}'`);
  }
  const args = [
    '-v', '-list',
    '-alias', this.keyAlias,
    '-keystore', this.keystorePath,
    '-storepass', this.keystorePassword
  ];
  log.info(`Running '${keytool}' with arguments: ${util.quote(args)}`);
  try {
    const {stdout} = await exec(keytool, args);
    const result = {};
    for (const hashName of [SHA512, SHA256, SHA1, MD5]) {
      const hashRe = new RegExp(`^\\s*${hashName}:\\s*([a-f0-9:]+)`, 'mi');
      const match = hashRe.exec(stdout);
      if (!match) {
        continue;
      }
      result[hashName] = match[1].replace(/:/g, '').toLowerCase();
    }
    if (_.isEmpty(result)) {
      log.debug(stdout);
      throw new Error('Cannot parse the hash value from the keytool output');
    }
    log.debug(`Keystore hash: ${JSON.stringify(result)}`);
    return result;
  } catch (e) {
    throw new Error(`Cannot get the hash of '${this.keystorePath}' keystore. ` +
      `Original error: ${e.stderr || e.message}`);
  }
};

export default apkSigningMethods;
