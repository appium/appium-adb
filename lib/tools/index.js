import methods from './adb-commands.js';
import manifestMethods from './android-manifest.js';
import systemCallMethods from './system-calls.js';
import apkSigningMethods from './apk-signing.js';
import apkUtilsMethods from './apk-utils.js';
import emuMethods from './adb-emu-commands.js';

Object.assign(
    methods,
    manifestMethods,
    systemCallMethods,
    emuMethods,
    apkSigningMethods,
    apkUtilsMethods
);

export default methods;
