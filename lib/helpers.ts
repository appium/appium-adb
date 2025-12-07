import path from 'path';
import {system, fs, zip, util} from '@appium/support';
import {log} from './logger.js';
import _ from 'lodash';
import {exec, type ExecError} from 'teen_process';
import type {ADB} from './adb.js';
import type {ApkManifest} from './tools/types.js';

// Declare __filename for CommonJS compatibility
declare const __filename: string;

// Constants
export const APKS_EXTENSION = '.apks';
export const APK_EXTENSION = '.apk';
export const APK_INSTALL_TIMEOUT = 60000;
export const DEFAULT_ADB_EXEC_TIMEOUT = 20000; // in milliseconds
const MODULE_NAME = 'appium-adb';

// Public methods

/**
 * Calculates the absolute path to the given resource
 */
export const getResourcePath = _.memoize(async function getResourcePath(
  relPath: string,
): Promise<string> {
  const moduleRoot = await getModuleRoot();
  const resultPath = path.resolve(moduleRoot, relPath);
  if (!(await fs.exists(resultPath))) {
    throw new Error(
      `Cannot find the resource '${relPath}' under the '${moduleRoot}' ` +
        `folder of ${MODULE_NAME} Node.js module`,
    );
  }
  return resultPath;
});

/**
 * Retrieves the actual path to SDK root folder from the system environment
 */
export function getSdkRootFromEnv(): string | undefined {
  return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
}

/**
 * Retrieves the actual path to SDK root folder
 */
export async function requireSdkRoot(customRoot: string | null = null): Promise<string> {
  const sdkRoot = customRoot || getSdkRootFromEnv();
  const docMsg =
    'Read https://developer.android.com/studio/command-line/variables for more details';
  if (!sdkRoot || _.isEmpty(sdkRoot)) {
    throw new Error(
      `Neither ANDROID_HOME nor ANDROID_SDK_ROOT environment variable was exported. ${docMsg}`,
    );
  }
  if (!(await fs.exists(sdkRoot))) {
    throw new Error(
      `The Android SDK root folder '${sdkRoot}' does not exist on the local file system. ${docMsg}`,
    );
  }

  const stats = await fs.stat(sdkRoot);
  if (!stats.isDirectory()) {
    throw new Error(`The Android SDK root '${sdkRoot}' must be a folder. ${docMsg}`);
  }
  return sdkRoot;
}

/**
 * @param zipPath
 * @param dstRoot
 */
export async function unzipFile(
  zipPath: string,
  dstRoot: string = path.dirname(zipPath),
): Promise<void> {
  log.debug(`Unzipping '${zipPath}' to '${dstRoot}'`);
  await zip.assertValidZip(zipPath);
  await zip.extractAllTo(zipPath, dstRoot);
  log.debug('Unzip successful');
}

export const getJavaHome = _.memoize(async function getJavaHome(): Promise<string> {
  const result = process.env.JAVA_HOME;
  if (!result) {
    throw new Error('The JAVA_HOME environment variable is not set for the current process');
  }
  if (!(await fs.exists(result))) {
    throw new Error(`The JAVA_HOME location '${result}' must exist`);
  }
  const stats = await fs.stat(result);
  if (!stats.isDirectory()) {
    throw new Error(`The JAVA_HOME location '${result}' must be a valid folder`);
  }
  return result;
});

export const getJavaForOs = _.memoize(async function getJavaForOs(): Promise<string> {
  let javaHome: string | undefined;
  let errMsg: string | undefined;
  try {
    javaHome = await getJavaHome();
  } catch (err: unknown) {
    const error = err as Error;
    errMsg = error.message;
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
  } catch {
    // Ignore and throw custom error below
  }
  throw new Error(
    `The '${executableName}' binary could not be found ` +
      `neither in PATH nor under JAVA_HOME (${javaHome ? path.resolve(javaHome, 'bin') : errMsg})`,
  );
});

/**
 * Transforms given options into the list of `adb install.install-multiple` command arguments
 */
export function buildInstallArgs(
  apiLevel: number,
  options: BuildInstallArgsOptions = {},
): string[] {
  const result: string[] = [];

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
      log.debug(
        `Skipping permissions grant option, since ` +
          `the current API level ${apiLevel} does not support applications ` +
          `permissions customization`,
      );
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
 */
export async function readPackageManifest(this: ADB, apkPath: string): Promise<ApkManifest> {
  await this.initAapt2();
  const aapt2Binary = this.binaries?.aapt2;
  if (!aapt2Binary) {
    throw new Error('aapt2 binary is not available');
  }

  const args = ['dump', 'badging', apkPath];
  log.debug(`Reading package manifest: '${util.quote([aapt2Binary, ...args])}'`);
  let stdout: string;
  try {
    ({stdout} = await exec(aapt2Binary, args));
  } catch (e: unknown) {
    const error = e as ExecError;
    const prefix = `Cannot read the manifest from '${apkPath}'`;
    const suffix = `Original error: ${error.stderr || error.message}`;
    if (error.stderr && _.includes(error.stderr, `Unable to open 'badging'`)) {
      throw new Error(`${prefix}. Update build tools to use a newer aapt2 version. ${suffix}`);
    }
    throw new Error(`${prefix}. ${suffix}`);
  }

  const extractValue = (
    line: string,
    propPattern: RegExp,
    valueTransformer: ((x: string) => any) | null,
  ): any => {
    const match = propPattern.exec(line);
    if (match) {
      return valueTransformer ? valueTransformer(match[1]) : match[1];
    }
    return undefined;
  };
  const extractArray = (
    line: string,
    propPattern: RegExp,
    valueTransformer: ((x: string) => any) | null,
  ): any[] => {
    let match: RegExpExecArray | null;
    const resultArray: any[] = [];
    while ((match = propPattern.exec(line))) {
      resultArray.push(valueTransformer ? valueTransformer(match[1]) : match[1]);
    }
    return resultArray;
  };

  const toInt = (x: string): number => parseInt(x, 10);

  const result: ApkManifest = {
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
        ['name', /name='([^']+)'/, null],
        ['versionCode', /versionCode='([^']+)'/, toInt],
        ['versionName', /versionName='([^']+)'/, null],
        ['platformBuildVersionName', /platformBuildVersionName='([^']+)'/, null],
        ['platformBuildVersionCode', /platformBuildVersionCode='([^']+)'/, toInt],
        ['compileSdkVersion', /compileSdkVersion='([^']+)'/, toInt],
        ['compileSdkVersionCodename', /compileSdkVersionCodename='([^']+)'/, null],
      ] as const) {
        const value = extractValue(line, pattern, transformer);
        if (!_.isUndefined(value)) {
          (result as Record<string, any>)[name] = value;
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
      const value = extractValue(line, /name='([^']+)'/, null);
      if (value) {
        result.usesPermissions.push(value);
      }
    } else if (line.startsWith('launchable-activity:')) {
      for (const [name, pattern] of [
        ['name', /name='([^']+)'/],
        ['label', /label='([^']+)'/],
        ['icon', /icon='([^']+)'/],
      ] as const) {
        const value = extractValue(line, pattern, null);
        if (value) {
          (result.launchableActivity as Record<string, any>)[name] = value;
        }
      }
    } else if (line.startsWith('locales:')) {
      result.locales = extractArray(line, /'([^']+)'/g, null) as string[];
    } else if (line.startsWith('native-code:')) {
      result.architectures = extractArray(line, /'([^']+)'/g, null) as string[];
    } else if (line.startsWith('densities:')) {
      result.densities = extractArray(line, /'([^']+)'/g, toInt) as number[];
    }
  }
  return result;
}

// Private methods

/**
 * Calculates the absolute path to the current module's root folder
 */
const getModuleRoot = _.memoize(async function getModuleRoot(): Promise<string> {
  let moduleRoot = path.dirname(path.resolve(__filename));
  let isAtFsRoot = false;
  while (!isAtFsRoot) {
    const manifestPath = path.join(moduleRoot, 'package.json');
    try {
      if (await fs.exists(manifestPath)) {
        const manifestContent = await fs.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestContent) as {name?: string};
        if (manifest.name === MODULE_NAME) {
          return moduleRoot;
        }
      }
    } catch {
      // Ignore errors and continue searching
    }
    const parentDir = path.dirname(moduleRoot);
    isAtFsRoot = moduleRoot.length <= parentDir.length;
    moduleRoot = parentDir;
  }
  if (isAtFsRoot) {
    throw new Error(`Cannot find the root folder of the ${MODULE_NAME} Node.js module`);
  }
  return moduleRoot;
});

// Type definitions

/**
 * Options for building install arguments
 */
interface BuildInstallArgsOptions {
  replace?: boolean;
  allowTestPackages?: boolean;
  useSdcard?: boolean;
  grantPermissions?: boolean;
  partialInstall?: boolean;
}
