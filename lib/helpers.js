import path from 'path';
import { system, fs, zip, util } from 'appium-support';
import log from './logger.js';
import _ from 'lodash';
import B from 'bluebird';
import semver from 'semver';


const rootDir = path.resolve(__dirname, process.env.NO_PRECOMPILE ? '..' : '../..');
const APKS_EXTENSION = '.apks';
const APK_EXTENSION = '.apk';
const APK_INSTALL_TIMEOUT = 60000;
const APKS_INSTALL_TIMEOUT = APK_INSTALL_TIMEOUT * 2;

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

async function unzipFile (zipPath, dstRoot = path.dirname(zipPath)) {
  log.debug(`Unzipping '${zipPath}' to '${dstRoot}'`);
  await zip.assertValidZip(zipPath);
  await zip.extractAllTo(zipPath, dstRoot);
  log.debug("Unzip successful");
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

const getOpenSslForOs = async function () {
  const binaryName = `openssl${system.isWindows() ? '.exe' : ''}`;
  try {
    return await fs.which(binaryName);
  } catch (err) {
    throw new Error('The openssl tool must be installed on the system and available on the path');
  }
};

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

/**
 * Builds command line representation for the given
 * application startup options
 *
 * @param {StartAppOptions} startAppOptions - Application options mapping
 * @param {number} apiLevel - The actual OS API level
 * @returns {Array<String>} The actual command line array
 */
function buildStartCmd (startAppOptions, apiLevel) {
  let cmd = ['am', 'start'];
  if (util.hasValue(startAppOptions.user)) {
    cmd.push('--user', startAppOptions.user);
  }
  cmd.push('-W', '-n', `${startAppOptions.pkg}/${startAppOptions.activity}`);
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

/**
 * Retrieves the list of permission names encoded in `dumpsys package` command output.
 *
 * @param {string} dumpsysOutput - The actual command output.
 * @param {Array<string>} groupNames - The list of group names to list permissions for.
 * @param {?boolean} grantedState - The expected state of `granted` attribute to filter with.
 *                                  No filtering is done if the parameter is not set.
 * @returns {Array<string>} The list of matched permission names or an empty list if no matches were found.
 */
const extractMatchingPermissions = function (dumpsysOutput, groupNames, grantedState = null) {
  const groupPatternByName = (groupName) => new RegExp(`^(\\s*${_.escapeRegExp(groupName)} permissions:[\\s\\S]+)`, 'm');
  const indentPattern = /\S|$/;
  const permissionNamePattern = /android\.permission\.\w+/;
  const grantedStatePattern = /\bgranted=(\w+)/;
  const result = [];
  for (const groupName of groupNames) {
    const groupMatch = groupPatternByName(groupName).exec(dumpsysOutput);
    if (!groupMatch) {
      continue;
    }

    const lines = groupMatch[1].split('\n');
    if (lines.length < 2) {
      continue;
    }

    const titleIndent = lines[0].search(indentPattern);
    for (const line of lines.slice(1)) {
      const currentIndent = line.search(indentPattern);
      if (currentIndent <= titleIndent) {
        break;
      }

      const permissionNameMatch = permissionNamePattern.exec(line);
      if (!permissionNameMatch) {
        continue;
      }
      const item = {
        permission: permissionNameMatch[0],
      };
      const grantedStateMatch = grantedStatePattern.exec(line);
      if (grantedStateMatch) {
        item.granted = grantedStateMatch[1] === 'true';
      }
      result.push(item);
    }
  }

  const filteredResult = result
    .filter((item) => !_.isBoolean(grantedState) || item.granted === grantedState)
    .map((item) => item.permission);
  log.debug(`Retrieved ${filteredResult.length} permission(s) from ${JSON.stringify(groupNames)} group(s)`);
  return filteredResult;
};

/**
 * @typedef {Object} InstallOptions
 * @property {boolean} allowTestPackages [false] - Set to true in order to allow test
 *                                                 packages installation.
 * @property {boolean} useSdcard [false] - Set to true to install the app on sdcard
 *                                         instead of the device memory.
 * @property {boolean} grantPermissions [false] - Set to true in order to grant all the
 *                                                permissions requested in the application's manifest
 *                                                automatically after the installation is completed
 *                                                under Android 6+.
 * @property {boolean} replace [true] - Set it to false if you don't want
 *                                      the application to be upgraded/reinstalled
 *                                      if it is already present on the device.
 */

/**
 * Transforms given options into the list of `adb install.install-multiple` command arguments
 *
 * @param {number} apiLevel - The current API level
 * @param {?InstallOptions} options - The options mapping to transform
 * @returns {Array<String>} The array of arguments
 */
function buildInstallArgs (apiLevel, options = {}) {
  const result = [];

  if (!util.hasValue(options.replace) || options.replace) {
    result.push('-r');
  }
  if (options.allowTestPackages) {
    result.push('-t');
  }
  if (options.useSdcard) {
    result.push('-s');
  }
  if (options.grantPermissions) {
    if (apiLevel < 23) {
      log.debug(`Skipping permissions grant option, since ` +
                `the current API level ${apiLevel} does not support applications ` +
                `permissions customization`);
    } else {
      result.push('-g');
    }
  }

  return result;
}

export {
  getAndroidPlatformAndPath, unzipFile,
  getIMEListFromOutput, getJavaForOs, isShowingLockscreen, isCurrentFocusOnKeyguard,
  getSurfaceOrientation, isScreenOnFully, buildStartCmd, getJavaHome,
  rootDir, getSdkToolsVersion, getApksignerForOs, getBuildToolsDirs,
  getApkanalyzerForOs, getOpenSslForOs, extractMatchingPermissions, APKS_EXTENSION,
  APK_INSTALL_TIMEOUT, APKS_INSTALL_TIMEOUT, buildInstallArgs, APK_EXTENSION,
};
