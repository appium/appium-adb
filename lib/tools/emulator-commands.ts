import {log} from '../logger.js';
import _ from 'lodash';
import net from 'net';
import {util, fs} from '@appium/support';
import B from 'bluebird';
import path from 'path';
import * as ini from 'ini';
import type {ADB} from '../adb.js';
import type {
  EmuInfo,
  EmuVersionInfo,
  StringRecord,
  PowerAcStates,
  Sensors,
  GsmCallActions,
  GsmSignalStrength,
  GsmVoiceStates,
  NetworkSpeed,
  ExecTelnetOptions,
} from './types.js';

/**
 * Retrieves the list of available Android emulators
 *
 * @returns
 */
async function listEmulators(): Promise<EmuInfo[]> {
  let avdsRoot = process.env.ANDROID_AVD_HOME;
  if (await dirExists(avdsRoot ?? '')) {
    return await getAvdConfigPaths(avdsRoot as string);
  }

  if (avdsRoot) {
    log.warn(
      `The value of the ANDROID_AVD_HOME environment variable '${avdsRoot}' is not an existing directory`,
    );
  }

  const prefsRoot = await getAndroidPrefsRoot();
  if (!prefsRoot) {
    return [];
  }

  avdsRoot = path.resolve(prefsRoot, 'avd');
  if (!(await dirExists(avdsRoot))) {
    log.debug(`Virtual devices config root '${avdsRoot}' is not an existing directory`);
    return [];
  }

  return await getAvdConfigPaths(avdsRoot);
}

/**
 * Get configuration paths of all virtual devices
 *
 * @param avdsRoot Path to the directory that contains the AVD .ini files
 * @returns
 */
async function getAvdConfigPaths(avdsRoot: string): Promise<EmuInfo[]> {
  const configs = await fs.glob('*.ini', {
    cwd: avdsRoot,
    absolute: true,
  });
  return configs
    .map((confPath) => {
      const avdName = path.basename(confPath).split('.').slice(0, -1).join('.');
      return {name: avdName, config: confPath};
    })
    .filter(({name}) => _.trim(name));
}

/**
 * Check the emulator state.
 *
 * @returns True if Emulator is visible to adb.
 */
export async function isEmulatorConnected(this: ADB): Promise<boolean> {
  const emulators = await this.getConnectedEmulators();
  return !!_.find(emulators, (x) => x && x.udid === this.curDeviceId);
}

/**
 * Verify the emulator is connected.
 *
 * @throws If Emulator is not visible to adb.
 */
export async function verifyEmulatorConnected(this: ADB): Promise<void> {
  if (!(await this.isEmulatorConnected())) {
    throw new Error(`The emulator "${this.curDeviceId}" was unexpectedly disconnected`);
  }
}

/**
 * Emulate fingerprint touch event on the connected emulator.
 *
 * @param fingerprintId - The ID of the fingerprint.
 */
export async function fingerprint(this: ADB, fingerprintId: string): Promise<void> {
  if (!fingerprintId) {
    throw new Error('Fingerprint id parameter must be defined');
  }
  // the method used only works for API level 23 and above
  const level = await this.getApiLevel();
  if (level < 23) {
    throw new Error(`Device API Level must be >= 23. Current Api level '${level}'`);
  }
  await this.adbExecEmu(['finger', 'touch', fingerprintId]);
}

/**
 * Change the display orientation on the connected emulator.
 * The orientation is changed (PI/2 is added) every time
 * this method is called.
 */
export async function rotate(this: ADB): Promise<void> {
  await this.adbExecEmu(['rotate']);
}

/**
 * Emulate power state change on the connected emulator.
 *
 * @param state - Either 'on' or 'off'.
 */
export async function powerAC(this: ADB, state: PowerAcStates = 'on'): Promise<void> {
  if (_.values(this.POWER_AC_STATES).indexOf(state) === -1) {
    throw new TypeError(
      `Wrong power AC state sent '${state}'. ` +
        `Supported values: ${_.values(this.POWER_AC_STATES)}]`,
    );
  }
  await this.adbExecEmu(['power', 'ac', state]);
}

/**
 * Emulate sensors values on the connected emulator.
 *
 * @param sensor - Sensor type declared in SENSORS items.
 * @param value  - Number to set as the sensor value.
 * @throws - If sensor type or sensor value is not defined
 */
export async function sensorSet(this: ADB, sensor: string, value: Sensors): Promise<void> {
  if (!_.includes(this.SENSORS, sensor)) {
    throw new TypeError(
      `Unsupported sensor sent '${sensor}'. ` + `Supported values: ${_.values(this.SENSORS)}]`,
    );
  }
  if (_.isNil(value)) {
    throw new TypeError(
      `Missing/invalid sensor value argument. ` +
        `You need to provide a valid value to set to the sensor in ` +
        `format <value-a>[:<value-b>[:<value-c>[...]]].`,
    );
  }
  await this.adbExecEmu(['sensor', 'set', sensor, `${value}`]);
}

/**
 * Emulate power capacity change on the connected emulator.
 *
 * @param percent - Percentage value in range [0, 100].
 */
export async function powerCapacity(this: ADB, percent: string | number = 100): Promise<void> {
  const percentInt = parseInt(`${percent}`, 10);
  if (isNaN(percentInt) || percentInt < 0 || percentInt > 100) {
    throw new TypeError(`The percentage value should be valid integer between 0 and 100`);
  }
  await this.adbExecEmu(['power', 'capacity', `${percentInt}`]);
}

/**
 * Emulate power off event on the connected emulator.
 */
export async function powerOFF(this: ADB): Promise<void> {
  await this.powerAC(this.POWER_AC_STATES.POWER_AC_OFF);
  await this.powerCapacity(0);
}

/**
 * Emulate send SMS event on the connected emulator.
 *
 * @param phoneNumber - The phone number of message sender.
 * @param message - The message content.
 * @throws If phone number has invalid format.
 */
export async function sendSMS(
  this: ADB,
  phoneNumber: string | number,
  message = '',
): Promise<void> {
  if (_.isEmpty(message)) {
    throw new TypeError('SMS message must not be empty');
  }
  if (!_.isInteger(phoneNumber) && _.isEmpty(phoneNumber)) {
    throw new TypeError('Phone number most not be empty');
  }
  await this.adbExecEmu(['sms', 'send', `${phoneNumber}`, message]);
}

/**
 * Emulate GSM call event on the connected emulator.
 *
 * @param phoneNumber - The phone number of the caller.
 * @param action - One of available GSM call actions.
 * @throws If phone number has invalid format.
 * @throws If _action_ value is invalid.
 */
export async function gsmCall(
  this: ADB,
  phoneNumber: string | number,
  action: GsmCallActions,
): Promise<void> {
  if (!_.values(this.GSM_CALL_ACTIONS).includes(action)) {
    throw new TypeError(
      `Invalid gsm action param ${action}. Supported values: ${_.values(this.GSM_CALL_ACTIONS)}`,
    );
  }
  if (!_.isInteger(phoneNumber) && _.isEmpty(phoneNumber)) {
    throw new TypeError('Phone number most not be empty');
  }
  await this.adbExecEmu(['gsm', action, `${phoneNumber}`]);
}

/**
 * Emulate GSM signal strength change event on the connected emulator.
 *
 * @param strength - A number in range [0, 4];
 * @throws If _strength_ value is invalid.
 */
export async function gsmSignal(this: ADB, strength: GsmSignalStrength = 4): Promise<void> {
  const strengthInt = parseInt(`${strength}`, 10);
  if (!_.includes(this.GSM_SIGNAL_STRENGTHS, strengthInt)) {
    throw new TypeError(
      `Invalid signal strength param ${strength}. Supported values: ${_.values(this.GSM_SIGNAL_STRENGTHS)}`,
    );
  }
  log.info('gsm signal-profile <strength> changes the reported strength on next (15s) update.');
  await this.adbExecEmu(['gsm', 'signal-profile', `${strength}`]);
}

/**
 * Emulate GSM voice event on the connected emulator.
 *
 * @param state - Either 'on' or 'off'.
 * @throws If _state_ value is invalid.
 */
export async function gsmVoice(this: ADB, state: GsmVoiceStates = 'on'): Promise<void> {
  // gsm voice <state> allows you to change the state of your GPRS connection
  if (!_.values(this.GSM_VOICE_STATES).includes(state)) {
    throw new TypeError(
      `Invalid gsm voice state param ${state}. Supported values: ${_.values(this.GSM_VOICE_STATES)}`,
    );
  }
  await this.adbExecEmu(['gsm', 'voice', state]);
}

/**
 * Emulate network speed change event on the connected emulator.
 *
 * @param speed
 *  One of possible NETWORK_SPEED values.
 * @throws If _speed_ value is invalid.
 */
export async function networkSpeed(this: ADB, speed: NetworkSpeed = 'full'): Promise<void> {
  // network speed <speed> allows you to set the network speed emulation.
  if (!_.values(this.NETWORK_SPEED).includes(speed)) {
    throw new Error(
      `Invalid network speed param ${speed}. Supported values: ${_.values(this.NETWORK_SPEED)}`,
    );
  }
  await this.adbExecEmu(['network', 'speed', speed]);
}

/**
 * Executes a command through emulator telnet console interface and returns its output
 *
 * @param cmd - The actual command to execute. See
 * https://developer.android.com/studio/run/emulator-console for more details
 * on available commands
 * @param opts
 * @returns The command output
 * @throws If there was an error while connecting to the Telnet console
 * or if the given command returned non-OK response
 */
export async function execEmuConsoleCommand(
  this: ADB,
  cmd: string[] | string,
  opts: ExecTelnetOptions = {},
): Promise<string> {
  let port = parseInt(`${opts.port}`, 10);
  if (!port) {
    const portMatch = /emulator-(\d+)/i.exec(this.curDeviceId as string);
    if (!portMatch) {
      throw new Error(
        `Cannot parse the console port number from the device identifier '${this.curDeviceId}'. ` +
          `Is it an emulator?`,
      );
    }
    port = parseInt(portMatch[1], 10);
  }
  const host = '127.0.0.1';
  const {execTimeout = 60000, connTimeout = 5000, initTimeout = 5000} = opts;
  await this.resetTelnetAuthToken();

  const okFlag = /^OK$/m;
  const nokFlag = /^KO\b/m;
  const eol = '\r\n';
  const client = net.connect({
    host,
    port,
  });

  return await new B((resolve, reject) => {
    const connTimeoutObj = setTimeout(
      () =>
        reject(
          new Error(
            `Cannot connect to the Emulator console at ${host}:${port} ` + `after ${connTimeout}ms`,
          ),
        ),
      connTimeout,
    );
    let execTimeoutObj: NodeJS.Timeout;
    let initTimeoutObj: NodeJS.Timeout;
    let isCommandSent = false;
    let serverResponse: Buffer[] = [];

    client.once('error', (e) => {
      clearTimeout(connTimeoutObj);
      reject(
        new Error(
          `Cannot connect to the Emulator console at ${host}:${port}. ` +
            `Original error: ${e.message}`,
        ),
      );
    });

    client.once('connect', () => {
      clearTimeout(connTimeoutObj);
      initTimeoutObj = setTimeout(
        () =>
          reject(
            new Error(
              `Did not get the initial response from the Emulator console at ${host}:${port} ` +
                `after ${initTimeout}ms`,
            ),
          ),
        initTimeout,
      );
    });

    client.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      serverResponse.push(buf);
      const output = Buffer.concat(serverResponse).toString('utf8').trim();
      if (okFlag.test(output)) {
        // The initial incoming data chunk confirms the interface is ready for input
        if (!isCommandSent) {
          clearTimeout(initTimeoutObj);
          serverResponse = [];
          const cmdStr = _.isArray(cmd) ? util.quote(cmd) : `${cmd}`;
          log.debug(`Executing Emulator console command: ${cmdStr}`);
          client.write(cmdStr);
          client.write(eol);
          isCommandSent = true;
          execTimeoutObj = setTimeout(
            () =>
              reject(
                new Error(
                  `Did not get any response from the Emulator console at ${host}:${port} ` +
                    `to '${cmd}' command after ${execTimeout}ms`,
                ),
              ),
            execTimeout,
          );
          return;
        }
        clearTimeout(execTimeoutObj);
        client.end();
        const outputArr = output.split(eol);
        // remove the redundant OK flag from the resulting command output
        return resolve(
          outputArr
            .slice(0, outputArr.length - 1)
            .join('\n')
            .trim(),
        );
      } else if (nokFlag.test(output)) {
        clearTimeout(initTimeoutObj);
        clearTimeout(execTimeoutObj);
        client.end();
        const outputArr = output.split(eol);
        return reject(_.trim(_.last(outputArr) || ''));
      }
    });
  });
}

/**
 * Retrieves emulator version from the file system
 *
 * @returns If no version info could be parsed then an empty
 * object is returned
 */
export async function getEmuVersionInfo(this: ADB): Promise<EmuVersionInfo> {
  const propsPath = path.join(this.sdkRoot as string, 'emulator', 'source.properties');
  if (!(await fs.exists(propsPath))) {
    return {};
  }

  const content = await fs.readFile(propsPath, 'utf8');
  const revisionMatch = /^Pkg\.Revision=([\d.]+)$/m.exec(content);
  const result: EmuVersionInfo = {};
  if (revisionMatch) {
    result.revision = revisionMatch[1];
  }
  const buildIdMatch = /^Pkg\.BuildId=(\d+)$/m.exec(content);
  if (buildIdMatch) {
    result.buildId = parseInt(buildIdMatch[1], 10);
  }
  return result;
}

/**
 * Retrieves emulator image properties from the local file system
 *
 * @param avdName Emulator name. Should NOT start with '@' character
 * @throws if there was a failure while extracting the properties
 * @returns The content of emulator image properties file.
 * Usually this configuration .ini file has the following content:
 *   avd.ini.encoding=UTF-8
 *   path=/Users/username/.android/avd/Pixel_XL_API_30.avd
 *   path.rel=avd/Pixel_XL_API_30.avd
 *   target=android-30
 */
export async function getEmuImageProperties(this: ADB, avdName: string): Promise<StringRecord> {
  const avds = await listEmulators();
  const avd = avds.find(({name}) => name === avdName);
  if (!avd) {
    let msg = `Cannot find '${avdName}' emulator. `;
    if (_.isEmpty(avds)) {
      msg += `No emulators have been detected on your system`;
    } else {
      msg += `Available avd names are: ${avds.map(({name}) => name)}`;
    }
    throw new Error(msg);
  }
  return ini.parse(await fs.readFile(avd.config, 'utf8'));
}

/**
 * Check if given emulator exists in the list of available avds.
 *
 * @param avdName - The name of emulator to verify for existence.
 * Should NOT start with '@' character
 * @throws If the emulator with given name does not exist.
 */
export async function checkAvdExist(this: ADB, avdName: string): Promise<boolean> {
  const avds = await listEmulators();
  if (!avds.some(({name}) => name === avdName)) {
    let msg = `Avd '${avdName}' is not available. `;
    if (_.isEmpty(avds)) {
      msg += `No emulators have been detected on your system`;
    } else {
      msg += `Please select your avd name from one of these: '${avds.map(({name}) => name)}'`;
    }
    throw new Error(msg);
  }
  return true;
}

/**
 * Send an arbitrary Telnet command to the device under test.
 *
 * @param command - The command to be sent.
 * @returns The actual output of the given command.
 */
export async function sendTelnetCommand(this: ADB, command: string): Promise<string> {
  return await this.execEmuConsoleCommand(command, {port: await this.getEmulatorPort()});
}

// #region Private functions

/**
 * Retrieves the full path to the Android preferences root
 *
 * @returns The full path to the folder or `null` if the folder cannot be found
 */
async function getAndroidPrefsRoot(): Promise<string | null> {
  let location = process.env.ANDROID_EMULATOR_HOME;
  if (await dirExists(location ?? '')) {
    return location ?? null;
  }

  if (location) {
    log.warn(
      `The value of the ANDROID_EMULATOR_HOME environment variable '${location}' is not an existing directory`,
    );
  }

  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    location = path.resolve(home, '.android');
  }

  if (!(await dirExists(location ?? ''))) {
    log.debug(`Android config root '${location}' is not an existing directory`);
    return null;
  }

  return location ?? null;
}

/**
 * Check if a path exists on the filesystem and is a directory
 *
 * @param location The full path to the directory
 * @returns
 */
async function dirExists(location: string): Promise<boolean> {
  return (await fs.exists(location)) && (await fs.stat(location)).isDirectory();
}

// #endregion
