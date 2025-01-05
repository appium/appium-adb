import _ from 'lodash';
import os from 'node:os';
import {
  DEFAULT_ADB_EXEC_TIMEOUT,
  requireSdkRoot,
  getSdkRootFromEnv
} from './helpers';
import log from './logger';
import type {ADBOptions, ADBExecutable} from './options';
import type { LogcatOpts, Logcat } from './logcat';
import type { LRUCache } from 'lru-cache';
import type { ExecError } from 'teen_process';
import type { StringRecord } from '@appium/types';

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
  getPlatformVersion = generalMethods.getPlatformVersion;
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
  getLocationProviders = generalMethods.getLocationProviders;
  toggleGPSLocationProvider = generalMethods.toggleGPSLocationProvider;
  setHiddenApiPolicy = generalMethods.setHiddenApiPolicy;
  setDefaultHiddenApiPolicy = generalMethods.setDefaultHiddenApiPolicy;
  stopAndClear = generalMethods.stopAndClear;
  availableIMEs = generalMethods.availableIMEs;
  enabledIMEs = generalMethods.enabledIMEs;
  enableIME = generalMethods.enableIME;
  disableIME = generalMethods.disableIME;
  setIME = generalMethods.setIME;
  defaultIME = generalMethods.defaultIME;
  keyevent = generalMethods.keyevent;
  inputText = generalMethods.inputText;
  clearTextField = generalMethods.clearTextField;
  lock = generalMethods.lock;
  back = generalMethods.back;
  goToHome = generalMethods.goToHome;
  getAdbPath = generalMethods.getAdbPath;
  getScreenOrientation = generalMethods.getScreenOrientation;
  sendTelnetCommand = generalMethods.sendTelnetCommand;
  isAirplaneModeOn = generalMethods.isAirplaneModeOn;
  setAirplaneMode = generalMethods.setAirplaneMode;
  setBluetoothOn = generalMethods.setBluetoothOn;
  setNfcOn = generalMethods.setNfcOn;
  broadcastAirplaneMode = generalMethods.broadcastAirplaneMode;
  isWifiOn = generalMethods.isWifiOn;
  isDataOn = generalMethods.isDataOn;
  isAnimationOn = generalMethods.isAnimationOn;
  setAnimationScale = generalMethods.setAnimationScale;
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
  getDeviceProperty = generalMethods.getDeviceProperty;
  setDeviceProperty = generalMethods.setDeviceProperty;
  getDeviceSysLanguage = generalMethods.getDeviceSysLanguage;
  getDeviceSysCountry = generalMethods.getDeviceSysCountry;
  getDeviceSysLocale = generalMethods.getDeviceSysLocale;
  getDeviceProductLanguage = generalMethods.getDeviceProductLanguage;
  getDeviceProductCountry = generalMethods.getDeviceProductCountry;
  getDeviceProductLocale = generalMethods.getDeviceProductLocale;
  getModel = generalMethods.getModel;
  getManufacturer = generalMethods.getManufacturer;
  getScreenSize = generalMethods.getScreenSize;
  getScreenDensity = generalMethods.getScreenDensity;
  setHttpProxy = generalMethods.setHttpProxy;
  deleteHttpProxy = generalMethods.deleteHttpProxy;
  setSetting = generalMethods.setSetting;
  getSetting = generalMethods.getSetting;
  bugreport = generalMethods.bugreport;
  screenrecord = generalMethods.screenrecord;
  runInImeContext = generalMethods.runInImeContext;
  getTimeZone = generalMethods.getTimeZone;
  listFeatures = generalMethods.listFeatures;
  isStreamedInstallSupported = generalMethods.isStreamedInstallSupported;
  isIncrementalInstallSupported = generalMethods.isIncrementalInstallSupported;
  getDeviceIdleWhitelist = generalMethods.getDeviceIdleWhitelist;
  addToDeviceIdleWhitelist = generalMethods.addToDeviceIdleWhitelist;
  takeScreenshot = generalMethods.takeScreenshot;
  setWifiState = generalMethods.setWifiState;
  setDataState = generalMethods.setDataState;
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
  getDeviceLanguage = apkUtilsMethods.getDeviceLanguage;
  getDeviceCountry = apkUtilsMethods.getDeviceCountry;
  getDeviceLocale = apkUtilsMethods.getDeviceLocale;
  ensureCurrentLocale = apkUtilsMethods.ensureCurrentLocale;
  getApkInfo = apkUtilsMethods.getApkInfo;
  getPackageInfo = apkUtilsMethods.getPackageInfo;
  pullApk = apkUtilsMethods.pullApk;
  activateApp = apkUtilsMethods.activateApp;

  hideKeyboard = keyboardCommands.hideKeyboard;
  isSoftKeyboardPresent = keyboardCommands.isSoftKeyboardPresent;

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
  POWER_AC_STATES = emuMethods.POWER_AC_STATES;
  GSM_CALL_ACTIONS = emuMethods.GSM_CALL_ACTIONS;
  GSM_VOICE_STATES = emuMethods.GSM_VOICE_STATES;
  GSM_SIGNAL_STRENGTHS = emuMethods.GSM_SIGNAL_STRENGTHS;
  NETWORK_SPEED = emuMethods.NETWORK_SPEED;
  SENSORS = emuMethods.SENSORS;
}
