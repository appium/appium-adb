import {exec} from 'teen_process';
import {log} from '../logger.js';
import path from 'path';
import _ from 'lodash';
import {fs, tempDir, util} from '@appium/support';
import {LRUCache} from 'lru-cache';
import {getJavaForOs, unzipFile, buildInstallArgs, APK_INSTALL_TIMEOUT} from '../helpers.js';
import AsyncLock from 'async-lock';
import B from 'bluebird';
import type {ADB} from '../adb.js';
import type {InstallMultipleApksOptions, InstallApksOptions, StringRecord} from './types.js';

const BASE_APK = 'base-master.apk';
const LANGUAGE_APK = (lang: string) => `base-${lang}.apk`;
const APKS_CACHE = new LRUCache<string, string>({
  max: 10,
  dispose: (extractedFilesRoot) => fs.rimraf(extractedFilesRoot),
});
const APKS_CACHE_GUARD = new AsyncLock();
const BUNDLETOOL_TIMEOUT_MS = 4 * 60 * 1000;
const APKS_INSTALL_TIMEOUT = APK_INSTALL_TIMEOUT * 2;

process.on('exit', () => {
  if (!APKS_CACHE.size) {
    return;
  }

  const paths = [...APKS_CACHE.values()];
  log.debug(
    `Performing cleanup of ${paths.length} cached .apks ` + util.pluralize('package', paths.length),
  );
  for (const appPath of paths) {
    try {
      // Asynchronous calls are not supported in onExit handler
      fs.rimrafSync(appPath);
    } catch (e) {
      log.warn((e as Error).message);
    }
  }
});

/**
 * Extracts the particular apks package into a temporary folder,
 * finds and returns the full path to the file contained in this apk.
 * The resulting temporary path, where the .apks file has been extracted,
 * will be stored into the internal LRU cache for better performance.
 *
 * @param apks - The full path to the .apks file
 * @param dstPath - The relative path to the destination file,
 * which is going to be extracted, where each path component is an array item
 * @returns Full path to the extracted file
 * @throws {Error} If the requested item does not exist in the extracted archive or the provides
 * apks file is not a valid bundle
 */
async function extractFromApks(apks: string, dstPath: string | string[]): Promise<string> {
  const normalizedDstPath = _.isArray(dstPath) ? dstPath : [dstPath];

  return await APKS_CACHE_GUARD.acquire(apks, async () => {
    // It might be that the original file has been replaced,
    // so we need to keep the hash sums instead of the actual file paths
    // as caching keys
    const apksHash = await fs.hash(apks);
    log.debug(`Calculated '${apks}' hash: ${apksHash}`);

    if (APKS_CACHE.has(apksHash)) {
      const cachedRoot = APKS_CACHE.get(apksHash);
      if (cachedRoot) {
        const resultPath = path.resolve(cachedRoot, ...normalizedDstPath);
        if (await fs.exists(resultPath)) {
          return resultPath;
        }
      }
      APKS_CACHE.delete(apksHash);
    }

    const tmpRoot = await tempDir.openDir();
    log.debug(`Unpacking application bundle at '${apks}' to '${tmpRoot}'`);
    await unzipFile(apks, tmpRoot);
    const resultPath = path.resolve(tmpRoot, ...normalizedDstPath);
    if (!(await fs.exists(resultPath))) {
      throw new Error(
        `${normalizedDstPath.join(path.sep)} cannot be found in '${apks}' bundle. ` +
          `Does the archive contain a valid application bundle?`,
      );
    }
    APKS_CACHE.set(apksHash, tmpRoot);
    return resultPath;
  });
}

/**
 * Executes bundletool utility with given arguments and returns the actual stdout
 *
 * @param args - the list of bundletool arguments
 * @param errorMsg - The customized error message string
 * @returns the actual command stdout
 * @throws {Error} If bundletool jar does not exist in PATH or there was an error while
 * executing it
 */
export async function execBundletool(
  this: ADB,
  args: string[],
  errorMsg: string,
): Promise<string> {
  await this.initBundletool();
  const binaries = this.binaries as StringRecord;
  args = ['-jar', binaries.bundletool, ...args];
  const env = process.env;
  if (this.adbPort) {
    env.ANDROID_ADB_SERVER_PORT = `${this.adbPort}`;
  }
  if (this.adbHost) {
    env.ANDROID_ADB_SERVER_HOST = this.adbHost;
  }
  log.debug(`Executing bundletool with arguments: ${JSON.stringify(args)}`);
  let stdout: string;
  try {
    ({stdout} = await exec(await getJavaForOs(), args, {
      env,
      timeout: BUNDLETOOL_TIMEOUT_MS,
    }));
    log.debug(`Command stdout: ${_.truncate(stdout, {length: 300})}`);
    return stdout;
  } catch (e) {
    const err = e as Error & {stdout?: string; stderr?: string};
    if (err.stdout) {
      log.debug(`Command stdout: ${err.stdout}`);
    }
    if (err.stderr) {
      log.debug(`Command stderr: ${err.stderr}`);
    }
    throw new Error(`${errorMsg}. Original error: ${err.message}`);
  }
}

/**
 *
 * @param specLocation - The full path to the generated device spec location
 * @returns The same `specLocation` value
 * @throws {Error} If it is not possible to retrieve the spec for the current device
 */
export async function getDeviceSpec(this: ADB, specLocation: string): Promise<string> {
  const args: string[] = [
    'get-device-spec',
    '--adb',
    this.executable.path,
    '--device-id',
    this.curDeviceId as string,
    '--output',
    specLocation,
  ];
  log.debug(`Getting the spec for the device '${this.curDeviceId}'`);
  await this.execBundletool(args, 'Cannot retrieve the device spec');
  return specLocation;
}

/**
 * Installs the given apks into the device under test
 *
 * @param apkPathsToInstall - The full paths to install apks
 * @param options - Installation options
 */
export async function installMultipleApks(
  this: ADB,
  apkPathsToInstall: string[],
  options: InstallMultipleApksOptions = {},
): Promise<string> {
  const installArgs = buildInstallArgs(await this.getApiLevel(), options);
  return await this.adbExec(['install-multiple', ...installArgs, ...apkPathsToInstall], {
    // @ts-ignore This validation works
    timeout: isNaN(Number(options.timeout)) ? undefined : options.timeout,
    timeoutCapName: options.timeoutCapName,
  });
}

/**
 * Installs the given .apks package into the device under test
 *
 * @param apks - The full path to the .apks file
 * @param options - Installation options
 * @throws {Error} If the .apks bundle cannot be installed
 */
export async function installApks(
  this: ADB,
  apks: string,
  options: InstallApksOptions = {},
): Promise<void> {
  const {grantPermissions, allowTestPackages, timeout} = options;

  const args: string[] = [
    'install-apks',
    '--adb',
    this.executable.path,
    '--apks',
    apks,
    '--timeout-millis',
    `${timeout || APKS_INSTALL_TIMEOUT}`,
    '--device-id',
    this.curDeviceId as string,
  ];
  if (allowTestPackages) {
    args.push('--allow-test-only');
  }
  const tasks: Promise<any>[] = [
    this.execBundletool(
      args,
      `Cannot install '${path.basename(apks)}' to the device ${this.curDeviceId}`,
    ),
  ];
  if (grantPermissions) {
    tasks.push(this.getApkInfo(apks));
  }
  const [, apkInfo] = await B.all(tasks);
  if (grantPermissions && apkInfo) {
    // TODO: Simplify it after https://github.com/google/bundletool/issues/246 is implemented
    await this.grantAllPermissions(apkInfo.name);
  }
}

/**
 * Extracts and returns the full path to the master .apk file inside the bundle.
 *
 * @param apks - The full path to the .apks file
 * @returns The full path to the master bundle .apk
 * @throws {Error} If there was an error while extracting/finding the file
 */
export async function extractBaseApk(this: ADB, apks: string): Promise<string> {
  return await extractFromApks(apks, ['splits', BASE_APK]);
}

/**
 * Extracts and returns the full path to the .apk, which contains the corresponding
 * resources for the given language in the .apks bundle.
 *
 * @param apks - The full path to the .apks file
 * @param language - The language abbreviation. The default language is
 * going to be selected if it is not set.
 * @returns The full path to the corresponding language .apk or the master .apk
 * if language split is not enabled for the bundle.
 * @throws {Error} If there was an error while extracting/finding the file
 */
export async function extractLanguageApk(
  this: ADB,
  apks: string,
  language: string | null = null,
): Promise<string> {
  if (language) {
    try {
      return await extractFromApks(apks, ['splits', LANGUAGE_APK(language)]);
    } catch (e) {
      log.debug((e as Error).message);
      log.info(
        `Assuming that splitting by language is not enabled for the '${apks}' bundle ` +
          `and returning the main apk instead`,
      );
      return await this.extractBaseApk(apks);
    }
  }

  const defaultLanguages = ['en', 'en_us'];
  for (const lang of defaultLanguages) {
    try {
      return await extractFromApks(apks, ['splits', LANGUAGE_APK(lang)]);
    } catch {}
  }

  log.info(
    `Cannot find any split apk for the default languages ${JSON.stringify(defaultLanguages)}. ` +
      `Returning the main apk instead.`,
  );
  return await this.extractBaseApk(apks);
}

/**
 *
 * @param output
 * @returns
 */
export function isTestPackageOnlyError(output: string): boolean {
  return /\[INSTALL_FAILED_TEST_ONLY\]/.test(output);
}

