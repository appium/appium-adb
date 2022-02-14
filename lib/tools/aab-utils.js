import log from '../logger.js';
import path from 'path';
import { fs, tempDir, util } from '@appium/support';
import LRU from 'lru-cache';
import { unzipFile } from '../helpers.js';
import AsyncLock from 'async-lock';
import B from 'bluebird';

const AAB_CACHE = new LRU({
  max: 10,
  dispose: (aabHash, extractedFilesRoot) => fs.rimraf(extractedFilesRoot),
});
const AAB_CACHE_GUARD = new AsyncLock();
const UNIVERSAL_APK = 'universal.apk';

const aabUtilsMethods = {};

process.on('exit', () => {
  if (!AAB_CACHE.size) {
    return;
  }

  const paths = [...AAB_CACHE.values()];
  log.debug(`Performing cleanup of ${paths.length} cached .aab ` +
    util.pluralize('package', paths.length));
  for (const appPath of paths) {
    try {
      // Asynchronous calls are not supported in onExit handler
      fs.rimrafSync(appPath);
    } catch (e) {
      log.warn(e.message);
    }
  }
});

aabUtilsMethods.extractUniversalApk = async function extractUniversalApk (aabPath) {
  if (!await fs.exists(aabPath)) {
    throw new Error(`The file at '${aabPath}' either does not exist or is not accessible`);
  }

  const aabName = path.basename(aabPath);
  const apkName = aabName.substring(0, aabName.length - path.extname(aabName)) + '.apk';
  const tmpRoot = await tempDir.openDir();
  const tmpApksPath = path.join(tmpRoot, `${aabName}.apks`);
  try {
    return await AAB_CACHE_GUARD.acquire(aabPath, async () => {
      const aabHash = await fs.hash(aabPath);
      log.debug(`Calculated '${aabPath}' hash: ${aabHash}`);
      if (AAB_CACHE.has(aabHash)) {
        const resultPath = path.resolve(AAB_CACHE.get(aabHash), apkName);
        if (await fs.exists(resultPath)) {
          return resultPath;
        }
        AAB_CACHE.del(aabHash);
      }

      await this.initAapt2();
      const args = [
        'build-apks',
        '--aapt2', this.binaries.aapt2,
        '--bundle', aabPath,
        '--output', tmpApksPath,
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
      AAB_CACHE.set(aabHash, tmpRoot);
      return resultPath;
    });
  } catch (e) {
    await fs.rimraf(tmpRoot);
    throw e;
  }
};

export default aabUtilsMethods;
