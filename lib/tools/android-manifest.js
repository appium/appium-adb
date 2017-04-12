import { exec } from 'teen_process';
import log from '../logger.js';
import { getAndroidPlatformAndPath, unzipFile, assertZipArchive } from '../helpers.js';
import { system, fs } from 'appium-support';
import _ from 'lodash';
import path from 'path';

const helperJarPath = path.resolve(__dirname, '..', '..', '..', 'jars');
let manifestMethods = {};

// android:process= may be defined in AndroidManifest.xml
// http://developer.android.com/reference/android/R.attr.html#process
// note that the process name when used with ps must be truncated to the last 15 chars
// ps -c com.example.android.apis becomes ps -c le.android.apis
manifestMethods.processFromManifest = async function (localApk) {
  try {
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
  } catch (e) {
    log.errorAndThrow(`processFromManifest failed. Original error: ${e.message}`);
  }
};

manifestMethods.packageAndLaunchActivityFromManifest = async function (localApk) {
  try {
    await this.initAapt();
    log.info("Extracting package and launch activity from manifest");
    let args = ['dump', 'badging', localApk];
    let {stdout} = await exec(this.binaries.aapt, args);
    let apkPackage = new RegExp(/package: name='([^']+)'/g).exec(stdout);
    if (apkPackage && apkPackage.length >= 2) {
      apkPackage = apkPackage[1];
    } else {
      log.errorAndThrow(`Cannot parse package name from ` +
        `'${_.join([this.binaries.aapt, 'dump', 'badging', '"' + localApk + '"'], ' ')}' command  output`);
    }
    let apkActivity = new RegExp(/launchable-activity: name='([^']+)'/g).exec(stdout);
    if (apkActivity && apkActivity.length >= 2) {
      apkActivity = apkActivity[1];
    } else {
      let outputPath = path.resolve(this.tmpDir, apkPackage);
      let getLaunchActivity = ['-jar', this.jars['appium_apk_tools.jar'],
                               'printLaunchActivity', localApk,
                               outputPath];
      let {stdout, stderr} = await exec('java', getLaunchActivity);
      if (stderr) {
        log.errorAndThrow(`Cannot parse launchActivity from manifest: ${stderr}`);
      }
      let act = new RegExp(/Launch activity parsed:([^']+)/g).exec(stdout);
      if (act && act.length >= 2) {
        apkActivity = act[1];
      }
    }
    log.debug(`badging package: ${apkPackage}`);
    log.debug(`badging act: ${apkActivity}`);
    return {apkPackage, apkActivity};
  } catch (e) {
    log.errorAndThrow(`packageAndLaunchActivityFromManifest failed. Original error: ${e.message}`);
  }
};

manifestMethods.targetSdkVersionFromManifest = async function (localApk) {
  try {
    await this.initAapt();
    log.info("Extracting package and launch activity from manifest");
    let args = ['dump', 'badging', localApk];
    let {stdout} = await exec(this.binaries.aapt, args);
    let targetSdkVersion = new RegExp(/targetSdkVersion:'([^']+)'/g).exec(stdout);
    if (!targetSdkVersion) {
      throw new Error(`targetSdkVersion is not specified in the application.`);
    }
    return parseInt(targetSdkVersion[1], 10);
  } catch (e) {
    log.errorAndThrow(`fetching targetSdkVersion from local APK failed. Original error: ${e.message}`);
  }
};

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

manifestMethods.compileManifest = async function (manifest, manifestPackage, targetPackage) {
  log.debug(`Compiling manifest ${manifest}`);
  let {platform, platformPath} = await getAndroidPlatformAndPath();
  if (!platform) {
    return new Error("Required platform doesn't exist (API level >= 17)");
  }
  log.debug('Compiling manifest.');
  try {
    let args = ['package', '-M', manifest, '--rename-manifest-package',
                manifestPackage, '--rename-instrumentation-target-package',
                targetPackage, '-I', path.resolve(platformPath, 'android.jar'),
                '-F', manifest + '.apk', '-f'];
    await exec(this.binaries.aapt, args);
    log.debug("Compiled manifest");
  } catch (err) {
    log.errorAndThrow(`Error compiling manifest. Original error: ${err.message}`);
  }
};

manifestMethods.insertManifest = async function (manifest, srcApk, dstApk) {
  log.debug(`Inserting manifest, src: ${srcApk} dst: ${dstApk}`);
  try {
    await unzipFile(`${manifest}.apk`);
    await fs.copyFile(srcApk, dstApk);
    log.debug("Testing new tmp apk");
    await assertZipArchive(dstApk);
    log.debug("Moving manifest");
    if (system.isWindows()) {
      let java = path.resolve(process.env.JAVA_HOME, 'bin', 'java');
      let args = ['-jar',  path.resolve(helperJarPath, 'move_manifest.jar'),
                  dstApk, manifest];
      await exec(java, args);
    } else {
      // Insert compiled manifest into /tmp/appPackage.clean.apk
      // -j = keep only the file, not the dirs
      // -m = move manifest into target apk.
      await exec('zip', ['-j', '-m', dstApk, manifest]);
    }
    log.debug("Inserted manifest.");
  } catch (e) {
    log.errorAndThrow(`Error inserting manifest. Original error: ${e.message}`);
  }
};

manifestMethods.hasInternetPermissionFromManifest = async function (localApk) {
  try {
    await this.initAapt();
    log.debug("Checking if has internet permission from manifest");
    let {stdout} = await exec(this.binaries.aapt, ['dump', 'badging', localApk]);
    return new RegExp(/uses-permission:.*'android.permission.INTERNET'/).test(stdout);
  } catch (e) {
    log.errorAndThrow(`Error checking internet permission for manifest. Original error: ${e.message}`);
  }
};


export default manifestMethods;
