/**
 * @privateRemarks This is a `.ts` file so we can re-export types from other
 * files; otherwise we would need to copy `@typedef`s around.
 * @module
 */

import {install} from 'source-map-support';
import {ADB} from './lib/adb';

install();

export * from './lib/adb';
export type * from './lib/mixins';
export type * from './lib/tools';
export type * from './lib/logcat';
export default ADB;
