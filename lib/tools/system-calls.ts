import path from 'path';
import {log} from '../logger.js';
import B from 'bluebird';
import {system, fs, util, tempDir, timing} from '@appium/support';
import {DEFAULT_ADB_EXEC_TIMEOUT, getSdkRootFromEnv} from '../helpers.js';
import {exec, SubProcess} from 'teen_process';
import type {ExecError, TeenProcessExecResult} from 'teen_process';
import {retry, retryInterval, waitForCondition} from 'asyncbox';
import _ from 'lodash';
import * as semver from 'semver';
import type {ADB} from '../adb.js';
import type {
  ConnectedDevicesOptions,
  Device,
  AvdLaunchOptions,
  Version,
  RootResult,
  ShellExecOptions,
  SpecialAdbExecOptions,
  TFullOutputOption,
  ExecResult,
} from './types.js';

const DEFAULT_ADB_REBOOT_RETRIES = 90;
const LINKER_WARNING_REGEXP = /^WARNING: linker.+$/m;
const ADB_RETRY_ERROR_PATTERNS = [
  /protocol fault \(no status\)/i,
  /error: device ('.+' )?not found/i,
  /error: device still connecting/i,
] as const;
const BINARY_VERSION_PATTERN = /^Version ([\d.]+)-(\d+)/m;
const BRIDGE_VERSION_PATTERN = /^Android Debug Bridge version ([\d.]+)/m;
const CERTS_ROOT = '/system/etc/security/cacerts';
const SDK_BINARY_ROOTS: (string | string[])[] = [
  'platform-tools',
  'emulator',
  ['cmdline-tools', 'latest', 'bin'],
  'tools',
  ['tools', 'bin'],
  '.', // Allow custom sdkRoot to specify full folder path
];
const MIN_DELAY_ADB_API_LEVEL = 28;
const REQUIRED_SERVICES = ['activity', 'package', 'window'] as const;
const MAX_SHELL_BUFFER_LENGTH = 1000;

// Private methods (defined early as they're used by public methods)

/**
 * Retrieve full binary name for the current operating system.
 *
 * @param binaryName - The name of the binary
 * @returns The binary name with appropriate extension for the current OS
 */
function _getBinaryNameForOS(binaryName: string): string {
  if (!system.isWindows()) {
    return binaryName;
  }

  if (['android', 'apksigner', 'apkanalyzer'].includes(binaryName)) {
    return `${binaryName}.bat`;
  }
  if (!path.extname(binaryName)) {
    return `${binaryName}.exe`;
  }
  return binaryName;
}

/**
 * Returns the Android binaries locations
 *
 * @param sdkRoot - The Android SDK root directory path
 * @param fullBinaryName - The full name of the binary (with extension)
 * @returns Array of possible binary location paths
 */
function getSdkBinaryLocationCandidates(sdkRoot: string, fullBinaryName: string): string[] {
  return SDK_BINARY_ROOTS.map((x) =>
    path.resolve(sdkRoot, ...(_.isArray(x) ? x : [x]), fullBinaryName),
  );
}

/**
 * Get the path to the openssl binary for the current operating system
 *
 * @returns The full path to the openssl binary
 * @throws {Error} If openssl is not found in PATH
 */
async function getOpenSslForOs(): Promise<string> {
  const binaryName = `openssl${system.isWindows() ? '.exe' : ''}`;
  try {
    return await fs.which(binaryName);
  } catch {
    throw new Error('The openssl tool must be installed on the system and available on the path');
  }
}

// Public methods

/**
 * Retrieve full path to the given binary.
 *
 * @param binaryName - The name of the binary
 * @returns The full path to the binary
 */
export async function getSdkBinaryPath(this: ADB, binaryName: string): Promise<string> {
  return await this.getBinaryFromSdkRoot(binaryName);
}

export const getBinaryNameForOS = _.memoize(_getBinaryNameForOS);

/**
 * Retrieve full path to the given binary and caches it into `binaries`
 * property of the current ADB instance.
 *
 * @param binaryName - The name of the binary
 * @returns The full path to the binary
 * @throws {Error} If SDK root is not set or binary cannot be found
 */
export async function getBinaryFromSdkRoot(this: ADB, binaryName: string): Promise<string> {
  if (this.binaries?.[binaryName]) {
    return this.binaries[binaryName];
  }
  const fullBinaryName = this.getBinaryNameForOS(binaryName);
  if (!this.sdkRoot) {
    throw new Error('SDK root is not set');
  }
  const binaryLocs = getSdkBinaryLocationCandidates(this.sdkRoot, fullBinaryName);

  // get subpaths for currently installed build tool directories
  let buildToolsDirs = await getBuildToolsDirs(this.sdkRoot);
  if (this.buildToolsVersion) {
    buildToolsDirs = buildToolsDirs.filter((x) => path.basename(x) === this.buildToolsVersion);
    if (_.isEmpty(buildToolsDirs)) {
      log.info(`Found no build tools whose version matches to '${this.buildToolsVersion}'`);
    } else {
      log.info(`Using build tools at '${buildToolsDirs}'`);
    }
  }
  binaryLocs.push(
    ..._.flatten(
      buildToolsDirs.map((dir) => [
        path.resolve(dir, fullBinaryName),
        path.resolve(dir, 'lib', fullBinaryName),
      ]),
    ),
  );

  let binaryLoc: string | null = null;
  for (const loc of binaryLocs) {
    if (await fs.exists(loc)) {
      binaryLoc = loc;
      break;
    }
  }
  if (_.isNull(binaryLoc)) {
    throw new Error(
      `Could not find '${fullBinaryName}' in ${JSON.stringify(binaryLocs)}. ` +
        `Do you have Android Build Tools ${this.buildToolsVersion ? `v ${this.buildToolsVersion} ` : ''}` +
        `installed at '${this.sdkRoot}'?`,
    );
  }
  log.info(`Using '${fullBinaryName}' from '${binaryLoc}'`);
  if (!this.binaries) {
    this.binaries = {};
  }
  this.binaries[binaryName] = binaryLoc;
  return binaryLoc;
}

/**
 * Retrieve full path to the given binary.
 * This method does not have cache.
 *
 * @param binaryName - The name of the binary
 * @returns The full path to the binary
 * @throws {Error} If binary cannot be found in the Android SDK
 */
export async function getAndroidBinaryPath(binaryName: string): Promise<string> {
  const fullBinaryName = getBinaryNameForOS(binaryName);
  const sdkRoot = getSdkRootFromEnv();
  const binaryLocs = getSdkBinaryLocationCandidates(sdkRoot ?? '', fullBinaryName);
  for (const loc of binaryLocs) {
    if (await fs.exists(loc)) {
      return loc;
    }
  }
  throw new Error(
    `Could not find '${fullBinaryName}' in ${JSON.stringify(binaryLocs)}. ` +
      `Do you have Android Build Tools installed at '${sdkRoot}'?`,
  );
}

/**
 * Retrieve full path to a binary file using the standard system lookup tool.
 *
 * @param binaryName - The name of the binary
 * @returns The full path to the binary
 * @throws {Error} If binary cannot be found in PATH
 */
export async function getBinaryFromPath(this: ADB, binaryName: string): Promise<string> {
  if (this.binaries?.[binaryName]) {
    return this.binaries[binaryName];
  }

  const fullBinaryName = this.getBinaryNameForOS(binaryName);
  try {
    const binaryLoc = await fs.which(fullBinaryName);
    log.info(`Using '${fullBinaryName}' from '${binaryLoc}'`);
    if (!this.binaries) {
      this.binaries = {};
    }
    this.binaries[binaryName] = binaryLoc;
    return binaryLoc;
  } catch {
    throw new Error(
      `Could not find '${fullBinaryName}' in PATH. Please set the ANDROID_HOME ` +
        `or ANDROID_SDK_ROOT environment variables to the correct Android SDK root directory path.`,
    );
  }
}

/**
 * Retrieve the list of devices visible to adb.
 *
 * @param opts - Options for device retrieval
 * @returns Array of connected devices
 * @throws {Error} If adb devices command fails or returns unexpected output
 */
export async function getConnectedDevices(
  this: ADB,
  opts: ConnectedDevicesOptions = {},
): Promise<Device[]> {
  log.debug('Getting connected devices');
  const args = [...this.executable.defaultArgs, 'devices'];
  if (opts.verbose) {
    args.push('-l');
  }

  let stdout: string;
  try {
    ({stdout} = await exec(this.executable.path, args));
  } catch (e: unknown) {
    const error = e as Error;
    throw new Error(`Error while getting connected devices. Original error: ${error.message}`);
  }
  const listHeader = 'List of devices';
  // expecting adb devices to return output as
  // List of devices attached
  // emulator-5554	device
  const startingIndex = stdout.indexOf(listHeader);
  if (startingIndex < 0) {
    throw new Error(`Unexpected output while trying to get devices: ${stdout}`);
  }
  // slicing output we care about
  stdout = stdout.slice(startingIndex);
  const excludedLines = [listHeader, 'adb server', '* daemon'];
  if (!this.allowOfflineDevices) {
    excludedLines.push('offline');
  }
  const devices = stdout
    .split('\n')
    .map(_.trim)
    .filter((line) => line && !excludedLines.some((x) => line.includes(x)))
    .map((line) => {
      // state is "device", afaic
      const [udid, state, ...description] = line.split(/\s+/);
      const device: Device & Record<string, string> = {udid, state} as Device &
        Record<string, string>;
      if (opts.verbose) {
        for (const entry of description) {
          if (entry.includes(':')) {
            // each entry looks like key:value
            const [key, value] = entry.split(':');
            device[key] = value;
          }
        }
      }
      return device;
    });
  if (_.isEmpty(devices)) {
    log.debug('No connected devices have been detected');
  } else {
    log.debug(`Connected devices: ${JSON.stringify(devices)}`);
  }
  return devices;
}

/**
 * Retrieve the list of devices visible to adb within the given timeout.
 *
 * @param timeoutMs - Maximum time to wait for devices (default: 20000ms)
 * @returns Array of connected devices
 * @throws {Error} If no devices are found within the timeout period
 */
export async function getDevicesWithRetry(this: ADB, timeoutMs: number = 20000): Promise<Device[]> {
  log.debug('Trying to find connected Android devices');
  try {
    let devices: Device[] = [];
    await waitForCondition(
      async () => {
        try {
          devices = await this.getConnectedDevices();
          if (devices.length) {
            return true;
          }
          log.debug('Could not find online devices');
        } catch (err: unknown) {
          const error = err as Error;
          log.debug(error.stack);
          log.warn(
            `Got an unexpected error while fetching connected devices list: ${error.message}`,
          );
        }

        try {
          await this.reconnect();
        } catch {
          await this.restartAdb();
        }
        return false;
      },
      {
        waitMs: timeoutMs,
        intervalMs: 200,
      },
    );
    return devices;
  } catch (e: unknown) {
    const error = e as Error;
    if (/Condition unmet/.test(error.message)) {
      throw new Error(`Could not find a connected Android device in ${timeoutMs}ms`);
    } else {
      throw e;
    }
  }
}

/**
 * Kick current connection from host/device side and make it reconnect
 *
 * @param target - The target to reconnect (default: 'offline')
 * @throws {Error} If reconnect command fails
 */
export async function reconnect(this: ADB, target: string | null = 'offline'): Promise<void> {
  log.debug(`Reconnecting adb (target ${target})`);

  const args = ['reconnect'];
  if (target) {
    args.push(target);
  }
  try {
    await this.adbExec(args);
  } catch (e: unknown) {
    const error = e as ExecError;
    throw new Error(`Cannot reconnect adb. Original error: ${error.stderr || error.message}`);
  }
}

/**
 * Restart adb server, unless _this.suppressKillServer_ property is true.
 */
export async function restartAdb(this: ADB): Promise<void> {
  if (this.suppressKillServer) {
    log.debug(`Not restarting abd since 'suppressKillServer' is on`);
    return;
  }

  log.debug('Restarting adb');
  try {
    await this.killServer();
    await this.adbExec(['start-server']);
  } catch {
    log.error(`Error killing ADB server, going to see if it's online anyway`);
  }
}

/**
 * Kill adb server.
 */
export async function killServer(this: ADB): Promise<void> {
  log.debug(`Killing adb server on port '${this.adbPort}'`);
  await this.adbExec(['kill-server'], {
    exclusive: true,
  });
}

/**
 * Reset Telnet authentication token.
 * @see {@link http://tools.android.com/recent/emulator2516releasenotes} for more details.
 *
 * @returns True if token was reset successfully, false otherwise
 */
export const resetTelnetAuthToken = _.memoize(
  async function resetTelnetAuthToken(): Promise<boolean> {
    // The methods is used to remove telnet auth token
    //
    const homeFolderPath = process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'];
    if (!homeFolderPath) {
      log.warn(
        `Cannot find the path to user home folder. Ignoring resetting of emulator's telnet authentication token`,
      );
      return false;
    }
    const dstPath = path.resolve(homeFolderPath, '.emulator_console_auth_token');
    log.debug(
      `Overriding ${dstPath} with an empty string to avoid telnet authentication for emulator commands`,
    );
    try {
      await fs.writeFile(dstPath, '');
    } catch (e: unknown) {
      const error = e as Error;
      log.warn(
        `Error ${error.message} while resetting the content of ${dstPath}. Ignoring resetting of emulator's telnet authentication token`,
      );
      return false;
    }
    return true;
  },
);

/**
 * Execute the given emulator command using _adb emu_ tool.
 *
 * @param cmd - Array of command arguments
 * @throws {Error} If emulator is not connected or command execution fails
 */
export async function adbExecEmu(this: ADB, cmd: string[]): Promise<void> {
  await this.verifyEmulatorConnected();
  await this.resetTelnetAuthToken();
  await this.adbExec(['emu', ...cmd]);
}

let isExecLocked = false;

export const EXEC_OUTPUT_FORMAT = {
  STDOUT: 'stdout',
  FULL: 'full',
} as const;

/**
 * Execute the given adb command.
 *
 * @param cmd - Command string or array of command arguments
 * @param opts - Execution options
 * @returns Command output (string or ExecResult depending on outputFormat)
 * @throws {Error} If command execution fails or timeout is exceeded
 */
export async function adbExec<
  TExecOpts extends ShellExecOptions & SpecialAdbExecOptions = ShellExecOptions &
    SpecialAdbExecOptions,
>(
  this: ADB,
  cmd: string | string[],
  opts?: TExecOpts,
): Promise<TExecOpts extends TFullOutputOption ? ExecResult : string> {
  if (!cmd) {
    throw new Error('You need to pass in a command to adbExec()');
  }

  const optsCopy = _.cloneDeep(opts ?? {}) as TExecOpts;
  // setting default timeout for each command to prevent infinite wait.
  optsCopy.timeout = optsCopy.timeout || this.adbExecTimeout || DEFAULT_ADB_EXEC_TIMEOUT;
  optsCopy.timeoutCapName = optsCopy.timeoutCapName || 'adbExecTimeout'; // For error message

  const {outputFormat = this.EXEC_OUTPUT_FORMAT.STDOUT} = optsCopy;

  cmd = _.isArray(cmd) ? cmd : [cmd];
  let adbRetried = false;
  const execFunc = async (): Promise<string | ExecResult> => {
    try {
      const args = [...this.executable.defaultArgs, ...cmd];
      log.debug(
        `Running '${this.executable.path} ` +
          (args.find((arg) => /\s+/.test(arg)) ? util.quote(args) : args.join(' ')) +
          `'`,
      );
      const {stdout: rawStdout, stderr} = await exec(this.executable.path, args, optsCopy) as TeenProcessExecResult<string>;
      // sometimes ADB prints out weird stdout warnings that we don't want
      // to include in any of the response data, so let's strip it out
      const stdout = rawStdout.replace(LINKER_WARNING_REGEXP, '').trim();
      return outputFormat === this.EXEC_OUTPUT_FORMAT.FULL ? {stdout, stderr} : stdout;
    } catch (e: unknown) {
      const error = e as ExecError;
      const errText = `${error.message}, ${error.stdout}, ${error.stderr}`;
      if (ADB_RETRY_ERROR_PATTERNS.some((p) => p.test(errText))) {
        log.info(`Error sending command, reconnecting device and retrying: ${cmd}`);
        await this.getDevicesWithRetry();

        // try again one time
        if (!adbRetried) {
          adbRetried = true;
          return await execFunc();
        }
      }

      if (error.code === 0 && error.stdout) {
        return error.stdout.replace(LINKER_WARNING_REGEXP, '').trim();
      }

      if (_.isNull(error.code)) {
        error.message =
          `Error executing adbExec. Original error: '${error.message}'. ` +
          `Try to increase the ${optsCopy.timeout}ms adb execution timeout ` +
          `represented by '${optsCopy.timeoutCapName}' capability`;
      } else {
        error.message =
          `Error executing adbExec. Original error: '${error.message}'; ` +
          `Command output: ${error.stderr || error.stdout || '<empty>'}`;
      }
      throw error;
    }
  };

  if (isExecLocked) {
    log.debug('Waiting until the other exclusive ADB command is completed');
    await waitForCondition(() => !isExecLocked, {
      waitMs: Number.MAX_SAFE_INTEGER,
      intervalMs: 10,
    });
    log.debug('Continuing with the current ADB command');
  }
  if (optsCopy.exclusive) {
    isExecLocked = true;
  }
  try {
    return (await execFunc()) as TExecOpts extends TFullOutputOption ? ExecResult : string;
  } finally {
    if (optsCopy.exclusive) {
      isExecLocked = false;
    }
  }
}

/**
 * Execute the given command using _adb shell_ prefix.
 *
 * @param cmd - Command string or array of command arguments
 * @param opts - Execution options
 * @returns Command output (string or ExecResult depending on outputFormat)
 * @throws {Error} If command execution fails
 */
export async function shell<TShellExecOpts extends ShellExecOptions = ShellExecOptions>(
  this: ADB,
  cmd: string | string[],
  opts?: TShellExecOpts,
): Promise<TShellExecOpts extends TFullOutputOption ? ExecResult : string> {
  const {privileged} = opts ?? ({} as TShellExecOpts);

  const cmdArr = _.isArray(cmd) ? cmd : [cmd];
  const fullCmd: string[] = ['shell'];
  if (privileged) {
    log.info(`'adb shell ${util.quote(cmdArr)}' requires root access`);
    if (await this.isRoot()) {
      log.info('The device already had root access');
      fullCmd.push(...cmdArr);
    } else {
      fullCmd.push('su', 'root', util.quote(cmdArr));
    }
  } else {
    fullCmd.push(...cmdArr);
  }
  return await this.adbExec(fullCmd, opts);
}

/**
 * Create a new ADB subprocess with the given arguments
 *
 * @param args - Array of command arguments (default: empty array)
 * @returns A SubProcess instance
 */
export function createSubProcess(this: ADB, args: string[] = []): SubProcess {
  // add the default arguments
  const finalArgs = [...this.executable.defaultArgs, ...args];
  log.debug(`Creating ADB subprocess with args: ${JSON.stringify(finalArgs)}`);
  return new SubProcess(this.getAdbPath(), finalArgs);
}

/**
 * Retrieve the current adb port.
 * @todo can probably deprecate this now that the logic is just to read this.adbPort
 * @deprecated Use this.adbPort instead
 *
 * @returns The ADB server port number
 */
export function getAdbServerPort(this: ADB): number {
  return this.adbPort as number;
}

/**
 * Retrieve the current emulator port from _adb devices_ output.
 *
 * @returns The emulator port number
 * @throws {Error} If no devices are connected or emulator port cannot be found
 */
export async function getEmulatorPort(this: ADB): Promise<number> {
  log.debug('Getting running emulator port');
  if (!_.isNil(this.emulatorPort)) {
    return this.emulatorPort;
  }
  try {
    const devices = await this.getConnectedDevices();
    const port = this.getPortFromEmulatorString(devices[0].udid);
    if (port) {
      return port;
    } else {
      throw new Error(`Emulator port not found`);
    }
  } catch (e: unknown) {
    const error = e as Error;
    throw new Error(`No devices connected. Original error: ${error.message}`);
  }
}

/**
 * Retrieve the current emulator port by parsing emulator name string.
 *
 * @param emStr - The emulator string (e.g., 'emulator-5554')
 * @returns The port number if found, false otherwise
 */
export function getPortFromEmulatorString(this: ADB, emStr: string): number | false {
  const portPattern = /emulator-(\d+)/;
  const match = portPattern.exec(emStr);
  return match ? parseInt(match[1], 10) : false;
}

/**
 * Retrieve the list of currently connected emulators.
 *
 * @param opts - Options for device retrieval
 * @returns Array of connected emulator devices
 * @throws {Error} If error occurs while getting emulators
 */
export async function getConnectedEmulators(
  this: ADB,
  opts: ConnectedDevicesOptions = {},
): Promise<Device[]> {
  log.debug('Getting connected emulators');
  try {
    const devices = await this.getConnectedDevices(opts);
    const emulators: Device[] = [];
    for (const device of devices) {
      const port = this.getPortFromEmulatorString(device.udid);
      if (port) {
        device.port = port;
        emulators.push(device);
      }
    }
    log.debug(`${util.pluralize('emulator', emulators.length, true)} connected`);
    return emulators;
  } catch (e: unknown) {
    const error = e as Error;
    throw new Error(`Error getting emulators. Original error: ${error.message}`);
  }
}

/**
 * Set _emulatorPort_ property of the current class.
 *
 * @param emPort - The emulator port number
 */
export function setEmulatorPort(this: ADB, emPort: number): void {
  this.emulatorPort = emPort;
}

/**
 * Set the identifier of the current device (_this.curDeviceId_).
 *
 * @param deviceId - The device identifier
 */
export function setDeviceId(this: ADB, deviceId: string): void {
  log.debug(`Setting device id to ${deviceId}`);
  this.curDeviceId = deviceId;
  const argsHasDevice = this.executable.defaultArgs.indexOf('-s');
  if (argsHasDevice !== -1) {
    // remove the old device id from the arguments
    this.executable.defaultArgs.splice(argsHasDevice, 2);
  }
  this.executable.defaultArgs.push('-s', deviceId);
}

/**
 * Set the current device object.
 *
 * @param deviceObj - The device object containing udid and other properties
 */
export function setDevice(this: ADB, deviceObj: Device): void {
  const deviceId = deviceObj.udid;
  const emPort = this.getPortFromEmulatorString(deviceId);
  if (_.isNumber(emPort)) {
    this.setEmulatorPort(emPort);
  }
  this.setDeviceId(deviceId);
}

/**
 * Get the object for the currently running emulator.
 * !!! This method has a side effect - it implicitly changes the
 * `deviceId` (only if AVD with a matching name is found)
 * and `emulatorPort` instance properties.
 *
 * @param avdName - The name of the AVD to find
 * @returns The device object if found, null otherwise
 * @throws {Error} If error occurs while getting AVD
 */
export async function getRunningAVD(this: ADB, avdName: string): Promise<Device | null> {
  log.debug(`Trying to find '${avdName}' emulator`);
  try {
    const emulators = await this.getConnectedEmulators();
    for (const emulator of emulators) {
      if (_.isNumber(emulator.port)) {
        this.setEmulatorPort(emulator.port);
      }
      const runningAVDName = await this.execEmuConsoleCommand(['avd', 'name'], {
        port: emulator.port,
        execTimeout: 5000,
        connTimeout: 1000,
      });
      if (_.toLower(avdName) === _.toLower(runningAVDName.trim())) {
        log.debug(`Found emulator '${avdName}' on port ${emulator.port}`);
        this.setDeviceId(emulator.udid);
        return emulator;
      }
    }
    log.debug(`Emulator '${avdName}' not running`);
    return null;
  } catch (e: unknown) {
    const error = e as Error;
    throw new Error(`Error getting AVD. Original error: ${error.message}`);
  }
}

/**
 * Get the object for the currently running emulator with retry.
 *
 * @param avdName - The name of the AVD to find
 * @param timeoutMs - Maximum time to wait (default: 20000ms)
 * @returns The device object if found, null otherwise
 * @throws {Error} If error occurs while getting AVD with retry
 */
export async function getRunningAVDWithRetry(
  this: ADB,
  avdName: string,
  timeoutMs: number = 20000,
): Promise<Device | null> {
  try {
    return (await waitForCondition(
      async () => {
        try {
          return await this.getRunningAVD(avdName.replace('@', ''));
        } catch (e: unknown) {
          const error = e as Error;
          log.debug(error.message);
          return false;
        }
      },
      {
        waitMs: timeoutMs,
        intervalMs: 1000,
      },
    )) as Device | null;
  } catch (e: unknown) {
    const error = e as Error;
    throw new Error(`Error getting AVD with retry. Original error: ${error.message}`);
  }
}

/**
 * Shutdown all running emulators by killing their processes.
 *
 * @throws {Error} If error occurs while killing emulators
 */
export async function killAllEmulators(this: ADB): Promise<void> {
  let cmd: string;
  let args: string[];
  if (system.isWindows()) {
    cmd = 'TASKKILL';
    args = ['TASKKILL', '/IM', 'emulator.exe'];
  } else {
    cmd = '/usr/bin/killall';
    args = ['-m', 'emulator*'];
  }
  try {
    await exec(cmd, args);
  } catch (e: unknown) {
    const error = e as Error;
    throw new Error(`Error killing emulators. Original error: ${error.message}`);
  }
}

/**
 * Kill emulator with the given name. No error
 * is thrown if given avd does not exist/is not running.
 *
 * @param avdName - The name of the AVD to kill (null to kill current AVD)
 * @param timeout - Maximum time to wait for emulator to be killed (default: 60000ms)
 * @returns True if emulator was killed, false if it was not running
 * @throws {Error} If emulator is still running after timeout
 */
export async function killEmulator(
  this: ADB,
  avdName: string | null = null,
  timeout: number = 60000,
): Promise<boolean> {
  if (util.hasValue(avdName)) {
    log.debug(`Killing avd '${avdName}'`);
    const device = await this.getRunningAVD(avdName);
    if (!device) {
      log.info(`No avd with name '${avdName}' running. Skipping kill step.`);
      return false;
    }
  } else {
    // killing the current avd
    log.debug(`Killing avd with id '${this.curDeviceId}'`);
    if (!(await this.isEmulatorConnected())) {
      log.debug(`Emulator with id '${this.curDeviceId}' not connected. Skipping kill step`);
      return false;
    }
  }
  await this.adbExec(['emu', 'kill']);
  log.debug(
    `Waiting up to ${timeout}ms until the emulator '${avdName ? avdName : this.curDeviceId}' is killed`,
  );
  try {
    await waitForCondition(
      async () => {
        try {
          return util.hasValue(avdName)
            ? !(await this.getRunningAVD(avdName as string))
            : !(await this.isEmulatorConnected());
        } catch {
          return false;
        }
      },
      {
        waitMs: timeout,
        intervalMs: 2000,
      },
    );
  } catch {
    throw new Error(
      `The emulator '${avdName ? avdName : this.curDeviceId}' is still running after being killed ${timeout}ms ago`,
    );
  }
  log.info(`Successfully killed the '${avdName ? avdName : this.curDeviceId}' emulator`);
  return true;
}

/**
 * Start an emulator with given parameters and wait until it is fully started.
 *
 * @param avdName - The name of the AVD to launch
 * @param opts - Launch options
 * @returns The SubProcess instance for the launched emulator
 * @throws {Error} If emulator fails to launch or boot
 */
export async function launchAVD(
  this: ADB,
  avdName: string,
  opts: AvdLaunchOptions = {},
): Promise<SubProcess> {
  const {
    args = [],
    env = {},
    language,
    country,
    launchTimeout = 60000,
    readyTimeout = 60000,
    retryTimes = 1,
  } = opts;
  log.debug(
    `Launching Emulator with AVD ${avdName}, launchTimeout ` +
      `${launchTimeout}ms and readyTimeout ${readyTimeout}ms`,
  );
  const emulatorBinaryPath = await this.getSdkBinaryPath('emulator');
  let processedAvdName = avdName;
  if (processedAvdName.startsWith('@')) {
    processedAvdName = processedAvdName.slice(1);
  }
  await this.checkAvdExist(processedAvdName);

  const launchArgs: string[] = ['-avd', processedAvdName];
  launchArgs.push(...toAvdLocaleArgs(language ?? null, country ?? null));

  let isDelayAdbFeatureEnabled = false;
  if (this.allowDelayAdb) {
    const {revision} = await this.getEmuVersionInfo();
    if (revision && util.compareVersions(revision, '>=', '29.0.7')) {
      // https://androidstudio.googleblog.com/2019/05/emulator-2907-canary.html
      try {
        const {target} = await this.getEmuImageProperties(processedAvdName);
        const apiMatch = /\d+/.exec(target);
        // https://issuetracker.google.com/issues/142533355
        if (apiMatch && parseInt(apiMatch[0], 10) >= MIN_DELAY_ADB_API_LEVEL) {
          launchArgs.push('-delay-adb');
          isDelayAdbFeatureEnabled = true;
        } else {
          throw new Error(`The actual image API version is below ${MIN_DELAY_ADB_API_LEVEL}`);
        }
      } catch (e: unknown) {
        const error = e as Error;
        log.info(
          `The -delay-adb emulator startup detection feature will not be enabled. ` +
            `Original error: ${error.message}`,
        );
      }
    }
  } else {
    log.info('The -delay-adb emulator startup detection feature has been explicitly disabled');
  }

  if (!_.isEmpty(args)) {
    launchArgs.push(...(_.isArray(args) ? args : util.shellParse(`${args}`)));
  }

  log.debug(`Running '${emulatorBinaryPath}' with args: ${util.quote(launchArgs)}`);
  if (!_.isEmpty(env)) {
    log.debug(`Customized emulator environment: ${JSON.stringify(env)}`);
  }
  const proc = new SubProcess(emulatorBinaryPath, launchArgs, {
    env: {...process.env, ...env},
  });
  await proc.start(0);
  for (const streamName of ['stderr', 'stdout']) {
    proc.on(`line-${streamName}`, (line: string) => log.debug(`[AVD OUTPUT] ${line}`));
  }
  proc.on('die', (code: number | null, signal: string | null) => {
    log.warn(
      `Emulator avd ${processedAvdName} exited with code ${code}${signal ? `, signal ${signal}` : ''}`,
    );
  });
  await retry(
    retryTimes,
    async () => await this.getRunningAVDWithRetry(processedAvdName, launchTimeout),
  );
  // At this point we have deviceId already assigned
  const timer = new timing.Timer().start();
  if (isDelayAdbFeatureEnabled) {
    try {
      await this.adbExec(['wait-for-device'], {timeout: readyTimeout});
    } catch (e: unknown) {
      const error = e as ExecError;
      throw new Error(
        `'${processedAvdName}' Emulator has failed to boot: ${error.stderr || error.message}`,
      );
    }
  }
  await this.waitForEmulatorReady(Math.trunc(readyTimeout - timer.getDuration().asMilliSeconds));
  return proc;
}

/**
 * Get the adb version. The result of this method is cached.
 *
 * @returns Version information object
 * @throws {Error} If error occurs while getting adb version
 */
export const getVersion = _.memoize(async function getVersion(this: ADB): Promise<Version> {
  let stdout: string;
  try {
    stdout = await this.adbExec('version');
  } catch (e: unknown) {
    const error = e as ExecError;
    throw new Error(`Error getting adb version: ${error.stderr || error.message}`);
  }

  const result: Partial<Version> = {};
  const binaryVersionMatch = BINARY_VERSION_PATTERN.exec(stdout);
  if (binaryVersionMatch) {
    result.binary = {
      version: semver.coerce(binaryVersionMatch[1])?.version || binaryVersionMatch[1],
      build: parseInt(binaryVersionMatch[2], 10),
    };
  }
  const bridgeVersionMatch = BRIDGE_VERSION_PATTERN.exec(stdout);
  if (bridgeVersionMatch) {
    result.bridge = {
      version: semver.coerce(bridgeVersionMatch[1])?.version || bridgeVersionMatch[1],
    };
  }
  return result as Version;
});

/**
 * Check if the current emulator is ready to accept further commands (booting completed).
 *
 * @param timeoutMs - Maximum time to wait (default: 20000ms)
 * @throws {Error} If emulator is not ready within the timeout period
 */
export async function waitForEmulatorReady(this: ADB, timeoutMs: number = 20000): Promise<void> {
  log.debug(`Waiting up to ${timeoutMs}ms for the emulator to be ready`);
  const requiredServicesRe = REQUIRED_SERVICES.map((name) => new RegExp(`\\b${name}:`));
  let services: string | undefined;
  const timer = new timing.Timer().start();
  let isFirstCheck = true;
  let isBootCompleted = false;
  try {
    await waitForCondition(
      async () => {
        if (isFirstCheck) {
          isFirstCheck = false;
        } else {
          log.debug(
            `${timer.getDuration().asMilliSeconds.toFixed(0)}ms elapsed since ` +
              `emulator readiness check has started`,
          );
        }
        try {
          if (!isBootCompleted) {
            const [bootCompleted, bootAnimState] = await Promise.all([
              this.shell(['getprop', 'sys.boot_completed']),
              this.shell(['getprop', 'init.svc.bootanim']),
            ]);
            if (bootCompleted.trim() !== '1' || !['stopped', ''].includes(bootAnimState.trim())) {
              log.debug(
                `Current status: sys.boot_completed=${bootCompleted.trim()}, ` +
                  `init.svc.bootanim=${bootAnimState.trim()}`,
              );
              return false;
            }
            isBootCompleted = true;
          }

          const servicesOutput = await this.shell(['service', 'list']);
          services = servicesOutput;
          if (
            !servicesOutput ||
            !requiredServicesRe.every((pattern) => pattern.test(servicesOutput))
          ) {
            log.debug(`Running services: ${servicesOutput}`);
            return false;
          }

          return true;
        } catch (err: unknown) {
          const error = err as Error;
          log.debug(`Intermediate error: ${error.message}`);
          return false;
        }
      },
      {
        waitMs: timeoutMs,
        intervalMs: 3000,
      },
    );
  } catch {
    let suffix = '';
    const servicesValue = services;
    if (servicesValue) {
      const missingServices = _.zip(REQUIRED_SERVICES, requiredServicesRe)
        .filter(([, pattern]) => !(pattern as RegExp).test(servicesValue))
        .map(([name]) => name);
      suffix = ` (${missingServices} service${missingServices.length === 1 ? ' is' : 's are'} not running)`;
    }
    throw new Error(`Emulator is not ready within ${timeoutMs}ms${suffix}`);
  }
  const elapsedMs = timer.getDuration().asMilliSeconds;
  // Only log if the wait took a noticeable amount of time
  if (elapsedMs > 100) {
    log.info(`Emulator is ready after ${elapsedMs}ms`);
  }
}

/**
 * Check if the current device is ready to accept further commands (booting completed).
 *
 * @param appDeviceReadyTimeout - Timeout in seconds (default: 30)
 * @throws {Error} If device is not ready within the timeout period
 */
export async function waitForDevice(this: ADB, appDeviceReadyTimeout: number = 30): Promise<void> {
  const timeoutMs = appDeviceReadyTimeout * 1000;
  let lastErrorMessage: string | null = null;
  try {
    await waitForCondition(
      async () => {
        try {
          await this.adbExec('wait-for-device', {timeout: Math.trunc(timeoutMs * 0.99)});
          await this.ping();
          return true;
        } catch (e: unknown) {
          const error = e as Error;
          lastErrorMessage = error.message;
          try {
            try {
              await this.reconnect();
            } catch {
              await this.restartAdb();
            }
            await this.getConnectedDevices();
          } catch {
            // Ignore errors during reconnection
          }
          return false;
        }
      },
      {
        waitMs: timeoutMs,
        intervalMs: 1000,
      },
    );
  } catch {
    let suffix = '';
    if (lastErrorMessage) {
      suffix = ` Original error: ${lastErrorMessage}`;
    }
    throw new Error(`The device is not ready after ${appDeviceReadyTimeout}s.${suffix}`);
  }
}

/**
 * Reboot the current device and wait until it is completed.
 *
 * @param retries - Number of retry attempts (default: 90)
 * @throws {Error} If reboot fails or device is not ready after reboot
 */
export async function reboot(
  this: ADB,
  retries: number = DEFAULT_ADB_REBOOT_RETRIES,
): Promise<void> {
  // Get root access so we can run the next shell commands which require root access
  const {wasAlreadyRooted} = await this.root();
  try {
    // Stop and re-start the device
    await this.shell(['stop']);
    await B.delay(2000); // let the emu finish stopping;
    await this.setDeviceProperty('sys.boot_completed', '0', {
      privileged: false, // no need to set privileged true because device already rooted
    });
    await this.shell(['start']);
  } catch (e: unknown) {
    const error = e as Error;
    const {message} = error;

    // provide a helpful error message if the reason reboot failed was because ADB couldn't gain root access
    if (message.includes('must be root')) {
      throw new Error(
        `Could not reboot device. Rebooting requires root access and ` +
          `attempt to get root access on device failed with error: '${message}'`,
      );
    }
    throw error;
  } finally {
    // Return root state to what it was before
    if (!wasAlreadyRooted) {
      await this.unroot();
    }
  }
  const timer = new timing.Timer().start();
  await retryInterval(retries, 1000, async () => {
    if ((await this.getDeviceProperty('sys.boot_completed')) === '1') {
      return;
    }
    const msg = `Reboot is not completed after ${timer.getDuration().asMilliSeconds.toFixed(0)}ms`;
    // we don't want the stack trace
    log.debug(msg);
    throw new Error(msg);
  });
}

/**
 * Switch adb server root privileges.
 *
 * @param isElevated - True to enable root, false to disable
 * @returns Result object indicating success and whether device was already rooted
 */
export async function changeUserPrivileges(this: ADB, isElevated: boolean): Promise<RootResult> {
  const cmd = isElevated ? 'root' : 'unroot';

  const retryIfOffline = async (cmdFunc: () => Promise<any>): Promise<any> => {
    try {
      return await cmdFunc();
    } catch (err: unknown) {
      const error = err as ExecError;
      // Check the output of the stdErr to see if there's any clues that show that the device went offline
      // and if it did go offline, restart ADB
      if (
        ['closed', 'device offline', 'timeout expired'].some((x) =>
          (error.stderr || '').toLowerCase().includes(x),
        )
      ) {
        log.warn(`Attempt to ${cmd} caused ADB to think the device went offline`);
        try {
          await this.reconnect();
        } catch {
          await this.restartAdb();
        }
        return await cmdFunc();
      } else {
        throw error;
      }
    }
  };

  // If it's already rooted, our job is done. No need to root it again.
  const isRoot = await retryIfOffline(async () => await this.isRoot());
  if ((isRoot && isElevated) || (!isRoot && !isElevated)) {
    return {isSuccessful: true, wasAlreadyRooted: isRoot};
  }

  let wasAlreadyRooted = isRoot;
  try {
    const {stdout} = await retryIfOffline(async () => await this.adbExec([cmd]));
    log.debug(stdout);

    // on real devices in some situations we get an error in the stdout
    if (stdout) {
      if (stdout.includes('adbd cannot run as root')) {
        return {isSuccessful: false, wasAlreadyRooted};
      }
      // if the device was already rooted, return that in the result
      if (stdout.includes('already running as root')) {
        wasAlreadyRooted = true;
      }
    }
    return {isSuccessful: true, wasAlreadyRooted};
  } catch (err: unknown) {
    const error = err as ExecError;
    const {stderr = '', message} = error;
    log.warn(
      `Unable to ${cmd} adb daemon. Original error: '${message}'. Stderr: '${stderr}'. Continuing.`,
    );
    return {isSuccessful: false, wasAlreadyRooted};
  }
}

/**
 * Switch adb server to root mode
 *
 * @returns Result object indicating success and whether device was already rooted
 */
export async function root(this: ADB): Promise<RootResult> {
  return await this.changeUserPrivileges(true);
}

/**
 * Switch adb server to non-root mode.
 *
 * @returns Result object indicating success and whether device was already rooted
 */
export async function unroot(this: ADB): Promise<RootResult> {
  return await this.changeUserPrivileges(false);
}

/**
 * Checks whether the current user is root
 *
 * @returns True if current user is root, false otherwise
 */
export async function isRoot(this: ADB): Promise<boolean> {
  return (await this.shell(['whoami'])).trim() === 'root';
}

/**
 * Installs the given certificate on a rooted real device or
 * an emulator. The emulator must be executed with `-writable-system`
 * command line option and adb daemon should be running in root
 * mode for this method to work properly. The method also requires
 * openssl tool to be available on the destination system.
 * Read https://github.com/appium/appium/issues/10964
 * for more details on this topic
 *
 * @param cert - Certificate as Buffer or base64-encoded string
 * @throws {Error} If certificate installation fails
 */
export async function installMitmCertificate(this: ADB, cert: Buffer | string): Promise<void> {
  const openSsl = await getOpenSslForOs();

  const tmpRoot = await tempDir.openDir();
  try {
    const srcCert = path.resolve(tmpRoot, 'source.cer');
    await fs.writeFile(srcCert, Buffer.isBuffer(cert) ? cert : Buffer.from(cert, 'base64'));
    const {stdout} = await exec(openSsl, ['x509', '-noout', '-hash', '-in', srcCert]);
    const certHash = stdout.trim();
    log.debug(`Got certificate hash: ${certHash}`);
    log.debug('Preparing certificate content');
    const {stdout: stdoutBuff1} = await exec(openSsl, ['x509', '-in', srcCert], {isBuffer: true});
    const {stdout: stdoutBuff2} = await exec(
      openSsl,
      ['x509', '-in', srcCert, '-text', '-fingerprint', '-noout'],
      {isBuffer: true},
    );
    const dstCertContent = Buffer.concat([stdoutBuff1, stdoutBuff2]);
    const dstCert = path.resolve(tmpRoot, `${certHash}.0`);
    await fs.writeFile(dstCert, dstCertContent);
    log.debug('Remounting /system in rw mode');
    // Sometimes emulator reboot is still not fully finished on this stage, so retry
    await retryInterval(5, 2000, async () => await this.adbExec(['remount']));
    log.debug(`Uploading the generated certificate from '${dstCert}' to '${CERTS_ROOT}'`);
    await this.push(dstCert, CERTS_ROOT);
    log.debug('Remounting /system to confirm changes');
    await this.adbExec(['remount']);
  } catch (err: unknown) {
    const error = err as Error;
    throw new Error(
      `Cannot inject the custom certificate. ` +
        `Is the certificate properly encoded into base64-string? ` +
        `Do you have root permissions on the device? ` +
        `Original error: ${error.message}`,
    );
  } finally {
    await fs.rimraf(tmpRoot);
  }
}

/**
 * Verifies if the given root certificate is already installed on the device.
 *
 * @param cert - Certificate as Buffer or base64-encoded string
 * @returns True if certificate is installed, false otherwise
 * @throws {Error} If certificate hash cannot be retrieved
 */
export async function isMitmCertificateInstalled(
  this: ADB,
  cert: Buffer | string,
): Promise<boolean> {
  const openSsl = await getOpenSslForOs();

  const tmpRoot = await tempDir.openDir();
  let certHash: string;
  try {
    const tmpCert = path.resolve(tmpRoot, 'source.cer');
    await fs.writeFile(tmpCert, Buffer.isBuffer(cert) ? cert : Buffer.from(cert, 'base64'));
    const {stdout} = await exec(openSsl, ['x509', '-noout', '-hash', '-in', tmpCert]);
    certHash = stdout.trim();
  } catch (err: unknown) {
    const error = err as Error;
    throw new Error(
      `Cannot retrieve the certificate hash. ` +
        `Is the certificate properly encoded into base64-string? ` +
        `Original error: ${error.message}`,
    );
  } finally {
    await fs.rimraf(tmpRoot);
  }
  const dstPath = path.posix.resolve(CERTS_ROOT, `${certHash}.0`);
  log.debug(`Checking if the certificate is already installed at '${dstPath}'`);
  return await this.fileExists(dstPath);
}

/**
 * Creates chunks for the given arguments and executes them in `adb shell`.
 * This is faster than calling `adb shell` separately for each arg, however
 * there is a limit for a maximum length of a single adb command. that is why
 * we need all this complicated logic.
 *
 * @param argTransformer - Function to transform each argument into command array
 * @param args - Array of arguments to process
 * @throws {Error} If argument transformer returns invalid result or command execution fails
 */
export async function shellChunks(
  this: ADB,
  argTransformer: (x: string) => string[],
  args: string[],
): Promise<void> {
  const commands: string[][] = [];
  let cmdChunk: string[] = [];
  for (const arg of args) {
    const nextCmd = argTransformer(arg);
    if (!_.isArray(nextCmd)) {
      throw new Error('Argument transformer must result in an array');
    }
    if (_.last(nextCmd) !== ';') {
      nextCmd.push(';');
    }
    if (nextCmd.join(' ').length + cmdChunk.join(' ').length >= MAX_SHELL_BUFFER_LENGTH) {
      commands.push(cmdChunk);
      cmdChunk = [];
    }
    cmdChunk = [...cmdChunk, ...nextCmd];
  }
  if (!_.isEmpty(cmdChunk)) {
    commands.push(cmdChunk);
  }
  log.debug(`Got the following command chunks to execute: ${JSON.stringify(commands)}`);
  let lastError: Error | null = null;
  for (const cmd of commands) {
    try {
      await this.shell(cmd);
    } catch (e: unknown) {
      lastError = e as Error;
    }
  }
  if (lastError) {
    throw lastError;
  }
}

/**
 * Transforms the given language and country abbreviations
 * to AVD arguments array
 *
 * @param language - Language code (e.g., 'en', 'fr')
 * @param country - Country code (e.g., 'US', 'FR')
 * @returns Array of AVD locale arguments
 */
export function toAvdLocaleArgs(language: string | null, country: string | null): string[] {
  const result: string[] = [];
  if (language && _.isString(language)) {
    result.push('-prop', `persist.sys.language=${language.toLowerCase()}`);
  }
  if (country && _.isString(country)) {
    result.push('-prop', `persist.sys.country=${country.toUpperCase()}`);
  }
  let locale: string | undefined;
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
 * Retrieves full paths to all 'build-tools' subfolders under the particular
 * SDK root folder
 *
 * @param sdkRoot - The Android SDK root directory path
 * @returns Array of build-tools directory paths (newest first)
 */
export const getBuildToolsDirs = _.memoize(async function getBuildToolsDirs(
  sdkRoot: string,
): Promise<string[]> {
  let buildToolsDirs = await fs.glob('*/', {
    cwd: path.resolve(sdkRoot, 'build-tools'),
    absolute: true,
  });
  try {
    buildToolsDirs = buildToolsDirs
      .map((dir) => [path.basename(dir), dir] as [string, string])
      .sort((a, b) => semver.rcompare(a[0], b[0]))
      .map((pair) => pair[1]);
  } catch (err: unknown) {
    const error = err as Error;
    log.warn(
      `Cannot sort build-tools folders ${JSON.stringify(buildToolsDirs.map((dir) => path.basename(dir)))} ` +
        `by semantic version names.`,
    );
    log.warn(`Falling back to sorting by modification date. Original error: ${error.message}`);
    const pairs = await B.map(
      buildToolsDirs,
      async (dir) => [(await fs.stat(dir)).mtime.valueOf(), dir] as [number, string],
    );
    buildToolsDirs = pairs.sort((a, b) => (a[0] < b[0] ? 1 : -1)).map((pair) => pair[1]);
  }
  log.info(
    `Found ${buildToolsDirs.length} 'build-tools' folders under '${sdkRoot}' (newest first):`,
  );
  for (const dir of buildToolsDirs) {
    log.info(`    ${dir}`);
  }
  return buildToolsDirs;
});
