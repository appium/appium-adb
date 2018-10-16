import { exec } from 'teen_process';
import log from '../logger.js';
import path from 'path';
import _ from 'lodash';
import { fs, mkdirp, tempDir } from 'appium-support';
import LRU from 'lru-cache';
import { getJavaForOs, unzipFile } from '../helpers.js';

const BASE_APK = 'base-master.apk';
const LANGUAGE_APK = (lang) => `base-${lang}.apk`;
const APKS_CACHE = new LRU({
  max: 10,
  dispose: (apksPath, extractedFilesRoot) => fs.rimraf(extractedFilesRoot),
});

/**
 * Extracts the particular apks package into a temporary folder,
 * finds and returns the full path to the file contained in this apk.
 * The resulting temporary path, where the .apks file has been extracted,
 * will be stored into the internal LRU cache for better performance.
 *
 * @param {string} apks - The full path to the .apks file
 * @param {string|Array<String>} dstPath - The relative path to the destination file,
 * which is going to be extract3ed, where each path component is an array item
 * @returns {string} Full path to the extracted file
 * @throws {Error} If the requested item does not exist in the extracted archive or the provides
 * apks file is not a valid bundle
 */
async function extractFromApks (apks, dstPath) {
  if (_.isString(dstPath)) {
    dstPath = [dstPath];
  }
  if (APKS_CACHE.has(apks)) {
    return path.resolve(APKS_CACHE.get(apks), ...dstPath);
  }

  const tmpRoot = await tempDir.openDir();
  log.debug(`Unpacking application bundle at '${apks}' to '${tmpRoot}'`);
  await mkdirp(tmpRoot);
  await unzipFile(apks, tmpRoot);
  const resultPath = path.resolve(tmpRoot, ...dstPath);
  if (!await fs.exists(resultPath)) {
    throw new Error(`${dstPath.join(path.sep)} cannot be found in '${apks}' bundle. ` +
      `Does the archive contain a valid application bundle?`);
  }
  APKS_CACHE.set(apks, tmpRoot);
  return resultPath;
}

let apksUtilsMethods = {};


/**
 * @typedef {Object} InstallApksOptions
 * @property {?number|string} timeout [20000] - The number of milliseconds to wait until
 * the installation is completed
 */

/**
 * Installs the given .apks package into the device under test
 *
 * @param {string} apks - The full path to the .apks file
 * @param {?InstallApksOptions} options - Installation options
 * @throws {Error} If the .apks bundle cannot be installed
 */
apksUtilsMethods.installApks = async function (apks, options = {}) {
  await this.initBundletool();

  const args = [
    '-jar', this.binaries.bundletool,
    'install-apks',
    '--adb', this.executable.path,
    '--apks', apks,
    '--device-id', this.curDeviceId,
  ];
  log.debug(`Installing '${apks}' with arguments: ${JSON.stringify[args]}`);
  let stdout;
  try {
    ({stdout} = await exec(getJavaForOs(), args, {
      timeout: options.timeout
    }));
    log.debug(`Install command stdout: ${_.truncate(stdout, {length: 300})}`);
  } catch (e) {
    if (e.stdout) {
      log.debug(`Install command stdout: ${e.stdout}`);
    }
    if (e.stderr) {
      log.debug(`Install command stderr: ${e.stderr}`);
    }
    throw new Error(`Cannot install the application bundle at '${apks}'. Original error: ${e.message}`);
  }
  if (_.includes(stdout, 'INSTALL_FAILED')) {
    throw new Error(stdout);
  }
};

/**
 * Extracts and returns the full path to the master .apk file inside the bundle.
 *
 * @param {string} apks - The full path to the .apks file
 * @returns {string} The full path to the master bundle .apk
 * @throws {Error} If there was an error while extracting/finding the file
 */
apksUtilsMethods.extractBaseApk = async function (apks) {
  return await extractFromApks(apks, ['splits', BASE_APK]);
};

/**
 * Extracts and returns the full path to the .apk, which contains the corresponding
 * resources for the given language in the .apks bundle.
 *
 * @param {string} apks - The full path to the .apks file
 * @param {?string} language - The language abbreviation. The default language is
 * going to be selected if it is not set.
 * @returns {string} The full path to the corresponding language .apk or the master .apk
 * if language split is not enabled for the bundle.
 * @throws {Error} If there was an error while extracting/finding the file
 */
apksUtilsMethods.extractLanguageApk = async function (apks, language = null) {
  if (language) {
    try {
      return await extractFromApks(apks, ['splits', LANGUAGE_APK(language)]);
    } catch (e) {
      log.debug(e.message);
      log.info(`Assuming that splitting by language is not enabled for the '${apks}' bundle ` +
        `and returning the main apk instead`);
      return await this.extractBaseApk(apks);
    }
  }

  const defaultLanguages = ['en', 'en_us'];
  for (const lang of defaultLanguages) {
    try {
      return await extractFromApks(apks, ['splits', LANGUAGE_APK(lang)]);
    } catch (ign) {}
  }

  log.info(`Cannot find any split apk for the default languages ${JSON.stringify(defaultLanguages)}. ` +
    `Returning the main apk instead.`);
  return await this.extractBaseApk(apks);
};

export default apksUtilsMethods;
