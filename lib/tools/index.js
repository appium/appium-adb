import methods from './adb-commands.js';
import manifestMethods from './android-manifest.js';
import systemCallMethods, { getAndroidBinaryPath } from './system-calls.js';
import apkSigningMethods from './apk-signing.js';
import apkUtilsMethods from './apk-utils.js';
import apksUtilsMethods from './apks-utils.js';
import aabUtilsMethods from './aab-utils.js';
import emuMethods from './adb-emu-commands.js';
import settingsClientCommands from './settings-client-commands';
import lockManagementCommands from './lockmgmt';
import keyboardCommands from './keyboard-commands';

Object.assign(
    methods,
    manifestMethods,
    systemCallMethods,
    emuMethods,
    apkSigningMethods,
    apkUtilsMethods,
    apksUtilsMethods,
    aabUtilsMethods,
    settingsClientCommands,
    lockManagementCommands,
    keyboardCommands,
);

export default methods;
export { getAndroidBinaryPath };
