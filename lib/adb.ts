import _ from 'lodash';
import os from 'node:os';
import {
  DEFAULT_ADB_EXEC_TIMEOUT,
  requireSdkRoot,
  getSdkRootFromEnv
} from './helpers';
import log from './logger';
import type { ADBOptions, ADBExecutable } from './types';
import type { Logcat } from './logcat';
import type { LogcatOpts, StringRecord } from './tools/types';
import type { LRUCache } from 'lru-cache';
import type { ExecError } from 'teen_process';

import * as generalMethods from './tools/adb-commands';
import * as manifestMethods from './tools/android-manifest';
import * as systemCallMethods from './tools/system-calls';
import * as apkSigningMethods from './tools/apk-signing';
import * as apkUtilsMethods from './tools/apk-utils';
import * as apksUtilsMethods from './tools/apks-utils';
import * as aabUtilsMethods from './tools/aab-utils';
import * as emuMethods from './tools/adb-emu-commands';
import * as lockManagementCommands from './tools/lockmgmt';
import * as keyboardCommands from './tools/keyboard-commands';
import * as emuConstants from './tools/emu-constants';
import * as deviceSettingsCommands from './tools/device-settings';


export const DEFAULT_ADB_PORT = 5037;
export const DEFAULT_OPTS = {
  sdkRoot: getSdkRootFromEnv(),
  executable: {path: 'adb', defaultArgs: []},
  tmpDir: os.tmpdir(),
  binaries: {},
  adbPort: DEFAULT_ADB_PORT,
  adbExecTimeout: DEFAULT_ADB_EXEC_TIMEOUT,
  remoteAppsCacheLimit: 10,
  allowOfflineDevices: false,
  allowDelayAdb: true,
} as const;

export class ADB implements ADBOptions {
  adbHost?: string;
  adbPort?: number;
  _apiLevel: number|undefined;
  _logcatStartupParams: LogcatOpts|undefined;
  _doesPsSupportAOption: boolean|undefined;
  _isPgrepAvailable: boolean|undefined;
  _canPgrepUseFullCmdLineSearch: boolean|undefined;
  _isPidofAvailable: boolean|undefined;
  _memoizedFeatures: (() => Promise<string>)|undefined;
  _areExtendedLsOptionsSupported: boolean|undefined;
  remoteAppsCache: LRUCache<string, string>|undefined;
  _isLockManagementSupported: boolean|undefined;

  sdkRoot?: string;
  udid?: string;
  appDeviceReadyTimeout?: number;
  useKeystore?: boolean;
  keystorePath?: string;
  keystorePassword?: string;
  keyAlias?: string;
  keyPassword?: string;
  executable: ADBExecutable;
  tmpDir?: string;
  curDeviceId?: string;
  emulatorPort?: number;
  logcat?: Logcat;
  binaries?: StringRecord;
  suppressKillServer?: boolean;
  adbExecTimeout?: number;
  remoteAppsCacheLimit?: number;
  buildToolsVersion?: string;
  allowOfflineDevices?: boolean;
  allowDelayAdb?: boolean;
  remoteAdbHost?: string;
  remoteAdbPort?: number;
  clearDeviceLogsOnStart?: boolean;

  constructor(opts: ADBOptions = ({} as ADBOptions)) {
    const options: ADBOptions = _.defaultsDeep(opts, _.cloneDeep(DEFAULT_OPTS));
    _.defaultsDeep(this, options);

    // The above defaultsDeep call guarantees the 'executable' field to be always assigned
    this.executable = options.executable as ADBExecutable;

    if (options.remoteAdbHost) {
      this.executable.defaultArgs.push('-H', options.remoteAdbHost);
      this.adbHost = options.remoteAdbHost;
    }
    // TODO figure out why we have this option as it does not appear to be
    // used anywhere. Probably deprecate in favor of simple opts.adbPort
    if (options.remoteAdbPort) {
      this.adbPort = options.remoteAdbPort;
    }
    this.executable.defaultArgs.push('-P', String(this.adbPort));
    if (options.udid) {
      this.setDeviceId(options.udid);
    }
  }

  /**
   * Create a new instance of `ADB` that inherits configuration from this `ADB` instance.
   * This avoids the need to call `ADB.createADB()` multiple times.
   * @param opts - Additional options mapping to pass to the `ADB` constructor.
   * @returns The resulting class instance.
   */
  clone(opts: ADBOptions = ({} as ADBOptions)): ADB {
    const originalOptions = _.cloneDeep(_.pick(this, Object.keys(DEFAULT_OPTS)));
    const cloneOptions = _.defaultsDeep(opts, originalOptions);

    // Reset default arguments created in the constructor.
    // Without this code, -H and -P can be injected into defaultArgs multiple times.
    const defaultArgs = cloneOptions.executable.defaultArgs;
    if (cloneOptions.remoteAdbHost && defaultArgs.includes('-H')) {
      defaultArgs.splice(defaultArgs.indexOf('-H'), 2);
    }
    if (defaultArgs.includes('-P')) {
      defaultArgs.splice(defaultArgs.indexOf('-P'), 2);
    }

    return new ADB(cloneOptions);
  }

  static async createADB(opts: ADBOptions = ({} as ADBOptions)) {
    const adb = new ADB(opts);
    adb.sdkRoot = await requireSdkRoot(adb.sdkRoot);
    await adb.getAdbWithCorrectAdbPath();
    if (!opts?.suppressKillServer) {
      try {
        await adb.adbExec(['start-server']);
      } catch (e) {
        const err = e as ExecError;
        log.warn(err.stderr || err.message);
      }
    }
    return adb;
  }

  // TODO: Group methods from general to corresponding modules
  shellChunks = generalMethods.shellChunks;
  getAdbWithCorrectAdbPath = generalMethods.getAdbWithCorrectAdbPath;
  initAapt = generalMethods.initAapt;
  initAapt2 = generalMethods.initAapt2;
  initZipAlign = generalMethods.initZipAlign;
  initBundletool = generalMethods.initBundletool;
  getApiLevel = generalMethods.getApiLevel;
  isDeviceConnected = generalMethods.isDeviceConnected;
  mkdir = generalMethods.mkdir;
  isValidClass = generalMethods.isValidClass;
  resolveLaunchableActivity = generalMethods.resolveLaunchableActivity;
  forceStop = generalMethods.forceStop;
  killPackage = generalMethods.killPackage;
  clear = generalMethods.clear;
  grantAllPermissions = generalMethods.grantAllPermissions;
  grantPermissions = generalMethods.grantPermissions;
  grantPermission = generalMethods.grantPermission;
  revokePermission = generalMethods.revokePermission;
  getGrantedPermissions = generalMethods.getGrantedPermissions;
  getDeniedPermissions = generalMethods.getDeniedPermissions;
  getReqPermissions = generalMethods.getReqPermissions;
  stopAndClear = generalMethods.stopAndClear;
  clearTextField = generalMethods.clearTextField;
  lock = generalMethods.lock;
  back = generalMethods.back;
  goToHome = generalMethods.goToHome;
  getAdbPath = generalMethods.getAdbPath;
  sendTelnetCommand = generalMethods.sendTelnetCommand;
  rimraf = generalMethods.rimraf;
  push = generalMethods.push;
  pull = generalMethods.pull;
  processExists = generalMethods.processExists;
  getForwardList = generalMethods.getForwardList;
  forwardPort = generalMethods.forwardPort;
  removePortForward = generalMethods.removePortForward;
  getReverseList = generalMethods.getReverseList;
  reversePort = generalMethods.reversePort;
  removePortReverse = generalMethods.removePortReverse;
  forwardAbstractPort = generalMethods.forwardAbstractPort;
  ping = generalMethods.ping;
  restart = generalMethods.restart;
  startLogcat = generalMethods.startLogcat;
  stopLogcat = generalMethods.stopLogcat;
  getLogcatLogs = generalMethods.getLogcatLogs;
  setLogcatListener = generalMethods.setLogcatListener;
  removeLogcatListener = generalMethods.removeLogcatListener;
  listProcessStatus = generalMethods.listProcessStatus;
  getNameByPid = generalMethods.getNameByPid;
  getPIDsByName = generalMethods.getPIDsByName;
  killProcessesByName = generalMethods.killProcessesByName;
  killProcessByPID = generalMethods.killProcessByPID;
  broadcastProcessEnd = generalMethods.broadcastProcessEnd;
  broadcast = generalMethods.broadcast;
  bugreport = generalMethods.bugreport;
  screenrecord = generalMethods.screenrecord;
  listFeatures = generalMethods.listFeatures;
  isStreamedInstallSupported = generalMethods.isStreamedInstallSupported;
  isIncrementalInstallSupported = generalMethods.isIncrementalInstallSupported;
  takeScreenshot = generalMethods.takeScreenshot;
  listPorts = generalMethods.listPorts;

  executeApksigner = apkSigningMethods.executeApksigner;
  signWithDefaultCert = apkSigningMethods.signWithDefaultCert;
  signWithCustomCert = apkSigningMethods.signWithCustomCert;
  sign = apkSigningMethods.sign;
  zipAlignApk = apkSigningMethods.zipAlignApk;
  checkApkCert = apkSigningMethods.checkApkCert;
  getKeystoreHash = apkSigningMethods.getKeystoreHash;

  APP_INSTALL_STATE = apkUtilsMethods.APP_INSTALL_STATE;
  isAppInstalled = apkUtilsMethods.isAppInstalled;
  startUri = apkUtilsMethods.startUri;
  startApp = apkUtilsMethods.startApp;
  dumpWindows = apkUtilsMethods.dumpWindows;
  getFocusedPackageAndActivity = apkUtilsMethods.getFocusedPackageAndActivity;
  waitForActivityOrNot = apkUtilsMethods.waitForActivityOrNot;
  waitForActivity = apkUtilsMethods.waitForActivity;
  waitForNotActivity = apkUtilsMethods.waitForNotActivity;
  uninstallApk = apkUtilsMethods.uninstallApk;
  installFromDevicePath = apkUtilsMethods.installFromDevicePath;
  cacheApk = apkUtilsMethods.cacheApk;
  install = apkUtilsMethods.install;
  getApplicationInstallState = apkUtilsMethods.getApplicationInstallState;
  installOrUpgrade = apkUtilsMethods.installOrUpgrade;
  extractStringsFromApk = apkUtilsMethods.extractStringsFromApk;
  getApkInfo = apkUtilsMethods.getApkInfo;
  getPackageInfo = apkUtilsMethods.getPackageInfo;
  pullApk = apkUtilsMethods.pullApk;
  activateApp = apkUtilsMethods.activateApp;

  hideKeyboard = keyboardCommands.hideKeyboard;
  isSoftKeyboardPresent = keyboardCommands.isSoftKeyboardPresent;
  keyevent = keyboardCommands.keyevent;
  availableIMEs = keyboardCommands.availableIMEs;
  enabledIMEs = keyboardCommands.enabledIMEs;
  enableIME = keyboardCommands.enableIME;
  disableIME = keyboardCommands.disableIME;
  setIME = keyboardCommands.setIME;
  defaultIME = keyboardCommands.defaultIME;
  inputText = keyboardCommands.inputText;
  runInImeContext = keyboardCommands.runInImeContext;

  isLockManagementSupported = lockManagementCommands.isLockManagementSupported;
  verifyLockCredential = lockManagementCommands.verifyLockCredential;
  clearLockCredential = lockManagementCommands.clearLockCredential;
  isLockEnabled = lockManagementCommands.isLockEnabled;
  setLockCredential = lockManagementCommands.setLockCredential;
  isScreenLocked = lockManagementCommands.isScreenLocked;
  dismissKeyguard = lockManagementCommands.dismissKeyguard;
  cycleWakeUp = lockManagementCommands.cycleWakeUp;

  getSdkBinaryPath = systemCallMethods.getSdkBinaryPath;
  getBinaryNameForOS = systemCallMethods.getBinaryNameForOS;
  getBinaryFromSdkRoot = systemCallMethods.getBinaryFromSdkRoot;
  getBinaryFromPath = systemCallMethods.getBinaryFromPath;
  getConnectedDevices = systemCallMethods.getConnectedDevices;
  getDevicesWithRetry = systemCallMethods.getDevicesWithRetry;
  reconnect = systemCallMethods.reconnect;
  restartAdb = systemCallMethods.restartAdb;
  killServer = systemCallMethods.killServer;
  resetTelnetAuthToken = systemCallMethods.resetTelnetAuthToken;
  adbExecEmu = systemCallMethods.adbExecEmu;
  EXEC_OUTPUT_FORMAT = systemCallMethods.EXEC_OUTPUT_FORMAT;
  adbExec = systemCallMethods.adbExec;
  shell = systemCallMethods.shell;
  createSubProcess = systemCallMethods.createSubProcess;
  getAdbServerPort = systemCallMethods.getAdbServerPort;
  getEmulatorPort = systemCallMethods.getEmulatorPort;
  getPortFromEmulatorString = systemCallMethods.getPortFromEmulatorString;
  getConnectedEmulators = systemCallMethods.getConnectedEmulators;
  setEmulatorPort = systemCallMethods.setEmulatorPort;
  setDeviceId = systemCallMethods.setDeviceId;
  setDevice = systemCallMethods.setDevice;
  getRunningAVD = systemCallMethods.getRunningAVD;
  getRunningAVDWithRetry = systemCallMethods.getRunningAVDWithRetry;
  killAllEmulators = systemCallMethods.killAllEmulators;
  killEmulator = systemCallMethods.killEmulator;
  launchAVD = systemCallMethods.launchAVD;
  getVersion = systemCallMethods.getVersion;
  waitForEmulatorReady = systemCallMethods.waitForEmulatorReady;
  waitForDevice = systemCallMethods.waitForDevice;
  reboot = systemCallMethods.reboot;
  changeUserPrivileges = systemCallMethods.changeUserPrivileges;
  root = systemCallMethods.root;
  unroot = systemCallMethods.unroot;
  isRoot = systemCallMethods.isRoot;
  fileExists = systemCallMethods.fileExists;
  ls = systemCallMethods.ls;
  fileSize = systemCallMethods.fileSize;
  installMitmCertificate = systemCallMethods.installMitmCertificate;
  isMitmCertificateInstalled = systemCallMethods.isMitmCertificateInstalled;

  execBundletool = apksUtilsMethods.execBundletool;
  getDeviceSpec = apksUtilsMethods.getDeviceSpec;
  installMultipleApks = apksUtilsMethods.installMultipleApks;
  installApks = apksUtilsMethods.installApks;
  extractBaseApk = apksUtilsMethods.extractBaseApk;
  extractLanguageApk = apksUtilsMethods.extractLanguageApk;
  isTestPackageOnlyError = apksUtilsMethods.isTestPackageOnlyError;

  packageAndLaunchActivityFromManifest = manifestMethods.packageAndLaunchActivityFromManifest;
  targetSdkVersionFromManifest = manifestMethods.targetSdkVersionFromManifest;
  targetSdkVersionUsingPKG = manifestMethods.targetSdkVersionUsingPKG;
  compileManifest = manifestMethods.compileManifest;
  insertManifest = manifestMethods.insertManifest;
  hasInternetPermissionFromManifest = manifestMethods.hasInternetPermissionFromManifest;

  extractUniversalApk = aabUtilsMethods.extractUniversalApk;

  isEmulatorConnected = emuMethods.isEmulatorConnected;
  verifyEmulatorConnected = emuMethods.verifyEmulatorConnected;
  fingerprint = emuMethods.fingerprint;
  rotate = emuMethods.rotate;
  powerAC = emuMethods.powerAC;
  sensorSet = emuMethods.sensorSet;
  powerCapacity = emuMethods.powerCapacity;
  powerOFF = emuMethods.powerOFF;
  sendSMS = emuMethods.sendSMS;
  gsmCall = emuMethods.gsmCall;
  gsmSignal = emuMethods.gsmSignal;
  gsmVoice = emuMethods.gsmVoice;
  networkSpeed = emuMethods.networkSpeed;
  execEmuConsoleCommand = emuMethods.execEmuConsoleCommand;
  getEmuVersionInfo = emuMethods.getEmuVersionInfo;
  getEmuImageProperties = emuMethods.getEmuImageProperties;
  checkAvdExist = emuMethods.checkAvdExist;
  readonly POWER_AC_STATES = emuConstants.POWER_AC_STATES;
  readonly GSM_CALL_ACTIONS = emuConstants.GSM_CALL_ACTIONS;
  readonly GSM_VOICE_STATES = emuConstants.GSM_VOICE_STATES;
  readonly GSM_SIGNAL_STRENGTHS = emuConstants.GSM_SIGNAL_STRENGTHS;
  readonly NETWORK_SPEED = emuConstants.NETWORK_SPEED;
  readonly SENSORS = emuConstants.SENSORS;

  getDeviceProperty = deviceSettingsCommands.getDeviceProperty;
  setDeviceProperty = deviceSettingsCommands.setDeviceProperty;
  getDeviceSysLanguage = deviceSettingsCommands.getDeviceSysLanguage;
  getDeviceSysCountry = deviceSettingsCommands.getDeviceSysCountry;
  getDeviceSysLocale = deviceSettingsCommands.getDeviceSysLocale;
  getDeviceProductLanguage = deviceSettingsCommands.getDeviceProductLanguage;
  getDeviceProductCountry = deviceSettingsCommands.getDeviceProductCountry;
  getDeviceProductLocale = deviceSettingsCommands.getDeviceProductLocale;
  getModel = deviceSettingsCommands.getModel;
  getManufacturer = deviceSettingsCommands.getManufacturer;
  getScreenSize = deviceSettingsCommands.getScreenSize;
  getScreenDensity = deviceSettingsCommands.getScreenDensity;
  setHttpProxy = deviceSettingsCommands.setHttpProxy;
  deleteHttpProxy = deviceSettingsCommands.deleteHttpProxy;
  setSetting = deviceSettingsCommands.setSetting;
  getSetting = deviceSettingsCommands.getSetting;
  getTimeZone = deviceSettingsCommands.getTimeZone;
  getPlatformVersion = deviceSettingsCommands.getPlatformVersion;
  getLocationProviders = deviceSettingsCommands.getLocationProviders;
  toggleGPSLocationProvider = deviceSettingsCommands.toggleGPSLocationProvider;
  setHiddenApiPolicy = deviceSettingsCommands.setHiddenApiPolicy;
  setDefaultHiddenApiPolicy = deviceSettingsCommands.setDefaultHiddenApiPolicy;
  getDeviceLanguage = deviceSettingsCommands.getDeviceLanguage;
  getDeviceCountry = deviceSettingsCommands.getDeviceCountry;
  getDeviceLocale = deviceSettingsCommands.getDeviceLocale;
  ensureCurrentLocale = deviceSettingsCommands.ensureCurrentLocale;
  setWifiState = deviceSettingsCommands.setWifiState;
  setDataState = deviceSettingsCommands.setDataState;
  getDeviceIdleWhitelist = deviceSettingsCommands.getDeviceIdleWhitelist;
  addToDeviceIdleWhitelist = deviceSettingsCommands.addToDeviceIdleWhitelist;
  isAirplaneModeOn = deviceSettingsCommands.isAirplaneModeOn;
  setAirplaneMode = deviceSettingsCommands.setAirplaneMode;
  setBluetoothOn = deviceSettingsCommands.setBluetoothOn;
  setNfcOn = deviceSettingsCommands.setNfcOn;
  broadcastAirplaneMode = deviceSettingsCommands.broadcastAirplaneMode;
  isWifiOn = deviceSettingsCommands.isWifiOn;
  isDataOn = deviceSettingsCommands.isDataOn;
  isAnimationOn = deviceSettingsCommands.isAnimationOn;
  setAnimationScale = deviceSettingsCommands.setAnimationScale;
  getScreenOrientation = deviceSettingsCommands.getScreenOrientation;
}
