import { exec } from 'teen_process';
import log from '../logger.js';
import { getAndroidPlatformAndPath, unzipFile, assertZipArchive,
         getApkanalyzerForOs } from '../helpers.js';
import { fs } from 'appium-support';
import _ from 'lodash';
import path from 'path';
import xmldom from 'xmldom';
import xpath from 'xpath';

let manifestMethods = {};

// android:process= may be defined in AndroidManifest.xml
// http://developer.android.com/reference/android/R.attr.html#process
// note that the process name when used with ps must be truncated to the last 15 chars
// ps -c com.example.android.apis becomes ps -c le.android.apis
manifestMethods.processFromManifest = async function (localApk) {
  await this.initAapt();
  log.info("Retrieving process from manifest");
  let args = ['dump', 'xmltree', localApk, 'AndroidManifest.xml'];
  let {stdout} = await exec(this.binaries.aapt, args);
  let result = null;
  let lines = stdout.split("\n");
  let applicationRegex = new RegExp(/\s+E: application \(line=\d+\).*/);
  let applicationFound = false;
  let attributeRegex = new RegExp(/\s+A: .+/);
  let processRegex = new RegExp(/\s+A: android:process\(0x01010011\)="([^"]+).*"/);
  for (let line of lines) {
    if (!applicationFound) {
      if (applicationRegex.test(line)) {
        applicationFound = true;
      }
    } else {
      let notAttribute = !attributeRegex.test(line);
      // process must be an attribute after application.
      if (notAttribute) {
        break;
      }
      let process = processRegex.exec(line);
      // this is an application attribute process.
      if (process && process.length > 1) {
        result = process[1];
        // must trim to last 15 for android's ps binary
        if (result.length > 15) {
          result = result.substr(result.length - 15);
        }
        break;
      }
    }
  }
  return result;
};

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
  log.info("Extracting package and launch activity from manifest");
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
  const manifestXml = (await exec(apkanalyzerPath, args, {
    shell: true,
    cwd: path.dirname(apkanalyzerPath)
  })).stdout;
  const doc = new xmldom.DOMParser().parseFromString(manifestXml);
  const apkPackageAttribute = xpath.select1('//manifest/@package', doc);
  if (!apkPackageAttribute) {
    throw new Error(`Cannot parse package name from ${manifestXml}`);
  }
  const apkPackage = apkPackageAttribute.value;
  // Look for activity or activity-alias with
  // action == android.intent.action.MAIN and
  // category == android.intent.category.LAUNCHER
  // descendants
  const apkActivityAttribute = xpath.select1(
    "//application/*[starts-with(name(), 'activity') " +
    "and .//action[@*[local-name()='name' and .='android.intent.action.MAIN']] " +
    "and .//category[@*[local-name()='name' and .='android.intent.category.LAUNCHER']]]" +
    "/@*[local-name()='name']", doc);
  if (!apkActivityAttribute) {
    throw new Error(`Cannot parse main activity name from ${manifestXml}`);
  }
  const apkActivity = apkActivityAttribute.value;
  return {apkPackage, apkActivity};
}

/**
 * Extract package and main activity name from application manifest.
 *
 * @param {string} localApk - The full path to application package.
 * @return {APKInfo} The parsed application info.
 * @throws {error} If there was an error while getting the data from the given
 *                 application package.
 */
manifestMethods.packageAndLaunchActivityFromManifest = async function (localApk) {
  const apkInfoGetters = [
    async () => {
      const apkanalyzerPath = await getApkanalyzerForOs(this);
      return await extractApkInfoWithApkanalyzer(localApk, apkanalyzerPath);
    },
    async () => {
      await this.initAapt();
      return await extractApkInfoWithApkTools(localApk,
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
        log.info(`Using the alternative activity name detection method `+
                 `because of: ${e.message}`);
      }
      savedError = e;
    }
  }
  throw new Error(`packageAndLaunchActivityFromManifest failed. ` +
                  `Original error: ${savedError.message}` +
                  (savedError.stderr ? `; StdErr: ${savedError.stderr}` : ''));
};

/**
 * Extract target SDK version from application manifest.
 *
 * @param {string} localApk - The full path to application package.
 * @return {number} The version of the target SDK.
 * @throws {error} If there was an error while getting the data from the given
 *                 application package.
 */
manifestMethods.targetSdkVersionFromManifest = async function (localApk) {
  await this.initAapt();
  log.info("Extracting package and launch activity from manifest");
  let args = ['dump', 'badging', localApk];
  let output;
  try {
    let {stdout} = await exec(this.binaries.aapt, args);
    output = stdout;
  } catch (e) {
    throw new Error(`fetching targetSdkVersion from local APK failed. Original error: ${e.message}`);
  }
  let targetSdkVersion = new RegExp(/targetSdkVersion:'([^']+)'/g).exec(output);
  if (!targetSdkVersion) {
    throw new Error(`targetSdkVersion is not specified in the application.`);
  }
  return parseInt(targetSdkVersion[1], 10);
};

/**
 * Extract target SDK version from package information.
 *
 * @param {string} pkg - The class name of the package installed on the device under test.
 * @return {number} The version of the target SDK.
 */
manifestMethods.targetSdkVersionUsingPKG = async function (pkg) {
  let stdout =  await this.shell(['dumpsys', 'package', pkg]);
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
manifestMethods.compileManifest = async function (manifest, manifestPackage, targetPackage) {
  log.debug(`Compiling manifest ${manifest}`);
  let {platform, platformPath} = await getAndroidPlatformAndPath();
  if (!platform) {
    throw new Error("Required platform doesn't exist (API level >= 17)");
  }
  log.debug('Compiling manifest.');
  await this.initAapt();
  try {
    await exec(this.binaries.aapt, [
      'package',
      '-M', manifest,
      '--rename-manifest-package', manifestPackage,
      '--rename-instrumentation-target-package', targetPackage,
      '-I', path.resolve(platformPath, 'android.jar'),
      '-F', `${manifest}.apk`,
      '-f',
    ]);
    log.debug("Compiled manifest");
  } catch (err) {
    throw new Error(`Error compiling manifest. Original error: ${err.message}`);
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
manifestMethods.insertManifest = async function (manifest, srcApk, dstApk) {
  log.debug(`Inserting manifest, src: ${srcApk} dst: ${dstApk}`);
  await this.initAapt();
  await unzipFile(`${manifest}.apk`);
  await fs.copyFile(srcApk, dstApk);
  log.debug("Testing new tmp apk");
  await assertZipArchive(dstApk);
  log.debug("Moving manifest");
  try {
    await exec(this.binaries.aapt, [
      'remove', dstApk, path.basename(manifest)
    ]);
  } catch (ign) {}
  await exec(this.binaries.aapt, [
    'add', dstApk, path.basename(manifest)
  ], {cwd: path.dirname(manifest)});
  log.debug("Inserted manifest.");
};

/**
 * Check whether package manifest contains Internet permissions.
 *
 * @param {string} localApk - The full path to application package.
 * @return {boolean} True if the manifest requires Internet access permission.
 */
manifestMethods.hasInternetPermissionFromManifest = async function (localApk) {
  await this.initAapt();
  log.debug(`Checking if '${localApk}' requires internet access permission in the manifest`);
  try {
    let {stdout} = await exec(this.binaries.aapt, ['dump', 'badging', localApk]);
    return new RegExp(/uses-permission:.*'android.permission.INTERNET'/).test(stdout);
  } catch (e) {
    throw new Error(`Cannot check if '${localApk}' requires internet access permission. ` +
                    `Original error: ${e.message}`);
  }
};


export default manifestMethods;
