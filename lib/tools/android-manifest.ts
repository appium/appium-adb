import _ from 'lodash';
import {exec} from 'teen_process';
import {log} from '../logger.js';
import {unzipFile, APKS_EXTENSION, readPackageManifest} from '../helpers.js';
import {fs, zip, tempDir, util} from '@appium/support';
import path from 'path';
import type {ADB} from '../adb.js';
import type {APKInfo, PlatformInfo, StringRecord} from './types.js';

/**
 * Extract package and main activity name from application manifest.
 *
 * @param appPath - The full path to application .apk(s) package
 * @return The parsed application info.
 * @throws {error} If there was an error while getting the data from the given
 *                 application package.
 */
export async function packageAndLaunchActivityFromManifest(
  this: ADB,
  appPath: string,
): Promise<APKInfo> {
  if (appPath.endsWith(APKS_EXTENSION)) {
    appPath = await this.extractBaseApk(appPath);
  }

  const {
    name: apkPackage,
    launchableActivity: {name: apkActivity},
  } = await readPackageManifest.bind(this)(appPath);
  log.info(`Package name: '${apkPackage}'`);
  log.info(`Main activity name: '${apkActivity}'`);
  return {apkPackage, apkActivity};
}

/**
 * Extract target SDK version from application manifest.
 *
 * @param appPath - The full path to .apk(s) package.
 * @return The version of the target SDK.
 * @throws {error} If there was an error while getting the data from the given
 *                 application package.
 */
export async function targetSdkVersionFromManifest(this: ADB, appPath: string): Promise<number> {
  log.debug(`Extracting target SDK version of '${appPath}'`);
  const originalAppPath = appPath;
  if (appPath.endsWith(APKS_EXTENSION)) {
    appPath = await this.extractBaseApk(appPath);
  }

  const {targetSdkVersion} = await readPackageManifest.bind(this)(appPath);
  if (!targetSdkVersion) {
    throw new Error(
      `Cannot extract targetSdkVersion of '${originalAppPath}'. Does ` +
        `the package manifest define it?`,
    );
  }
  return targetSdkVersion;
}

/**
 * Extract target SDK version from package information.
 *
 * @param pkg - The class name of the package installed on the device under test.
 * @param cmdOutput - Optional parameter containing the output of
 * _dumpsys package_ command. It may speed up the method execution.
 * @return The version of the target SDK.
 */
export async function targetSdkVersionUsingPKG(
  this: ADB,
  pkg: string,
  cmdOutput: string | null = null,
): Promise<number> {
  const stdout = cmdOutput || (await this.shell(['dumpsys', 'package', pkg]));
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
 * @param manifest - Full path to the initial manifest template
 * @param manifestPackage - The name of the manifest package
 * @param targetPackage - The name of the destination package
 */
export async function compileManifest(
  this: ADB,
  manifest: string,
  manifestPackage: string,
  targetPackage: string,
): Promise<void> {
  const {platform, platformPath} = await getAndroidPlatformAndPath(
    this.sdkRoot as string,
  );
  if (!platform || !platformPath) {
    throw new Error(
      'Cannot compile the manifest. The required platform does not exist (API level >= 17)',
    );
  }
  const resultPath = `${manifest}.apk`;
  const androidJarPath = path.resolve(platformPath, 'android.jar');
  if (await fs.exists(resultPath)) {
    await fs.rimraf(resultPath);
  }
  try {
    await this.initAapt2();
    // https://developer.android.com/studio/command-line/aapt2
    const binaries = this.binaries as StringRecord;
    const args = [
      'link',
      '-o',
      resultPath,
      '--manifest',
      manifest,
      '--rename-manifest-package',
      manifestPackage,
      '--rename-instrumentation-target-package',
      targetPackage,
      '-I',
      androidJarPath,
      '-v',
    ];
    log.debug(
      `Compiling the manifest using '${util.quote([binaries.aapt2, ...args])}'`,
    );
    await exec(binaries.aapt2, args);
  } catch (e) {
    log.debug(
      'Cannot compile the manifest using aapt2. Defaulting to aapt. ' +
        `Original error: ${(e as Error).message || (e as {stderr?: string}).stderr}`,
    );
    await this.initAapt();
    const binaries = this.binaries as StringRecord;
    const args = [
      'package',
      '-M',
      manifest,
      '--rename-manifest-package',
      manifestPackage,
      '--rename-instrumentation-target-package',
      targetPackage,
      '-I',
      androidJarPath,
      '-F',
      resultPath,
      '-f',
    ];
    log.debug(
      `Compiling the manifest using '${util.quote([binaries.aapt, ...args])}'`,
    );
    try {
      await exec(binaries.aapt, args);
    } catch (e1) {
      throw new Error(
        `Cannot compile the manifest. Original error: ${(e1 as Error).message || (e1 as {stderr?: string}).stderr}`,
      );
    }
  }
  log.debug(`Compiled the manifest at '${resultPath}'`);
}

/**
 * Replace/insert the specially precompiled manifest file into the
 * particular package.
 *
 * @param manifest - Full path to the precompiled manifest
 *                            created by `compileManifest` method call
 *                            without .apk extension
 * @param srcApk - Full path to the existing valid application package, where
 *                          this manifest has to be insetred to. This package
 *                          will NOT be modified.
 * @param dstApk - Full path to the resulting package.
 *                          The file will be overridden if it already exists.
 */
export async function insertManifest(
  this: ADB,
  manifest: string,
  srcApk: string,
  dstApk: string,
): Promise<void> {
  log.debug(`Inserting manifest '${manifest}', src: '${srcApk}', dst: '${dstApk}'`);
  await zip.assertValidZip(srcApk);
  await unzipFile(`${manifest}.apk`);
  const manifestName = path.basename(manifest);
  try {
    await this.initAapt();
    const binaries = this.binaries as StringRecord;
    await fs.copyFile(srcApk, dstApk);
    log.debug('Moving manifest');
    try {
      await exec(binaries.aapt, ['remove', dstApk, manifestName]);
    } catch {}
    await exec(binaries.aapt, ['add', dstApk, manifestName], {
      cwd: path.dirname(manifest),
    });
  } catch (e) {
    log.debug(
      'Cannot insert manifest using aapt. Defaulting to zip. ' +
        `Original error: ${(e as Error).message || (e as {stderr?: string}).stderr}`,
    );
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
 * @param appPath - The full path to .apk(s) package.
 * @return True if the manifest requires Internet access permission.
 */
export async function hasInternetPermissionFromManifest(
  this: ADB,
  appPath: string,
): Promise<boolean> {
  log.debug(`Checking if '${appPath}' requires internet access permission in the manifest`);
  if (appPath.endsWith(APKS_EXTENSION)) {
    appPath = await this.extractBaseApk(appPath);
  }

  const {usesPermissions} = await readPackageManifest.bind(this)(appPath);
  return usesPermissions.some((name: string) => name === 'android.permission.INTERNET');
}

// #region Private functions

/**
 * Retrieve the path to the recent installed Android platform.
 *
 * @param sdkRoot
 * @return The resulting path to the newest installed platform.
 */
export async function getAndroidPlatformAndPath(sdkRoot: string): Promise<PlatformInfo> {
  const propsPaths = await fs.glob('*/build.prop', {
    cwd: path.resolve(sdkRoot, 'platforms'),
    absolute: true,
  });
  const platformsMapping: Record<string, PlatformInfo> = {};
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
    log.warn(
      `Found zero platform folders at '${path.resolve(sdkRoot, 'platforms')}'. ` +
        `Do you have any Android SDKs installed?`,
    );
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

