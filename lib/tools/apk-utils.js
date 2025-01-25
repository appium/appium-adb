import {
  APKS_EXTENSION, buildInstallArgs,
  APK_INSTALL_TIMEOUT, DEFAULT_ADB_EXEC_TIMEOUT,
  readPackageManifest
} from '../helpers.js';
import { exec } from 'teen_process';
import { log } from '../logger.js';
import path from 'path';
import _ from 'lodash';
import { fs, util, mkdirp, timing } from '@appium/support';
import * as semver from 'semver';
import os from 'os';
import { LRUCache } from 'lru-cache';

export const REMOTE_CACHE_ROOT = '/data/local/tmp/appium_cache';

/**
 * Uninstall the given package from the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} pkg - The name of the package to be uninstalled.
 * @param {import('./types').UninstallOptions} [options={}] - The set of uninstall options.
 * @return {Promise<boolean>} True if the package was found on the device and
 *                   successfully uninstalled.
 */
export async function uninstallApk (pkg, options = {}) {
  log.debug(`Uninstalling ${pkg}`);
  if (!options.skipInstallCheck && !await this.isAppInstalled(pkg)) {
    log.info(`${pkg} was not uninstalled, because it was not present on the device`);
    return false;
  }

  const cmd = ['uninstall'];
  if (options.keepData) {
    cmd.push('-k');
  }
  cmd.push(pkg);

  let stdout;
  try {
    await this.forceStop(pkg);
    stdout = (await this.adbExec(cmd, {timeout: options.timeout})).trim();
  } catch (e) {
    throw new Error(`Unable to uninstall APK. Original error: ${e.message}`);
  }
  log.debug(`'adb ${cmd.join(' ')}' command output: ${stdout}`);
  if (stdout.includes('Success')) {
    log.info(`${pkg} was successfully uninstalled`);
    return true;
  }
  log.info(`${pkg} was not uninstalled`);
  return false;
}

/**
 * Install the package after it was pushed to the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} apkPathOnDevice - The full path to the package on the device file system.
 * @param {import('./types').ShellExecOptions} [opts={}] Additional exec options.
 * @throws {error} If there was a failure during application install.
 */
export async function installFromDevicePath (apkPathOnDevice, opts = {}) {
  const stdout = /** @type {string} */ (await this.shell(['pm', 'install', '-r', apkPathOnDevice], opts));
  if (stdout.includes('Failure')) {
    throw new Error(`Remote install failed: ${stdout}`);
  }
}

/**
 * Caches the given APK at a remote location to speed up further APK deployments.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} apkPath - Full path to the apk on the local FS
 * @param {import('./types').CachingOptions} [options={}] - Caching options
 * @returns {Promise<string>} - Full path to the cached apk on the remote file system
 * @throws {Error} if there was a failure while caching the app
 */
export async function cacheApk (apkPath, options = {}) {
  const appHash = await fs.hash(apkPath);
  const remotePath = path.posix.join(REMOTE_CACHE_ROOT, `${appHash}.apk`);
  const remoteCachedFiles = [];
  // Get current contents of the remote cache or create it for the first time
  try {
    const errorMarker = '_ERROR_';
    let lsOutput = null;
    if (this._areExtendedLsOptionsSupported === true || !_.isBoolean(this._areExtendedLsOptionsSupported)) {
      lsOutput = await this.shell([`ls -t -1 ${REMOTE_CACHE_ROOT} 2>&1 || echo ${errorMarker}`]);
    }
    if (!_.isString(lsOutput) || (lsOutput.includes(errorMarker) && !lsOutput.includes(REMOTE_CACHE_ROOT))) {
      if (!_.isBoolean(this._areExtendedLsOptionsSupported)) {
        log.debug('The current Android API does not support extended ls options. ' +
          'Defaulting to no-options call');
      }
      lsOutput = await this.shell([`ls ${REMOTE_CACHE_ROOT} 2>&1 || echo ${errorMarker}`]);
      this._areExtendedLsOptionsSupported = false;
    } else {
      this._areExtendedLsOptionsSupported = true;
    }
    if (lsOutput.includes(errorMarker)) {
      throw new Error(lsOutput.substring(0, lsOutput.indexOf(errorMarker)));
    }
    remoteCachedFiles.push(...(
      lsOutput.split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
    ));
  } catch (e) {
    log.debug(`Got an error '${e.message.trim()}' while getting the list of files in the cache. ` +
      `Assuming the cache does not exist yet`);
    await this.shell(['mkdir', '-p', REMOTE_CACHE_ROOT]);
  }
  log.debug(`The count of applications in the cache: ${remoteCachedFiles.length}`);
  const toHash = (remotePath) => path.posix.parse(remotePath).name;
  // Push the apk to the remote cache if needed
  if (remoteCachedFiles.some((x) => toHash(x) === appHash)) {
    log.info(`The application at '${apkPath}' is already cached to '${remotePath}'`);
    // Update the application timestamp asynchronously in order to bump its position
    // in the sorted ls output
    // eslint-disable-next-line promise/prefer-await-to-then
    this.shell(['touch', '-am', remotePath]).catch(() => {});
  } else {
    log.info(`Caching the application at '${apkPath}' to '${remotePath}'`);
    const timer = new timing.Timer().start();
    await this.push(apkPath, remotePath, {timeout: options.timeout});
    const {size} = await fs.stat(apkPath);
    log.info(`The upload of '${path.basename(apkPath)}' (${util.toReadableSizeString(size)}) ` +
      `took ${timer.getDuration().asMilliSeconds.toFixed(0)}ms`);
  }
  if (!this.remoteAppsCache) {
    this.remoteAppsCache = new LRUCache({
      max: /** @type {number} */ (this.remoteAppsCacheLimit),
    });
  }
  // Cleanup the invalid entries from the cache
  _.difference([...this.remoteAppsCache.keys()], remoteCachedFiles.map(toHash))
    .forEach((hash) => (/** @type {LRUCache} */ (this.remoteAppsCache)).delete(hash));
  // Bump the cache record for the recently cached item
  this.remoteAppsCache.set(appHash, remotePath);
  // If the remote cache exceeds this.remoteAppsCacheLimit, remove the least recently used entries
  const entriesToCleanup = remoteCachedFiles
    .map((x) => path.posix.join(REMOTE_CACHE_ROOT, x))
    .filter((x) => !(/** @type {LRUCache} */ (this.remoteAppsCache)).has(toHash(x)))
    .slice((/** @type {number} */ (this.remoteAppsCacheLimit)) - [...this.remoteAppsCache.keys()].length);
  if (!_.isEmpty(entriesToCleanup)) {
    try {
      await this.shell(['rm', '-f', ...entriesToCleanup]);
      log.debug(`Deleted ${entriesToCleanup.length} expired application cache entries`);
    } catch (e) {
      log.warn(`Cannot delete ${entriesToCleanup.length} expired application cache entries. ` +
        `Original error: ${e.message}`);
    }
  }
  return remotePath;
}

/**
 * Install the package from the local file system.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} appPath - The full path to the local package.
 * @param {import('./types').InstallOptions} [options={}] - The set of installation options.
 * @throws {Error} If an unexpected error happens during install.
 */
export async function install (appPath, options = {}) {
  if (appPath.endsWith(APKS_EXTENSION)) {
    return await this.installApks(appPath, options);
  }

  options = _.cloneDeep(options);
  _.defaults(options, {
    replace: true,
    timeout: this.adbExecTimeout === DEFAULT_ADB_EXEC_TIMEOUT ? APK_INSTALL_TIMEOUT : this.adbExecTimeout,
    timeoutCapName: 'androidInstallTimeout',
  });

  const installArgs = buildInstallArgs(await this.getApiLevel(), options);
  if (options.noIncremental && await this.isIncrementalInstallSupported()) {
    // Adb throws an error if it does not know about an arg,
    // which is the case here for older adb versions.
    installArgs.push('--no-incremental');
  }
  const installOpts = {
    timeout: options.timeout,
    timeoutCapName: options.timeoutCapName,
  };
  const installCmd = [
    'install',
    ...installArgs,
    appPath,
  ];
  let performAppInstall = async () => await this.adbExec(installCmd, installOpts);
  // this.remoteAppsCacheLimit <= 0 means no caching should be applied
  let shouldCacheApp = (/** @type {number} */ (this.remoteAppsCacheLimit)) > 0;
  if (shouldCacheApp) {
    shouldCacheApp = !(await this.isStreamedInstallSupported());
    if (!shouldCacheApp) {
      log.info(`The application at '${appPath}' will not be cached, because the device under test has ` +
        `confirmed the support of streamed installs`);
    }
  }
  if (shouldCacheApp) {
    const clearCache = async () => {
      log.info(`Clearing the cache at '${REMOTE_CACHE_ROOT}'`);
      await this.shell(['rm', '-rf', `${REMOTE_CACHE_ROOT}/*`]);
    };
    const cacheApp = async () => await this.cacheApk(appPath, {
      timeout: options.timeout,
    });
    try {
      const cachedAppPath = await cacheApp();
      performAppInstall = async () => {
        const pmInstallCmdByRemotePath = (remotePath) => [
          'pm', 'install',
          ...installArgs,
          remotePath,
        ];
        const output = await this.shell(pmInstallCmdByRemotePath(cachedAppPath), installOpts);
        // https://github.com/appium/appium/issues/13970
        if (/\bINSTALL_FAILED_INSUFFICIENT_STORAGE\b/.test(output)) {
          log.warn(`There was a failure while installing '${appPath}' ` +
            `because of the insufficient device storage space`);
          await clearCache();
          log.info(`Consider decreasing the maximum amount of cached apps ` +
            `(currently ${this.remoteAppsCacheLimit}) to avoid such issues in the future`);
          const newCachedAppPath = await cacheApp();
          return await this.shell(pmInstallCmdByRemotePath(newCachedAppPath), installOpts);
        }
        return output;
      };
    } catch (e) {
      log.debug(e);
      log.warn(`There was a failure while caching '${appPath}': ${e.message}`);
      log.warn('Falling back to the default installation procedure');
      await clearCache();
    }
  }
  try {
    const timer = new timing.Timer().start();
    const output = /** @type {string} */(await performAppInstall());
    log.info(`The installation of '${path.basename(appPath)}' took ${timer.getDuration().asMilliSeconds.toFixed(0)}ms`);
    const truncatedOutput = (!_.isString(output) || output.length <= 300) ?
      output : `${output.substring(0, 150)}...${output.substring(output.length - 150)}`;
    log.debug(`Install command stdout: ${truncatedOutput}`);
    if (/\[INSTALL[A-Z_]+FAILED[A-Z_]+\]/.test(output)) {
      if (this.isTestPackageOnlyError(output)) {
        const msg = `Set 'allowTestPackages' capability to true in order to allow test packages installation.`;
        log.warn(msg);
        throw new Error(`${output}\n${msg}`);
      }
      throw new Error(output);
    }
  } catch (err) {
    // on some systems this will throw an error if the app already
    // exists
    if (!err.message.includes('INSTALL_FAILED_ALREADY_EXISTS')) {
      throw err;
    }
    log.debug(`Application '${appPath}' already installed. Continuing.`);
  }
}

/**
 * Retrieves the current installation state of the particular application
 *
 * @this {import('../adb.js').ADB}
 * @param {string} appPath - Full path to the application
 * @param {string?} [pkg=null] - Package identifier. If omitted then the script will
 * try to extract it on its own
 * @returns {Promise<import('./types').InstallState>} One of `APP_INSTALL_STATE` constants
 */
export async function getApplicationInstallState (appPath, pkg = null) {
  let apkInfo = null;
  if (!pkg) {
    apkInfo = await this.getApkInfo(appPath);
    // @ts-ignore We are ok if this prop does not exist
    pkg = apkInfo.name;
  }
  if (!pkg) {
    log.warn(`Cannot read the package name of '${appPath}'`);
    return this.APP_INSTALL_STATE.UNKNOWN;
  }

  const {
    versionCode: pkgVersionCode,
    versionName: pkgVersionNameStr,
    isInstalled,
  } = await this.getPackageInfo(pkg);
  if (!isInstalled) {
    log.debug(`App '${appPath}' is not installed`);
    return this.APP_INSTALL_STATE.NOT_INSTALLED;
  }
  const pkgVersionName = semver.valid(semver.coerce(pkgVersionNameStr));
  if (!apkInfo) {
    apkInfo = await this.getApkInfo(appPath);
  }
  // @ts-ignore We validate the valus below
  const {versionCode: apkVersionCode, versionName: apkVersionNameStr} = apkInfo;
  const apkVersionName = semver.valid(semver.coerce(apkVersionNameStr));

  if (!_.isInteger(apkVersionCode) || !_.isInteger(pkgVersionCode)) {
    log.warn(`Cannot read version codes of '${appPath}' and/or '${pkg}'`);
    if (!_.isString(apkVersionName) || !_.isString(pkgVersionName)) {
      log.warn(`Cannot read version names of '${appPath}' and/or '${pkg}'`);
      return this.APP_INSTALL_STATE.UNKNOWN;
    }
  }
  if (_.isInteger(apkVersionCode) && _.isInteger(pkgVersionCode)) {
    if ((/** @type {number} */ (pkgVersionCode)) > apkVersionCode) {
      log.debug(`The version code of the installed '${pkg}' is greater than the application version code (${pkgVersionCode} > ${apkVersionCode})`);
      return this.APP_INSTALL_STATE.NEWER_VERSION_INSTALLED;
    }
    // Version codes might not be maintained. Check version names.
    if (pkgVersionCode === apkVersionCode) {
      if (_.isString(apkVersionName) && _.isString(pkgVersionName) && semver.satisfies(pkgVersionName, `>=${apkVersionName}`)) {
        log.debug(`The version name of the installed '${pkg}' is greater or equal to the application version name ('${pkgVersionName}' >= '${apkVersionName}')`);
        return semver.satisfies(pkgVersionName, `>${apkVersionName}`)
          ? this.APP_INSTALL_STATE.NEWER_VERSION_INSTALLED
          : this.APP_INSTALL_STATE.SAME_VERSION_INSTALLED;
      }
      if (!_.isString(apkVersionName) || !_.isString(pkgVersionName)) {
        log.debug(`The version name of the installed '${pkg}' is equal to application version name (${pkgVersionCode} === ${apkVersionCode})`);
        return this.APP_INSTALL_STATE.SAME_VERSION_INSTALLED;
      }
    }
  } else if (_.isString(apkVersionName) && _.isString(pkgVersionName) && semver.satisfies(pkgVersionName, `>=${apkVersionName}`)) {
    log.debug(`The version name of the installed '${pkg}' is greater or equal to the application version name ('${pkgVersionName}' >= '${apkVersionName}')`);
    return semver.satisfies(pkgVersionName, `>${apkVersionName}`)
      ? this.APP_INSTALL_STATE.NEWER_VERSION_INSTALLED
      : this.APP_INSTALL_STATE.SAME_VERSION_INSTALLED;
  }

  log.debug(`The installed '${pkg}' package is older than '${appPath}' (${pkgVersionCode} < ${apkVersionCode} or '${pkgVersionName}' < '${apkVersionName}')'`);
  return this.APP_INSTALL_STATE.OLDER_VERSION_INSTALLED;
}

/**
 * Install the package from the local file system or upgrade it if an older
 * version of the same package is already installed.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} appPath - The full path to the local package.
 * @param {string?} [pkg=null] - The name of the installed package. The method will
 * perform faster if it is set.
 * @param {import('./types').InstallOrUpgradeOptions} [options={}] - Set of install options.
 * @throws {Error} If an unexpected error happens during install.
 * @returns {Promise<import('./types').InstallOrUpgradeResult>}
 */
export async function installOrUpgrade (appPath, pkg = null, options = {}) {
  if (!pkg) {
    const apkInfo = await this.getApkInfo(appPath);
    if ('name' in apkInfo) {
      pkg = apkInfo.name;
    } else {
      log.warn(
        `Cannot determine the package name of '${appPath}'. ` +
        `Continuing with the install anyway`
      );
    }
  }

  const {
    enforceCurrentBuild,
  } = options;
  const appState = await this.getApplicationInstallState(appPath, pkg);
  let wasUninstalled = false;
  const uninstallPackage = async () => {
    if (!await this.uninstallApk(/** @type {string} */ (pkg), {skipInstallCheck: true})) {
      throw new Error(`'${pkg}' package cannot be uninstalled`);
    }
    wasUninstalled = true;
  };
  switch (appState) {
    case this.APP_INSTALL_STATE.NOT_INSTALLED:
      log.debug(`Installing '${appPath}'`);
      await this.install(appPath, Object.assign({}, options, {replace: false}));
      return {
        appState,
        wasUninstalled,
      };
    case this.APP_INSTALL_STATE.NEWER_VERSION_INSTALLED:
      if (enforceCurrentBuild) {
        log.info(`Downgrading '${pkg}' as requested`);
        await uninstallPackage();
        break;
      }
      log.debug(`There is no need to downgrade '${pkg}'`);
      return {
        appState,
        wasUninstalled,
      };
    case this.APP_INSTALL_STATE.SAME_VERSION_INSTALLED:
      if (enforceCurrentBuild) {
        break;
      }
      log.debug(`There is no need to install/upgrade '${appPath}'`);
      return {
        appState,
        wasUninstalled,
      };
    case this.APP_INSTALL_STATE.OLDER_VERSION_INSTALLED:
      log.debug(`Executing upgrade of '${appPath}'`);
      break;
    default:
      log.debug(`The current install state of '${appPath}' is unknown. Installing anyway`);
      break;
  }

  try {
    await this.install(appPath, Object.assign({}, options, {replace: true}));
  } catch (err) {
    log.warn(`Cannot install/upgrade '${pkg}' because of '${err.message}'. Trying full reinstall`);
    await uninstallPackage();
    await this.install(appPath, Object.assign({}, options, {replace: false}));
  }
  return {
    appState,
    wasUninstalled,
  };
}

/**
 * Extract string resources from the given package on local file system.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} appPath - The full path to the .apk(s) package.
 * @param {string?} [language=null] - The name of the language to extract the resources for.
 * The default language is used if this equals to `null`
 * @param {string?} [outRoot=null] - The name of the destination folder on the local file system to
 * store the extracted file to. If not provided then the `localPath` property in the returned object
 * will be undefined.
 * @return {Promise<import('./types').ApkStrings>}
 */
export async function extractStringsFromApk (
  appPath,
  language = null,
  outRoot = null
) {
  log.debug(`Extracting strings from for language: ${language || 'default'}`);
  const originalAppPath = appPath;
  if (appPath.endsWith(APKS_EXTENSION)) {
    appPath = await this.extractLanguageApk(appPath, language);
  }

  let apkStrings = {};
  let configMarker;
  try {
    await this.initAapt();

    configMarker = await formatConfigMarker(async () => {
      const {stdout} = await exec((/** @type {import('./types').StringRecord} */ (this.binaries)).aapt, [
        'd', 'configurations', appPath,
      ]);
      return _.uniq(stdout.split(os.EOL));
    }, language, '(default)');

    const {stdout} = await exec((/** @type {import('./types').StringRecord} */ (this.binaries)).aapt, [
      'd', '--values', 'resources', appPath,
    ]);
    apkStrings = parseAaptStrings(stdout, configMarker);
  } catch (e) {
    log.debug('Cannot extract resources using aapt. Trying aapt2. ' +
      `Original error: ${e.stderr || e.message}`);

    await this.initAapt2();

    configMarker = await formatConfigMarker(async () => {
      const {stdout} = await exec((/** @type {import('./types').StringRecord} */ (this.binaries)).aapt2, [
        'd', 'configurations', appPath,
      ]);
      return _.uniq(stdout.split(os.EOL));
    }, language, '');

    try {
      const {stdout} = await exec((/** @type {import('./types').StringRecord} */ (this.binaries)).aapt2, [
        'd', 'resources', appPath,
      ]);
      apkStrings = parseAapt2Strings(stdout, configMarker);
    } catch (e) {
      throw new Error(`Cannot extract resources from '${originalAppPath}'. ` +
        `Original error: ${e.message}`);
    }
  }

  if (_.isEmpty(apkStrings)) {
    log.warn(`No strings have been found in '${originalAppPath}' resources ` +
      `for '${configMarker || 'default'}' configuration`);
  } else {
    log.info(`Successfully extracted ${_.keys(apkStrings).length} strings from ` +
      `'${originalAppPath}' resources for '${configMarker || 'default'}' configuration`);
  }

  if (!outRoot) {
    return {apkStrings};
  }

  const localPath = path.resolve(outRoot, 'strings.json');
  await mkdirp(outRoot);
  await fs.writeFile(localPath, JSON.stringify(apkStrings, null, 2), 'utf-8');
  return {apkStrings, localPath};
}

/**
 * Get the package info from local apk file.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} appPath - The full path to existing .apk(s) package on the local
 *                           file system.
 * @return {Promise<import('./types').AppInfo|{}>} The parsed application information.
 */
export async function getApkInfo (appPath) {
  if (!await fs.exists(appPath)) {
    throw new Error(`The file at path ${appPath} does not exist or is not accessible`);
  }

  if (appPath.endsWith(APKS_EXTENSION)) {
    appPath = await this.extractBaseApk(appPath);
  }

  try {
    const {name, versionCode, versionName} = await readPackageManifest.bind(this)(appPath);
    return {
      name,
      versionCode,
      versionName,
    };
  } catch (e) {
    log.warn(`Error '${e.message}' while getting badging info`);
  }
  return {};
}

// #region Private functions

/**
 * Formats the config marker, which is then passed to parse.. methods
 * to make it compatible with resource formats generated by aapt(2) tool
 *
 * @param {Function} configsGetter The function whose result is a list
 * of apk configs
 * @param {string?} desiredMarker The desired config marker value
 * @param {string} defaultMarker The default config marker value
 * @return {Promise<string>} The formatted config marker
 */
async function formatConfigMarker (configsGetter, desiredMarker, defaultMarker) {
  let configMarker = desiredMarker || defaultMarker;
  if (configMarker.includes('-') && !configMarker.includes('-r')) {
    configMarker = configMarker.replace('-', '-r');
  }
  const configs = await configsGetter();
  log.debug(`Resource configurations: ${JSON.stringify(configs)}`);
  // Assume the 'en' configuration is the default one
  if (configMarker.toLowerCase().startsWith('en')
    && !configs.some((x) => x.trim() === configMarker)) {
    log.debug(`Resource configuration name '${configMarker}' is unknown. ` +
      `Replacing it with '${defaultMarker}'`);
    configMarker = defaultMarker;
  } else {
    log.debug(`Selected configuration: '${configMarker}'`);
  }
  return configMarker;
}

/**
 * Parses apk strings from aapt2 tool output
 *
 * @param {string} rawOutput The actual tool output
 * @param {string} configMarker The config marker. Usually
 * a language abbreviation or an empty string for the default one
 * @returns {Object} Strings ids to values mapping. Plural
 * values are represented as arrays. If no config found for the
 * given marker then an empty mapping is returned.
 */
export function parseAapt2Strings (rawOutput, configMarker) {
  const allLines = rawOutput.split(os.EOL);
  function extractContent (startIdx) {
    let idx = startIdx;
    const startCharPos = allLines[startIdx].indexOf('"');
    if (startCharPos < 0) {
      return [null, idx];
    }
    let result = '';
    while (idx < allLines.length) {
      const terminationCharMatch = /"$/.exec(allLines[idx]);
      if (terminationCharMatch) {
        const terminationCharPos = terminationCharMatch.index;
        if (startIdx === idx) {
          return [
            allLines[idx].substring(startCharPos + 1, terminationCharPos),
            idx
          ];
        }
        return [
          `${result}\\n${_.trimStart(allLines[idx].substring(0, terminationCharPos))}`,
          idx,
        ];
      }
      if (idx > startIdx) {
        result += `\\n${_.trimStart(allLines[idx])}`;
      } else {
        result += allLines[idx].substring(startCharPos + 1);
      }
      ++idx;
    }
    return [result, idx];
  }

  const apkStrings = {};
  let currentResourceId = null;
  let isInPluralGroup = false;
  let isInCurrentConfig = false;
  let lineIndex = 0;
  while (lineIndex < allLines.length) {
    const trimmedLine = allLines[lineIndex].trim();
    if (_.isEmpty(trimmedLine)) {
      ++lineIndex;
      continue;
    }

    if (['type', 'Package'].some((x) => trimmedLine.startsWith(x))) {
      currentResourceId = null;
      isInPluralGroup = false;
      isInCurrentConfig = false;
      ++lineIndex;
      continue;
    }

    if (trimmedLine.startsWith('resource')) {
      isInPluralGroup = false;
      currentResourceId = null;
      isInCurrentConfig = false;

      if (trimmedLine.includes('string/')) {
        const match = /string\/(\S+)/.exec(trimmedLine);
        if (match) {
          currentResourceId = match[1];
        }
      } else if (trimmedLine.includes('plurals/')) {
        const match = /plurals\/(\S+)/.exec(trimmedLine);
        if (match) {
          currentResourceId = match[1];
          isInPluralGroup = true;
        }
      }
      ++lineIndex;
      continue;
    }

    if (currentResourceId) {
      if (isInPluralGroup) {
        if (trimmedLine.startsWith('(')) {
          isInCurrentConfig = trimmedLine.startsWith(`(${configMarker})`);
          ++lineIndex;
          continue;
        }
        if (isInCurrentConfig) {
          const [content, idx] = extractContent(lineIndex);
          lineIndex = idx;
          if (_.isString(content)) {
            apkStrings[currentResourceId] = [
              ...(apkStrings[currentResourceId] || []),
              content,
            ];
          }
        }
      } else if (trimmedLine.startsWith(`(${configMarker})`)) {
        const [content, idx] = extractContent(lineIndex);
        lineIndex = idx;
        if (_.isString(content)) {
          apkStrings[currentResourceId] = content;
        }
        currentResourceId = null;
      }
    }
    ++lineIndex;
  }
  return apkStrings;
}

/**
 * Parses apk strings from aapt tool output
 *
 * @param {string} rawOutput The actual tool output
 * @param {string} configMarker The config marker. Usually
 * a language abbreviation or `(default)`
 * @returns {Object} Strings ids to values mapping. Plural
 * values are represented as arrays. If no config found for the
 * given marker then an empty mapping is returned.
 */
export function parseAaptStrings (rawOutput, configMarker) {
  const normalizeStringMatch = function (s) {
    return s.replace(/"$/, '').replace(/^"/, '').replace(/\\"/g, '"');
  };

  const apkStrings = {};
  let isInConfig = false;
  let currentResourceId = null;
  let isInPluralGroup = false;
  // The pattern matches any quoted content including escaped quotes
  const quotedStringPattern = /"[^"\\]*(?:\\.[^"\\]*)*"/;
  for (const line of rawOutput.split(os.EOL)) {
    const trimmedLine = line.trim();
    if (_.isEmpty(trimmedLine)) {
      continue;
    }

    if (['config', 'type', 'spec', 'Package'].some((x) => trimmedLine.startsWith(x))) {
      isInConfig = trimmedLine.startsWith(`config ${configMarker}:`);
      currentResourceId = null;
      isInPluralGroup = false;
      continue;
    }

    if (!isInConfig) {
      continue;
    }

    if (trimmedLine.startsWith('resource')) {
      isInPluralGroup = false;
      currentResourceId = null;

      if (trimmedLine.includes(':string/')) {
        const match = /:string\/(\S+):/.exec(trimmedLine);
        if (match) {
          currentResourceId = match[1];
        }
      } else if (trimmedLine.includes(':plurals/')) {
        const match = /:plurals\/(\S+):/.exec(trimmedLine);
        if (match) {
          currentResourceId = match[1];
          isInPluralGroup = true;
        }
      }
      continue;
    }

    if (currentResourceId && trimmedLine.startsWith('(string')) {
      const match = quotedStringPattern.exec(trimmedLine);
      if (match) {
        apkStrings[currentResourceId] = normalizeStringMatch(match[0]);
      }
      currentResourceId = null;
      continue;
    }

    if (currentResourceId && isInPluralGroup && trimmedLine.includes(': (string')) {
      const match = quotedStringPattern.exec(trimmedLine);
      if (match) {
        apkStrings[currentResourceId] = [
          ...(apkStrings[currentResourceId] || []),
          normalizeStringMatch(match[0]),
        ];
      }
      continue;
    }
  }
  return apkStrings;
}

// #endregion
