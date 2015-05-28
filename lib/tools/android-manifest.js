import { exec } from 'teen_process';
import log from '../logger.js';

let manifestMethods = {};

// android:process= may be defined in AndroidManifest.xml
// http://developer.android.com/reference/android/R.attr.html#process
// note that the process name when used with ps must be truncated to the last 15 chars
// ps -c com.example.android.apis becomes ps -c le.android.apis
manifestMethods.processFromManifest = async function (localApk) {
  try {
    await this.initAapt();
    log.info("Retrieving process from manifest.");
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
    throw new Error(`processFromManifest failed. Original error ${e.message}`);
  }
};

manifestMethods.packageAndLaunchActivityFromManifest = async function (localApk) {
  try {
    await this.initAapt();
    log.info("Extracting package and launch activity from manifest.");
    let args = ['dump', 'badging', localApk];
    let {stdout} = await exec(this.binaries.aapt, args);
    let apkPackage = new RegExp(/package: name='([^']+)'/g).exec(stdout);
    if (apkPackage && apkPackage.length >= 2) {
      apkPackage = apkPackage[1];
    } else {
      apkPackage = null;
    }
    let apkActivity = new RegExp(/launchable-activity: name='([^']+)'/g).exec(stdout);
    if (apkActivity && apkActivity.length >= 2) {
      apkActivity = apkActivity[1];
    } else {
      apkActivity = null;
    }
    log.debug(`badging package: ${apkPackage}`);
    log.debug(`badging act: ${apkActivity}`);
    return {apkPackage, apkActivity};
  } catch (e) {
    return new Error(`packageAndLaunchActivityFromManifest failed. Original error ${e.message}`);
  }
};

export default manifestMethods;
