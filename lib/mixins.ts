/**
 * @privateRemarks
 * This is just an interface which mixes methods into the root `ADB` class.
 *
 * @module
 */

import {
  SystemCalls,
  ApkUtils,
  ADBCommands,
  SettingsClientCommands,
  ADBEmuCommands,
  LockManagementCommands,
  ManifestMethods,
  KeyboardCommands,
  ApkSigningCommands,
  ApksUtils,
} from './tools';
import {ADBOptions} from './options';

declare module './adb' {
  // note that ADBOptions is the options object, but it's mixed directly in to the instance in the constructor.
  interface ADB
    extends ADBCommands,
      ApkUtils,
      ApksUtils,
      SystemCalls,
      ADBOptions,
      SettingsClientCommands,
      ADBEmuCommands,
      LockManagementCommands,
      ManifestMethods,
      KeyboardCommands,
      ApkSigningCommands {}
}
