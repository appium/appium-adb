import { exec } from 'teen_process';
import path from 'path';
import log from '../logger.js';
import { tempDir, system, mkdirp, fs, zip } from 'appium-support';
import { getJavaForOs, getJavaHome } from '../helpers.js';

let apkSigningMethods = {};

/**
 * (Re)sign the given apk file on the local file system with the default certificate.
 *
 * @param {string} apk - The full path to the local apk file.
 * @throws {Error} If signing fails.
 */
apkSigningMethods.signWithDefaultCert = async function (apk) {
  const java = getJavaForOs();
  let signPath = path.resolve(this.helperJarPath, 'sign.jar');
  log.debug("Resigning apk.");
  try {
    if (!(await fs.exists(apk))) {
      throw new Error(`${apk} file doesn't exist.`);
    }
    await exec(java, ['-jar', signPath, apk, '--override']);
  } catch (e) {
    log.errorAndThrow(`Could not sign with default certificate. Original error ${e.message}`);
  }
};

/**
 * (Re)sign the given apk file on the local file system with a custom certificate.
 *
 * @param {string} apk - The full path to the local apk file.
 * @throws {Error} If signing fails.
 */
apkSigningMethods.signWithCustomCert = async function (apk) {
  log.debug(`Signing '${apk}' with custom cert`);
  const java = getJavaForOs();
  let javaHome = getJavaHome();
  let jarsigner = path.resolve(javaHome, 'bin', 'jarsigner');
  if (system.isWindows()) {
    jarsigner = jarsigner + '.exe';
  }
  if (!(await fs.exists(this.keystorePath))) {
    throw new Error(`Keystore: ${this.keystorePath} doesn't exist.`);
  }
  if (!(await fs.exists(apk))) {
    throw new Error(`${apk} file doesn't exist.`);
  }
  try {
    log.debug("Unsigning apk.");
    await exec(java, ['-jar', path.resolve(this.helperJarPath, 'unsign.jar'), apk]);
    log.debug("Signing apk.");
    await exec(jarsigner, ['-sigalg', 'MD5withRSA', '-digestalg', 'SHA1',
                           '-keystore', this.keystorePath, '-storepass', this.keystorePassword,
                           '-keypass', this.keyPassword, apk, this.keyAlias]);
  } catch (e) {
    log.errorAndThrow(`Could not sign with custom certificate. Original error ${e.message}`);
  }
};

/**
 * (Re)sign the given apk file on the local file system with either
 * custom or default certificate based on _this.useKeystore_ property value
 * and Zip-aligns it after signing.
 *
 * @param {string} apk - The full path to the local apk file.
 * @throws {Error} If signing fails.
 */
apkSigningMethods.sign = async function (apk) {
  if (this.useKeystore) {
    await this.signWithCustomCert(apk);
  } else {
    await this.signWithDefaultCert(apk);
  }
  await this.zipAlignApk(apk);
};

/**
 * Perform zip-aligning to the given local apk file.
 *
 * @param {string} apk - The full path to the local apk file.
 * @throws {Error} If zip-align fails.
 */
apkSigningMethods.zipAlignApk = async function (apk) {
  log.debug(`Zip-aligning '${apk}'`);
  await this.initZipAlign();
  let alignedApk = await tempDir.path({prefix: 'appium', suffix: '.tmp'});
  await mkdirp(path.dirname(alignedApk));
  log.debug("Zip-aligning apk.");
  try {
    await exec(this.binaries.zipalign, ['-f', '4', apk, alignedApk]);
    await fs.mv(alignedApk, apk, { mkdirp: true });
  } catch (e) {
    log.errorAndThrow(`zipAlignApk failed. Original error: ${e.message}`);
  }
};

/**
 * Check if the app is already signed.
 *
 * @param {string} apk - The full path to the local apk file.
 * @param {string} pgk - The name of application package.
 * @return {boolean} True if given application is already signed.
 */
apkSigningMethods.checkApkCert = async function (apk, pkg) {
  const java = getJavaForOs();
  if (!(await fs.exists(apk))) {
    log.debug(`APK doesn't exist. ${apk}`);
    return false;
  }
  if (this.useKeystore) {
    return await this.checkCustomApkCert(apk, pkg);
  }
  log.debug(`Checking app cert for ${apk}.`);
  try {
    await exec(java, ['-jar', path.resolve(this.helperJarPath, 'verify.jar'), apk]);
    log.debug("App already signed.");
    await this.zipAlignApk(apk);
    return true;
  } catch (e) {
    log.debug("App not signed with debug cert.");
    return false;
  }
};

/**
 * Check if the app is already signed with a custom certificate.
 *
 * @param {string} apk - The full path to the local apk file.
 * @param {string} pgk - The name of application package.
 * @return {boolean} True if given application is already signed with a custom certificate.
 */
apkSigningMethods.checkCustomApkCert = async function (apk, pkg) {
  log.debug(`Checking custom app cert for ${apk}`);
  let h = "a-fA-F0-9";
  let md5Str = [`.*MD5.*((?:[${h}]{2}:){15}[${h}]{2})`];
  let md5 = new RegExp(md5Str, 'mi');
  let javaHome = getJavaHome();
  let keytool = path.resolve(javaHome, 'bin', 'keytool');
  keytool = system.isWindows() ? `${keytool}.exe` : keytool;
  let keystoreHash = await this.getKeystoreMd5(keytool, md5);
  return await this.checkApkKeystoreMatch(keytool, md5, keystoreHash, pkg, apk);
};

/**
 * Get the MD5 hash of the keystore.
 *
 * @param {string} keytool - The name of the keytool utility.
 * @param {RegExp} md5re - The pattern used to match the result in _keytool_ output.
 * @return {?string} Keystore MD5 hash or _null_ if the hash cannot be parsed.
 * @throws {Error} If getting keystore MD5 hash fails.
 */
apkSigningMethods.getKeystoreMd5 = async function (keytool, md5re) {
  let keystoreHash;
  log.debug("Printing keystore md5.");
  try {
    let {stdout} = await exec(keytool, ['-v', '-list', '-alias', this.keyAlias,
                        '-keystore', this.keystorePath, '-storepass',
                         this.keystorePassword]);
    keystoreHash = md5re.exec(stdout);
    keystoreHash = keystoreHash ? keystoreHash[1] : null;
    log.debug(`Keystore MD5: ${keystoreHash}`);
    return keystoreHash;
  } catch (e) {
    log.errorAndThrow(`getKeystoreMd5 failed. Original error: ${e.message}`);
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
apkSigningMethods.checkApkKeystoreMatch = async function (keytool, md5re, keystoreHash,
    pkg, apk) {
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
    log.debug("extracted!");
    // check for match
    log.debug("Printing apk md5.");
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
