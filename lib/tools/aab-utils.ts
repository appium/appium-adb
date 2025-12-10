import {log} from '../logger.js';
import path from 'path';
import {fs, tempDir, util} from '@appium/support';
import {LRUCache} from 'lru-cache';
import {unzipFile} from '../helpers.js';
import AsyncLock from 'async-lock';
import B from 'bluebird';
import crypto from 'crypto';
import type {ADB} from '../adb.js';
import type {ApkCreationOptions, StringRecord} from './types.js';

const AAB_CACHE = new LRUCache<string, string>({
  max: 10,
  dispose: (extractedFilesRoot) => fs.rimraf(extractedFilesRoot),
});
const AAB_CACHE_GUARD = new AsyncLock();
const UNIVERSAL_APK = 'universal.apk';

process.on('exit', () => {
  if (!AAB_CACHE.size) {
    return;
  }

  const paths = [...AAB_CACHE.values()];
  log.debug(
    `Performing cleanup of ${paths.length} cached .aab ` + util.pluralize('package', paths.length),
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
 * Builds a universal .apk from the given .aab package. See
 * https://developer.android.com/studio/command-line/bundletool#generate_apks
 * for more details.
 *
 * @param aabPath Full path to the source .aab package
 * @param opts Options for APK creation
 * @returns The path to the resulting universal .apk. The .apk is stored in the internal cache
 * by default.
 * @throws {Error} If there was an error while creating the universal .apk
 */
export async function extractUniversalApk(
  this: ADB,
  aabPath: string,
  opts: ApkCreationOptions = {},
): Promise<string> {
  if (!(await fs.exists(aabPath))) {
    throw new Error(`The file at '${aabPath}' either does not exist or is not accessible`);
  }

  const aabName = path.basename(aabPath);
  const apkName = aabName.substring(0, aabName.length - path.extname(aabName).length) + '.apk';
  const tmpRoot = await tempDir.openDir();
  const tmpApksPath = path.join(tmpRoot, `${aabName}.apks`);
  try {
    return await AAB_CACHE_GUARD.acquire(aabPath, async () => {
      const aabHash = await fs.hash(aabPath);
      const {keystore, keystorePassword, keyAlias, keyPassword} = opts;
      let cacheHash = aabHash;
      if (keystore) {
        if (!(await fs.exists(keystore))) {
          throw new Error(
            `The keystore file at '${keystore}' either does not exist ` + `or is not accessible`,
          );
        }
        if (!keystorePassword || !keyAlias || !keyPassword) {
          throw new Error(
            'It is mandatory to also provide keystore password, key alias, ' +
              'and key password if the keystore path is set',
          );
        }
        const keystoreHash = await fs.hash(keystore);
        const keyAliasHash = crypto.createHash('sha1');
        keyAliasHash.update(keyAlias);
        cacheHash = [cacheHash, keystoreHash, keyAliasHash.digest('hex')].join(':');
      }
      log.debug(`Calculated the cache key for '${aabPath}': ${cacheHash}`);
      if (AAB_CACHE.has(cacheHash)) {
        const cachedRoot = AAB_CACHE.get(cacheHash);
        if (cachedRoot) {
          const resultPath = path.resolve(cachedRoot, apkName);
          if (await fs.exists(resultPath)) {
            return resultPath;
          }
        }
        AAB_CACHE.delete(cacheHash);
      }

      await this.initAapt2();
      const binaries = this.binaries as StringRecord;
      const args = [
        'build-apks',
        '--aapt2',
        binaries.aapt2,
        '--bundle',
        aabPath,
        '--output',
        tmpApksPath,
        ...(keystore
          ? [
              '--ks',
              keystore,
              '--ks-pass',
              `pass:${keystorePassword}`,
              '--ks-key-alias',
              keyAlias,
              '--key-pass',
              `pass:${keyPassword}`,
            ]
          : []),
        '--mode=universal',
      ];
      log.debug(`Preparing universal .apks bundle from '${aabPath}'`);
      await this.execBundletool(args, `Cannot build a universal .apks bundle from '${aabPath}'`);

      log.debug(`Unpacking universal application bundle at '${tmpApksPath}' to '${tmpRoot}'`);
      await unzipFile(tmpApksPath, tmpRoot);
      let universalApkPath: string | undefined;
      const fileDeletionPromises: Promise<void>[] = [];
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
      } catch {}
      if (!universalApkPath) {
        log.debug(`The following items were extracted from the .aab bundle: ${allFileNames}`);
        throw new Error(
          `${UNIVERSAL_APK} cannot be found in '${aabPath}' bundle. ` +
            `Does the archive contain a valid application bundle?`,
        );
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
}

