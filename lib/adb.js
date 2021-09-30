import _ from 'lodash';
import os from 'os';
import methods, { getAndroidBinaryPath } from './tools/index.js';
import {
  DEFAULT_ADB_EXEC_TIMEOUT, requireSdkRoot, getSdkRootFromEnv
} from './helpers';
import log from './logger.js';

const DEFAULT_ADB_PORT = 5037;
const DEFAULT_OPTS = {
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

class ADB {
  constructor (opts = {}) {
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
    this.executable.defaultArgs.push('-P', this.adbPort);
  }
}

ADB.createADB = async function createADB (opts) {
  const adb = new ADB(opts);
  adb.sdkRoot = await requireSdkRoot(adb.sdkRoot);
  await adb.getAdbWithCorrectAdbPath();
  try {
    await adb.adbExec(['start-server']);
  } catch (e) {
    log.warn(e.stderr || e.message);
  }
  return adb;
};

// add all the methods to the ADB prototype
for (const [fnName, fn] of _.toPairs(methods)) {
  ADB.prototype[fnName] = fn;
}

export default ADB;
export { ADB, DEFAULT_ADB_PORT, getAndroidBinaryPath, getSdkRootFromEnv };
