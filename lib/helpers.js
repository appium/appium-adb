import path from 'path';
import { system, fs, zip, util, tempDir } from 'appium-support';
import log from './logger.js';
import _ from 'lodash';
import B from 'bluebird';
import semver from 'semver';
import os from 'os';

const rootDir = path.resolve(__dirname, process.env.NO_PRECOMPILE ? '..' : '../..');
const APKS_EXTENSION = '.apks';
const APK_EXTENSION = '.apk';
const APK_INSTALL_TIMEOUT = 60000;
const APKS_INSTALL_TIMEOUT = APK_INSTALL_TIMEOUT * 2;
const DEFAULT_ADB_EXEC_TIMEOUT = 20000; // in milliseconds

/**
 * Retrieves the actual path to SDK root folder from the system environment
 *
 * @return {?string} The full path to the SDK root folder
 */
function getSdkRootFromEnv () {
  return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
}

/**
 * Retrieves the actual path to SDK root folder
 *
 * @return {string} The full path to the SDK root folder
 * @throws {Error} If either the corresponding env variable is unset or is
 * pointing to an invalid file system entry
 */
async function requireSdkRoot (customRoot = null) {
  const sdkRoot = customRoot || getSdkRootFromEnv();
  const docMsg = 'Read https://developer.android.com/studio/command-line/variables for more details';
  if (_.isEmpty(sdkRoot)) {
    throw new Error(`Neither ANDROID_HOME nor ANDROID_SDK_ROOT environment variable was exported. ${docMsg}`);
  }

  if (!await fs.exists(sdkRoot)) {
    throw new Error(`The Android SDK root folder '${sdkRoot}' does not exist on the local file system. ${docMsg}`);
  }
  const stats = await fs.stat(sdkRoot);
  if (!stats.isDirectory()) {
    throw new Error(`The Android SDK root '${sdkRoot}' must be a folder. ${docMsg}`);
  }
  return sdkRoot;
}

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
async function getAndroidPlatformAndPath (sdkRoot) {
  const propsPaths = await fs.glob('*/build.prop', {
    cwd: path.resolve(sdkRoot, 'platforms'),
    absolute: true,
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
    log.warn(`Found zero platform folders at '${path.resolve(sdkRoot, 'platforms')}'. ` +
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
  log.debug('Unzip successful');
}

/**
 * Unsigns the given apk by removing the
 * META-INF folder recursively from the archive.
 * !!! The function overwrites the given apk after successful unsigning !!!
 *
 * @param {string} apkPath The path to the apk
 * @returns {boolean} `true` if the apk has been successfully
 * unsigned and overwritten
 * @throws {Error} if there was an error during the unsign operation
 */
async function unsignApk (apkPath) {
  const tmpRoot = await tempDir.openDir();
  const metaInfFolderName = 'META-INF';
  try {
    let hasMetaInf = false;
    await zip.readEntries(apkPath, ({entry}) => {
      hasMetaInf = entry.fileName.startsWith(`${metaInfFolderName}/`);
      // entries iteration stops after `false` is returned
      return !hasMetaInf;
    });
    if (!hasMetaInf) {
      return false;
    }
    const tmpZipRoot = path.resolve(tmpRoot, 'apk');
    await zip.extractAllTo(apkPath, tmpZipRoot);
    await fs.rimraf(path.resolve(tmpZipRoot, metaInfFolderName));
    const tmpResultPath = path.resolve(tmpRoot, path.basename(apkPath));
    await zip.toArchive(tmpResultPath, {
      cwd: tmpZipRoot,
    });
    await fs.unlink(apkPath);
    await fs.mv(tmpResultPath, apkPath);
    return true;
  } finally {
    await fs.rimraf(tmpRoot);
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

const getJavaHome = _.memoize(async function getJavaHome () {
  const result = process.env.JAVA_HOME;
  if (!result) {
    throw new Error('The JAVA_HOME environment variable is not set for the current process');
  }
  if (!await fs.exists(result)) {
    throw new Error(`The JAVA_HOME location '${result}' must exist`);
  }
  const stats = await fs.stat(result);
  if (!stats.isDirectory()) {
    throw new Error(`The JAVA_HOME location '${result}' must be a valid folder`);
  }
  return result;
});

const getJavaForOs = _.memoize(async function getJavaForOs () {
  let javaHome;
  let errMsg;
  try {
    javaHome = await getJavaHome();
  } catch (err) {
    errMsg = err.message;
  }
  const executableName = `java${system.isWindows() ? '.exe' : ''}`;
  if (javaHome) {
    const resultPath = path.resolve(javaHome, 'bin', executableName);
    if (await fs.exists(resultPath)) {
      return resultPath;
    }
  }
  try {
    return await fs.which(executableName);
  } catch (ign) {}
  throw new Error(`The '${executableName}' binary could not be found ` +
    `neither in PATH nor under JAVA_HOME (${errMsg || path.resolve(javaHome, 'bin')})`);
});

const getOpenSslForOs = async function () {
  const binaryName = `openssl${system.isWindows() ? '.exe' : ''}`;
  try {
    return await fs.which(binaryName);
  } catch (err) {
    throw new Error('The openssl tool must be installed on the system and available on the path');
  }
};

/**
 * Get the absolute path to apksigner tool
 *
 * @param {Object} sysHelpers - An instance containing systemCallMethods helper methods
 * @returns {string} An absolute path to apksigner tool.
 * @throws {Error} If the tool is not present on the local file system.
 */
async function getApksignerForOs (sysHelpers) {
  return await sysHelpers.getBinaryFromSdkRoot('apksigner.jar');
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
 * A note: `adb shell dumpsys trust` performs better while detecting the locked screen state
 * in comparison to `adb dumpsys window` output parsing.
 * But the trust command does not work for `Swipe` unlock pattern.
 *
 * In some Android devices (Probably around Android 10+), `mShowingLockscreen` and `mDreamingLockscreen`
 * do not work to detect lock status. Instead, keyguard preferences helps to detect the lock condition.
 * Some devices such as Android TV do not have keyguard, so we should keep
 * screen condition as this primary method.
 *
 * @param {string} dumpsys - The output of dumpsys window command.
 * @return {boolean} True if lock screen is showing.
 */
function isShowingLockscreen (dumpsys) {
  return _.some(['mShowingLockscreen=true', 'mDreamingLockscreen=true'], (x) => dumpsys.includes(x))
    // `mIsShowing` and `mInputRestricted` are `true` in lock condition. `false` is unlock condition.
    || _.every([/KeyguardStateMonitor[\n\s]+mIsShowing=true/, /\s+mInputRestricted=true/], (x) => x.test(dumpsys));
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
  const {
    user,
    waitForLaunch,
    pkg,
    activity,
    action,
    category,
    stopApp,
    flags,
  } = startAppOptions;
  const cmd = ['am', 'start'];
  if (util.hasValue(user)) {
    cmd.push('--user', user);
  }
  if (waitForLaunch) {
    cmd.push('-W');
  }
  if (activity && pkg) {
    cmd.push('-n', `${pkg}/${activity}`);
  }
  if (stopApp && apiLevel >= 15) {
    cmd.push('-S');
  }
  if (action) {
    cmd.push('-a', action);
  }
  if (category) {
    cmd.push('-c', category);
  }
  if (flags) {
    cmd.push('-f', flags);
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
  let buildToolsDirs = await fs.glob('*/', {
    cwd: path.resolve(sdkRoot, 'build-tools'),
    absolute: true,
  });
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
  const permissionNamePattern = /android\.\w*\.?permission\.\w+/;
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
  log.debug(`Retrieved ${util.pluralize('permission', filteredResult.length, true)} ` +
    `from ${groupNames} ${util.pluralize('group', groupNames.length, false)}`);
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
 * @property {boolean} partialInstall [false] - Install apks partially. It is used for 'install-multiple'.
 *                                             https://android.stackexchange.com/questions/111064/what-is-a-partial-application-install-via-adb
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
  // For multiple-install
  if (options.partialInstall) {
    result.push('-p');
  }

  return result;
}

/**
 * @typedef {Object} ManifestInfo
 * @property {string} pkg - The application identifier
 * @property {string} activity - The name of the main package activity
 * @property {?number} versionCode - The version code number (might be `NaN`)
 * @property {?string} versionName - The version name (might be `null`)
 */

/**
 * Perform parsing of the manifest object in order
 * to extract some vital values from it
 *
 * @param {object} manifest The manifest content formatted as JSON
 * See https://www.npmjs.com/package/adbkit-apkreader for detailed format description
 * @returns {ManifestInfo}
 */
function parseManifest (manifest) {
  const result = {
    pkg: manifest.package,
    versionCode: parseInt(manifest.versionCode, 10),
    versionName: manifest.versionName || null,
  };
  if (!manifest.application) {
    return result;
  }

  // Look for enabled activity or activity-alias with
  // action == android.intent.action.MAIN and
  // category == android.intent.category.LAUNCHER
  for (const activity of [
    ...manifest.application.activities,
    ...manifest.application.activityAliases,
  ]) {
    if (activity.enabled === false || _.isEmpty(activity.intentFilters)) {
      continue;
    }

    for (const {actions, categories} of activity.intentFilters) {
      if (_.isEmpty(actions) || _.isEmpty(categories)) {
        continue;
      }

      const isMainAction = actions
        .some(({name}) => name === 'android.intent.action.MAIN');
      const isLauncherCategory = categories
        .some(({name}) => name === 'android.intent.category.LAUNCHER');
      if (isMainAction && isLauncherCategory) {
        result.activity = activity.name;
        return result;
      }
    }
  }
  return result;
}

/**
 * Parses apk strings from aapt tool output
 *
 * @param {string} rawOutput The actual tool output
 * @param {string} configMarker The config marker. Usually
 * a language abbreviation or `(default)`
 * @returns {Object} Strings ids to values mapping. Plural
 * values are represented as arrays. If no config found for the
 * given marker then an empty mapping is returned.
 */
function parseAaptStrings (rawOutput, configMarker) {
  const normalizeStringMatch = function (s) {
    return s.replace(/"$/, '').replace(/^"/, '').replace(/\\"/g, '"');
  };

  const apkStrings = {};
  let isInConfig = false;
  let currentResourceId = null;
  let isInPluralGroup = false;
  // The pattern matches any quoted content including escaped quotes
  const quotedStringPattern = /"[^"\\]*(?:\\.[^"\\]*)*"/;
  for (const line of rawOutput.split(os.EOL)) {
    const trimmedLine = line.trim();
    if (_.isEmpty(trimmedLine)) {
      continue;
    }

    if (['config', 'type', 'spec', 'Package'].some((x) => trimmedLine.startsWith(x))) {
      isInConfig = trimmedLine.startsWith(`config ${configMarker}:`);
      currentResourceId = null;
      isInPluralGroup = false;
      continue;
    }

    if (!isInConfig) {
      continue;
    }

    if (trimmedLine.startsWith('resource')) {
      isInPluralGroup = false;
      currentResourceId = null;

      if (trimmedLine.includes(':string/')) {
        const match = /:string\/(\S+):/.exec(trimmedLine);
        if (match) {
          currentResourceId = match[1];
        }
      } else if (trimmedLine.includes(':plurals/')) {
        const match = /:plurals\/(\S+):/.exec(trimmedLine);
        if (match) {
          currentResourceId = match[1];
          isInPluralGroup = true;
        }
      }
      continue;
    }

    if (currentResourceId && trimmedLine.startsWith('(string')) {
      const match = quotedStringPattern.exec(trimmedLine);
      if (match) {
        apkStrings[currentResourceId] = normalizeStringMatch(match[0]);
      }
      currentResourceId = null;
      continue;
    }

    if (currentResourceId && isInPluralGroup && trimmedLine.includes(': (string')) {
      const match = quotedStringPattern.exec(trimmedLine);
      if (match) {
        apkStrings[currentResourceId] = [
          ...(apkStrings[currentResourceId] || []),
          normalizeStringMatch(match[0]),
        ];
      }
      continue;
    }
  }
  return apkStrings;
}

/**
 * Parses apk strings from aapt2 tool output
 *
 * @param {string} rawOutput The actual tool output
 * @param {string} configMarker The config marker. Usually
 * a language abbreviation or an empty string for the default one
 * @returns {Object} Strings ids to values mapping. Plural
 * values are represented as arrays. If no config found for the
 * given marker then an empty mapping is returned.
 */
function parseAapt2Strings (rawOutput, configMarker) {
  const allLines = rawOutput.split(os.EOL);
  function extractContent (startIdx) {
    let idx = startIdx;
    const startCharPos = allLines[startIdx].indexOf('"');
    if (startCharPos < 0) {
      return [null, idx];
    }
    let result = '';
    while (idx < allLines.length) {
      const terminationCharMatch = /"$/.exec(allLines[idx]);
      if (terminationCharMatch) {
        const terminationCharPos = terminationCharMatch.index;
        if (startIdx === idx) {
          return [
            allLines[idx].substring(startCharPos + 1, terminationCharPos),
            idx
          ];
        }
        return [
          `${result}\\n${_.trimStart(allLines[idx].substring(0, terminationCharPos))}`,
          idx,
        ];
      }
      if (idx > startIdx) {
        result += `\\n${_.trimStart(allLines[idx])}`;
      } else {
        result += allLines[idx].substring(startCharPos + 1);
      }
      ++idx;
    }
    return [result, idx];
  }

  const apkStrings = {};
  let currentResourceId = null;
  let isInPluralGroup = false;
  let isInCurrentConfig = false;
  let lineIndex = 0;
  while (lineIndex < allLines.length) {
    const trimmedLine = allLines[lineIndex].trim();
    if (_.isEmpty(trimmedLine)) {
      ++lineIndex;
      continue;
    }

    if (['type', 'Package'].some((x) => trimmedLine.startsWith(x))) {
      currentResourceId = null;
      isInPluralGroup = false;
      isInCurrentConfig = false;
      ++lineIndex;
      continue;
    }

    if (trimmedLine.startsWith('resource')) {
      isInPluralGroup = false;
      currentResourceId = null;
      isInCurrentConfig = false;

      if (trimmedLine.includes('string/')) {
        const match = /string\/(\S+)/.exec(trimmedLine);
        if (match) {
          currentResourceId = match[1];
        }
      } else if (trimmedLine.includes('plurals/')) {
        const match = /plurals\/(\S+)/.exec(trimmedLine);
        if (match) {
          currentResourceId = match[1];
          isInPluralGroup = true;
        }
      }
      ++lineIndex;
      continue;
    }

    if (currentResourceId) {
      if (isInPluralGroup) {
        if (trimmedLine.startsWith('(')) {
          isInCurrentConfig = trimmedLine.startsWith(`(${configMarker})`);
          ++lineIndex;
          continue;
        }
        if (isInCurrentConfig) {
          const [content, idx] = extractContent(lineIndex);
          lineIndex = idx;
          if (_.isString(content)) {
            apkStrings[currentResourceId] = [
              ...(apkStrings[currentResourceId] || []),
              content,
            ];
          }
        }
      } else if (trimmedLine.startsWith(`(${configMarker})`)) {
        const [content, idx] = extractContent(lineIndex);
        lineIndex = idx;
        if (_.isString(content)) {
          apkStrings[currentResourceId] = content;
        }
        currentResourceId = null;
      }
    }
    ++lineIndex;
  }
  return apkStrings;
}

/**
 * Formats the config marker, which is then passed to parse.. methods
 * to make it compatible with resource formats generated by aapt(2) tool
 *
 * @param {Function} configsGetter The function whose result is a list
 * of apk configs
 * @param {string} desiredMarker The desired config marker value
 * @param {string} defaultMarker The default config marker value
 * @return {string} The formatted config marker
 */
async function formatConfigMarker (configsGetter, desiredMarker, defaultMarker) {
  let configMarker = desiredMarker || defaultMarker;
  if (configMarker.includes('-') && !configMarker.includes('-r')) {
    configMarker = configMarker.replace('-', '-r');
  }
  const configs = await configsGetter();
  log.debug(`Resource configurations: ${JSON.stringify(configs)}`);
  // Assume the 'en' configuration is the default one
  if (configMarker.toLowerCase().startsWith('en')
    && !configs.some((x) => x.trim() === configMarker)) {
    log.debug(`Resource configuration name '${configMarker}' is unknown. ` +
      `Replacing it with '${defaultMarker}'`);
    configMarker = defaultMarker;
  } else {
    log.debug(`Selected configuration: '${configMarker}'`);
  }
  return configMarker;
}

/**
 * Parses the output in JSON format retrieved from
 * the corresponding Appium Settings broadcast calls
 *
 * @param {string} output The actual command output
 * @param {string} entityName The name of the entity which is
 * going to be parsed
 * @returns {Object} The parsed JSON object
 * @throws {Error} If the output cannot be parsed
 * as a valid JSON
 */
function parseJsonData (output, entityName) {
  if (!/\bresult=-1\b/.test(output) || !/\bdata="/.test(output)) {
    log.debug(output);
    throw new Error(`Cannot retrieve ${entityName} from the device. ` +
      'Check the server log for more details');
  }
  const match = /\bdata=(".+)/.exec(output);
  if (!match) {
    log.debug(output);
    throw new Error(`Cannot parse ${entityName} from the command output. ` +
      'Check the server log for more details');
  }
  const jsonStr = _.trim(match[1]).replace(/(^")|("$)/g, '');
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    log.debug(jsonStr);
    throw new Error(`Cannot parse ${entityName} from the resulting data string. ` +
      'Check the server log for more details');
  }
}

/**
 * Transforms the given language and country abbreviations
 * to AVD arguments array
 *
 * @param {?string} language Language name, for example 'fr'
 * @param {?string} country Country name, for example 'CA'
 * @returns {Array<string>} The generated arguments. The
 * resulting array might be empty if both arguments are empty
 */
function toAvdLocaleArgs (language, country) {
  const result = [];
  if (language && _.isString(language)) {
    result.push('-prop', `persist.sys.language=${language.toLowerCase()}`);
  }
  if (country && _.isString(country)) {
    result.push('-prop', `persist.sys.country=${country.toUpperCase()}`);
  }
  let locale;
  if (_.isString(language) && _.isString(country) && language && country) {
    locale = language.toLowerCase() + '-' + country.toUpperCase();
  } else if (language && _.isString(language)) {
    locale = language.toLowerCase();
  } else if (country && _.isString(country)) {
    locale = country;
  }
  if (locale) {
    result.push('-prop', `persist.sys.locale=${locale}`);
  }
  return result;
}

/**
 * Retrieves the full path to the Android preferences root
 *
 * @returns {?string} The full path to the folder or `null` if the folder cannot be found
 */
async function getAndroidPrefsRoot () {
  let location = process.env.ANDROID_EMULATOR_HOME;
  if (await dirExists(location)) {
    return location;
  }

  if (location) {
    log.warn(`The value of the ANDROID_EMULATOR_HOME environment variable '${location}' is not an existing directory`);
  }

  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    location = path.resolve(home, '.android');
  }

  if (!await dirExists(location)) {
    log.debug(`Android config root '${location}' is not an existing directory`);
    return null;
  }

  return location;
}

/**
 * Check if a path exists on the filesystem and is a directory
 *
 * @param {?string} location The full path to the directory
 * @returns {boolean}
 */
async function dirExists (location) {
  return location
    && await fs.exists(location)
    && (await fs.stat(location)).isDirectory();
}

/**
 * Escapes special characters in command line arguments.
 * This is needed to avoid possible issues with how system `spawn`
 * call handles them.
 * See https://discuss.appium.io/t/how-to-modify-wd-proxy-and-uiautomator2-source-code-to-support-unicode/33466
 * for more details.
 *
 * @param {string} arg Non-escaped argument string
 * @returns The escaped argument
 */
function escapeShellArg (arg) {
  arg = `${arg}`;
  if (system.isWindows()) {
    return /[&|^\s]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
  }
  return arg.replace(/&/g, '\\&');
}

export {
  getAndroidPlatformAndPath, unzipFile,
  getIMEListFromOutput, getJavaForOs, isShowingLockscreen, isCurrentFocusOnKeyguard,
  getSurfaceOrientation, isScreenOnFully, buildStartCmd, getJavaHome,
  rootDir, getSdkToolsVersion, getApksignerForOs, getBuildToolsDirs,
  getApkanalyzerForOs, getOpenSslForOs, extractMatchingPermissions, APKS_EXTENSION,
  APK_INSTALL_TIMEOUT, APKS_INSTALL_TIMEOUT, buildInstallArgs, APK_EXTENSION,
  DEFAULT_ADB_EXEC_TIMEOUT, parseManifest, parseAaptStrings, parseAapt2Strings,
  formatConfigMarker, parseJsonData, unsignApk, toAvdLocaleArgs, requireSdkRoot,
  getSdkRootFromEnv, getAndroidPrefsRoot, dirExists, escapeShellArg,
};
