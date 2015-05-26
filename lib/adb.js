// transpile:mocha

import _ from 'lodash';
import path from 'path';
import { SystemCallsHelper } from './syscalls.js';

class ADB {

 constructor (opts = {}) {
   if (typeof opts.sdkRoot === "undefined") {
     opts.sdkRoot = process.env.ANDROID_HOME || '';
   }
   this.sdkRoot = opts.sdkRoot;
   this.udid = opts.udid;
   this.appDeviceReadyTimeout = opts.appDeviceReadyTimeout;
   this.useKeystore = opts.useKeystore;
   this.keystorePath = opts.keystorePath;
   this.keystorePassword = opts.keystorePassword;
   this.keyAlias = opts.keyAlias;
   this.keyPassword = opts.keyPassword;
   this.adb = {path: "adb", defaultArgs:[]};
   this.tmpDir = opts.tmpDir;
   if (opts.remoteAdbHost) {
   this.adb.defaultArgs.push("-H", opts.remoteAdbHost);
   }
   if (opts.remoteAdbPort) {
     this.adb.defaultArgs.push("-P", opts.remoteAdbPort);
   }
   this.curDeviceId = null;
   this.emulatorPort = null;
   this.logcat = null;
   this.binaries = {};
   this.instrumentProc = null;
   this.javaVersion = opts.javaVersion;
   this.suppressKillServer = opts.suppressAdbKillServer;
   this.sysCallsHelper = new SystemCallsHelper(this.sdkRoot);
   this.jars = {};
   _(['move_manifest.jar', 'sign.jar', 'appium_apk_tools.jar', 'unsign.jar',
   'verify.jar']).each(function (jarName) {
     this.jars[jarName] = path.resolve(__dirname, '../jars', jarName);
   }.bind(this));

   if (!this.javaVersion || parseFloat(this.javaVersion) < 1.7) {
     this.jars["appium_apk_tools.jar"] = path.resolve(__dirname, '../jars', "appium_apk_tools_1.6.jar");
   }
 }

 async createADB (opts) {
   let adb = new ADB(opts);
   return await adb.checkAdbPresent();
 }

 async checkAdbPresent () {
   try {
     this.adb.path = await this.sysCallsHelper.checkSdkBinaryPresent("adb");
   } catch (err) {
     return err;
   }
   return this.adb;
 }

 async checkAaptPresent () {
   return await this.sysCallsHelper.checkSdkBinaryPresent("aapt");
 }

 async checkZipAlignPresent () {
   return await this.sysCallsHelper.this.checkSdkBinaryPresent("zipalign");
 }

}

export { ADB };
