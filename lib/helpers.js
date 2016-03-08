import path from 'path';
import { system, fs } from 'appium-support';
import log from './logger.js';
import AdmZip from 'adm-zip';
import { exec } from 'teen_process';
import _ from 'lodash';


const rootDir = path.resolve(__dirname, process.env.NO_PRECOMPILE ? '..' : '../..');
const androidPlatforms = ['android-4.2', 'android-17', 'android-4.3', 'android-18',
                          'android-4.4', 'android-19', 'android-L', 'android-20',
                          'android-5.0', 'android-21', 'android-22', 'android-MNC',
                          'android-23', 'android-6.0'];

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
  if (!_.isString(androidHome)) {
    log.error("ANDROID_HOME was not exported!");
    return null;
  }

  // get the latest platform and path
  for (let platform of _.clone(androidPlatforms).reverse()) {
    let platforms = path.resolve(androidHome, 'platforms');
    let platformPath = path.resolve(platforms, platform);
    if (await fs.exists(platformPath)) {
      return {platform, platformPath};
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
    if (await fs.exists(zipPath)) {
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
  const sep = path.sep;
  let java = `${getJavaHome()}${sep}bin${sep}java`;
  if (system.isWindows()) {
    java = java + '.exe';
  }
  return java;
}

function getJavaHome () {
  if (process.env.JAVA_HOME) {
    return process.env.JAVA_HOME;
  }
  throw new Error("JAVA_HOME is not set currently. Please set JAVA_HOME.");
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
    // expect optionalIntentArguments to be something like '-x options',
    // '-y option argument' or a combination of the two
    let argRe = /(-[^\s]+) ([^-]+)/g;
    while (true) {
      let optionalIntentArguments = argRe.exec(startAppOptions.optionalIntentArguments);
      if (!optionalIntentArguments) {
        break;
      }
      let flag = optionalIntentArguments[1];
      let space = optionalIntentArguments[2].indexOf(' ');
      let arg, value;
      if (space === -1) {
        arg = optionalIntentArguments[2];
      } else {
        arg = optionalIntentArguments[2].substring(0, space).trim();
        value = optionalIntentArguments[2].substring(space + 1).trim();
      }
      cmd.push(flag, arg);
      if (value) {
        cmd.push(value);
      }
    }
  }
  return cmd;
}

// turns pkg.activity.name to .activity.name
// also turns activity.name to .activity.name
function getPossibleActivityNames (pkgName, activityName) {
  let names = [activityName];
  // need to beware of namespaces with overlapping chars:
  //   com.foo.bar
  //   com.foo.barx
  if (activityName.indexOf(`${pkgName}.`) === 0) {
    names.push(activityName.substring(pkgName.length));
  }
  if (activityName[0] !== '.') {
    names.push(`.${activityName}`);
  }
  return names;
}

export { getDirectories, getAndroidPlatformAndPath, unzipFile, assertZipArchive,
         getIMEListFromOutput, getJavaForOs, isShowingLockscreen, isCurrentFocusOnKeyguard,
         isScreenOnFully, buildStartCmd, getPossibleActivityNames, getJavaHome,
         rootDir, androidPlatforms };
