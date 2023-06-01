/**
 * @privateRemarks
 * This is just an interface which mixes methods into the root `ADB` class.
 *
 * @module
 */

import {SystemCalls} from './tools/system-calls';
import {ApkUtils} from './tools/apk-utils';
import {ADBCommands} from './tools/adb-commands';

declare module './adb' {
  // note that ADBOptions is the options object, but it's mixed directly in to the instance in the constructor.
  interface ADB extends ADBCommands, ApkUtils, SystemCalls, ADBOptions {}
}
