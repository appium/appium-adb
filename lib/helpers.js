import path from 'path';
import { system, fs } from 'appium-support';
import log from './logger.js';
import AdmZip from 'adm-zip';
import { exec } from 'teen_process';
import _ from 'lodash';
import readline from 'readline';
import Promise from 'bluebird';

const rootDir = path.resolve(__dirname, process.env.NO_PRECOMPILE ? '..' : '../..');
const androidPlatforms = ['android-4.2', 'android-17', 'android-4.3', 'android-18',
                          'android-4.4', 'android-19', 'android-L', 'android-20',
                          'android-5.0', 'android-21', 'android-22', 'android-MNC',
                          'android-23', 'android-6.0', 'android-N', 'android-24',
                          'android-25'];

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
  let platforms = path.resolve(androidHome, 'platforms');
  for (let platform of _.clone(androidPlatforms).reverse()) {
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

async function getSdkToolsVersion() {
    return new Promise((resolve) => {
        const androidHome = process.env.ANDROID_HOME;
        let tools = path.resolve(androidHome, 'tools');

        var rd = readline.createInterface({
            input: fs.createReadStream(tools + '/source.properties'),
            output: process.stdout,
            console: false
        });

        rd.on('line', function(line) {
            if (line.indexOf("Pkg.Revision") <= -1) {
                return;
            }
            let version = line.substr(line.indexOf("="));
            log.debug(`Using Android version: ${version}`);
            resolve(version);
        });
    });
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
 * Reads SurfaceOrientation in dumpsys output
 */
function getSurfaceOrientation (dumpsys) {
  let m = /SurfaceOrientation: \d/gi.exec(dumpsys);
  return m && parseInt(m[0].split(':')[1]);
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
  let cmd = ['am', 'start', '-W', '-n', `${startAppOptions.pkg}/${startAppOptions.activity}`];
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
    // expect optionalIntentArguments to be a single string of the form:
    //     "-flag key"
    //     "-flag key value"
    // or a combination of these (e.g., "-flag1 key1 -flag2 key2 value2")

    // take a string and parse out the part before any spaces, and anything after
    // the first space
    let parseKeyValue = function (str) {
      str = str.trim();
      let space = str.indexOf(' ');
      if (space === -1) {
        return str.length ? [str] : [];
      } else {
        return [str.substring(0, space).trim(), str.substring(space + 1).trim()];
      }
    };

    // cycle through the optionalIntentArguments and pull out the arguments
    // add a space initially so flags can be distinguished from arguments that
    // have internal hyphens
    let optionalIntentArguments = ` ${startAppOptions.optionalIntentArguments}`;
    let re = / (-[^\s]+) (.+)/;
    while (true) { // eslint-disable-line no-constant-condition
      let args = re.exec(optionalIntentArguments);
      if (!args) {
        if (optionalIntentArguments.length) {
          // no more flags, so the remainder can be treated as 'key' or 'key value'
          cmd.push.apply(cmd, parseKeyValue(optionalIntentArguments));
        }
        // we are done
        break;
      }

      // take the flag and see if it is at the beginning of the string
      // if it is not, then it means we have been through already, and
      // what is before the flag is the argument for the previous flag
      let flag = args[1];
      let flagPos = optionalIntentArguments.indexOf(flag);
      if (flagPos !== 0) {
        let prevArgs = optionalIntentArguments.substring(0, flagPos);
        cmd.push.apply(cmd, parseKeyValue(prevArgs));
      }

      // add the flag, as there are no more earlier arguments
      cmd.push(flag);

      // make optionalIntentArguments hold the remainder
      optionalIntentArguments = args[2];
    }
  }
  return cmd;
}


export { getDirectories, getSdkToolsVersion, getAndroidPlatformAndPath, unzipFile, assertZipArchive,
         getIMEListFromOutput, getJavaForOs, isShowingLockscreen, isCurrentFocusOnKeyguard,
         getSurfaceOrientation, isScreenOnFully, buildStartCmd, getJavaHome,
         rootDir, androidPlatforms };
