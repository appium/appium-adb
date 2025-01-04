/**
 * @privateRemarks This is a `.ts` file so we can re-export types from other
 * files; otherwise we would need to copy `@typedef`s around.
 * @module
 */

import {install} from 'source-map-support';
install();

export * from './lib/adb';
// eslint-disable-next-line import/export
export {getAndroidBinaryPath} from './lib/tools/system-calls';
// TODO: move public typedefs into a separate file
export type * from './lib/logcat';
export type * from './lib/options';
export type * from './lib/tools/adb-commands';
// eslint-disable-next-line import/export
export type * from './lib/tools/system-calls';
export type * from './lib/tools/adb-emu-commands';
export type * from './lib/tools/apk-signing';
export type * from './lib/tools/apk-utils';
export type * from './lib/tools/apks-utils';
export type * from './lib/tools/aab-utils';
export type * from './lib/tools/android-manifest';
export type * from './lib/tools/keyboard-commands';
export type * from './lib/tools/lockmgmt';

import {ADB} from './lib/adb';
export default ADB;
