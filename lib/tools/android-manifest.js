import _ from 'lodash';
import { exec } from 'teen_process';
import { log } from '../logger.js';
import {
  unzipFile,
  APKS_EXTENSION,
  readPackageManifest,
} from '../helpers.js';
import { fs, zip, tempDir, util } from '@appium/support';
import path from 'path';

/**
 * Extract package and main activity name from application manifest.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} appPath - The full path to application .apk(s) package
 * @return {Promise<import('./types').APKInfo>} The parsed application info.
 * @throws {error} If there was an error while getting the data from the given
 *                 application package.
 */
export async function packageAndLaunchActivityFromManifest (appPath) {
  if (appPath.endsWith(APKS_EXTENSION)) {
    appPath = await this.extractBaseApk(appPath);
  }

  const {
    name: apkPackage,
    launchableActivity: {
      name: apkActivity,
    },
  } = await readPackageManifest.bind(this)(appPath);
  log.info(`Package name: '${apkPackage}'`);
  log.info(`Main activity name: '${apkActivity}'`);
  return {apkPackage, apkActivity};
}

/**
 * Extract target SDK version from application manifest.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} appPath - The full path to .apk(s) package.
 * @return {Promise<number>} The version of the target SDK.
 * @throws {error} If there was an error while getting the data from the given
 *                 application package.
 */
export async function targetSdkVersionFromManifest (appPath) {
  log.debug(`Extracting target SDK version of '${appPath}'`);
  const originalAppPath = appPath;
  if (appPath.endsWith(APKS_EXTENSION)) {
    appPath = await this.extractBaseApk(appPath);
  }

  const {targetSdkVersion} = await readPackageManifest.bind(this)(appPath);
  if (!targetSdkVersion) {
    throw new Error(
      `Cannot extract targetSdkVersion of '${originalAppPath}'. Does ` +
      `the package manifest define it?`
    );
  }
  return targetSdkVersion;
}

/**
 * Extract target SDK version from package information.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The class name of the package installed on the device under test.
 * @param {string?} [cmdOutput=null] - Optional parameter containing the output of
 * _dumpsys package_ command. It may speed up the method execution.
 * @return {Promise<number>} The version of the target SDK.
 */
export async function targetSdkVersionUsingPKG (pkg, cmdOutput = null) {
  const stdout = cmdOutput || await this.shell(['dumpsys', 'package', pkg]);
  const targetSdkVersionMatch = new RegExp(/targetSdk=([^\s\s]+)/g).exec(stdout);
  return targetSdkVersionMatch && targetSdkVersionMatch.length >= 2
    ? parseInt(targetSdkVersionMatch[1], 10)
    : 0;
}

/**
 * Create binary representation of package manifest (usually AndroidManifest.xml).
 * `${manifest}.apk` file will be created as the result of this method
 * containing the compiled manifest.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} manifest - Full path to the initial manifest template
 * @param {string} manifestPackage - The name of the manifest package
 * @param {string} targetPackage - The name of the destination package
 */
export async function compileManifest (manifest, manifestPackage, targetPackage) {
  const {platform, platformPath} = await getAndroidPlatformAndPath(/** @type {string} */ (this.sdkRoot));
  if (!platform || !platformPath) {
    throw new Error('Cannot compile the manifest. The required platform does not exist (API level >= 17)');
  }
  const resultPath = `${manifest}.apk`;
  const androidJarPath = path.resolve(platformPath, 'android.jar');
  if (await fs.exists(resultPath)) {
    await fs.rimraf(resultPath);
  }
  try {
    await this.initAapt2();
    // https://developer.android.com/studio/command-line/aapt2
    const args = [
      'link',
      '-o', resultPath,
      '--manifest', manifest,
      '--rename-manifest-package', manifestPackage,
      '--rename-instrumentation-target-package', targetPackage,
      '-I', androidJarPath,
      '-v',
    ];
    log.debug(`Compiling the manifest using '${util.quote([
      (/** @type {import('./types').StringRecord} */ (this.binaries)).aapt2,
      ...args
    ])}'`);
    await exec((/** @type {import('./types').StringRecord} */ (this.binaries)).aapt2, args);
  } catch (e) {
    log.debug('Cannot compile the manifest using aapt2. Defaulting to aapt. ' +
      `Original error: ${e.stderr || e.message}`);
    await this.initAapt();
    const args = [
      'package',
      '-M', manifest,
      '--rename-manifest-package', manifestPackage,
      '--rename-instrumentation-target-package', targetPackage,
      '-I', androidJarPath,
      '-F', resultPath,
      '-f',
    ];
    log.debug(`Compiling the manifest using '${util.quote([
      (/** @type {import('./types').StringRecord} */ (this.binaries)).aapt,
      ...args
    ])}'`);
    try {
      await exec((/** @type {import('./types').StringRecord} */ (this.binaries)).aapt, args);
    } catch (e1) {
      throw new Error(`Cannot compile the manifest. Original error: ${e1.stderr || e1.message}`);
    }
  }
  log.debug(`Compiled the manifest at '${resultPath}'`);
}

/**
 * Replace/insert the specially precompiled manifest file into the
 * particular package.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} manifest - Full path to the precompiled manifest
 *                            created by `compileManifest` method call
 *                            without .apk extension
 * @param {string} srcApk - Full path to the existing valid application package, where
 *                          this manifest has to be insetred to. This package
 *                          will NOT be modified.
 * @param {string} dstApk - Full path to the resulting package.
 *                          The file will be overridden if it already exists.
 */
export async function insertManifest (manifest, srcApk, dstApk) {
  log.debug(`Inserting manifest '${manifest}', src: '${srcApk}', dst: '${dstApk}'`);
  await zip.assertValidZip(srcApk);
  await unzipFile(`${manifest}.apk`);
  const manifestName = path.basename(manifest);
  try {
    await this.initAapt();
    await fs.copyFile(srcApk, dstApk);
    log.debug('Moving manifest');
    try {
      await exec((/** @type {import('./types').StringRecord} */ (this.binaries)).aapt, [
        'remove', dstApk, manifestName
      ]);
    } catch {}
    await exec((/** @type {import('./types').StringRecord} */ (this.binaries)).aapt, [
      'add', dstApk, manifestName
    ], {cwd: path.dirname(manifest)});
  } catch (e) {
    log.debug('Cannot insert manifest using aapt. Defaulting to zip. ' +
      `Original error: ${e.stderr || e.message}`);
    const tmpRoot = await tempDir.openDir();
    try {
      // Unfortunately NodeJS does not provide any reliable methods
      // to replace files inside zip archives without loading the
      // whole archive content into RAM
      log.debug(`Extracting the source apk at '${srcApk}'`);
      await zip.extractAllTo(srcApk, tmpRoot);
      log.debug('Moving manifest');
      await fs.mv(manifest, path.resolve(tmpRoot, manifestName));
      log.debug(`Collecting the destination apk at '${dstApk}'`);
      await zip.toArchive(dstApk, {
        cwd: tmpRoot,
      });
    } finally {
      await fs.rimraf(tmpRoot);
    }
  }
  log.debug(`Manifest insertion into '${dstApk}' is completed`);
}

/**
 * Check whether package manifest contains Internet permissions.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} appPath - The full path to .apk(s) package.
 * @return {Promise<boolean>} True if the manifest requires Internet access permission.
 */
export async function hasInternetPermissionFromManifest (appPath) {
  log.debug(`Checking if '${appPath}' requires internet access permission in the manifest`);
  if (appPath.endsWith(APKS_EXTENSION)) {
    appPath = await this.extractBaseApk(appPath);
  }

  const {usesPermissions} = await readPackageManifest.bind(this)(appPath);
  return usesPermissions.some((/** @type {string} */ name) => name === 'android.permission.INTERNET');
}

// #region Private functions

/**
 * Retrieve the path to the recent installed Android platform.
 *
 * @param {string} sdkRoot
 * @return {Promise<import('./types').PlatformInfo>} The resulting path to the newest installed platform.
 */
export async function getAndroidPlatformAndPath (sdkRoot) {
  const propsPaths = await fs.glob('*/build.prop', {
    cwd: path.resolve(sdkRoot, 'platforms'),
    absolute: true,
  });
  /** @type {Record<string, import('./types').PlatformInfo>} */
  const platformsMapping = {};
  for (const propsPath of propsPaths) {
    const propsContent = await fs.readFile(propsPath, 'utf-8');
    const platformPath = path.dirname(propsPath);
    const platform = path.basename(platformPath);
    const match = /ro\.build\.version\.sdk=(\d+)/.exec(propsContent);
    if (!match) {
      log.warn(`Cannot read the SDK version from '${propsPath}'. Skipping '${platform}'`);
      continue;
    }
    platformsMapping[parseInt(match[1], 10)] = {
      platform,
      platformPath,
    };
  }
  if (_.isEmpty(platformsMapping)) {
    log.warn(`Found zero platform folders at '${path.resolve(sdkRoot, 'platforms')}'. ` +
      `Do you have any Android SDKs installed?`);
    return {
      platform: null,
      platformPath: null,
    };
  }

  const recentSdkVersion = _.keys(platformsMapping).sort().reverse()[0];
  const result = platformsMapping[recentSdkVersion];
  log.debug(`Found the most recent Android platform: ${JSON.stringify(result)}`);
  return result;
}

// #endregion
