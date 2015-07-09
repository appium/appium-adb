import _ from 'lodash';
import path from 'path';
import methods from './tools/index.js';
import { rootDir} from './utils';

const DEFAULTS_OPTS = {
  sdkRoot: null,
  udid: null,
  appDeviceReadyTimeout: null,
  useKeystore: null,
  keystorePath: null,
  keystorePassword: null,
  keyAlias: null,
  keyPassword: null,
  executable: {path: "adb", defaultArgs: []},
  tmpDir: null,
  curDeviceId: null,
  emulatorPort : null,
  logcat: null,
  binaries: {},
  instrumentProc: null,
  javaVersion: null,
  suppressKillServer: null,
  jars: {},
  helperJarPath: path.resolve(rootDir, 'jars')
};

class ADB {

 constructor (opts = {}) {
   if (typeof opts.sdkRoot === "undefined") {
     opts.sdkRoot = process.env.ANDROID_HOME || '';
   }

   Object.assign(this, DEFAULTS_OPTS, opts);
   if (opts.remoteAdbHost) {
     this.executable.defaultArgs.push("-H", opts.remoteAdbHost);
   }
   if (opts.remoteAdbPort) {
     this.executable.defaultArgs.push("-P", opts.remoteAdbPort);
   }
   this.initJars();
 }

 initJars () {
   let tempJars = ['move_manifest.jar', 'sign.jar', 'appium_apk_tools.jar',
                   'unsign.jar', 'verify.jar'];
   for (let jarName of tempJars) {
     this.jars[jarName] = path.resolve(__dirname, '../jars', jarName);
   }
   if (!this.javaVersion || parseFloat(this.javaVersion) < 1.7) {
     this.jars['appium_apk_tools.jar'] = path.resolve(__dirname,
                                                      '../jars',
                                                      'appium_apk_tools_1.6.jar');
   }
 }
}

ADB.createADB = async function (opts) {
   let adb = new ADB(opts);
   await adb.getAdbWithCorrectAdbPath();
   return adb;
};

for (let [fnName, fn] of _.pairs(methods)) {
  ADB.prototype[fnName] = fn;
}

export default ADB;
