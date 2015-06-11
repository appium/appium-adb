import { fs } from './utils.js';
import path from 'path';
import { system, util } from 'appium-support';
import log from './logger.js';
import AdmZip from 'adm-zip';
import { exec } from 'teen_process';

async function getDirectories (rootPath) {
  let files = await fs.readdir(rootPath);
  let dirs = [];
  for (let file of files) {
    let pathString = path.resolve(rootPath, file);
    if ((await fs.lstat(pathString)).isDirectory()) {
      dirs.push(file);
    }
  }
  // It is not a clean way to sort it, but in this case would work fine because
  // we have numerics and alphanumeric
  // will return some thing like this
  // ["17.0.0", "18.0.1", "19.0.0", "19.0.1", "19.1.0", "20.0.0",
  //  "android-4.2.2", "android-4.3", "android-4.4"]
  return dirs.sort();
}

async function getAndroidPlatformAndPath () {
  const androidHome = process.env.ANDROID_HOME;
  if (typeof androidHome !== "string") {
    log.error("ANDROID_HOME was not exported!");
    return null;
  }
  // TODO import it from appium support
  let locs = ['android-4.2', 'android-17', 'android-4.3', 'android-18',
      'android-4.4', 'android-19', 'android-L', 'android-20', 'android-5.0',
      'android-21'];

  for (let loc of locs.reverse()) {
    let platforms = path.resolve(androidHome, 'platforms');
    let locPath = path.resolve(platforms, loc);
    if (await util.fileExists(locPath)) {
      return {platform: loc, platformPath: locPath};
    }
  }
  return null;
}

async function unzipFile (zipPath) {
  log.debug(`Unzipping ${zipPath}`);
  try {
    await assertZipArchive(zipPath);
    if (system.isWindows()) {
      let zip = new AdmZip(zipPath);
      zip.extractAllTo(path.dirname(zipPath), true);
      log.debug("Unzip successful");
    } else {
      await exec('unzip', ['-o', zipPath], {cwd: path.dirname(zipPath)});
      log.debug("Unzip successful");
    }
  } catch (e) {
    throw new Error(`Error occurred while unzipping. Original error: ${e.message}`);
  }
}

async function assertZipArchive (zipPath) {
  log.debug(`Testing zip archive: ${zipPath}`);
  if (system.isWindows()) {
    if (await util.fileExists(zipPath)) {
      log.debug("Zip archive tested clean");
    } else {
      throw new Error(`Zip archive not present at ${zipPath}`);
    }
  } else {
    let execOpts = {cwd: path.dirname(zipPath)};
    await exec('unzip', ['-tq', zipPath], execOpts);
  }
}

function getIMEListFromOutput (stdout) {
  let engines = [];
  for (let line of stdout.split('\n')) {
    if (line.length > 0 && line[0] !== ' ') {
      // remove newline and trailing colon, and add to the list
      engines.push(line.trim().replace(/:$/, ''));
    }
  }
  return engines;
}

function getJavaForOs () {
  let java = path.resolve(process.env.JAVA_HOME, 'bin', 'java');
  if (system.isWindows()) {
    java = java + '.exe';
  }
  return java;
}

/*
 * Checks mShowingLockscreen in dumpsys output to determine if lock screen is showing
 */
function isShowingLockscreen (dumpsys) {
  let m = /mShowingLockscreen=\w+/gi.exec(dumpsys);
  let ret = (m && m.length && m[0].split('=')[1] === 'true') || false;
  return ret;
}

/*
 * Checks mCurrentFocus in dumpsys output to determine if Keyguard is activated
 */
function isCurrentFocusOnKeyguard (dumpsys) {
  let m = /mCurrentFocus.+Keyguard/gi.exec(dumpsys);
  return (m && m.length && m[0]) ? true : false;
}

/*
 * Checks mScreenOnFully in dumpsys output to determine if screen is showing
 * Default is true
 */
function isScreenOnFully (dumpsys) {
  let m = /mScreenOnFully=\w+/gi.exec(dumpsys);
  return !m || // if information is missing we assume screen is fully on
         (m && m.length > 0 && m[0].split('=')[1] === 'true') || false;
}

function buildStartCmd (startAppOptions, apiLevel) {
  let cmd = ['am', 'start', '-n', `${startAppOptions.pkg}/${startAppOptions.activity}`];
  if (startAppOptions.stopApp && apiLevel >= 15) {
    cmd.push('-S');
  }
  if (startAppOptions.action) {
    cmd.push('-a', startAppOptions.action);
  }
  if (startAppOptions.category) {
    cmd.push('-c', startAppOptions.category);
  }
  if (startAppOptions.flags) {
    cmd.push('-f', startAppOptions.flags);
  }
  if (startAppOptions.optionalIntentArguments) {
    cmd.push(startAppOptions.optionalIntentArguments);
  }
  return cmd;
}

function getActivityRelativeName (pkgName, activityRelativeName) {
  let relativeName = activityRelativeName;
  // need to beware of namespaces with overlapping chars:
  //   com.foo.bar
  //   com.foo.barx
  if (activityRelativeName.indexOf(pkgName + ".") === 0) {
    relativeName = activityRelativeName.substring(pkgName.length);
  }
  return relativeName;
}

export { getDirectories, getAndroidPlatformAndPath, unzipFile, assertZipArchive,
         getIMEListFromOutput, getJavaForOs, isShowingLockscreen, isCurrentFocusOnKeyguard,
         isScreenOnFully, buildStartCmd, getActivityRelativeName};
