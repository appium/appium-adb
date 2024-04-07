import type Logcat from './logcat';
import type {StringRecord} from '@appium/types';

export interface ADBOptions {
  sdkRoot?: string;
  udid?: string;
  appDeviceReadyTimeout?: number;
  useKeystore?: boolean;
  keystorePath?: string;
  keystorePassword?: string;
  keyAlias?: string;
  keyPassword?: string;
  executable?: ADBExecutable;
  tmpDir?: string;
  curDeviceId?: string;
  emulatorPort?: number;
  logcat?: Logcat;
  binaries?: StringRecord;
  suppressKillServer?: boolean;
  adbPort?: number;
  adbHost?: string;
  adbExecTimeout?: number;
  remoteAppsCacheLimit?: number;
  buildToolsVersion?: string;
  allowOfflineDevices?: boolean;
  allowDelayAdb?: boolean;
  remoteAdbHost?: string;
  remoteAdbPort?: number;
  clearDeviceLogsOnStart?: boolean;
}

export interface ADBExecutable {
  path: string;
  defaultArgs: string[];
}
