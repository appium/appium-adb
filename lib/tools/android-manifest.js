import { exec } from 'teen_process';
import log from '../logger.js';
import {
  getAndroidPlatformAndPath, unzipFile,
  getApkanalyzerForOs, APKS_EXTENSION, parseManifest } from '../helpers.js';
import { fs, zip } from 'appium-support';
import _ from 'lodash';
import path from 'path';
import { quote } from 'shell-quote';

let manifestMethods = {};

/**
 * @typedef {Object} APKInfo
 * @property {string} apkPackage - The name of application package, for example 'com.acme.app'.
 * @property {string} apkActivity - The name of main application activity.
 */

/**
 * Extract package and main activity name from application manifest using
 * the custom apk tools.
 *
 * @param {string} localApk - The full path to application package.
 * @param {string} aaptPath - The full path to appt binary.
 * @param {string} jarPath - The full path to appium_apk_tools.jar utility
 * @param {string} tmpRoot - The full path to the class-wide temporary folder.
 * @return {APKInfo} The parsed application info.
 * @throws {Error} If there was an error while getting the data from the given
 *                 application package.
 */
async function extractApkInfoWithApkTools (localApk, aaptPath, jarPath, tmpRoot) {
  log.info('Extracting package and launch activity from manifest');
  let args = ['dump', 'badging', localApk];
  let stdout = (await exec(aaptPath, args)).stdout;
  let apkPackage = new RegExp(/package: name='([^']+)'/g).exec(stdout);
  if (!apkPackage || apkPackage.length < 2) {
    throw new Error(`Cannot parse package name from ` +
      `'${_.join([aaptPath, 'dump', 'badging', '"' + localApk + '"'], ' ')}' command  output`);
  }
  apkPackage = apkPackage[1];
  let apkActivity = new RegExp(/launchable-activity: name='([^']+)'/g).exec(stdout);
  if (apkActivity && apkActivity.length >= 2) {
    apkActivity = apkActivity[1];
    return {apkPackage, apkActivity};
  }

  let outputPath = path.resolve(tmpRoot, apkPackage);
  let getLaunchActivity = [
    '-jar', jarPath,
    'printLaunchActivity', localApk,
    outputPath
  ];
  const output = await exec('java', getLaunchActivity);
  if (output.stderr) {
    throw new Error(`Cannot parse launchActivity from manifest: ${output.stderr}`);
  }
  stdout = output.stdout;
  let act = new RegExp(/Launch activity parsed:([^']+)/g).exec(stdout);
  if (act && act.length >= 2) {
    apkActivity = act[1];
    return {apkPackage, apkActivity};
  }
  throw new Error(`Cannot parse main activity name from '${stdout}' command  output`);
}

/**
 * Extract package and main activity name from application manifest using
 * apkanalyzer tool.
 *
 * @param {string} localApk - The full path to application package.
 * @param {string} apkanalyzerPath - The full path to apkanalyzer tool.
 * @return {APKInfo} The parsed application info.
 * @throws {Error} If there was an error while getting the data from the given
 *                 application package or if the tool itself
 *                 is not present on the local file system.
 */
async function extractApkInfoWithApkanalyzer (localApk, apkanalyzerPath) {
  const args = ['-h', 'manifest', 'print', localApk];
  log.debug(`Starting '${apkanalyzerPath}' with args ${JSON.stringify(args)}`);
  const {stdout} = await exec(apkanalyzerPath, args, {
    shell: true,
    cwd: path.dirname(apkanalyzerPath)
  });
  const {pkg, activity} = parseManifest(stdout);
  if (!pkg) {
    throw new Error(`Cannot parse package name from ${stdout}`);
  }
  if (!activity) {
    throw new Error(`Cannot parse main activity name from ${stdout}`);
  }
  return {
    apkPackage: pkg,
    apkActivity: activity,
  };
}

/**
 * Extract package and main activity name from application manifest.
 *
 * @param {string} appPath - The full path to application .apk(s) package
 * @return {APKInfo} The parsed application info.
 * @throws {error} If there was an error while getting the data from the given
 *                 application package.
 */
manifestMethods.packageAndLaunchActivityFromManifest = async function packageAndLaunchActivityFromManifest (appPath) {
  if (appPath.endsWith(APKS_EXTENSION)) {
    appPath = await this.extractBaseApk(appPath);
  }

  const apkInfoGetters = [
    async () => {
      const apkanalyzerPath = await getApkanalyzerForOs(this);
      return await extractApkInfoWithApkanalyzer(appPath, apkanalyzerPath);
    },
    async () => {
      await this.initAapt();
      return await extractApkInfoWithApkTools(appPath,
        this.binaries.aapt, this.jars['appium_apk_tools.jar'], this.tmpDir);
    },
  ];

  let savedError;
  for (const infoGetter of apkInfoGetters) {
    try {
      const {apkPackage, apkActivity} = await infoGetter();
      log.info(`Package name: '${apkPackage}'`);
      log.info(`Main activity name: '${apkActivity}'`);
      return {apkPackage, apkActivity};
    } catch (e) {
      if (infoGetter !== _.last(apkInfoGetters)) {
        log.info(`Using the alternative activity name detection method because of: ${e.message}`);
      }
      savedError = e;
    }
  }
  throw new Error(`packageAndLaunchActivityFromManifest failed. Original error: ${savedError.message}` +
                  (savedError.stderr ? `; StdErr: ${savedError.stderr}` : ''));
};

/**
 * Extract target SDK version from application manifest.
 *
 * @param {string} appPath - The full path to .apk(s) package.
 * @return {number} The version of the target SDK.
 * @throws {error} If there was an error while getting the data from the given
 *                 application package.
 */
manifestMethods.targetSdkVersionFromManifest = async function targetSdkVersionFromManifest (appPath) {
  const originalAppPath = appPath;
  if (appPath.endsWith(APKS_EXTENSION)) {
    appPath = await this.extractBaseApk(appPath);
  }

  log.info('Extracting target SDK version from the manifest');
  try {
    const apkanalyzerPath = await getApkanalyzerForOs(this);
    const {stdout} = await exec(apkanalyzerPath, ['manifest', 'target-sdk', appPath], {
      shell: true,
      cwd: path.dirname(apkanalyzerPath),
    });
    if (isNaN(_.trim(stdout))) {
      throw new Error(`Cannot parse the minimum SDK version from '${stdout}'`);
    }
    return parseInt(_.trim(stdout), 10);
  } catch (e) {
    log.info(`Cannot extract targetSdkVersion using apkanalyzer. Falling back to aapt. ` +
      `Original error: ${e.message}`);
    await this.initAapt();
    const args = ['dump', 'badging', appPath];
    let output;
    try {
      const {stdout} = await exec(this.binaries.aapt, args);
      output = stdout;
    } catch (e) {
      throw new Error(`Fetching targetSdkVersion from '${originalAppPath}' failed. ` +
        `Original error: ${e.message}`);
    }
    const targetSdkVersion = new RegExp(/targetSdkVersion:'([^']+)'/g).exec(output);
    if (!targetSdkVersion) {
      throw new Error(`targetSdkVersion is not specified in the '${originalAppPath}' application`);
    }
    return parseInt(targetSdkVersion[1], 10);
  }
};

/**
 * Extract target SDK version from package information.
 *
 * @param {string} pkg - The class name of the package installed on the device under test.
 * @param {?string} cmdOutput - Optional parameter containing the output of
 *                              _dumpsys package_ command. It may speed up the method execution.
 * @return {number} The version of the target SDK.
 */
manifestMethods.targetSdkVersionUsingPKG = async function targetSdkVersionUsingPKG (pkg, cmdOutput = null) {
  let stdout = cmdOutput || await this.shell(['dumpsys', 'package', pkg]);
  let targetSdkVersion = new RegExp(/targetSdk=([^\s\s]+)/g).exec(stdout);
  if (targetSdkVersion && targetSdkVersion.length >= 2) {
    targetSdkVersion = targetSdkVersion[1];
  } else {
    // targetSdk not found in the dump, assigning 0 to targetSdkVersion
    targetSdkVersion = 0;
  }
  return parseInt(targetSdkVersion, 10);
};

/**
 * Create binary representation of package manifest (usually AndroidManifest.xml).
 * `${manifest}.apk` file will be created as the result of this method
 * containing the compiled manifest.
 *
 * @param {string} manifest - Full path to the initial manifest template
 * @param {string} manifestPackage - The name of the manifest package
 * @param {string} targetPackage - The name of the destination package
 */
manifestMethods.compileManifest = async function compileManifest (manifest, manifestPackage, targetPackage) {
  const {platform, platformPath} = await getAndroidPlatformAndPath();
  if (!platform) {
    throw new Error('Cannot compile the manifest. The required platform does not exist (API level >= 17)');
  }
  const resultPath = `${manifest}.apk`;
  const args = [
    'package',
    '-M', manifest,
    '--rename-manifest-package', manifestPackage,
    '--rename-instrumentation-target-package', targetPackage,
    '-I', path.resolve(platformPath, 'android.jar'),
    '-F', resultPath,
    '-f',
  ];
  try {
    await this.initAapt();
    log.debug(`Compiling the manifest: ${this.binaries.aapt} ${quote(args)}`);
    await exec(this.binaries.aapt, args);
    log.debug(`Compiled the manifest at '${resultPath}'`);
  } catch (err) {
    throw new Error(`Cannot compile the manifest. Original error: ${err.message}`);
  }
};

/**
 * Replace/insert the specially precompiled manifest file into the
 * particular package.
 *
 * @param {string} manifest - Full path to the precompiled manifest
 *                            created by `compileManifest` method call
 *                            without .apk extension
 * @param {string} srcApk - Full path to the existing valid application package, where
 *                          this manifest has to be insetred to. This package
 *                          will NOT be modified.
 * @param {string} dstApk - Full path to the resulting package.
 *                          The file will be overriden if it already exists.
 */
manifestMethods.insertManifest = async function insertManifest (manifest, srcApk, dstApk) {
  log.debug(`Inserting manifest, src: ${srcApk} dst: ${dstApk}`);
  await this.initAapt();
  await unzipFile(`${manifest}.apk`);
  await fs.copyFile(srcApk, dstApk);
  log.debug('Testing new tmp apk');
  await zip.assertValidZip(dstApk);
  log.debug('Moving manifest');
  try {
    await exec(this.binaries.aapt, [
      'remove', dstApk, path.basename(manifest)
    ]);
  } catch (ign) {}
  await exec(this.binaries.aapt, [
    'add', dstApk, path.basename(manifest)
  ], {cwd: path.dirname(manifest)});
  log.debug('Inserted manifest.');
};

/**
 * Check whether package manifest contains Internet permissions.
 *
 * @param {string} appPath - The full path to .apk(s) package.
 * @return {boolean} True if the manifest requires Internet access permission.
 */
manifestMethods.hasInternetPermissionFromManifest = async function hasInternetPermissionFromManifest (appPath) {
  await this.initAapt();

  if (appPath.endsWith(APKS_EXTENSION)) {
    appPath = await this.extractBaseApk(appPath);
  }

  log.debug(`Checking if '${appPath}' requires internet access permission in the manifest`);
  try {
    let {stdout} = await exec(this.binaries.aapt, ['dump', 'badging', appPath]);
    return new RegExp(/uses-permission:.*'android.permission.INTERNET'/).test(stdout);
  } catch (e) {
    throw new Error(`Cannot check if '${appPath}' requires internet access permission. ` +
                    `Original error: ${e.message}`);
  }
};

/**
 * Prints out the manifest extracted from the apk
 *
 * @param {string} appPath - The full path to application package.
 * @param {?string} logLevel - The level at which to log. E.g., 'debug'
 */
manifestMethods.printManifestFromApk = async function printManifestFromApk (appPath, logLevel = 'debug') {
  await this.initAapt();

  if (appPath.endsWith(APKS_EXTENSION)) {
    appPath = await this.extractBaseApk(appPath);
  }

  log[logLevel](`Extracting the manifest from '${appPath}'`);
  let out = false;
  const {stdout} = await exec(this.binaries.aapt, ['l', '-a', appPath]);
  for (const line of stdout.split('\n')) {
    if (!out && line.includes('Android manifest:')) {
      out = true;
    }
    if (out) {
      log[logLevel](line);
    }
  }
};


export default manifestMethods;
