import path from 'path';
import { system, fs, zip, util } from '@appium/support';
import { log } from './logger.js';
import _ from 'lodash';
import { exec } from 'teen_process';

export const APKS_EXTENSION = '.apks';
export const APK_EXTENSION = '.apk';
export const APK_INSTALL_TIMEOUT = 60000;
export const DEFAULT_ADB_EXEC_TIMEOUT = 20000; // in milliseconds
const MODULE_NAME = 'appium-adb';

/**
 * Calculates the absolute path to the current module's root folder
 *
 * @returns {Promise<string>} The full path to module root
 * @throws {Error} If the current module root folder cannot be determined
 */
const getModuleRoot = _.memoize(async function getModuleRoot () {
  let moduleRoot = path.dirname(path.resolve(__filename));
  let isAtFsRoot = false;
  while (!isAtFsRoot) {
    const manifestPath = path.join(moduleRoot, 'package.json');
    try {
      if (await fs.exists(manifestPath) &&
          JSON.parse(await fs.readFile(manifestPath, 'utf8')).name === MODULE_NAME) {
        return moduleRoot;
      }
    } catch {}
    moduleRoot = path.dirname(moduleRoot);
    isAtFsRoot = moduleRoot.length <= path.dirname(moduleRoot).length;
  }
  if (isAtFsRoot) {
    throw new Error(`Cannot find the root folder of the ${MODULE_NAME} Node.js module`);
  }
  return moduleRoot;
});

/**
 * Calculates the absolsute path to the given resource
 *
 * @param {string} relPath Relative path to the resource starting from the current module root
 * @returns {Promise<string>} The full path to the resource
 * @throws {Error} If the absolute resource path cannot be determined
 */
export const getResourcePath = _.memoize(async function getResourcePath (relPath) {
  const moduleRoot = await getModuleRoot();
  const resultPath = path.resolve(moduleRoot, relPath);
  if (!await fs.exists(resultPath)) {
    throw new Error(`Cannot find the resource '${relPath}' under the '${moduleRoot}' ` +
      `folder of ${MODULE_NAME} Node.js module`);
  }
  return resultPath;
});

/**
 * Retrieves the actual path to SDK root folder from the system environment
 *
 * @return {string|undefined} The full path to the SDK root folder
 */
export function getSdkRootFromEnv () {
  return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
}

/**
 * Retrieves the actual path to SDK root folder
 *
 * @param {string?} [customRoot]
 * @return {Promise<string>} The full path to the SDK root folder
 * @throws {Error} If either the corresponding env variable is unset or is
 * pointing to an invalid file system entry
 */
export async function requireSdkRoot (customRoot = null) {
  const sdkRoot = customRoot || getSdkRootFromEnv();
  const docMsg = 'Read https://developer.android.com/studio/command-line/variables for more details';
  if (_.isEmpty(sdkRoot)) {
    throw new Error(`Neither ANDROID_HOME nor ANDROID_SDK_ROOT environment variable was exported. ${docMsg}`);
  }

  if (!await fs.exists(/** @type {string} */ (sdkRoot))) {
    throw new Error(`The Android SDK root folder '${sdkRoot}' does not exist on the local file system. ${docMsg}`);
  }
  const stats = await fs.stat(/** @type {string} */ (sdkRoot));
  if (!stats.isDirectory()) {
    throw new Error(`The Android SDK root '${sdkRoot}' must be a folder. ${docMsg}`);
  }
  return /** @type {string} */ (sdkRoot);
}

/**
 * @param {string} zipPath
 * @param {string} dstRoot
 */
export async function unzipFile (zipPath, dstRoot = path.dirname(zipPath)) {
  log.debug(`Unzipping '${zipPath}' to '${dstRoot}'`);
  await zip.assertValidZip(zipPath);
  await zip.extractAllTo(zipPath, dstRoot);
  log.debug('Unzip successful');
}

/** @type {() => Promise<string>} */
export const getJavaHome = _.memoize(async function getJavaHome () {
  const result = process.env.JAVA_HOME;
  if (!result) {
    throw new Error('The JAVA_HOME environment variable is not set for the current process');
  }
  if (!await fs.exists(result)) {
    throw new Error(`The JAVA_HOME location '${result}' must exist`);
  }
  const stats = await fs.stat(result);
  if (!stats.isDirectory()) {
    throw new Error(`The JAVA_HOME location '${result}' must be a valid folder`);
  }
  return result;
});

/** @type {() => Promise<string>} */
export const getJavaForOs = _.memoize(async function getJavaForOs () {
  let javaHome;
  let errMsg;
  try {
    javaHome = await getJavaHome();
  } catch (err) {
    errMsg = err.message;
  }
  const executableName = `java${system.isWindows() ? '.exe' : ''}`;
  if (javaHome) {
    const resultPath = path.resolve(javaHome, 'bin', executableName);
    if (await fs.exists(resultPath)) {
      return resultPath;
    }
  }
  try {
    return await fs.which(executableName);
  } catch {}
  throw new Error(`The '${executableName}' binary could not be found ` +
    `neither in PATH nor under JAVA_HOME (${javaHome ? path.resolve(javaHome, 'bin') : errMsg})`);
});

/**
 * Transforms given options into the list of `adb install.install-multiple` command arguments
 *
 * @param {number} apiLevel - The current API level
 * @param {InstallOptions} [options={}] - The options mapping to transform
 * @returns {string[]} The array of arguments
 */
export function buildInstallArgs (apiLevel, options = {}) {
  const result = [];

  if (!util.hasValue(options.replace) || options.replace) {
    result.push('-r');
  }
  if (options.allowTestPackages) {
    result.push('-t');
  }
  if (options.useSdcard) {
    result.push('-s');
  }
  if (options.grantPermissions) {
    if (apiLevel < 23) {
      log.debug(`Skipping permissions grant option, since ` +
                `the current API level ${apiLevel} does not support applications ` +
                `permissions customization`);
    } else {
      result.push('-g');
    }
  }
  // For multiple-install
  if (options.partialInstall) {
    result.push('-p');
  }

  return result;
}

/**
 * Extracts various package manifest details
 * from the given application file.
 *
 * @this {import('./adb.js').ADB}
 * @param {string} apkPath Full path to the application file.
 * @returns {Promise<import('./tools/types').ApkManifest>}
 */
export async function readPackageManifest(apkPath) {
  await this.initAapt2();
  const aapt2Binary = (/** @type {import('./tools/types').StringRecord} */ (this.binaries)).aapt2;

  const args = ['dump', 'badging', apkPath];
  log.debug(`Reading package manifest: '${util.quote([aapt2Binary, ...args])}'`);
  /** @type {string} */
  let stdout;
  try {
    ({stdout} = await exec(aapt2Binary, args));
  } catch (e) {
    const prefix = `Cannot read the manifest from '${apkPath}'`;
    const suffix = `Original error: ${e.stderr || e.message}`;
    if (_.includes(e.stderr, `Unable to open 'badging'`)) {
      throw new Error(`${prefix}. Update build tools to use a newer aapt2 version. ${suffix}`);
    }
    throw new Error(`${prefix}. ${suffix}`);
  }

  const extractValue = (
    /** @type {string} */ line,
    /** @type {RegExp} */ propPattern,
    /** @type {((x: string) => any)|undefined} */ valueTransformer
  ) => {
    const match = propPattern.exec(line);
    if (match) {
      return valueTransformer ? valueTransformer(match[1]) : match[1];
    }
  };
  const extractArray = (
    /** @type {string} */ line,
    /** @type {RegExp} */ propPattern,
    /** @type {((x: string) => any)|undefined} */ valueTransformer
  ) => {
    let match;
    const resultArray = [];
    while ((match = propPattern.exec(line))) {
      resultArray.push(valueTransformer ? valueTransformer(match[1]) : match[1]);
    }
    return resultArray;
  };

  const toInt = (/** @type {string} */ x) => parseInt(x, 10);

  /** @type {import('./tools/types').ApkManifest} */
  const result = {
    name: '',
    versionCode: 0,
    minSdkVersion: 0,
    compileSdkVersion: 0,
    usesPermissions: [],
    launchableActivity: {
      name: '',
    },
    architectures: [],
    locales: [],
    densities: [],
  };
  for (const line of stdout.split('\n')) {
    if (line.startsWith('package:')) {
      for (const [name, pattern, transformer] of [
        ['name', /name='([^']+)'/],
        ['versionCode', /versionCode='([^']+)'/, toInt],
        ['versionName', /versionName='([^']+)'/],
        ['platformBuildVersionName', /platformBuildVersionName='([^']+)'/],
        ['platformBuildVersionCode', /platformBuildVersionCode='([^']+)'/, toInt],
        ['compileSdkVersion', /compileSdkVersion='([^']+)'/, toInt],
        ['compileSdkVersionCodename', /compileSdkVersionCodename='([^']+)'/],
      ]) {
        const value = extractValue(
          line,
          /** @type {RegExp} */ (pattern),
          /** @type {((x: string) => any)|undefined} */ (transformer)
        );
        if (!_.isUndefined(value)) {
          result[/** @type {string} */ (name)] = value;
        }
      }
    } else if (line.startsWith('sdkVersion:') || line.startsWith('minSdkVersion:')) {
      const value = extractValue(line, /[sS]dkVersion:'([^']+)'/, toInt);
      if (value) {
        result.minSdkVersion = value;
      }
    } else if (line.startsWith('targetSdkVersion:')) {
      const value = extractValue(line, /targetSdkVersion:'([^']+)'/, toInt);
      if (value) {
        result.targetSdkVersion = value;
      }
    } else if (line.startsWith('uses-permission:')) {
      const value = extractValue(line, /name='([^']+)'/);
      if (value) {
        result.usesPermissions.push(/** @type {string} */ (value));
      }
    } else if (line.startsWith('launchable-activity:')) {
      for (const [name, pattern] of [
        ['name', /name='([^']+)'/],
        ['label', /label='([^']+)'/],
        ['icon', /icon='([^']+)'/],
      ]) {
        const value = extractValue(line, /** @type {RegExp} */ (pattern));
        if (value) {
          result.launchableActivity[/** @type {string} */ (name)] = value;
        }
      }
    } else if (line.startsWith('locales:')) {
      result.locales = /** @type {string[]} */ (extractArray(line, /'([^']+)'/g));
    } else if (line.startsWith('native-code:')) {
      result.architectures = /** @type {string[]} */ (extractArray(line, /'([^']+)'/g));
    } else if (line.startsWith('densities:')) {
      result.densities = /** @type {number[]} */ (extractArray(line, /'([^']+)'/g, toInt));
    }
  }
  return result;
}

/**
 * @typedef {Object} InstallOptions
 * @property {boolean} [allowTestPackages=false] - Set to true in order to allow test
 *                                                 packages installation.
 * @property {boolean} [useSdcard=false] - Set to true to install the app on sdcard
 *                                         instead of the device memory.
 * @property {boolean} [grantPermissions=false] - Set to true in order to grant all the
 *                                                permissions requested in the application's manifest
 *                                                automatically after the installation is completed
 *                                                under Android 6+.
 * @property {boolean} [replace=true] - Set it to false if you don't want
 *                                      the application to be upgraded/reinstalled
 *                                      if it is already present on the device.
 * @property {boolean} [partialInstall=false] - Install apks partially. It is used for 'install-multiple'.
 *                                             https://android.stackexchange.com/questions/111064/what-is-a-partial-application-install-via-adb
 */

