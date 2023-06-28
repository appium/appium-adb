import _ from 'lodash';
import os from 'node:os';
import methods, {getAndroidBinaryPath} from './tools';
import {DEFAULT_ADB_EXEC_TIMEOUT, requireSdkRoot, getSdkRootFromEnv} from './helpers';
import log from './logger';
import type {ADBOptions, ADBExecutable} from './options';

const DEFAULT_ADB_PORT = 5037;
export const DEFAULT_OPTS = {
  sdkRoot: getSdkRootFromEnv(),
  executable: {path: 'adb', defaultArgs: []},
  tmpDir: os.tmpdir(),
  binaries: {},
  jars: {},
  adbPort: DEFAULT_ADB_PORT,
  adbExecTimeout: DEFAULT_ADB_EXEC_TIMEOUT,
  remoteAppsCacheLimit: 10,
  allowOfflineDevices: false,
  allowDelayAdb: true,
} as const;

export class ADB {
  adbHost?: string;
  adbPort?: number;

  executable: ADBExecutable;
  constructor(opts: Partial<ADBOptions> = {}) {
    const options: ADBOptions = _.defaultsDeep(opts, _.cloneDeep(DEFAULT_OPTS));
    _.defaultsDeep(this, options);

    // avoid TS error by explicitly assigning
    this.executable = options.executable;

    if (options.remoteAdbHost) {
      this.executable.defaultArgs.push('-H', options.remoteAdbHost);
      this.adbHost = options.remoteAdbHost;
    }
    // TODO figure out why we have this option as it does not appear to be
    // used anywhere. Probably deprecate in favor of simple opts.adbPort
    if (options.remoteAdbPort) {
      this.adbPort = options.remoteAdbPort;
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
    adb.sdkRoot = await requireSdkRoot(adb.sdkRoot);
    await adb.getAdbWithCorrectAdbPath();
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
