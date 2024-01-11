/**
 * @privateRemarks This is a `.ts` file so we can re-export types from other
 * files; otherwise we would need to copy `@typedef`s around.
 * @module
 */

import methods from './adb-commands';
import manifestMethods from './android-manifest';
import systemCallMethods, {getAndroidBinaryPath} from './system-calls';
import apkSigningMethods from './apk-signing';
import apkUtilsMethods from './apk-utils';
import apksUtilsMethods from './apks-utils';
import aabUtilsMethods from './aab-utils';
import emuMethods from './adb-emu-commands';
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
  lockManagementCommands,
  keyboardCommands
);

export default methods;
export {getAndroidBinaryPath};

export type * from './adb-commands';
export type * from './system-calls';
export type * from './adb-emu-commands';
export type * from './apk-signing';
export type * from './apk-utils';
export type * from './apks-utils';
export type * from './aab-utils';
export type * from './android-manifest';
export type * from './keyboard-commands';
export type * from './lockmgmt';
