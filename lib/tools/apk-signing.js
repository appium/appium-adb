import _ from 'lodash';
import _fs from 'fs';
import { exec } from 'teen_process';
import path from 'path';
import { log } from '../logger.js';
import { tempDir, system, mkdirp, fs, util, zip } from '@appium/support';
import { LRUCache } from 'lru-cache';
import {
  getJavaForOs,
  getJavaHome,
  APKS_EXTENSION,
  getResourcePath,
} from '../helpers.js';

const DEFAULT_PRIVATE_KEY = path.join('keys', 'testkey.pk8');
const DEFAULT_CERTIFICATE = path.join('keys', 'testkey.x509.pem');
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
/** @type {LRUCache<string, import('./types').SignedAppCacheValue>} */
const SIGNED_APPS_CACHE = new LRUCache({
  max: 30,
});

/**
 * Execute apksigner utility with given arguments.
 *
 * @this {import('../adb.js').ADB}
 * @param {string[]} args - The list of tool arguments.
 * @return {Promise<string>} - Command stdout
 * @throws {Error} If apksigner binary is not present on the local file system
 *                 or the return code is not equal to zero.
 */
export async function executeApksigner (args) {
  const apkSignerJar = await getApksignerForOs.bind(this)();
  const fullCmd = [
    await getJavaForOs(), '-Xmx1024M', '-Xss1m',
    '-jar', apkSignerJar,
    ...args
  ];
  log.debug(`Starting apksigner: ${util.quote(fullCmd)}`);
  // It is necessary to specify CWD explicitly; see https://github.com/appium/appium/issues/14724#issuecomment-737446715
  const {stdout, stderr} = await exec(fullCmd[0], fullCmd.slice(1), {
    cwd: path.dirname(apkSignerJar),
    // @ts-ignore This works
    windowsVerbatimArguments: system.isWindows(),
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
}

/**
 * (Re)sign the given apk file on the local file system with the default certificate.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} apk - The full path to the local apk file.
 * @throws {Error} If signing fails.
 */
export async function signWithDefaultCert (apk) {
  log.debug(`Signing '${apk}' with default cert`);
  if (!(await fs.exists(apk))) {
    throw new Error(`${apk} file doesn't exist.`);
  }

  const args = [
    'sign',
    '--key', await getResourcePath(DEFAULT_PRIVATE_KEY),
    '--cert', await getResourcePath(DEFAULT_CERTIFICATE),
    apk,
  ];
  try {
    await this.executeApksigner(args);
  } catch (e) {
    throw new Error(`Could not sign '${apk}' with the default certificate. ` +
      `Original error: ${e.stderr || e.stdout || e.message}`);
  }
}

/**
 * (Re)sign the given apk file on the local file system with a custom certificate.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} apk - The full path to the local apk file.
 * @throws {Error} If signing fails.
 */
export async function signWithCustomCert (apk) {
  log.debug(`Signing '${apk}' with custom cert`);
  if (!(await fs.exists(/** @type {string} */(this.keystorePath)))) {
    throw new Error(`Keystore: ${this.keystorePath} doesn't exist.`);
  }
  if (!(await fs.exists(apk))) {
    throw new Error(`'${apk}' doesn't exist.`);
  }

  try {
    await this.executeApksigner(['sign',
      '--ks', /** @type {string} */(this.keystorePath),
      '--ks-key-alias', /** @type {string} */(this.keyAlias),
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
      /** @type {string[]} */
      const fullCmd = [jarsigner,
        '-sigalg', 'MD5withRSA',
        '-digestalg', 'SHA1',
        '-keystore', /** @type {string} */(this.keystorePath),
        '-storepass', /** @type {string} */(this.keystorePassword),
        '-keypass', /** @type {string} */(this.keyPassword),
        apk, /** @type {string} */(this.keyAlias)];
      log.debug(`Starting jarsigner: ${util.quote(fullCmd)}`);
      await exec(fullCmd[0], fullCmd.slice(1), {
        // @ts-ignore This works
        windowsVerbatimArguments: system.isWindows(),
      });
    } catch (e) {
      throw new Error(`Could not sign with custom certificate. ` +
        `Original error: ${e.stderr || e.message}`);
    }
  }
}

/**
 * (Re)sign the given apk file on the local file system with either
 * custom or default certificate based on _this.useKeystore_ property value
 * and Zip-aligns it after signing.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} appPath - The full path to the local .apk(s) file.
 * @throws {Error} If signing fails.
 */
export async function sign (appPath) {
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
}

/**
 * Perform zip-aligning to the given local apk file.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} apk - The full path to the local apk file.
 * @returns {Promise<boolean>} True if the apk has been successfully aligned
 * or false if the apk has been already aligned.
 * @throws {Error} If zip-align fails.
 */
export async function zipAlignApk (apk) {
  await this.initZipAlign();
  try {
    await exec((/** @type {import('./types').StringRecord} */ (this.binaries)).zipalign, ['-c', '4', apk]);
    log.debug(`${apk}' is already zip-aligned. Doing nothing`);
    return false;
  } catch {
    log.debug(`'${apk}' is not zip-aligned. Aligning`);
  }
  try {
    await fs.access(apk, _fs.constants.W_OK);
  } catch {
    throw new Error(`The file at '${apk}' is not writeable. ` +
      `Please grant write permissions to this file or to its parent folder '${path.dirname(apk)}' ` +
      `for the Appium process, so it can zip-align the file`);
  }
  const alignedApk = await tempDir.path({prefix: 'appium', suffix: '.tmp'});
  await mkdirp(path.dirname(alignedApk));
  try {
    await exec(
      (/** @type {import('./types').StringRecord} */ (this.binaries)).zipalign,
      ['-f', '4', apk, alignedApk]
    );
    await fs.mv(alignedApk, apk, { mkdirp: true });
    return true;
  } catch (e) {
    if (await fs.exists(alignedApk)) {
      await fs.unlink(alignedApk);
    }
    throw new Error(`zipAlignApk failed. Original error: ${e.stderr || e.message}`);
  }
}

/**
 * Check if the app is already signed with the default Appium certificate.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} appPath - The full path to the local .apk(s) file.
 * @param {string} pkg - The name of application package.
 * @param {import('./types').CertCheckOptions} [opts={}] - Certificate checking options
 * @return {Promise<boolean>} True if given application is already signed.
 */
export async function checkApkCert (appPath, pkg, opts = {}) {
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
    const {keystorePath, output, expected} = /** @type {import('./types').SignedAppCacheValue} */ (
      SIGNED_APPS_CACHE.get(appHash)
    );
    if (this.useKeystore && this.keystorePath === keystorePath || !this.useKeystore) {
      return (!this.useKeystore && !requireDefaultCert) || hashMatches(output, expected);
    }
  }

  const expected = this.useKeystore ? await this.getKeystoreHash() : DEFAULT_CERT_HASH;
  try {
    await getApksignerForOs.bind(this)();
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
        keystorePath: /** @type {string} */ (this.keystorePath),
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
}

/**
 * Retrieve the the hash of the given keystore.
 *
 * @this {import('../adb.js').ADB}
 * @return {Promise<import('./types').KeystoreHash>}
 * @throws {Error} If getting keystore hash fails.
 */
export async function getKeystoreHash () {
  log.debug(`Getting hash of the '${this.keystorePath}' keystore`);
  const keytool = path.resolve(await getJavaHome(), 'bin',
    `keytool${system.isWindows() ? '.exe' : ''}`);
  if (!await fs.exists(keytool)) {
    throw new Error(`The keytool utility cannot be found at '${keytool}'`);
  }
  /** @type {string[]} */
  const args = [
    '-v', '-list',
    '-alias', /** @type {string} */ (this.keyAlias),
    '-keystore', /** @type {string} */ (this.keystorePath),
    '-storepass', /** @type {string} */ (this.keystorePassword),
  ];
  log.info(`Running '${keytool}' with arguments: ${util.quote(args)}`);
  try {
    const {stdout} = await exec(keytool, args, {
      // @ts-ignore This property is ok
      windowsVerbatimArguments: system.isWindows(),
    });
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
}

// #region Private functions

/**
 * Get the absolute path to apksigner tool
 *
 * @this {import('../adb').ADB}
 * @returns {Promise<string>} An absolute path to apksigner tool.
 * @throws {Error} If the tool is not present on the local file system.
 */
export async function getApksignerForOs () {
  return await this.getBinaryFromSdkRoot('apksigner.jar');
}

/**
 * Unsigns the given apk by removing the
 * META-INF folder recursively from the archive.
 * !!! The function overwrites the given apk after successful unsigning !!!
 *
 * @param {string} apkPath The path to the apk
 * @returns {Promise<boolean>} `true` if the apk has been successfully
 * unsigned and overwritten
 * @throws {Error} if there was an error during the unsign operation
 */
export async function unsignApk (apkPath) {
  const tmpRoot = await tempDir.openDir();
  const metaInfFolderName = 'META-INF';
  try {
    let hasMetaInf = false;
    await zip.readEntries(apkPath, ({entry}) => {
      hasMetaInf = entry.fileName.startsWith(`${metaInfFolderName}/`);
      // entries iteration stops after `false` is returned
      return !hasMetaInf;
    });
    if (!hasMetaInf) {
      return false;
    }
    const tmpZipRoot = path.resolve(tmpRoot, 'apk');
    await zip.extractAllTo(apkPath, tmpZipRoot);
    await fs.rimraf(path.resolve(tmpZipRoot, metaInfFolderName));
    const tmpResultPath = path.resolve(tmpRoot, path.basename(apkPath));
    await zip.toArchive(tmpResultPath, {
      cwd: tmpZipRoot,
    });
    await fs.unlink(apkPath);
    await fs.mv(tmpResultPath, apkPath);
    return true;
  } finally {
    await fs.rimraf(tmpRoot);
  }
}

// #endregion
