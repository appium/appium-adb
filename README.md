appium-adb
==========

[![NPM version](http://img.shields.io/npm/v/appium-adb.svg)](https://npmjs.org/package/appium-adb)
[![Downloads](http://img.shields.io/npm/dm/appium-adb.svg)](https://npmjs.org/package/appium-adb)
[![Dependency Status](https://david-dm.org/appium/appium-adb.svg)](https://david-dm.org/appium/appium-adb)
[![devDependency Status](https://david-dm.org/appium/appium-adb/dev-status.svg)](https://david-dm.org/appium/appium-adb#info=devDependencies)

[![Build Status](https://api.travis-ci.org/appium/appium-adb.png?branch=master)](https://travis-ci.org/appium/appium-adb)
[![Coverage Status](https://coveralls.io/repos/appium/appium-adb/badge.svg?branch=master)](https://coveralls.io/r/appium/appium-adb?branch=master)

A wrapper over android-adb, implemented using ES6 and along with `async/await`. This package is mainly used by Appium to perform all adb operations on android device.

*Note*: Issue tracking for this repo has been disabled. Please use the [main Appium issue tracker](https://github.com/appium/appium/issues) instead.

## Installing

```bash
npm install appium-adb
```

## Watch

```bash
npm run watch
```

## Test

### unit tests

```bash
npm run test
```

### functional tests

By default the functional tests use an avd named `NEXUS_S_18_X86`, with API Level
18. To change this, you can use the environment variables `PLATFORM_VERSION`,
`API_LEVEL`, and `ANDROID_AVD`. If `PLATFORM_VERSION` is set then it is not
necessary to set `API_LEVEL` as it will be inferred.

```bash
gulp e2e-test
```

## Usage:

example:

```js
import ADB from 'appium-adb';

const adb = await ADB.createADB();
console.log(await adb.getPIDsByName('m.android.phone'));
```

### List of methods:

- `createADB`
- `initJars`
- `getAdbWithCorrectAdbPath`
- `getAdbVersion`
- `initAapt`
- `initZipAlign`
- `getApiLevel`
- `isDeviceConnected`
- `mkdir`
- `isValidClass`
- `forceStop`
- `clear`
- `stopAndClear`
- `availableIMEs`
- `enabledIMEs`
- `enableIME`
- `disableIME`
- `setIME`
- `defaultIME`
- `keyevent`
- `lock`
- `back`
- `goToHome`
- `isScreenLocked`
- `isSoftKeyboardPresent`
- `sendTelnetCommand`
- `isAirplaneModeOn`
- `setAirplaneMode`
- `broadcastAirplaneMode`
- `isWifiOn`
- `getScreenSize`
- `getScreenDensity`
- `setWifiState`
- `isDataOn`
- `setDataState`
- `setWifiAndData`
- `rimraf`
- `push`
- `pull`
- `processExists`
- `forwardPort`
- `forwardAbstractPort`
- `ping`
- `restart`
- `startLogcat`
- `stopLogcat`
- `getLogcatLogs`
- `getPIDsByName`
- `killProcessesByName`
- `killProcessByPID`
- `broadcastProcessEnd`
- `broadcast`
- `endAndroidCoverage`
- `instrument`
- `androidCoverage`
- `processFromManifest`
- `packageAndLaunchActivityFromManifest`
- `compileManifest`
- `insertManifest`
- `hasInternetPermissionFromManifest`
- `getSdkBinaryPath`
- `getCommandForOS`
- `getBinaryFromSdkRoot`
- `getBinaryFromPath`
- `getConnectedDevices`
- `getDevicesWithRetry`
- `restartAdb`
- `adbExec`
- `shell`
- `getAdbServerPort`
- `getEmulatorPort`
- `getPortFromEmulatorString`
- `getConnectedEmulators`
- `setEmulatorPort`
- `setDeviceId`
- `getRunningAVD`
- `getRunningAVDWithRetry`
- `killAllEmulators`
- `launchAVD`
- `waitForEmulatorReady`
- `waitForDevice`
- `reboot`
- `signWithDefaultCert`
- `signWithCustomCert`
- `sign`
- `zipAlignApk`
- `checkApkCert`
- `checkCustomApkCert`
- `getKeystoreMd5`
- `checkApkKeystoreMatch`
- `isAppInstalled`
- `startApp`
- `startUri`
- `getFocusedPackageAndActivity`
- `waitForActivityOrNot`
- `waitForActivity`
- `waitForNotActivity`
- `uninstallApk`
- `installFromDevicePath`
- `install`
- `fingerprint` (ApiLevel >=23 | emulator only)
- `sendSMS` (emulator only)
- `rotate` (emulator only)
- `powerAC` (emulator only)
- `powerCapacity` (emulator only)
- `powerOFF` (emulator only)
- `gsmCall` (emulator only)
- `gsmSignal` (emulator only)
- `gsmVoice` (emulator only)
- `root`
- `unroot`
