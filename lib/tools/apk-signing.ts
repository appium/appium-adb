import _ from 'lodash';
import _fs from 'fs';
import {exec, type ExecError} from 'teen_process';
import path from 'path';
import {log} from '../logger.js';
import {tempDir, system, mkdirp, fs, util, zip} from '@appium/support';
import {LRUCache} from 'lru-cache';
import {getJavaForOs, getJavaHome, APKS_EXTENSION, getResourcePath} from '../helpers.js';
import type {ADB} from '../adb.js';
import type {StringRecord, SignedAppCacheValue, CertCheckOptions, KeystoreHash} from './types.js';

const DEFAULT_PRIVATE_KEY = path.join('keys', 'testkey.pk8');
const DEFAULT_CERTIFICATE = path.join('keys', 'testkey.x509.pem');
const BUNDLETOOL_TUTORIAL = 'https://developer.android.com/studio/command-line/bundletool';
const APKSIGNER_VERIFY_FAIL = 'DOES NOT VERIFY';
const SHA1 = 'sha1';
const SHA256 = 'sha256';
const SHA512 = 'sha512';
const MD5 = 'md5';
const DEFAULT_CERT_HASH: KeystoreHash = {
  [SHA256]: 'a40da80a59d170caa950cf15c18c454d47a39b26989d8b640ecd745ba71bf5dc',
};
const JAVA_PROPS_INIT_ERROR = 'java.lang.Error: Properties init';
const SIGNED_APPS_CACHE = new LRUCache<string, SignedAppCacheValue>({
  max: 30,
});

/**
 * Execute apksigner utility with given arguments.
 *
 * @param args - The list of tool arguments.
 * @returns - Command stdout
 * @throws If apksigner binary is not present on the local file system
 *                 or the return code is not equal to zero.
 */
export async function executeApksigner(this: ADB, args: string[]): Promise<string> {
  const apkSignerJar = await getApksignerForOs.bind(this)();
  const fullCmd = [await getJavaForOs(), '-Xmx1024M', '-Xss1m', '-jar', apkSignerJar, ...args];
  log.debug(`Starting apksigner: ${util.quote(fullCmd)}`);
  // It is necessary to specify CWD explicitly; see https://github.com/appium/appium/issues/14724#issuecomment-737446715
  const {stdout, stderr} = await exec(fullCmd[0], fullCmd.slice(1), {
    cwd: path.dirname(apkSignerJar),
    // @ts-ignore This works
    windowsVerbatimArguments: system.isWindows(),
  });
  for (const [name, stream] of [
    ['stdout', stdout],
    ['stderr', stderr],
  ] as const) {
    if (!_.trim(stream)) {
      continue;
    }

    if (name === 'stdout') {
      // Make the output less talkative
      const filteredStream = stream
        .split('\n')
        .filter((line) => !line.includes('WARNING:'))
        .join('\n');
      log.debug(`apksigner ${name}: ${filteredStream}`);
    } else {
      log.debug(`apksigner ${name}: ${stream}`);
    }
  }
  return stdout;
}

/**
 * (Re)sign the given apk file on the local file system with the default certificate.
 *
 * @param apk - The full path to the local apk file.
 * @throws If signing fails.
 */
export async function signWithDefaultCert(this: ADB, apk: string): Promise<void> {
  log.debug(`Signing '${apk}' with default cert`);
  if (!(await fs.exists(apk))) {
    throw new Error(`${apk} file doesn't exist.`);
  }

  const args = [
    'sign',
    '--key',
    await getResourcePath(DEFAULT_PRIVATE_KEY),
    '--cert',
    await getResourcePath(DEFAULT_CERTIFICATE),
    apk,
  ];
  try {
    await this.executeApksigner(args);
  } catch (e) {
    const err = e as ExecError;
    throw new Error(
      `Could not sign '${apk}' with the default certificate. ` +
        `Original error: ${err.stderr || err.stdout || err.message}`,
    );
  }
}

/**
 * (Re)sign the given apk file on the local file system with a custom certificate.
 *
 * @param apk - The full path to the local apk file.
 * @throws If signing fails.
 */
export async function signWithCustomCert(this: ADB, apk: string): Promise<void> {
  log.debug(`Signing '${apk}' with custom cert`);
  if (!(await fs.exists(this.keystorePath as string))) {
    throw new Error(`Keystore: ${this.keystorePath} doesn't exist.`);
  }
  if (!(await fs.exists(apk))) {
    throw new Error(`'${apk}' doesn't exist.`);
  }

  try {
    await this.executeApksigner([
      'sign',
      '--ks',
      this.keystorePath as string,
      '--ks-key-alias',
      this.keyAlias as string,
      '--ks-pass',
      `pass:${this.keystorePassword}`,
      '--key-pass',
      `pass:${this.keyPassword}`,
      apk,
    ]);
  } catch (err) {
    const error = err as ExecError;
    log.warn(
      `Cannot use apksigner tool for signing. Defaulting to jarsigner. ` +
        `Original error: ${error.stderr || error.stdout || error.message}`,
    );
    try {
      if (await unsignApk(apk)) {
        log.debug(`'${apk}' has been successfully unsigned`);
      } else {
        log.debug(`'${apk}' does not need to be unsigned`);
      }
      const jarsigner = path.resolve(
        await getJavaHome(),
        'bin',
        `jarsigner${system.isWindows() ? '.exe' : ''}`,
      );
      const fullCmd: string[] = [
        jarsigner,
        '-sigalg',
        'MD5withRSA',
        '-digestalg',
        'SHA1',
        '-keystore',
        this.keystorePath as string,
        '-storepass',
        this.keystorePassword as string,
        '-keypass',
        this.keyPassword as string,
        apk,
        this.keyAlias as string,
      ];
      log.debug(`Starting jarsigner: ${util.quote(fullCmd)}`);
      await exec(fullCmd[0], fullCmd.slice(1), {
        // @ts-ignore This works
        windowsVerbatimArguments: system.isWindows(),
      });
    } catch (e) {
      const execErr = e as ExecError;
      throw new Error(
        `Could not sign with custom certificate. ` +
          `Original error: ${execErr.stderr || execErr.message}`,
      );
    }
  }
}

/**
 * (Re)sign the given apk file on the local file system with either
 * custom or default certificate based on _this.useKeystore_ property value
 * and Zip-aligns it after signing.
 *
 * @param appPath - The full path to the local .apk(s) file.
 * @throws If signing fails.
 */
export async function sign(this: ADB, appPath: string): Promise<void> {
  if (appPath.endsWith(APKS_EXTENSION)) {
    let message = 'Signing of .apks-files is not supported. ';
    if (this.useKeystore) {
      message +=
        'Consider manual application bundle signing with the custom keystore ' +
        `like it is described at ${BUNDLETOOL_TUTORIAL}`;
    } else {
      message +=
        `Consider manual application bundle signing with the key at '${DEFAULT_PRIVATE_KEY}' ` +
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
 * @param apk - The full path to the local apk file.
 * @returns True if the apk has been successfully aligned
 * or false if the apk has been already aligned.
 * @throws If zip-align fails.
 */
export async function zipAlignApk(this: ADB, apk: string): Promise<boolean> {
  await this.initZipAlign();
  try {
    await exec((this.binaries as StringRecord).zipalign as string, ['-c', '4', apk]);
    log.debug(`${apk}' is already zip-aligned. Doing nothing`);
    return false;
  } catch {
    log.debug(`'${apk}' is not zip-aligned. Aligning`);
  }
  try {
    await fs.access(apk, _fs.constants.W_OK);
  } catch {
    throw new Error(
      `The file at '${apk}' is not writeable. ` +
        `Please grant write permissions to this file or to its parent folder '${path.dirname(apk)}' ` +
        `for the Appium process, so it can zip-align the file`,
    );
  }
  const alignedApk = await tempDir.path({prefix: 'appium', suffix: '.tmp'});
  await mkdirp(path.dirname(alignedApk));
  try {
    await exec((this.binaries as StringRecord).zipalign as string, ['-f', '4', apk, alignedApk]);
    await fs.mv(alignedApk, apk, {mkdirp: true});
    return true;
  } catch (e) {
    const err = e as Error;
    if (await fs.exists(alignedApk)) {
      await fs.unlink(alignedApk);
    }
    throw new Error(
      `zipAlignApk failed. Original error: ${err.message || (err as ExecError).stderr}`,
    );
  }
}

/**
 * Check if the app is already signed with the default Appium certificate.
 *
 * @param appPath - The full path to the local .apk(s) file.
 * @param pkg - The name of application package.
 * @param opts - Certificate checking options
 * @returns True if given application is already signed.
 */
export async function checkApkCert(
  this: ADB,
  appPath: string,
  pkg: string,
  opts: CertCheckOptions = {},
): Promise<boolean> {
  log.debug(`Checking app cert for ${appPath}`);
  if (!(await fs.exists(appPath))) {
    log.debug(`'${appPath}' does not exist`);
    return false;
  }

  let actualAppPath = appPath;
  if (path.extname(appPath) === APKS_EXTENSION) {
    actualAppPath = await this.extractBaseApk(appPath);
  }

  const hashMatches = (apksignerOutput: string, expectedHashes: KeystoreHash): boolean => {
    for (const [name, value] of _.toPairs(expectedHashes)) {
      if (value && new RegExp(`digest:\\s+${value}\\b`, 'i').test(apksignerOutput)) {
        log.debug(`${name} hash did match for '${path.basename(actualAppPath)}'`);
        return true;
      }
    }
    return false;
  };

  const {requireDefaultCert = true} = opts;

  const appHash = await fs.hash(actualAppPath);
  if (SIGNED_APPS_CACHE.has(appHash)) {
    log.debug(`Using the previously cached signature entry for '${path.basename(actualAppPath)}'`);
    const cached = SIGNED_APPS_CACHE.get(appHash);
    if (cached) {
      const {keystorePath, output, expected} = cached;
      if ((this.useKeystore && this.keystorePath === keystorePath) || !this.useKeystore) {
        return (!this.useKeystore && !requireDefaultCert) || hashMatches(output, expected);
      }
    }
  }

  const expected = this.useKeystore ? await this.getKeystoreHash() : DEFAULT_CERT_HASH;
  try {
    await getApksignerForOs.bind(this)();
    const output = await this.executeApksigner(['verify', '--print-certs', actualAppPath]);
    const hasMatch = hashMatches(output, expected);
    if (hasMatch) {
      log.info(
        `'${actualAppPath}' is signed with the ` +
          `${this.useKeystore ? 'keystore' : 'default'} certificate`,
      );
    } else {
      log.info(
        `'${actualAppPath}' is signed with a ` +
          `non-${this.useKeystore ? 'keystore' : 'default'} certificate`,
      );
    }
    const isSigned = (!this.useKeystore && !requireDefaultCert) || hasMatch;
    if (isSigned) {
      SIGNED_APPS_CACHE.set(appHash, {
        output,
        expected,
        keystorePath: this.keystorePath as string,
      });
    }
    return isSigned;
  } catch (err) {
    const error = err as ExecError;
    // check if there is no signature
    if (_.includes(error.stderr, APKSIGNER_VERIFY_FAIL)) {
      log.info(`'${actualAppPath}' is not signed`);
      return false;
    }
    const errMsg = error.stderr || error.stdout || error.message;
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
      log.warn(`Assuming '${actualAppPath}' is already signed and continuing anyway`);
      return true;
    }
    throw new Error(
      `Cannot verify the signature of '${actualAppPath}'. ` + `Original error: ${errMsg}`,
    );
  }
}

/**
 * Retrieve the the hash of the given keystore.
 *
 * @returns
 * @throws If getting keystore hash fails.
 */
export async function getKeystoreHash(this: ADB): Promise<KeystoreHash> {
  log.debug(`Getting hash of the '${this.keystorePath}' keystore`);
  const keytool = path.resolve(
    await getJavaHome(),
    'bin',
    `keytool${system.isWindows() ? '.exe' : ''}`,
  );
  if (!(await fs.exists(keytool))) {
    throw new Error(`The keytool utility cannot be found at '${keytool}'`);
  }
  const args: string[] = [
    '-v',
    '-list',
    '-alias',
    this.keyAlias as string,
    '-keystore',
    this.keystorePath as string,
    '-storepass',
    this.keystorePassword as string,
  ];
  log.info(`Running '${keytool}' with arguments: ${util.quote(args)}`);
  try {
    const {stdout} = await exec(keytool, args, {
      // @ts-ignore This property is ok
      windowsVerbatimArguments: system.isWindows(),
    });
    const result: KeystoreHash = {};
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
    const err = e as ExecError;
    throw new Error(
      `Cannot get the hash of '${this.keystorePath}' keystore. ` +
        `Original error: ${err.stderr || err.message}`,
    );
  }
}

// #region Private functions

/**
 * Get the absolute path to apksigner tool
 *
 * @returns An absolute path to apksigner tool.
 * @throws If the tool is not present on the local file system.
 */
export async function getApksignerForOs(this: ADB): Promise<string> {
  return await this.getBinaryFromSdkRoot('apksigner.jar');
}

/**
 * Unsigns the given apk by removing the
 * META-INF folder recursively from the archive.
 * !!! The function overwrites the given apk after successful unsigning !!!
 *
 * @param apkPath The path to the apk
 * @returns `true` if the apk has been successfully
 * unsigned and overwritten
 * @throws if there was an error during the unsign operation
 */
export async function unsignApk(apkPath: string): Promise<boolean> {
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
