import {log} from '../logger.js';
import _ from 'lodash';
import {fs, util} from '@appium/support';
import {SubProcess, exec, type ExecError} from 'teen_process';
import type {ADB} from '../adb.js';
import type {ScreenrecordOptions, StringRecord} from './types.js';

/**
 * Get the path to adb executable amd assign it
 * to this.executable.path and this.binaries.adb properties.
 *
 * @return ADB instance.
 */
export async function getAdbWithCorrectAdbPath(this: ADB): Promise<ADB> {
  this.executable.path = await this.getSdkBinaryPath('adb');
  return this;
}

/**
 * Get the full path to aapt tool and assign it to
 * this.binaries.aapt property
 */
export async function initAapt(this: ADB): Promise<void> {
  await this.getSdkBinaryPath('aapt');
}

/**
 * Get the full path to aapt2 tool and assign it to
 * this.binaries.aapt2 property
 */
export async function initAapt2(this: ADB): Promise<void> {
  await this.getSdkBinaryPath('aapt2');
}

/**
 * Get the full path to zipalign tool and assign it to
 * this.binaries.zipalign property
 */
export async function initZipAlign(this: ADB): Promise<void> {
  await this.getSdkBinaryPath('zipalign');
}

/**
 * Get the full path to bundletool binary and assign it to
 * this.binaries.bundletool property
 */
export async function initBundletool(this: ADB): Promise<void> {
  try {
    const binaries = this.binaries as StringRecord;
    binaries.bundletool = await fs.which('bundletool.jar');
  } catch {
    throw new Error(
      'bundletool.jar binary is expected to be present in PATH. ' +
        'Visit https://github.com/google/bundletool for more details.',
    );
  }
}

/**
 * Retrieve the API level of the device under test.
 *
 * @return The API level as integer number, for example 21 for
 *                  Android Lollipop. The result of this method is cached, so all the further
 * calls return the same value as the first one.
 */
export async function getApiLevel(this: ADB): Promise<number> {
  if (!_.isInteger(this._apiLevel)) {
    try {
      const strOutput = await this.getDeviceProperty('ro.build.version.sdk');
      let apiLevel = parseInt(strOutput.trim(), 10);

      // Workaround for preview/beta platform API level
      const charCodeQ = 'q'.charCodeAt(0);
      // 28 is the first API Level, where Android SDK started returning letters in response to getPlatformVersion
      const apiLevelDiff = apiLevel - 28;
      const codename = String.fromCharCode(charCodeQ + apiLevelDiff);
      if (apiLevelDiff >= 0 && (await this.getPlatformVersion()).toLowerCase() === codename) {
        log.debug(
          `Release version is ${codename.toUpperCase()} but found API Level ${apiLevel}. Setting API Level to ${apiLevel + 1}`,
        );
        apiLevel++;
      }

      this._apiLevel = apiLevel;
      log.debug(`Device API level: ${this._apiLevel}`);
      if (isNaN(this._apiLevel)) {
        throw new Error(`The actual output '${strOutput}' cannot be converted to an integer`);
      }
    } catch (e) {
      throw new Error(
        `Error getting device API level. Original error: ${(e as Error).message}`,
      );
    }
  }
  return this._apiLevel as number;
}

/**
 * Verify whether a device is connected.
 *
 * @return True if at least one device is visible to adb.
 */
export async function isDeviceConnected(this: ADB): Promise<boolean> {
  const devices = await this.getConnectedDevices();
  return devices.length > 0;
}

/**
 * Clear the active text field on the device under test by sending
 * special keyevents to it.
 *
 * @param length - The maximum length of the text in the field to be cleared.
 */
export async function clearTextField(this: ADB, length: number = 100): Promise<void> {
  // assumes that the EditText field already has focus
  log.debug(`Clearing up to ${length} characters`);
  if (length === 0) {
    return;
  }
  const args = ['input', 'keyevent'];
  for (let i = 0; i < length; i++) {
    // we cannot know where the cursor is in the text field, so delete both before
    // and after so that we get rid of everything
    // https://developer.android.com/reference/android/view/KeyEvent.html#KEYCODE_DEL
    // https://developer.android.com/reference/android/view/KeyEvent.html#KEYCODE_FORWARD_DEL
    args.push('67', '112');
  }
  await this.shell(args);
}

/**
 * Send the special keycode to the device under test in order to emulate
 * Back button tap.
 */
export async function back(this: ADB): Promise<void> {
  log.debug('Pressing the BACK button');
  await this.keyevent(4);
}

/**
 * Send the special keycode to the device under test in order to emulate
 * Home button tap.
 */
export async function goToHome(this: ADB): Promise<void> {
  log.debug('Pressing the HOME button');
  await this.keyevent(3);
}

/**
 * @return the actual path to adb executable.
 */
export function getAdbPath(this: ADB): string {
  return this.executable.path;
}

/**
 * Restart the device under test using adb commands.
 *
 * @throws {Error} If start fails.
 */
export async function restart(this: ADB): Promise<void> {
  try {
    await this.stopLogcat();
    await this.restartAdb();
    await this.waitForDevice(60);
    await this.startLogcat(this._logcatStartupParams);
  } catch (e) {
    const err = e as Error;
    throw new Error(`Restart failed. Original error: ${err.message}`);
  }
}

/**
 * Retrieve the `adb bugreport` command output. This
 * operation may take up to several minutes.
 *
 * @param timeout - Command timeout in milliseconds
 * @returns Command stdout
 */
export async function bugreport(this: ADB, timeout: number = 120000): Promise<string> {
  return await this.adbExec(['bugreport'], {timeout});
}

/**
 * Initiate screenrecord utility on the device
 *
 * @param destination - Full path to the writable media file destination
 *                               on the device file system.
 * @param options - Screenrecord options
 * @returns screenrecord process, which can be then controlled by the client code
 */
export function screenrecord(
  this: ADB,
  destination: string,
  options: ScreenrecordOptions = {},
): SubProcess {
  const cmd: string[] = ['screenrecord'];
  const {videoSize, bitRate, timeLimit, bugReport} = options;
  if (util.hasValue(videoSize)) {
    cmd.push('--size', videoSize);
  }
  if (util.hasValue(timeLimit)) {
    cmd.push('--time-limit', `${timeLimit}`);
  }
  if (util.hasValue(bitRate)) {
    cmd.push('--bit-rate', `${bitRate}`);
  }
  if (bugReport) {
    cmd.push('--bugreport');
  }
  cmd.push(destination);

  const fullCmd = [...this.executable.defaultArgs, 'shell', ...cmd];
  log.debug(`Building screenrecord process with the command line: adb ${util.quote(fullCmd)}`);
  return new SubProcess(this.executable.path, fullCmd);
}

/**
 * Retrieves the list of features supported by the device under test
 *
 * @returns the list of supported feature names or an empty list.
 * An example adb command output:
 * ```
 * cmd
 * ls_v2
 * fixed_push_mkdir
 * shell_v2
 * abb
 * stat_v2
 * apex
 * abb_exec
 * remount_shell
 * fixed_push_symlink_timestamp
 * ```
 * @throws {Error} if there was an error while retrieving the list
 */
export async function listFeatures(this: ADB): Promise<string[]> {
  this._memoizedFeatures =
    this._memoizedFeatures ||
    _.memoize(
      async () => await this.adbExec(['features']),
      () => this.curDeviceId,
    );
  try {
    const memoizedFeatures = this._memoizedFeatures;
    if (!memoizedFeatures) {
      throw new Error('Memoized features function is not initialized');
    }
    return (await memoizedFeatures())
      .split(/\s+/)
      .map((x) => x.trim())
      .filter(Boolean);
  } catch (e) {
    const err = e as ExecError;
    if (_.includes(err.stderr, 'unknown command')) {
      return [];
    }
    throw err;
  }
}

/**
 * Checks the state of streamed install feature.
 * This feature allows to speed up apk installation
 * since it does not require the original apk to be pushed to
 * the device under test first, which also saves space.
 * Although, it is required that both the device under test
 * and the adb server have the mentioned functionality.
 * See https://github.com/aosp-mirror/platform_system_core/blob/master/adb/client/adb_install.cpp
 * for more details
 *
 * @returns `true` if the feature is supported by both adb and the
 * device under test
 */
export async function isStreamedInstallSupported(this: ADB): Promise<boolean> {
  const proto = Object.getPrototypeOf(this);
  proto._helpOutput = proto._helpOutput || (await this.adbExec(['help']));
  return proto._helpOutput.includes('--streaming') && (await this.listFeatures()).includes('cmd');
}

/**
 * Checks whether incremental install feature is supported by ADB.
 * Read https://developer.android.com/preview/features#incremental
 * for more details on it.
 *
 * @returns `true` if the feature is supported by both adb and the
 * device under test
 */
export async function isIncrementalInstallSupported(this: ADB): Promise<boolean> {
  const {binary} = await this.getVersion();
  if (!binary) {
    return false;
  }
  return (
    util.compareVersions(`${binary.version}`, '>=', '30.0.1') &&
    (await this.listFeatures()).includes('abb_exec')
  );
}

/**
 * Takes a screenshot of the given display or the default display.
 *
 * @param displayId A valid display identifier. If
 * no identifier is provided then the screenshot of the default display is returned.
 * Note that only recent Android APIs provide multi-screen support.
 * @returns PNG screenshot payload
 */
export async function takeScreenshot(
  this: ADB,
  displayId?: number | string,
): Promise<Buffer> {
  const args = [...this.executable.defaultArgs, 'exec-out', 'screencap', '-p'];
  // @ts-ignore This validation works as expected
  const displayIdStr = isNaN(Number(displayId)) ? null : `${displayId}`;
  if (displayIdStr) {
    args.push('-d', displayIdStr);
  }
  const displayDescr = displayIdStr ? `display #${displayIdStr}` : 'default display';
  let stdout: Buffer;
  try {
    ({stdout} = await exec(this.executable.path, args, {encoding: 'binary', isBuffer: true}));
  } catch (e) {
    const err = e as ExecError;
    let outputStr = '';
    if (err.stderr) {
      const stderr = err.stderr as string | Buffer;
      outputStr = typeof stderr === 'string' ? stderr : stderr.toString('utf-8');
    } else if (err.stdout) {
      const stdout = err.stdout as string | Buffer;
      outputStr = typeof stdout === 'string' ? stdout : stdout.toString('utf-8');
    }
    throw new Error(
      `Screenshot of the ${displayDescr} failed. ` +
        `Code: '${err.code ?? 'unknown'}', output: '${outputStr}'`,
    );
  }
  if (stdout.length === 0) {
    throw new Error(`Screenshot of the ${displayDescr} returned no data`);
  }
  return stdout;
}

