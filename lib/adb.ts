import _ from 'lodash';
import os from 'node:os';
import {DEFAULT_ADB_EXEC_TIMEOUT, requireSdkRoot, getSdkRootFromEnv} from './helpers';
import {log} from './logger';
import type {ADBOptions, ADBExecutable} from './types';
import type {Logcat} from './logcat';
import type {LogcatOpts, StringRecord} from './tools/types';
import type {LRUCache} from 'lru-cache';
import type {ExecError} from 'teen_process';

import * as generalCommands from './tools/general-commands';
import * as manifestCommands from './tools/android-manifest';
import * as systemCommands from './tools/system-calls';
import * as signingCommands from './tools/apk-signing';
import * as apkUtilCommands from './tools/apk-utils';
import * as apksUtilCommands from './tools/apks-utils';
import * as aabUtilCommands from './tools/aab-utils';
import * as emuCommands from './tools/emulator-commands';
import * as emuConstants from './tools/emu-constants';
import * as lockManagementCommands from './tools/lockmgmt';
import * as keyboardCommands from './tools/keyboard-commands';
import * as deviceSettingsCommands from './tools/device-settings';
import * as fsCommands from './tools/fs-commands';
import * as appCommands from './tools/app-commands';
import * as networkCommands from './tools/network-commands';
import * as logcatCommands from './tools/logcat-commands';
import * as processCommands from './tools/process-commands';

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
  listenAllNetwork: false,
} as const;

export class ADB implements ADBOptions {
  adbHost?: string;
  adbPort?: number;
  _apiLevel: number | undefined;
  _logcatStartupParams: LogcatOpts | undefined;
  _doesPsSupportAOption: boolean | undefined;
  _isPgrepAvailable: boolean | undefined;
  _canPgrepUseFullCmdLineSearch: boolean | undefined;
  _isPidofAvailable: boolean | undefined;
  _memoizedFeatures: (() => Promise<string>) | undefined;
  _areExtendedLsOptionsSupported: boolean | undefined;
  remoteAppsCache: LRUCache<string, string> | undefined;
  _isLockManagementSupported: boolean | undefined;

  sdkRoot?: string;
  udid?: string;
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
  listenAllNetwork?: boolean;

  constructor(opts: ADBOptions = {} as ADBOptions) {
    const options: ADBOptions = _.defaultsDeep(opts, _.cloneDeep(DEFAULT_OPTS));
    _.defaultsDeep(this, options);

    // The above defaultsDeep call guarantees the 'executable' field to be always assigned
    this.executable = options.executable as ADBExecutable;

    // do not add -a option twice if the defualtArgs already had it.
    if (options.listenAllNetwork && !this.executable.defaultArgs.includes('-a')) {
      this.executable.defaultArgs.push('-a');
    } else if (this.executable.defaultArgs.includes('-a')) {
      this.listenAllNetwork = true;
    }

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
  clone(opts: ADBOptions = {} as ADBOptions): ADB {
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

  static async createADB(opts: ADBOptions = {} as ADBOptions) {
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

  getAdbWithCorrectAdbPath = generalCommands.getAdbWithCorrectAdbPath;
  initAapt = generalCommands.initAapt;
  initAapt2 = generalCommands.initAapt2;
  initZipAlign = generalCommands.initZipAlign;
  initBundletool = generalCommands.initBundletool;
  getApiLevel = generalCommands.getApiLevel;
  isDeviceConnected = generalCommands.isDeviceConnected;
  clearTextField = generalCommands.clearTextField;
  back = generalCommands.back;
  goToHome = generalCommands.goToHome;
  getAdbPath = generalCommands.getAdbPath;
  restart = generalCommands.restart;
  bugreport = generalCommands.bugreport;
  screenrecord = generalCommands.screenrecord;
  listFeatures = generalCommands.listFeatures;
  isStreamedInstallSupported = generalCommands.isStreamedInstallSupported;
  isIncrementalInstallSupported = generalCommands.isIncrementalInstallSupported;
  takeScreenshot = generalCommands.takeScreenshot;

  startLogcat = logcatCommands.startLogcat;
  stopLogcat = logcatCommands.stopLogcat;
  getLogcatLogs = logcatCommands.getLogcatLogs;
  setLogcatListener = logcatCommands.setLogcatListener;
  removeLogcatListener = logcatCommands.removeLogcatListener;

  getForwardList = networkCommands.getForwardList;
  forwardPort = networkCommands.forwardPort;
  listPorts = networkCommands.listPorts;
  ping = networkCommands.ping;
  forwardAbstractPort = networkCommands.forwardAbstractPort;
  removePortReverse = networkCommands.removePortReverse;
  reversePort = networkCommands.reversePort;
  getReverseList = networkCommands.getReverseList;
  removePortForward = networkCommands.removePortForward;

  executeApksigner = signingCommands.executeApksigner;
  signWithDefaultCert = signingCommands.signWithDefaultCert;
  signWithCustomCert = signingCommands.signWithCustomCert;
  sign = signingCommands.sign;
  zipAlignApk = signingCommands.zipAlignApk;
  checkApkCert = signingCommands.checkApkCert;
  getKeystoreHash = signingCommands.getKeystoreHash;

  grantAllPermissions = appCommands.grantAllPermissions;
  grantPermissions = appCommands.grantPermissions;
  grantPermission = appCommands.grantPermission;
  revokePermission = appCommands.revokePermission;
  getGrantedPermissions = appCommands.getGrantedPermissions;
  getDeniedPermissions = appCommands.getDeniedPermissions;
  getReqPermissions = appCommands.getReqPermissions;
  stopAndClear = appCommands.stopAndClear;
  isValidClass = appCommands.isValidClass;
  resolveLaunchableActivity = appCommands.resolveLaunchableActivity;
  forceStop = appCommands.forceStop;
  killPackage = appCommands.killPackage;
  clear = appCommands.clear;
  readonly APP_INSTALL_STATE = appCommands.APP_INSTALL_STATE;
  isAppInstalled = appCommands.isAppInstalled;
  startUri = appCommands.startUri;
  startApp = appCommands.startApp;
  dumpWindows = appCommands.dumpWindows;
  getFocusedPackageAndActivity = appCommands.getFocusedPackageAndActivity;
  waitForActivityOrNot = appCommands.waitForActivityOrNot;
  waitForActivity = appCommands.waitForActivity;
  waitForNotActivity = appCommands.waitForNotActivity;
  getPackageInfo = appCommands.getPackageInfo;
  pullApk = appCommands.pullApk;
  activateApp = appCommands.activateApp;
  listAppProcessIds = appCommands.listAppProcessIds;
  isAppRunning = appCommands.isAppRunning;
  broadcast = appCommands.broadcast;

  listProcessStatus = processCommands.listProcessStatus;
  getProcessNameById = processCommands.getProcessNameById;
  getProcessIdsByName = processCommands.getProcessIdsByName;
  killProcessesByName = processCommands.killProcessesByName;
  killProcessByPID = processCommands.killProcessByPID;
  processExists = processCommands.processExists;

  uninstallApk = apkUtilCommands.uninstallApk;
  installFromDevicePath = apkUtilCommands.installFromDevicePath;
  cacheApk = apkUtilCommands.cacheApk;
  install = apkUtilCommands.install;
  installOrUpgrade = apkUtilCommands.installOrUpgrade;
  extractStringsFromApk = apkUtilCommands.extractStringsFromApk;
  getApkInfo = apkUtilCommands.getApkInfo;
  getApplicationInstallState = apkUtilCommands.getApplicationInstallState;

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

  lock = lockManagementCommands.lock;
  isLockManagementSupported = lockManagementCommands.isLockManagementSupported;
  verifyLockCredential = lockManagementCommands.verifyLockCredential;
  clearLockCredential = lockManagementCommands.clearLockCredential;
  isLockEnabled = lockManagementCommands.isLockEnabled;
  setLockCredential = lockManagementCommands.setLockCredential;
  isScreenLocked = lockManagementCommands.isScreenLocked;
  dismissKeyguard = lockManagementCommands.dismissKeyguard;
  cycleWakeUp = lockManagementCommands.cycleWakeUp;

  getSdkBinaryPath = systemCommands.getSdkBinaryPath;
  getBinaryNameForOS = systemCommands.getBinaryNameForOS;
  getBinaryFromSdkRoot = systemCommands.getBinaryFromSdkRoot;
  getBinaryFromPath = systemCommands.getBinaryFromPath;
  getConnectedDevices = systemCommands.getConnectedDevices;
  getDevicesWithRetry = systemCommands.getDevicesWithRetry;
  reconnect = systemCommands.reconnect;
  restartAdb = systemCommands.restartAdb;
  killServer = systemCommands.killServer;
  resetTelnetAuthToken = systemCommands.resetTelnetAuthToken;
  adbExecEmu = systemCommands.adbExecEmu;
  EXEC_OUTPUT_FORMAT = systemCommands.EXEC_OUTPUT_FORMAT;
  adbExec = systemCommands.adbExec;
  shell = systemCommands.shell;
  shellChunks = systemCommands.shellChunks;
  createSubProcess = systemCommands.createSubProcess;
  getAdbServerPort = systemCommands.getAdbServerPort;
  getEmulatorPort = systemCommands.getEmulatorPort;
  getPortFromEmulatorString = systemCommands.getPortFromEmulatorString;
  getConnectedEmulators = systemCommands.getConnectedEmulators;
  setEmulatorPort = systemCommands.setEmulatorPort;
  setDeviceId = systemCommands.setDeviceId;
  setDevice = systemCommands.setDevice;
  getRunningAVD = systemCommands.getRunningAVD;
  getRunningAVDWithRetry = systemCommands.getRunningAVDWithRetry;
  killAllEmulators = systemCommands.killAllEmulators;
  killEmulator = systemCommands.killEmulator;
  launchAVD = systemCommands.launchAVD;
  getVersion = systemCommands.getVersion;
  waitForEmulatorReady = systemCommands.waitForEmulatorReady;
  waitForDevice = systemCommands.waitForDevice;
  reboot = systemCommands.reboot;
  changeUserPrivileges = systemCommands.changeUserPrivileges;
  root = systemCommands.root;
  unroot = systemCommands.unroot;
  isRoot = systemCommands.isRoot;
  installMitmCertificate = systemCommands.installMitmCertificate;
  isMitmCertificateInstalled = systemCommands.isMitmCertificateInstalled;

  execBundletool = apksUtilCommands.execBundletool;
  getDeviceSpec = apksUtilCommands.getDeviceSpec;
  installMultipleApks = apksUtilCommands.installMultipleApks;
  installApks = apksUtilCommands.installApks;
  extractBaseApk = apksUtilCommands.extractBaseApk;
  extractLanguageApk = apksUtilCommands.extractLanguageApk;
  isTestPackageOnlyError = apksUtilCommands.isTestPackageOnlyError;

  packageAndLaunchActivityFromManifest = manifestCommands.packageAndLaunchActivityFromManifest;
  targetSdkVersionFromManifest = manifestCommands.targetSdkVersionFromManifest;
  targetSdkVersionUsingPKG = manifestCommands.targetSdkVersionUsingPKG;
  compileManifest = manifestCommands.compileManifest;
  insertManifest = manifestCommands.insertManifest;
  hasInternetPermissionFromManifest = manifestCommands.hasInternetPermissionFromManifest;

  extractUniversalApk = aabUtilCommands.extractUniversalApk;

  isEmulatorConnected = emuCommands.isEmulatorConnected;
  verifyEmulatorConnected = emuCommands.verifyEmulatorConnected;
  fingerprint = emuCommands.fingerprint;
  rotate = emuCommands.rotate;
  powerAC = emuCommands.powerAC;
  sensorSet = emuCommands.sensorSet;
  powerCapacity = emuCommands.powerCapacity;
  powerOFF = emuCommands.powerOFF;
  sendSMS = emuCommands.sendSMS;
  gsmCall = emuCommands.gsmCall;
  gsmSignal = emuCommands.gsmSignal;
  gsmVoice = emuCommands.gsmVoice;
  networkSpeed = emuCommands.networkSpeed;
  sendTelnetCommand = emuCommands.sendTelnetCommand;
  execEmuConsoleCommand = emuCommands.execEmuConsoleCommand;
  getEmuVersionInfo = emuCommands.getEmuVersionInfo;
  getEmuImageProperties = emuCommands.getEmuImageProperties;
  checkAvdExist = emuCommands.checkAvdExist;
  readonly POWER_AC_STATES = emuConstants.POWER_AC_STATES;
  readonly GSM_CALL_ACTIONS = emuConstants.GSM_CALL_ACTIONS;
  readonly GSM_VOICE_STATES = emuConstants.GSM_VOICE_STATES;
  readonly GSM_SIGNAL_STRENGTHS = emuConstants.GSM_SIGNAL_STRENGTHS;
  readonly NETWORK_SPEED = emuConstants.NETWORK_SPEED;
  readonly SENSORS = emuConstants.SENSORS;

  fileExists = fsCommands.fileExists;
  ls = fsCommands.ls;
  fileSize = fsCommands.fileSize;
  rimraf = fsCommands.rimraf;
  push = fsCommands.push;
  pull = fsCommands.pull;
  mkdir = fsCommands.mkdir;

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
