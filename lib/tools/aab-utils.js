import log from '../logger.js';
import path from 'path';
import { fs, tempDir, util } from '@appium/support';
import { LRUCache } from 'lru-cache';
import { unzipFile } from '../helpers.js';
import AsyncLock from 'async-lock';
import B from 'bluebird';
import crypto from 'crypto';

/** @type {LRUCache<string, string>} */
const AAB_CACHE = new LRUCache({
  max: 10,
  dispose: (extractedFilesRoot) => fs.rimraf(/** @type {string} */ (extractedFilesRoot)),
});
const AAB_CACHE_GUARD = new AsyncLock();
const UNIVERSAL_APK = 'universal.apk';

const aabUtilsMethods = {};

process.on('exit', () => {
  if (!AAB_CACHE.size) {
    return;
  }

  const paths = /** @type {string[]} */ ([...AAB_CACHE.values()]);
  log.debug(`Performing cleanup of ${paths.length} cached .aab ` +
    util.pluralize('package', paths.length));
  for (const appPath of paths) {
    try {
      // Asynchronous calls are not supported in onExit handler
      fs.rimrafSync(appPath);
    } catch (e) {
      log.warn((/** @type {Error} */ (e)).message);
    }
  }
});

/**
 * @typedef {Object} ApkCreationOptions
 * @property {string} [keystore] Specifies the path to the deployment keystore used
 * to sign the APKs. This flag is optional. If you don't include it,
 * bundletool attempts to sign your APKs with a debug signing key.
 * If the .apk has been already signed and cached then it is not going to be resigned
 * unless a different keystore or key alias is used.
 * @property {string} [keystorePassword] Specifies your keystore’s password.
 * It is mandatory to provide this value if `keystore` one is assigned
 * otherwise it is going to be ignored.
 * @property {string} [keyAlias] Specifies the alias of the signing key you want to use.
 * It is mandatory to provide this value if `keystore` one is assigned
 * otherwise it is going to be ignored.
 * @property {string} [keyPassword] Specifies the password for the signing key.
 * It is mandatory to provide this value if `keystore` one is assigned
 * otherwise it is going to be ignored.
 */

/**
 * Builds a universal .apk from the given .aab package. See
 * https://developer.android.com/studio/command-line/bundletool#generate_apks
 * for more details.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} aabPath Full path to the source .aab package
 * @param {ApkCreationOptions} [opts={}]
 * @returns The path to the resulting universal .apk. The .apk is stored in the internal cache
 * by default.
 * @throws {Error} If there was an error while creating the universal .apk
 */
aabUtilsMethods.extractUniversalApk = async function extractUniversalApk (aabPath, opts = {}) {
  if (!await fs.exists(aabPath)) {
    throw new Error(`The file at '${aabPath}' either does not exist or is not accessible`);
  }

  const aabName = path.basename(aabPath);
  const apkName = aabName.substring(0, aabName.length - path.extname(aabName).length) + '.apk';
  const tmpRoot = await tempDir.openDir();
  const tmpApksPath = path.join(tmpRoot, `${aabName}.apks`);
  try {
    return await AAB_CACHE_GUARD.acquire(aabPath, async () => {
      const aabHash = await fs.hash(aabPath);
      const {
        keystore,
        keystorePassword,
        keyAlias,
        keyPassword,
      } = opts;
      let cacheHash = aabHash;
      if (keystore) {
        if (!await fs.exists(keystore)) {
          throw new Error(`The keystore file at '${keystore}' either does not exist ` +
            `or is not accessible`);
        }
        if (!keystorePassword || !keyAlias || !keyPassword) {
          throw new Error('It is mandatory to also provide keystore password, key alias, ' +
            'and key password if the keystore path is set');
        }
        const keystoreHash = await fs.hash(keystore);
        const keyAliasHash = crypto.createHash('sha1');
        keyAliasHash.update(keyAlias);
        cacheHash = [cacheHash, keystoreHash, keyAliasHash.digest('hex')].join(':');
      }
      log.debug(`Calculated the cache key for '${aabPath}': ${cacheHash}`);
      if (AAB_CACHE.has(cacheHash)) {
        const resultPath = path.resolve(/** @type {string} */ (AAB_CACHE.get(cacheHash)), apkName);
        if (await fs.exists(resultPath)) {
          return resultPath;
        }
        AAB_CACHE.delete(cacheHash);
      }

      await this.initAapt2();
      const args = [
        'build-apks',
        '--aapt2', (/** @type {import('@appium/types').StringRecord} */ (this.binaries)).aapt2,
        '--bundle', aabPath,
        '--output', tmpApksPath,
        ...(keystore ? [
          '--ks', keystore,
          '--ks-pass', `pass:${keystorePassword}`,
          '--ks-key-alias', keyAlias,
          '--key-pass', `pass:${keyPassword}`,
        ] : []),
        '--mode=universal'
      ];
      log.debug(`Preparing universal .apks bundle from '${aabPath}'`);
      await this.execBundletool(args, `Cannot build a universal .apks bundle from '${aabPath}'`);

      log.debug(`Unpacking universal application bundle at '${tmpApksPath}' to '${tmpRoot}'`);
      await unzipFile(tmpApksPath, tmpRoot);
      let universalApkPath;
      const fileDeletionPromises = [];
      const allFileNames = await fs.readdir(tmpRoot);
      for (const fileName of allFileNames) {
        const fullPath = path.join(tmpRoot, fileName);
        if (fileName === UNIVERSAL_APK) {
          universalApkPath = fullPath;
        } else {
          fileDeletionPromises.push(fs.rimraf(fullPath));
        }
      }
      try {
        await B.all(fileDeletionPromises);
      } catch (ign) {}
      if (!universalApkPath) {
        log.debug(`The following items were extracted from the .aab bundle: ${allFileNames}`);
        throw new Error(`${UNIVERSAL_APK} cannot be found in '${aabPath}' bundle. ` +
          `Does the archive contain a valid application bundle?`);
      }
      const resultPath = path.join(tmpRoot, apkName);
      log.debug(`Found ${UNIVERSAL_APK} at '${universalApkPath}'. Caching it to '${resultPath}'`);
      await fs.mv(universalApkPath, resultPath);
      AAB_CACHE.set(cacheHash, tmpRoot);
      return resultPath;
    });
  } catch (e) {
    await fs.rimraf(tmpRoot);
    throw e;
  }
};

export default aabUtilsMethods;

/**
 * @typedef {typeof aabUtilsMethods} AabUtils
 */
