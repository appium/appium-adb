import methods from './adb-commands.js';
import manifestMethods from './android-manifest.js';
import systemCallMethods from './system-calls.js';
import apkSigningMethods from './apk-signing.js';

Object.assign(
    methods,
    manifestMethods,
    systemCallMethods,
    apkSigningMethods
);

export default methods;
