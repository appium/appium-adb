import _ from 'lodash';
import _fs from 'fs';
import { exec } from 'teen_process';
import path from 'path';
import log from '../logger.js';
import { tempDir, system, mkdirp, fs, zip, util } from 'appium-support';
import { getJavaForOs, getApksignerForOs, getJavaHome, rootDir, APKS_EXTENSION } from '../helpers.js';

const DEFAULT_PRIVATE_KEY = path.resolve(rootDir, 'keys', 'testkey.pk8');
const DEFAULT_CERTIFICATE = path.resolve(rootDir, 'keys', 'testkey.x509.pem');
const DEFAULT_CERT_DIGEST = 'a40da80a59d170caa950cf15c18c454d47a39b26989d8b640ecd745ba71bf5dc';
const BUNDLETOOL_TUTORIAL = 'https://developer.android.com/studio/command-line/bundletool';
const APKSIGNER_VERIFY_FAIL = 'DOES NOT VERIFY';

let apkSigningMethods = {};

/**
 * Applies the patch, which workarounds'-Djava.ext.dirs is not supported. Use -classpath instead.'
 * error on Windows by creating a temporary patched copy of the original apksigner script.
 *
 * @param {string} originalPath - The original path to apksigner tool
 * @returns {string} The full path to the patched script or the same path if there is
 *                   no need to patch the original file.
 */
async function patchApksigner (originalPath) {
  const originalContent = await fs.readFile(originalPath, 'ascii');
  const patchedContent = originalContent.replace('-Djava.ext.dirs="%frameworkdir%"',
    '-cp "%frameworkdir%\\*"');
  if (patchedContent === originalContent) {
    return originalPath;
  }
  log.debug(`Patching '${originalPath}...`);
  const patchedPath = await tempDir.path({prefix: 'apksigner', suffix: '.bat'});
  await mkdirp(path.dirname(patchedPath));
  await fs.writeFile(patchedPath, patchedContent, 'ascii');
  return patchedPath;
}

/**
 * Execute apksigner utility with given arguments.
 *
 * @param {?Array<String>} args - The list of tool arguments.
 * @return {string} - Command stdout
 * @throws {Error} If apksigner binary is not present on the local file system
 *                 or the return code is not equal to zero.
 */
apkSigningMethods.executeApksigner = async function executeApksigner (args = []) {
  const apkSigner = await getApksignerForOs(this);
  const originalFolder = path.dirname(apkSigner);
  const getApksignerOutput = async (apksignerPath) => {
    let binaryPath = apksignerPath;
    if (system.isWindows() && util.isSubPath(binaryPath, originalFolder)) {
      // Workaround for https://github.com/nodejs/node-v0.x-archive/issues/25895
      binaryPath = path.basename(binaryPath);
    }
    const {stdout, stderr} = await exec(binaryPath, args, {
      cwd: originalFolder
    });
    for (let [name, stream] of [['stdout', stdout], ['stderr', stderr]]) {
      if (!stream) {
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
  log.debug(`Starting '${apkSigner}' with args '${JSON.stringify(args)}'`);
  try {
    return await getApksignerOutput(apkSigner);
  } catch (err) {
    log.warn(`Got an error during apksigner execution: ${err.message}`);
    for (const [name, stream] of [['stdout', err.stdout], ['stderr', err.stderr]]) {
      if (stream) {
        log.warn(`apksigner ${name}: ${stream}`);
      }
    }
    if (system.isWindows()) {
      const patchedApksigner = await patchApksigner(apkSigner);
      if (patchedApksigner !== apkSigner) {
        try {
          return await getApksignerOutput(patchedApksigner);
        } finally {
          await fs.unlink(patchedApksigner);
        }
      }
    }
    throw err;
  }
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

  try {
    const args = ['sign',
      '--key', DEFAULT_PRIVATE_KEY,
      '--cert', DEFAULT_CERTIFICATE,
      apk];
    await this.executeApksigner(args);
  } catch (err) {
    log.warn(`Cannot use apksigner tool for signing. Defaulting to sign.jar. ` +
      `Original error: ${err.message}` + (err.stderr ? `; StdErr: ${err.stderr}` : ''));
    const java = getJavaForOs();
    const signPath = path.resolve(this.helperJarPath, 'sign.jar');
    log.debug('Resigning apk.');
    try {
      await exec(java, ['-jar', signPath, apk, '--override']);
    } catch (e) {
      throw new Error(`Could not sign with default certificate. Original error ${e.message}`);
    }
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
    const args = ['sign',
      '--ks', this.keystorePath,
      '--ks-key-alias', this.keyAlias,
      '--ks-pass', `pass:${this.keystorePassword}`,
      '--key-pass', `pass:${this.keyPassword}`,
      apk];
    await this.executeApksigner(args);
  } catch (err) {
    log.warn(`Cannot use apksigner tool for signing. Defaulting to jarsigner. ` +
      `Original error: ${err.message}`);
    try {
      log.debug('Unsigning apk.');
      await exec(getJavaForOs(), ['-jar', path.resolve(this.helperJarPath, 'unsign.jar'), apk]);
      log.debug('Signing apk.');
      const jarsigner = path.resolve(getJavaHome(), 'bin', `jarsigner${system.isWindows() ? '.exe' : ''}`);
      await exec(jarsigner, ['-sigalg', 'MD5withRSA', '-digestalg', 'SHA1',
        '-keystore', this.keystorePath, '-storepass', this.keystorePassword,
        '-keypass', this.keyPassword, apk, this.keyAlias]);
    } catch (e) {
      throw new Error(`Could not sign with custom certificate. Original error ${e.message}`);
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

  let apksignerFound = true;
  try {
    await getApksignerForOs(this);
  } catch (err) {
    apksignerFound = false;
  }

  if (apksignerFound) {
    // it is necessary to apply zipalign only before signing
    // if apksigner is used or only after signing if we only have
    // sign.jar utility
    await this.zipAlignApk(appPath);
  }

  if (this.useKeystore) {
    await this.signWithCustomCert(appPath);
  } else {
    await this.signWithDefaultCert(appPath);
  }

  if (!apksignerFound) {
    await this.zipAlignApk(appPath);
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
    throw new Error(`zipAlignApk failed. Original error: ${e.message}. Stdout: '${e.stdout}'; Stderr: '${e.stderr}'`);
  }
};

/**
 * Check if the app is already signed with the default Appium certificate.
 *
 * @param {string} appPath - The full path to the local .apk(s) file.
 * @param {string} pgk - The name of application package.
 * @return {boolean} True if given application is already signed.
 */
apkSigningMethods.checkApkCert = async function checkApkCert (appPath, pkg) {
  log.debug(`Checking app cert for ${appPath}`);
  if (!await fs.exists(appPath)) {
    log.debug(`'${appPath}' does not exist`);
    return false;
  }

  if (this.useKeystore) {
    return await this.checkCustomApkCert(appPath, pkg);
  }

  if (path.extname(appPath) === APKS_EXTENSION) {
    appPath = await this.extractBaseApk(appPath);
  }

  try {
    await getApksignerForOs(this);
    const output = await this.executeApksigner(['verify', '--print-certs', appPath]);
    if (!_.includes(output, DEFAULT_CERT_DIGEST)) {
      log.debug(`'${appPath}' is signed with non-default certificate`);
      return false;
    }
    log.debug(`'${appPath}' is already signed.`);
    return true;
  } catch (err) {
    // check if there is no signature
    if (err.stderr && err.stderr.includes(APKSIGNER_VERIFY_FAIL)) {
      log.debug(`'${appPath}' is not signed with debug cert`);
      return false;
    }
    log.warn(`Cannot use apksigner tool for signature verification. ` +
      `Original error: ${err.message}`);
  }

  // default to verify.jar
  try {
    log.debug(`Defaulting to verify.jar`);
    await exec(getJavaForOs(), ['-jar', path.resolve(this.helperJarPath, 'verify.jar'), appPath]);
    log.debug(`'${appPath}' is already signed.`);
    return true;
  } catch (err) {
    log.debug(`'${appPath}' is not signed with debug cert${err.stderr ? `: ${err.stderr}` : ''}`);
    return false;
  }
};

/**
 * Check if the app is already signed with a custom certificate.
 *
 * @param {string} appPath - The full path to the local apk(s) file.
 * @param {string} pgk - The name of application package.
 * @return {boolean} True if given application is already signed with a custom certificate.
 */
apkSigningMethods.checkCustomApkCert = async function checkCustomApkCert (appPath, pkg) {
  log.debug(`Checking custom app cert for ${appPath}`);

  if (path.extname(appPath) === APKS_EXTENSION) {
    appPath = await this.extractBaseApk(appPath);
  }

  let h = 'a-fA-F0-9';
  let md5Str = [`.*MD5.*((?:[${h}]{2}:){15}[${h}]{2})`];
  let md5 = new RegExp(md5Str, 'mi');
  let keytool = path.resolve(getJavaHome(), 'bin', `keytool${system.isWindows() ? '.exe' : ''}`);
  let keystoreHash = await this.getKeystoreMd5(keytool, md5);
  return await this.checkApkKeystoreMatch(keytool, md5, keystoreHash, pkg, appPath);
};

/**
 * Get the MD5 hash of the keystore.
 *
 * @param {string} keytool - The name of the keytool utility.
 * @param {RegExp} md5re - The pattern used to match the result in _keytool_ output.
 * @return {?string} Keystore MD5 hash or _null_ if the hash cannot be parsed.
 * @throws {Error} If getting keystore MD5 hash fails.
 */
apkSigningMethods.getKeystoreMd5 = async function getKeystoreMd5 (keytool, md5re) {
  log.debug('Printing keystore md5.');
  try {
    let {stdout} = await exec(keytool, ['-v', '-list',
      '-alias', this.keyAlias,
      '-keystore', this.keystorePath,
      '-storepass', this.keystorePassword]);
    let keystoreHash = md5re.exec(stdout);
    keystoreHash = keystoreHash ? keystoreHash[1] : null;
    log.debug(`Keystore MD5: ${keystoreHash}`);
    return keystoreHash;
  } catch (e) {
    throw new Error(`getKeystoreMd5 failed. Original error: ${e.message}`);
  }
};

/**
 * Check if the MD5 hash of the particular application matches to the given hash.
 *
 * @param {string} keytool - The name of the keytool utility.
 * @param {RegExp} md5re - The pattern used to match the result in _keytool_ output.
 * @param {string} keystoreHash - The expected hash value.
 * @param {string} pkg - The name of the installed package.
 * @param {string} apk - The full path to the existing apk file.
 * @return {boolean} True if both hashes are equal.
 * @throws {Error} If getting keystore MD5 hash fails.
 */
apkSigningMethods.checkApkKeystoreMatch = async function checkApkKeystoreMatch (keytool, md5re, keystoreHash, pkg, apk) {
  let entryHash = null;
  let rsa = /^META-INF\/.*\.[rR][sS][aA]$/;
  let foundKeystoreMatch = false;

  //for (let entry of entries) {
  await zip.readEntries(apk, async ({entry, extractEntryTo}) => {
    entry = entry.fileName;
    if (!rsa.test(entry)) {
      return;
    }
    log.debug(`Entry: ${entry}`);
    let entryPath = path.join(this.tmpDir, pkg, 'cert');
    log.debug(`entryPath: ${entryPath}`);
    let entryFile = path.join(entryPath, entry);
    log.debug(`entryFile: ${entryFile}`);
    // ensure /tmp/pkg/cert/ doesn't exist or extract will fail.
    await fs.rimraf(entryPath);
    // META-INF/CERT.RSA
    await extractEntryTo(entryPath);
    log.debug('extracted!');
    // check for match
    log.debug('Printing apk md5.');
    let {stdout} = await exec(keytool, ['-v', '-printcert', '-file', entryFile]);
    entryHash = md5re.exec(stdout);
    entryHash = entryHash ? entryHash[1] : null;
    log.debug(`entryHash MD5: ${entryHash}`);
    log.debug(`keystore MD5: ${keystoreHash}`);
    let matchesKeystore = entryHash && entryHash === keystoreHash;
    log.debug(`Matches keystore? ${matchesKeystore}`);

    // If we have a keystore match, stop iterating
    if (matchesKeystore) {
      foundKeystoreMatch = true;
      return false;
    }
  });
  return foundKeystoreMatch;
};

export default apkSigningMethods;
