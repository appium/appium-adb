appium-adb
==========

[![NPM version](http://img.shields.io/npm/v/appium-adb.svg)](https://npmjs.org/package/appium-adb)
[![Downloads](http://img.shields.io/npm/dm/appium-adb.svg)](https://npmjs.org/package/appium-adb)

A wrapper over [Android Debugger Bridge](https://developer.android.com/tools/adb), implemented using ES6
and along with `async/await`. This package is mainly used by Appium to perform all adb operations on Android devices.

## Installing

```bash
npm install appium-adb
```

## Watch

```bash
npm run dev
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
npm run e2e-test
```

## Usage:

example:

```js
import ADB from 'appium-adb';

const adb = await ADB.createADB();
console.log(await adb.getPIDsByName('com.android.phone'));
```
