import path from 'path';
import { system, fs, zip } from 'appium-support';
import log from './logger.js';
import { exec } from 'teen_process';
import _ from 'lodash';
import B from 'bluebird';
import semver from 'semver';

const ZIP_MAGIC = 'PK';
const rootDir = path.resolve(__dirname, process.env.NO_PRECOMPILE ? '..' : '../..');

/**
 * @typedef {Object} PlatformInfo
 * @property {?string} platform - The platform name, for example `android-24`
 *                                or `null` if it cannot be found
 * @property {?string} platformPath - Full path to the platform SDK folder
 *                                    or `null` if it cannot be found
 */

/**
 * Retrieve the path to the recent installed Android platform.
 *
 * @return {PlatformInfo} The resulting path to the newest installed platform.
 */
async function getAndroidPlatformAndPath () {
  const androidHome = process.env.ANDROID_HOME;
  if (!_.isString(androidHome)) {
    throw new Error("ANDROID_HOME environment variable was not exported");
  }

  let propsPaths = await fs.glob(path.resolve(androidHome, 'platforms', '*', 'build.prop'), {
    absolute: true
  });
  const platformsMapping = {};
  for (const propsPath of propsPaths) {
    const propsContent = await fs.readFile(propsPath, 'utf-8');
    const platformPath = path.dirname(propsPath);
    const platform = path.basename(platformPath);
    const match = /ro\.build\.version\.sdk=(\d+)/.exec(propsContent);
    if (!match) {
      log.warn(`Cannot read the SDK version from '${propsPath}'. Skipping '${platform}'`);
      continue;
    }
    platformsMapping[parseInt(match[1], 10)] = {
      platform,
      platformPath,
    };
  }
  if (_.isEmpty(platformsMapping)) {
    log.warn(`Found zero platform folders at '${path.resolve(androidHome, 'platforms')}'. ` +
             `Do you have any Android SDKs installed?`);
    return {
      platform: null,
      platformPath: null,
    };
  }

  const recentSdkVersion = _.keys(platformsMapping).sort().reverse()[0];
  const result = platformsMapping[recentSdkVersion];
  log.debug(`Found the most recent Android platform: ${JSON.stringify(result)}`);
  return result;
}

async function unzipFile (zipPath) {
  log.debug(`Unzipping ${zipPath}`);
  try {
    await assertZipArchive(zipPath);
    if (system.isWindows()) {
      await zip.extractAllTo(zipPath, path.dirname(zipPath));
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
  log.debug(`Testing zip archive: '${zipPath}'`);
  if (!await fs.exists(zipPath)) {
    throw new Error(`Zip archive does not exist at '${zipPath}'`);
  }

  const {size} = await fs.stat(zipPath);
  if (size < 4) {
    throw new Error(`The file at '${zipPath}' is too small to be a ZIP archive`);
  }
  const fd = await fs.open(zipPath, 'r');
  const buffer = new Buffer(ZIP_MAGIC.length);
  await fs.read(fd, buffer, 0, ZIP_MAGIC.length, 0);
  if (buffer.toString('ascii') !== ZIP_MAGIC) {
    throw new Error(`The file signature '${buffer.toString('ascii')}' of '${zipPath}' ` +
                    `is not equal to the expected ZIP archive signature '${ZIP_MAGIC}'`);
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

const getJavaForOs = _.memoize(() => {
  return path.resolve(getJavaHome(), 'bin', `java${system.isWindows() ? '.exe' : ''}`);
});

function getJavaHome () {
  if (process.env.JAVA_HOME) {
    return process.env.JAVA_HOME;
  }
  throw new Error("JAVA_HOME is not set currently. Please set JAVA_HOME.");
}

/**
 * Get the absolute path to apksigner tool
 *
 * @param {Object} sysHelpers - An instance containing systemCallMethods helper methods
 * @returns {string} An absolute path to apksigner tool.
 * @throws {Error} If the tool is not present on the local file system.
 */
async function getApksignerForOs (sysHelpers) {
  return await sysHelpers.getBinaryFromSdkRoot('apksigner');
}

/**
 * Get the absolute path to apkanalyzer tool.
 * https://developer.android.com/studio/command-line/apkanalyzer.html
 *
 * @param {Object} sysHelpers - An instance containing systemCallMethods helper methods
 * @returns {string} An absolute path to apkanalyzer tool.
 * @throws {Error} If the tool is not present on the local file system.
 */
async function getApkanalyzerForOs (sysHelpers) {
  return await sysHelpers.getBinaryFromSdkRoot('apkanalyzer');
}

 /**
  * Checks mShowingLockscreen or mDreamingLockscreen in dumpsys output to determine
  * if lock screen is showing
  *
  * @param {string} dumpsys - The output of dumpsys window command.
  * @return {boolean} True if lock screen is showing.
  */
function isShowingLockscreen (dumpsys) {
  return /(mShowingLockscreen=true|mDreamingLockscreen=true)/gi.test(dumpsys);
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
  return m && parseInt(m[0].split(':')[1], 10);
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

const getSdkToolsVersion = _.memoize(async function getSdkToolsVersion () {
  const androidHome = process.env.ANDROID_HOME;
  if (!androidHome) {
    throw new Error('ANDROID_HOME environment variable is expected to be set');
  }
  const propertiesPath = path.resolve(androidHome, 'tools', 'source.properties');
  if (!await fs.exists(propertiesPath)) {
    log.warn(`Cannot find ${propertiesPath} file to read SDK version from`);
    return;
  }
  const propertiesContent = await fs.readFile(propertiesPath, 'utf8');
  const versionMatcher = new RegExp(/Pkg\.Revision=(\d+)\.?(\d+)?\.?(\d+)?/);
  const match = versionMatcher.exec(propertiesContent);
  if (match) {
    return {
      major: parseInt(match[1], 10),
      minor: match[2] ? parseInt(match[2], 10) : 0,
      build: match[3] ? parseInt(match[3], 10) : 0
    };
  }
  log.warn(`Cannot parse "Pkg.Revision" value from ${propertiesPath}`);
});

/**
 * Retrieves full paths to all 'build-tools' subfolders under the particular
 * SDK root folder
 *
 * @param {string} sdkRoot - The full path to the Android SDK root folder
 * @returns {Array<string>} The full paths to the resulting folders sorted by
 * modification date (the newest comes first) or an empty list if no macthes were found
 */
const getBuildToolsDirs = _.memoize(async function getBuildToolsDirs (sdkRoot) {
  let buildToolsDirs = await fs.glob(path.resolve(sdkRoot, 'build-tools', '*'), {absolute: true});
  try {
    buildToolsDirs = buildToolsDirs
      .map((dir) => [path.basename(dir), dir])
      .sort((a, b) => semver.rcompare(a[0], b[0]))
      .map((pair) => pair[1]);
  } catch (err) {
    log.warn(`Cannot sort build-tools folders ${JSON.stringify(buildToolsDirs.map((dir) => path.basename(dir)))} ` +
             `by semantic version names.`);
    log.warn(`Falling back to sorting by modification date. Original error: ${err.message}`);
    const pairs = await B.map(buildToolsDirs, async (dir) => [(await fs.stat(dir)).mtime.valueOf(), dir]);
    buildToolsDirs = pairs
      .sort((a, b) => a[0] < b[0])
      .map((pair) => pair[1]);
  }
  log.info(`Found ${buildToolsDirs.length} 'build-tools' folders under '${sdkRoot}' (newest first):`);
  for (let dir of buildToolsDirs) {
    log.info(`    ${dir}`);
  }
  return buildToolsDirs;
});

export { getAndroidPlatformAndPath, unzipFile, assertZipArchive,
         getIMEListFromOutput, getJavaForOs, isShowingLockscreen, isCurrentFocusOnKeyguard,
         getSurfaceOrientation, isScreenOnFully, buildStartCmd, getJavaHome,
         rootDir, getSdkToolsVersion, getApksignerForOs, getBuildToolsDirs,
         getApkanalyzerForOs };
