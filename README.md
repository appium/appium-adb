appium-adb
==========

[![NPM version](http://img.shields.io/npm/v/appium-adb.svg)](https://npmjs.org/package/appium-adb)
[![Downloads](http://img.shields.io/npm/dm/appium-adb.svg)](https://npmjs.org/package/appium-adb)
[![Dependency Status](https://david-dm.org/appium/appium-adb/2.0.svg)](https://david-dm.org/appium/appium-adb/2.0)
[![devDependency Status](https://david-dm.org/appium/appium-adb/2.0/dev-status.svg)](https://david-dm.org/appium/appium-adb/2.0#info=devDependencies)

[![Build Status](https://api.travis-ci.org/appium/appium-adb.png?branch=2.0)](https://travis-ci.org/appium/appium-adb)
[![Coverage Status](https://coveralls.io/repos/appium/appium-adb/badge.svg?branch=2.0)](https://coveralls.io/r/appium/appium-adb?branch=2.0)

A wrapper over android-adb, implemented using ES6 and along with `async/await`. This package is mainly used by Appium to perform all adb operations on android device.

## Installing

```
npm install appium-adb
```

## Watch

```
npm run watch
```

## Test

### unit tests

```
npm run test
```

### functional tests

```
gulp e2e-test
```

## Usage:

example:

```
import ADB from 'appium-adb';

let adb = new ADB();
await adb.createADB();
console.log(await adb.getPIDsByName('m.android.phone'));
```

### List of methods:

- createADB
- initJars
- getAdbWithCorrectAdbPath
- initAapt
- initZipAlign
- getApiLevel
- isDeviceConnected
- mkdir
- isValidClass
- forceStop
- clear
- stopAndClear
- availableIMEs
- enabledIMEs
- enableIME
- disableIME
- setIME
- defaultIME
- keyevent
- lock
- back
- goToHome
- isScreenLocked
- isSoftKeyboardPresent
- sendTelnetCommand
- isAirplaneModeOn
- setAirplaneMode
- broadcastAirplaneMode
- isWifiOn
- setWifiState
- isDataOn
- setDataState
- setWifiAndData
- rimraf
- push
- pull
- processExists
- forwardPort
- forwardAbstractPort
- ping
- restart
- startLogcat
- stopLogcat
- getLogcatLogs
- getPIDsByName
- killProcessesByName
- killProcessByPID
- broadcastProcessEnd
- broadcast
- endAndroidCoverage
- instrument
- androidCoverage
- processFromManifest
- packageAndLaunchActivityFromManifest
- compileManifest
- insertManifest
- hasInternetPermissionFromManifest
- getSdkBinaryPath
- getCommandForOS
- getBinaryFromSdkRoot
- getBinaryFromPath
- getConnectedDevices
- getDevicesWithRetry
- restartAdb
- adbExec
- shell
- getAdbServerPort
- getEmulatorPort
- getPortFromEmulatorString
- getConnectedEmulators
- setEmulatorPort
- setDeviceId
- getRunningAVD
- getRunningAVDWithRetry
- killAllEmulators
- launchAVD
- waitForEmulatorReady
- waitForDevice
- reboot
- signWithDefaultCert
- signWithCustomCert
- sign
- zipAlignApk
- checkApkCert
- checkCustomApkCert
- getKeystoreMd5
- checkApkKeystoreMatch
- isAppInstalled
- startApp
- startUri
- getFocusedPackageAndActivity
- waitForActivityOrNot
- waitForActivity
- waitForNotActivity
- uninstallApk
- installFromDevicePath
- install
- fingerprint (ApiLevel >=23)
