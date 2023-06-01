import _ from 'lodash';
import os from 'node:os';
import methods, {getAndroidBinaryPath} from './tools/index.js';
import {DEFAULT_ADB_EXEC_TIMEOUT, requireSdkRoot, getSdkRootFromEnv} from './helpers.js';
import log from './logger.js';
import {StringRecord} from '@appium/types';

const DEFAULT_ADB_PORT = 5037;
export const DEFAULT_OPTS: ADBOptions = {
  sdkRoot: getSdkRootFromEnv() || null,
  udid: null,
  appDeviceReadyTimeout: null,
  useKeystore: null,
  keystorePath: null,
  keystorePassword: null,
  keyAlias: null,
  keyPassword: null,
  executable: {path: 'adb', defaultArgs: []},
  tmpDir: os.tmpdir(),
  curDeviceId: null,
  emulatorPort: null,
  logcat: null,
  binaries: {},
  instrumentProc: null,
  suppressKillServer: null,
  jars: {},
  adbPort: DEFAULT_ADB_PORT,
  adbHost: null,
  adbExecTimeout: DEFAULT_ADB_EXEC_TIMEOUT,
  remoteAppsCacheLimit: 10,
  buildToolsVersion: null,
  allowOfflineDevices: false,
  allowDelayAdb: true,
};

export interface ADBOptions {
  sdkRoot?: string | null;
  udid?: string | null;
  appDeviceReadyTimeout?: null;
  useKeystore?: string | null;
  keystorePath?: string | null;
  keystorePassword?: string | null;
  keyAlias?: string | null;
  keyPassword?: string | null;
  executable: ADBExecutable;
  tmpDir?: string;
  curDeviceId?: string | null;
  emulatorPort?: number | null;
  logcat?: string | null;
  binaries?: StringRecord;
  instrumentProc?: string | null;
  suppressKillServer?: string | null;
  jars?: StringRecord;
  adbPort?: number;
  adbHost?: string | null;
  adbExecTimeout?: number;
  remoteAppsCacheLimit?: number;
  buildToolsVersion?: string | null;
  allowOfflineDevices?: boolean;
  allowDelayAdb?: boolean;
  remoteAdbHost?: string;
  remoteAdbPort?: number;
}

export interface ADBExecutable {
  path: string;
  defaultArgs: string[];
}

export class ADB {
  adbHost?: string;
  adbPort?: number;
  constructor(opts: Partial<ADBOptions> = {}) {
    Object.assign(this, opts);
    _.defaultsDeep(this, _.cloneDeep(DEFAULT_OPTS));

    if (opts.remoteAdbHost) {
      this.executable.defaultArgs.push('-H', opts.remoteAdbHost);
      this.adbHost = opts.remoteAdbHost;
    }
    // TODO figure out why we have this option as it does not appear to be
    // used anywhere. Probably deprecate in favor of simple opts.adbPort
    if (opts.remoteAdbPort) {
      this.adbPort = opts.remoteAdbPort;
    }
    this.executable.defaultArgs.push('-P', String(this.adbPort));
  }

  /**
   * Create a new instance of `ADB` that inherits configuration from this `ADB` instance.
   * This avoids the need to call `ADB.createADB()` multiple times.
   * @param opts - Additional options mapping to pass to the `ADB` constructor.
   * @returns The resulting class instance.
   */
  clone(opts: Partial<ADBOptions> = {}): ADB {
    const originalOptions = _.cloneDeep(_.pick(this, Object.keys(DEFAULT_OPTS)));
    const cloneOptions = _.defaultsDeep(opts, originalOptions);

    // Reset default arguments created in the constructor.
    // Without this code, -H and -P can be injected into defaultArgs multiple times.
    const defaultArgs = cloneOptions.executable.defaultArgs;
    if (cloneOptions.remoteAdbHost && defaultArgs.includes('-H')) {
      defaultArgs.splice(defaultArgs.indexOf('-H'), 2);
    }
    if (defaultArgs.includes('-P')) {
      defaultArgs.splice(defaultArgs.indexOf('-P'), 2);
    }

    return new ADB(cloneOptions);
  }

  static async createADB(opts: Partial<ADBOptions>) {
    const adb = new ADB(opts);
    adb.sdkRoot = requireSdkRoot(adb.sdkRoot);
    adb.getAdbWithCorrectAdbPath();
    try {
      await adb.adbExec(['start-server']);
    } catch (e) {
      const err = e as import('teen_process').ExecError;
      log.warn(err.stderr || err.message);
    }
    return adb;
  }
}

// add all the methods to the ADB prototype
Object.assign(ADB.prototype, methods);

export {DEFAULT_ADB_PORT, getAndroidBinaryPath, getSdkRootFromEnv};
