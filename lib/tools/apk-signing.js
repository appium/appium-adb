import { exec } from 'teen_process';
import path from 'path';
import log from '../logger.js';
import { tempDir, system, mkdirp, fs, zip } from 'appium-support';
import { getJavaForOs, getJavaHome } from '../helpers.js';

let apkSigningMethods = {};


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
    log.errorAndThrow(`Could not sign with default ceritficate. Original error ${e.message}`);
  }
};

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
    log.errorAndThrow(`Could not sign with custom ceritficate. Original error ${e.message}`);
  }
};

apkSigningMethods.sign = async function (apk) {
  if (this.useKeystore) {
    await this.signWithCustomCert(apk);
  } else {
    await this.signWithDefaultCert(apk);
  }
  await this.zipAlignApk(apk);
};

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

// returns true when already signed, false otherwise.
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
