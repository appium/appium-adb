import _ from 'lodash';
import os from 'os';
import path from 'path';
import methods from './tools/index.js';
import { rootDir} from './helpers';

const DEFAULT_ADB_PORT = 5037;
const JAR_PATH = path.resolve(rootDir, 'jars');
const DEFAULT_OPTS = {
  sdkRoot: null,
  udid: null,
  appDeviceReadyTimeout: null,
  useKeystore: null,
  keystorePath: null,
  keystorePassword: null,
  keyAlias: null,
  keyPassword: null,
  executable: {path: "adb", defaultArgs: []},
  tmpDir: os.tmpdir(),
  curDeviceId: null,
  emulatorPort : null,
  logcat: null,
  binaries: {},
  instrumentProc: null,
  javaVersion: null,
  suppressKillServer: null,
  jars: {},
  helperJarPath: JAR_PATH,
  adbPort: DEFAULT_ADB_PORT
};

class ADB {
  constructor (opts = {}) {
    if (typeof opts.sdkRoot === "undefined") {
      opts.sdkRoot = process.env.ANDROID_HOME || '';
    }

    Object.assign(this, opts);
    _.defaultsDeep(this, _.cloneDeep(DEFAULT_OPTS));

    if (opts.remoteAdbHost) {
      this.executable.defaultArgs.push("-H", opts.remoteAdbHost);
    }
    // TODO figure out why we have this option as it does not appear to be
    // used anywhere. Probably deprecate in favor of simple opts.adbPort
    if (opts.remoteAdbPort) {
      this.adbPort = opts.remoteAdbPort;
    }
    this.executable.defaultArgs.push("-P", this.adbPort);

    this.initJars();
  }

  initJars () {
    let tempJars = ['move_manifest.jar', 'sign.jar', 'appium_apk_tools.jar',
                    'unsign.jar', 'verify.jar'];
    for (let jarName of tempJars) {
      this.jars[jarName] = path.resolve(JAR_PATH, jarName);
    }
    if (!this.javaVersion || parseFloat(this.javaVersion) < 1.7) {
      this.jars['appium_apk_tools.jar'] = path.resolve(JAR_PATH,
                                                       'appium_apk_tools_1.6.jar');
    }
  }
}

ADB.createADB = async function (opts) {
  let adb = new ADB(opts);
  await adb.getAdbWithCorrectAdbPath();
  return adb;
};

// add all the methods to the ADB prototype
for (let [fnName, fn] of _.toPairs(methods)) {
  ADB.prototype[fnName] = fn;
}

export default ADB;
export { DEFAULT_ADB_PORT };
