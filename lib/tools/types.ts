import * as emuConstants from './emu-constants';

export type StringRecord<T = any> = Record<string, T>;

export interface ApkCreationOptions {
  /**
   * Specifies the path to the deployment keystore used
   * to sign the APKs. This flag is optional. If you don't include it,
   * bundletool attempts to sign your APKs with a debug signing key.
   * If the .apk has been already signed and cached then it is not going to be resigned
   * unless a different keystore or key alias is used.
   */
  keystore?: string;
  /**
   * Specifies your keystore’s password.
   * It is mandatory to provide this value if `keystore` one is assigned
   * otherwise it is going to be ignored.
   */
  keystorePassword?: string;
  /**
   * Specifies the alias of the signing key you want to use.
   * It is mandatory to provide this value if `keystore` one is assigned
   * otherwise it is going to be ignored.
   */
  keyAlias?: string;
  /**
   * Specifies the password for the signing key.
   * It is mandatory to provide this value if `keystore` one is assigned
   * otherwise it is going to be ignored.
   */
  keyPassword?: string;
}

export interface LogcatOpts {
  /**
   * The log print format, where <format> is one of:
   * brief process tag thread raw time threadtime long
   * `threadtime` is the default value.
   */
  format?: string;
  /**
   * Series of `<tag>[:priority]`
   * where `<tag>` is a log component tag (or `*` for all) and priority is:
   *  V    Verbose
   *  D    Debug
   *  I    Info
   *  W    Warn
   *  E    Error
   *  F    Fatal
   *  S    Silent (suppress all output)
   *
   * `'*'` means `'*:d'` and `<tag>` by itself means `<tag>:v`
   *
   * If not specified on the commandline, filterspec is set from `ANDROID_LOG_TAGS`.
   * If no filterspec is found, filter defaults to `'*:I'`
   */
  filterSpecs?: string[];
}

export interface ResolveActivityOptions {
  /**
   * Whether to prefer `cmd` tool usage for
   * launchable activity name detection. It might be useful to disable it if
   * `cmd package resolve-activity` returns 'android/com.android.internal.app.ResolverActivity',
   * which means the app has no default handler set in system settings.
   * See https://github.com/appium/appium/issues/17128 for more details.
   * This option has no effect if the target Android version is below 24 as there
   * the corresponding `cmd` subcommand is not implemented and dumpsys usage is the only
   * possible way to detect the launchable activity name.
   * `true` by default.
   */
  preferCmd?: boolean;
}

export interface LogEntry {
  timestamp: number;
  level: 'ALL';
  message: string;
}

/**
 * Listener function, which accepts one argument.
 */
export type LogcatListener = (logEntry: LogEntry) => any;

export interface SetPropOpts {
  /**
   * Do we run setProp as a privileged command? Default true.
   */
  privileged?: boolean;
}

export interface ScreenrecordOptions {
  /**
   * The format is widthxheight.
   * The default value is the device's native display resolution (if supported),
   * 1280x720 if not. For best results,
   * use a size supported by your device's Advanced Video Coding (AVC) encoder.
   * For example, "1280x720"
   */
  videoSize?: string;
  /**
   * Set it to `true` in order to display additional information on the video overlay,
   * such as a timestamp, that is helpful in videos captured to illustrate bugs.
   * This option is only supported since API level 27 (Android P)
   */
  bugReport?: boolean;
  /**
   * The maximum recording time, in seconds.
   * The default (and maximum) value is 180 (3 minutes).
   */
  timeLimit?: string | number;
  /**
   * The video bit rate for the video, in megabits per second.
   * The default value is 4. You can increase the bit rate to improve video quality,
   * but doing so results in larger movie files.
   */
  bitRate?: string | number;
}

export type PortFamily = '4' | '6';

export interface PortInfo {
  /**
   * The actual port number between 0 and 0xFFFF
   */
  port: number;
  family: PortFamily;
  /**
   * See https://elixir.bootlin.com/linux/v4.14.42/source/include/net/tcp_states.h
   */
  state: number;
}

export interface APKInfo {
  /**
   * The name of application package, for example 'com.acme.app'.
   */
  apkPackage: string;
  /**
   * The name of main application activity.
   */
  apkActivity?: string;
}

export interface ExecTelnetOptions {
  /**
   * A timeout used to wait for a server
   * reply to the given command. 60000ms by default.
   */
  execTimeout?: number;
  /**
   * Console connection timeout in milliseconds.
   * 5000ms by default.
   */
  connTimeout?: number;
  /**
   * Telnet console initialization timeout
   * in milliseconds (the time between connection happens and the command prompt
   * is available).
   * 5000ms by default.
   */
  initTimeout?: number;
  /**
   * The emulator port number. The script will try to parse it
   * from the current device identifier if unset
   */
  port?: number | string;
}

export interface EmuVersionInfo {
  /**
   * The actual revision number, for example '30.0.5'
   */
  revision?: string;
  /**
   * The build identifier, for example 6306047
   */
  buildId?: number;
}

export type GsmSignalStrength = (typeof emuConstants.GSM_SIGNAL_STRENGTHS)[number];

export interface EmuInfo {
  /**
   * Emulator name, for example `Pixel_XL_API_30`
   */
  name: string;
  /**
   * Full path to the emulator config .ini file,
   * for example `/Users/user/.android/avd/Pixel_XL_API_30.ini`
   */
  config: string;
}

export interface KeystoreHash {
  /**
   * the md5 hash value of the keystore
   */
  md5?: string;
  /**
   * the sha1 hash value of the keystore
   */
  sha1?: string;
  /**
   * the sha256 hash value of the keystore
   */
  sha256?: string;
  /**
   * the sha512 hash value of the keystore
   */
  sha512?: string;
}

export type SignedAppCacheValue = {output: string; expected: KeystoreHash; keystorePath: string};

export interface CertCheckOptions {
  /**
   * Whether to require that the destination APK
   * is signed with the default Appium certificate or any valid certificate. This option
   * only has effect if `useKeystore` property is unset.
   * `true` by default.
   */
  requireDefaultCert?: boolean;
}

export interface InstallMultipleApksOptions {
  /**
   * The number of milliseconds to wait until
   * the installation is completed. 20000ms by default.
   */
  timeout?: number | string;
  /**
   * The option name
   * used to increase the install timeout.
   * `androidInstallTimeout` by default
   */
  timeoutCapName?: string;
  /**
   * Set to true in order to allow test
   * packages installation. `false` by default.
   */
  allowTestPackages?: boolean;
  /**
   * Set to true to install the app on sdcard
   * instead of the device memory. `false` by default.
   */
  useSdcard?: boolean;
  /**
   * Set to true in order to grant all the
   * permissions requested in the application's manifest automatically after the installation
   * is completed under Android 6+.
   * `false` by default.
   */
  grantPermissions?: boolean;
  /**
   * Install apks partially. It is used for 'install-multiple'.
   * https://android.stackexchange.com/questions/111064/what-is-a-partial-application-install-via-adb.
   * `false` by default.
   */
  partialInstall?: boolean;
}

export interface InstallApksOptions {
  /**
   * The number of milliseconds to wait until
   * the installation is completed.
   * 120000ms by default.
   */
  timeout?: number | string;
  /**
   * The option name
   * used to increase the install timeout.
   * `androidInstallTimeout` by default
   */
  timeoutCapName?: string;
  /**
   * Set to true in order to allow test
   * packages installation. `false` by default.
   */
  allowTestPackages?: boolean;
  /**
   * Set to true in order to grant all the
   * permissions requested in the application's manifest automatically after the installation
   * is completed under Android 6+.
   * `false` by default.
   */
  grantPermissions?: boolean;
}

export interface KeyboardState {
  /**
   * Whether soft keyboard is currently visible.
   */
  isKeyboardShown: boolean;
  /**
   * Whether the keyboard can be closed.
   */
  canCloseKeyboard: boolean;
}

export type InstallState =
  | 'unknown'
  | 'notInstalled'
  | 'newerVersionInstalled'
  | 'sameVersionInstalled'
  | 'olderVersionInstalled';

export interface IsAppInstalledOptions {
  /**
   * The user id
   */
  user?: string;
}

export interface StartUriOptions {
  /**
   * If `false` then adb won't wait
   * for the started activity to return the control.
   * `true` by default.
   */
  waitForLaunch?: boolean;
}

export interface StartAppOptions {
  /**
   * The name of the application package
   */
  pkg: string;
  /**
   * The name of the main application activity.
   * This or action is required in order to be able to launch an app.
   */
  activity?: string;
  /**
   * The name of the intent action that will launch the required app.
   * This or activity is required in order to be able to launch an app.
   */
  action?: string;
  /**
   * If this property is set to `true`
   * and the activity name does not start with '.' then the method
   * will try to add the missing dot and start the activity once more
   * if the first startup try fails.
   * `true` by default.
   */
  retry?: boolean;
  /**
   * Set it to `true` in order to forcefully
   * stop the activity if it is already running.
   * `true` by default.
   */
  stopApp?: boolean;
  /**
   * The name of the package to wait to on
   * startup (this only makes sense if this name is
   * different from the one, which is set as `pkg`)
   */
  waitPkg?: string;
  /**
   * The name of the activity to wait to on
   * startup (this only makes sense if this name is different
   * from the one, which is set as `activity`)
   */
  waitActivity?: string;
  /**
   * The number of milliseconds to wait until the
   * `waitActivity` is focused
   */
  waitDuration?: number;
  /**
   * The number of the user profile to start
   * the given activity with. The default OS user profile (usually zero) is used
   * when this property is unset
   */
  user?: string | number;
  /**
   * If `false` then adb won't wait
   * for the started activity to return the control.
   * `true` by default.
   */
  waitForLaunch?: boolean;
  category?: string;
  flags?: string;
  optionalIntentArguments?: string;
}

export interface PackageActivityInfo {
  /**
   * The name of application package,
   * for example 'com.acme.app'.
   */
  appPackage?: string | null;
  /**
   * The name of main application activity.
   */
  appActivity?: string | null;
}

export interface UninstallOptions {
  /**
   * The count of milliseconds to wait until the
   * app is uninstalled.
   */
  timeout?: number;
  /**
   * Set to true in order to keep the
   * application data and cache folders after uninstall.
   */
  keepData?: boolean;
  /**
   * Whether to check if the app is installed prior to
   * uninstalling it. By default this is checked.
   */
  skipInstallCheck?: boolean;
}

export interface CachingOptions {
  /**
   * The count of milliseconds to wait until the
   * app is uploaded to the remote location.
   */
  timeout?: number;
}

export interface InstallOptions {
  /**
   * The count of milliseconds to wait until the
   * app is installed.
   * 20000ms by default.
   */
  timeout?: number;
  /**
   * The option name
   * used to increase the timeout.
   * `androidInstallTimeout` by default.
   */
  timeoutCapName?: string;
  /**
   * Set to true in order to allow test
   * packages installation.
   * `false` by default.
   */
  allowTestPackages?: boolean;
  /**
   * Set to true to install the app on sdcard
   * instead of the device memory.
   * `false` by default.
   */
  useSdcard?: boolean;
  /**
   * Set to true in order to grant all the
   * permissions requested in the application's manifest
   * automatically after the installation is completed
   * under Android 6+.
   * `false` by default.
   */
  grantPermissions?: boolean;
  /**
   * Set it to false if you don't want
   * the application to be upgraded/reinstalled
   * if it is already present on the device.
   * `true` by default.
   */
  replace?: boolean;
  /**
   * Forcefully disables incremental installs if set to `true`.
   * Read https://developer.android.com/preview/features#incremental
   * for more details.
   * `false` by default.
   */
  noIncremental?: boolean;
}

export interface InstallOrUpgradeOptions {
  /**
   * The count of milliseconds to wait until the
   * app is installed.
   * 60000ms by default.
   */
  timeout?: number;
  /**
   * Set to true in order to allow test
   * packages installation.
   * `false` by default.
   */
  allowTestPackages?: boolean;
  /**
   * Set to true to install the app on SDCard
   * instead of the device memory.
   * `false` by default.
   */
  useSdcard?: boolean;
  /**
   * Set to true in order to grant all the
   * permissions requested in the application's manifest
   * automatically after the installation is completed
   * under Android 6+.
   * `false` by default.
   */
  grantPermissions?: boolean;
  /**
   * Set to `true` in order to always prefer
   * the current build over any installed packages having
   * the same identifier.
   * `false` by default.
   */
  enforceCurrentBuild?: boolean;
}

export interface InstallOrUpgradeResult {
  /**
   * Equals to `true` if the target app has been uninstalled
   * before being installed
   */
  wasUninstalled: boolean;
  /**
   * One of `adb.APP_INSTALL_STATE` states, which reflects
   * the state of the application before being installed.
   */
  appState: InstallState;
}

export interface ApkStrings {
  /**
   * Parsed resource file
   * represented as JSON object.
   */
  apkStrings: StringRecord;
  /**
   * The path to the extracted file on the local file system
   */
  localPath?: string;
}

export interface AppInfo {
  /**
   * Package name, for example 'com.acme.app'.
   */
  name: string;
  /**
   * Version code.
   */
  versionCode?: number;
  /**
   * Version name, for example '1.0'.
   */
  versionName?: string;
  /**
   * true if the app is installed on the device under test.
   */
  isInstalled?: boolean;
}

export interface ConnectedDevicesOptions {
  /**
   * Whether to get long output, which includes extra properties in each device.
   * Akin to running `adb devices -l`.
   */
  verbose?: boolean;
}

export interface Device {
  /**
   * The device udid.
   */
  udid: string;
  /**
   * Current device state, as it is visible in
   * _adb devices -l_ output.
   */
  state: string;
  port?: number;
}

export interface VerboseDevice extends Device {
  /**
   * The product codename of the device, such as "razor".
   */
  product: string;
  /**
   * The model name of the device, such as "Nexus_7".
   */
  model: string;
  /**
   * The device codename, such as "flow".
   */
  device: string;
  /**
   * Represents the USB port the device is connected to, such as "1-1".
   */
  usb?: string;
  /**
   * The Transport ID for the device, such as "1".
   */
  transport_id?: string;
}

export type ExecOutputFormat = 'stdout' | 'full';

export interface ExecResult {
  /**
   * The stdout received from exec
   */
  stdout: string;
  /**
   * The stderr received from exec
   */
  stderr: string;
}

export interface SpecialAdbExecOptions {
  exclusive?: boolean;
}

export interface ShellExecOptions {
  /**
   * The name of the corresponding Appium's timeout capability
   * (used in the error messages).
   */
  timeoutCapName?: string;
  /**
   * command execution timeout
   */
  timeout?: number;
  /**
   * Whether to run the given command as root.
   * `false` by default.
   */
  privileged?: boolean;
  /**
   * Whether response should include full exec output or just stdout.
   * Potential values are full or stdout.
   *
   * All other properties are the same as for `exec` call from {@link https://github.com/appium/node-teen_process}
   * module.
   * `stdout` by default.
   */
  outputFormat?: ExecOutputFormat;
}

export type TFullOutputOption = {outputFormat: 'full'};

export interface AvdLaunchOptions {
  /**
   * Additional emulator command line arguments
   */
  args?: string | string[];
  /**
   * Additional emulator environment variables
   */
  env?: Record<string, string>;
  /**
   * Emulator system language
   */
  language?: string;
  /**
   * Emulator system country
   */
  country?: string;
  /**
   * Emulator startup timeout in milliseconds.
   * 60000ms by default.
   */
  launchTimeout?: number;
  /**
   * The maximum period of time to wait until Emulator
   * is ready for usage in milliseconds.
   * 60000ms by default.
   */
  readyTimeout?: number;
  /**
   * The maximum number of startup retries.
   * `1` by default.
   */
  retryTimes?: number;
}

export interface BinaryVersion {
  /**
   * The ADB binary version number
   */
  version: string;
  /**
   * The ADB binary build number
   */
  build: number;
}

export interface BridgeVersion {
  /**
   * The Android Debug Bridge version number
   */
  version: string;
}

export interface Version {
  /**
   * This version number might not be
   * be present for older ADB releases.
   */
  binary?: BinaryVersion;
  bridge: BridgeVersion;
}

export interface RootResult {
  /**
   * True if the call to root/unroot was successful
   */
  isSuccessful: boolean;
  /**
   * True if the device was already rooted
   */
  wasAlreadyRooted: boolean;
}

export type Sensors = (typeof emuConstants.SENSORS)[keyof typeof emuConstants.SENSORS];
export type NetworkSpeed =
  (typeof emuConstants.NETWORK_SPEED)[keyof typeof emuConstants.NETWORK_SPEED];
export type GsmVoiceStates =
  (typeof emuConstants.GSM_VOICE_STATES)[keyof typeof emuConstants.GSM_VOICE_STATES];
export type GsmCallActions =
  (typeof emuConstants.GSM_CALL_ACTIONS)[keyof typeof emuConstants.GSM_CALL_ACTIONS];
export type PowerAcStates =
  (typeof emuConstants.POWER_AC_STATES)[keyof typeof emuConstants.POWER_AC_STATES];

export interface PlatformInfo {
  /**
   * The platform name, for example `android-24`
   * or `null` if it cannot be found
   */
  platform?: string | null;
  /**
   * Full path to the platform SDK folder
   * or `null` if it cannot be found
   */
  platformPath?: string | null;
}

export interface LaunchableActivity {
  name: string;
  label?: string;
  icon?: string;
}

export interface ApkManifest {
  /**
   * Package name, for example 'io.appium.android.apis'
   */
  name: string;
  versionCode: number;
  versionName?: string;
  platformBuildVersionName?: string;
  platformBuildVersionCode?: number;
  compileSdkVersion: number;
  compileSdkVersionCodename?: string;
  minSdkVersion: number;
  targetSdkVersion?: number;
  /**
   * List of requested permissions
   */
  usesPermissions: string[];
  launchableActivity: LaunchableActivity;
  /**
   * List of supported locales
   */
  locales: string[];
  /**
   * List of supported architectures. Could be empty for older apps.
   */
  architectures: string[];
  /**
   * List of supported display densities
   */
  densities: number[];
}
