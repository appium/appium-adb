import {log} from '../logger.js';
import _ from 'lodash';
import {retryInterval} from 'asyncbox';
import {util} from '@appium/support';
import B from 'bluebird';
import type {ADB} from '../adb.js';
import type {SetPropOpts} from './types.js';
import type {ExecError} from 'teen_process';

const ANIMATION_SCALE_KEYS = [
  'animator_duration_scale',
  'transition_animation_scale',
  'window_animation_scale',
] as const;
const HIDDEN_API_POLICY_KEYS = [
  'hidden_api_policy_pre_p_apps',
  'hidden_api_policy_p_apps',
  'hidden_api_policy',
] as const;

/**
 * Get the particular property of the device under test.
 *
 * @param property - The name of the property. This name should
 *                            be known to _adb shell getprop_ tool.
 *
 * @returns The value of the given property.
 */
export async function getDeviceProperty(this: ADB, property: string): Promise<string> {
  const stdout = await this.shell(['getprop', property]);
  const val = stdout.trim();
  log.debug(`Current device property '${property}': ${val}`);
  return val;
}

/**
 * Set the particular property of the device under test.
 *
 * @param prop - The name of the property. This name should
 *                            be known to _adb shell setprop_ tool.
 * @param val - The new property value.
 * @param opts
 *
 * @throws If _setprop_ utility fails to change property value.
 */
export async function setDeviceProperty(
  this: ADB,
  prop: string,
  val: string,
  opts: SetPropOpts = {},
): Promise<void> {
  const {privileged = true} = opts;
  log.debug(`Setting device property '${prop}' to '${val}'`);
  await this.shell(['setprop', prop, val], {
    privileged,
  });
}

/**
 * @returns Current system language on the device under test.
 */
export async function getDeviceSysLanguage(this: ADB): Promise<string> {
  return await this.getDeviceProperty('persist.sys.language');
}

/**
 * @returns Current country name on the device under test.
 */
export async function getDeviceSysCountry(this: ADB): Promise<string> {
  return await this.getDeviceProperty('persist.sys.country');
}

/**
 * @returns Current system locale name on the device under test.
 */
export async function getDeviceSysLocale(this: ADB): Promise<string> {
  return await this.getDeviceProperty('persist.sys.locale');
}

/**
 * @returns Current product language name on the device under test.
 */
export async function getDeviceProductLanguage(this: ADB): Promise<string> {
  return await this.getDeviceProperty('ro.product.locale.language');
}

/**
 * @returns Current product country name on the device under test.
 */
export async function getDeviceProductCountry(this: ADB): Promise<string> {
  return await this.getDeviceProperty('ro.product.locale.region');
}

/**
 * @returns Current product locale name on the device under test.
 */
export async function getDeviceProductLocale(this: ADB): Promise<string> {
  return await this.getDeviceProperty('ro.product.locale');
}

/**
 * @returns The model name of the device under test.
 */
export async function getModel(this: ADB): Promise<string> {
  return await this.getDeviceProperty('ro.product.model');
}

/**
 * @returns The manufacturer name of the device under test.
 */
export async function getManufacturer(this: ADB): Promise<string> {
  return await this.getDeviceProperty('ro.product.manufacturer');
}

/**
 * Get the current screen size.
 *
 * @returns Device screen size as string in format 'WxH' or
 * _null_ if it cannot be determined.
 */
export async function getScreenSize(this: ADB): Promise<string | null> {
  const stdout = await this.shell(['wm', 'size']);
  const size = new RegExp(/Physical size: ([^\r?\n]+)*/g).exec(stdout);
  if (size && size.length >= 2) {
    return size[1].trim();
  }
  return null;
}

/**
 * Get the current screen density in dpi
 *
 * @returns Device screen density as a number or _null_ if it
 * cannot be determined
 */
export async function getScreenDensity(this: ADB): Promise<number | null> {
  const stdout = await this.shell(['wm', 'density']);
  const density = new RegExp(/Physical density: ([^\r?\n]+)*/g).exec(stdout);
  if (density && density.length >= 2) {
    const densityNumber = parseInt(density[1].trim(), 10);
    return isNaN(densityNumber) ? null : densityNumber;
  }
  return null;
}

/**
 * Setup HTTP proxy in device global settings.
 * Read https://android.googlesource.com/platform/frameworks/base/+/android-9.0.0_r21/core/java/android/provider/Settings.java for each property
 *
 * @param proxyHost - The host name of the proxy.
 * @param proxyPort - The port number to be set.
 */
export async function setHttpProxy(
  this: ADB,
  proxyHost: string,
  proxyPort: string | number,
): Promise<void> {
  const proxy = `${proxyHost}:${proxyPort}`;
  if (_.isUndefined(proxyHost)) {
    throw new Error(`Call to setHttpProxy method with undefined proxy_host: ${proxy}`);
  }
  if (_.isUndefined(proxyPort)) {
    throw new Error(`Call to setHttpProxy method with undefined proxy_port ${proxy}`);
  }

  /** @type {[string, string][]} */
  const httpProxySettins: [string, string][] = [
    ['http_proxy', proxy],
    ['global_http_proxy_host', proxyHost],
    ['global_http_proxy_port', `${proxyPort}`],
  ];
  for (const [settingKey, settingValue] of httpProxySettins) {
    await this.setSetting('global', settingKey, settingValue);
  }
}

/**
 * Delete HTTP proxy in device global settings.
 * Rebooting the test device is necessary to apply the change.
 */
export async function deleteHttpProxy(this: ADB): Promise<void> {
  const httpProxySettins = [
    'http_proxy',
    'global_http_proxy_host',
    'global_http_proxy_port',
    'global_http_proxy_exclusion_list', // `global_http_proxy_exclusion_list=` was generated by `settings global htto_proxy xxxx`
  ];
  for (const setting of httpProxySettins) {
    await this.shell(['settings', 'delete', 'global', setting]);
  }
}

/**
 * Set device property.
 * [android.provider.Settings]{@link https://developer.android.com/reference/android/provider/Settings.html}
 *
 * @param namespace - one of {system, secure, global}, case-insensitive.
 * @param setting - property name.
 * @param value - property value.
 * @returns command output.
 */
export async function setSetting(
  this: ADB,
  namespace: string,
  setting: string,
  value: string | number,
): Promise<string> {
  return await this.shell(['settings', 'put', namespace, setting, `${value}`]);
}

/**
 * Get device property.
 * [android.provider.Settings]{@link https://developer.android.com/reference/android/provider/Settings.html}
 *
 * @param namespace - one of {system, secure, global}, case-insensitive.
 * @param setting - property name.
 * @returns property value.
 */
export async function getSetting(this: ADB, namespace: string, setting: string): Promise<string> {
  return await this.shell(['settings', 'get', namespace, setting]);
}

/**
 * Get tz database time zone formatted timezone
 *
 * @returns TZ database Time Zones format
 * @throws If any exception is reported by adb shell.
 */
export async function getTimeZone(this: ADB): Promise<string> {
  log.debug('Getting current timezone');
  try {
    return await this.getDeviceProperty('persist.sys.timezone');
  } catch (e) {
    const err = e as Error;
    throw new Error(`Error getting timezone. Original error: ${err.message}`);
  }
}

/**
 * Retrieve the platform version of the device under test.
 *
 * @returns The platform version as a string, for example '5.0' for
 * Android Lollipop.
 */
export async function getPlatformVersion(this: ADB): Promise<string> {
  log.info('Getting device platform version');
  try {
    return await this.getDeviceProperty('ro.build.version.release');
  } catch (e) {
    const err = e as Error;
    throw new Error(`Error getting device platform version. ` + `Original error: ${err.message}`);
  }
}

/**
 * Retrieve the list of location providers for the device under test.
 *
 * @returns The list of available location providers or an empty list.
 */
export async function getLocationProviders(this: ADB): Promise<string[]> {
  if ((await this.getApiLevel()) < 31) {
    // https://stackoverflow.com/questions/70939503/settings-secure-location-providers-allowed-returns-null-in-android-12
    const stdout = await this.getSetting('secure', 'location_providers_allowed');
    return stdout
      .trim()
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  }

  // To emulate the legacy behavior
  return _.includes(await this.shell(['cmd', 'location', 'is-location-enabled']), 'true')
    ? ['gps']
    : [];
}

/**
 * Toggle the state of GPS location provider.
 *
 * @param enabled - Whether to enable (true) or disable (false) the GPS provider.
 */
export async function toggleGPSLocationProvider(this: ADB, enabled: boolean): Promise<void> {
  if ((await this.getApiLevel()) < 31) {
    // https://stackoverflow.com/questions/70939503/settings-secure-location-providers-allowed-returns-null-in-android-12
    await this.setSetting('secure', 'location_providers_allowed', `${enabled ? '+' : '-'}gps`);
    return;
  }
  await this.shell(['cmd', 'location', 'set-location-enabled', enabled ? 'true' : 'false']);
}

/**
 * Decorates an exception message with a solution link
 *
 * @param e The error object to be decorated
 * @returns Either the same error or the decorated one
 */
function decorateWriteSecureSettingsException(e: Error): Error {
  if (_.includes(e.message, 'requires:android.permission.WRITE_SECURE_SETTINGS')) {
    e.message = `Check https://github.com/appium/appium/issues/13802 for throubleshooting. ${e.message}`;
  }
  return e;
}

/**
 * Set hidden api policy to manage access to non-SDK APIs.
 * https://developer.android.com/preview/restrictions-non-sdk-interfaces
 *
 * @param value - The API enforcement policy.
 *     For Android P
 *     0: Disable non-SDK API usage detection. This will also disable logging, and also break the strict mode API,
 *        detectNonSdkApiUsage(). Not recommended.
 *     1: "Just warn" - permit access to all non-SDK APIs, but keep warnings in the log.
 *        The strict mode API will keep working.
 *     2: Disallow usage of dark grey and black listed APIs.
 *     3: Disallow usage of blacklisted APIs, but allow usage of dark grey listed APIs.
 *
 *     For Android Q
 *     https://developer.android.com/preview/non-sdk-q#enable-non-sdk-access
 *     0: Disable all detection of non-SDK interfaces. Using this setting disables all log messages for non-SDK interface usage
 *        and prevents you from testing your app using the StrictMode API. This setting is not recommended.
 *     1: Enable access to all non-SDK interfaces, but print log messages with warnings for any non-SDK interface usage.
 *        Using this setting also allows you to test your app using the StrictMode API.
 *     2: Disallow usage of non-SDK interfaces that belong to either the black list
 *        or to a restricted greylist for your target API level.
 *
 * @param ignoreError - Whether to ignore an exception in 'adb shell settings put global' command
 * @throws If there was an error and ignoreError was true while executing 'adb shell settings put global'
 *                 command on the device under test.
 */
export async function setHiddenApiPolicy(
  this: ADB,
  value: number | string,
  ignoreError = false,
): Promise<void> {
  try {
    await this.shell(
      HIDDEN_API_POLICY_KEYS.map((k) => `settings put global ${k} ${value}`).join(';'),
    );
  } catch (e) {
    const err = e as Error;
    if (!ignoreError) {
      throw decorateWriteSecureSettingsException(err);
    }
    log.info(
      `Failed to set setting keys '${HIDDEN_API_POLICY_KEYS}' to '${value}'. ` +
        `Original error: ${err.message}`,
    );
  }
}

/**
 * Reset access to non-SDK APIs to its default setting.
 * https://developer.android.com/preview/restrictions-non-sdk-interfaces
 *
 * @param ignoreError - Whether to ignore an exception in 'adb shell settings delete global' command
 * @throws If there was an error and ignoreError was true while executing 'adb shell settings delete global'
 *                 command on the device under test.
 */
export async function setDefaultHiddenApiPolicy(this: ADB, ignoreError = false): Promise<void> {
  try {
    await this.shell(HIDDEN_API_POLICY_KEYS.map((k) => `settings delete global ${k}`).join(';'));
  } catch (e) {
    const err = e as Error;
    if (!ignoreError) {
      throw decorateWriteSecureSettingsException(err);
    }
    log.info(`Failed to delete keys '${HIDDEN_API_POLICY_KEYS}'. Original error: ${err.message}`);
  }
}

/**
 * Get the language name of the device under test.
 *
 * @returns The name of device language.
 */
export async function getDeviceLanguage(this: ADB): Promise<string> {
  return (await this.getApiLevel()) < 23
    ? (await this.getDeviceSysLanguage()) || (await this.getDeviceProductLanguage())
    : (await this.getDeviceLocale()).split('-')[0];
}

/**
 * Get the country name of the device under test.
 *
 * @summary Could only be used for Android API < 23
 * @returns The name of device country.
 */
export async function getDeviceCountry(this: ADB): Promise<string> {
  return (await this.getDeviceSysCountry()) || (await this.getDeviceProductCountry());
}

/**
 * Get the locale name of the device under test.
 *
 * @summary Could only be used for Android API >= 23
 * @returns The name of device locale.
 */
export async function getDeviceLocale(this: ADB): Promise<string> {
  return (await this.getDeviceSysLocale()) || (await this.getDeviceProductLocale());
}

/**
 * Make sure current device locale is expected or not.
 *
 * @privateRemarks FIXME: language or country is required
 * @param language - Language. The language field is case insensitive, but Locale always canonicalizes to lower case.
 * @param country - Country. The language field is case insensitive, but Locale always canonicalizes to lower case.
 * @param script - Script. The script field is case insensitive but Locale always canonicalizes to title case.
 *
 * @returns If current locale is language and country as arguments, return true.
 */
export async function ensureCurrentLocale(
  this: ADB,
  language?: string,
  country?: string,
  script?: string,
): Promise<boolean> {
  const hasLanguage = _.isString(language);
  const hasCountry = _.isString(country);
  if (!hasLanguage && !hasCountry) {
    log.warn('ensureCurrentLocale requires language or country');
    return false;
  }

  const lcLanguage = (language || '').toLowerCase();
  const lcCountry = (country || '').toLowerCase();
  const apiLevel = await this.getApiLevel();
  return (
    (await retryInterval(5, 1000, async () => {
      if (apiLevel < 23) {
        log.debug(`Requested locale: ${lcLanguage}-${lcCountry}`);
        let actualLanguage: string | undefined;
        if (hasLanguage) {
          actualLanguage = (await this.getDeviceLanguage()).toLowerCase();
          log.debug(`Actual language: ${actualLanguage}`);
          if (!hasCountry && lcLanguage === actualLanguage) {
            return true;
          }
        }
        let actualCountry: string | undefined;
        if (hasCountry) {
          actualCountry = (await this.getDeviceCountry()).toLowerCase();
          log.debug(`Actual country: ${actualCountry}`);
          if (!hasLanguage && lcCountry === actualCountry) {
            return true;
          }
        }
        return lcLanguage === actualLanguage && lcCountry === actualCountry;
      }
      const actualLocale = (await this.getDeviceLocale()).toLowerCase();
      // zh-hans-cn : zh-cn
      const expectedLocale = script
        ? `${lcLanguage}-${script.toLowerCase()}-${lcCountry}`
        : `${lcLanguage}-${lcCountry}`;
      log.debug(`Requested locale: ${expectedLocale}. Actual locale: '${actualLocale}'`);
      const languagePattern = `^${_.escapeRegExp(lcLanguage)}-${script ? _.escapeRegExp(script) + '-' : ''}`;
      const checkLocalePattern = (p: string) => new RegExp(p, 'i').test(actualLocale);
      if (hasLanguage && !hasCountry) {
        return checkLocalePattern(languagePattern);
      }
      const countryPattern = `${script ? '-' + _.escapeRegExp(script) : ''}-${_.escapeRegExp(lcCountry)}$`;
      if (!hasLanguage && hasCountry) {
        return checkLocalePattern(countryPattern);
      }
      return [languagePattern, countryPattern].every(checkLocalePattern);
    })) ?? false
  );
}

/**
 * Change the state of WiFi on the device under test.
 * Only works for real devices since API 30
 *
 * @param on - True to enable and false to disable it.
 * @param isEmulator - Set it to true if the device under test
 *                                       is an emulator rather than a real device.
 */
export async function setWifiState(this: ADB, on: boolean, isEmulator = false): Promise<void> {
  if (isEmulator) {
    // The svc command does not require to be root since API 26
    await this.shell(['svc', 'wifi', on ? 'enable' : 'disable'], {
      privileged: (await this.getApiLevel()) < 26,
    });
    return;
  }

  await this.shell(['cmd', '-w', 'wifi', 'set-wifi-enabled', on ? 'enabled' : 'disabled']);
}

/**
 * Change the state of Data transfer on the device under test.
 * Only works for real devices since API 30
 *
 * @param on - True to enable and false to disable it.
 * @param isEmulator - Set it to true if the device under test
 *                                       is an emulator rather than a real device.
 */
export async function setDataState(this: ADB, on: boolean, isEmulator = false): Promise<void> {
  if (isEmulator) {
    // The svc command does not require to be root since API 26
    await this.shell(['svc', 'data', on ? 'enable' : 'disable'], {
      privileged: (await this.getApiLevel()) < 26,
    });
    return;
  }

  await this.shell(['cmd', 'phone', 'data', on ? 'enable' : 'disable']);
}

/**
 * Retrieves the list of packages from Doze whitelist on Android 8+
 *
 * @returns The list of whitelisted packages. An example output:
 * system,com.android.shell,2000
 * system,com.google.android.cellbroadcastreceiver,10143
 * user,io.appium.settings,10157
 */
export async function getDeviceIdleWhitelist(this: ADB): Promise<string[]> {
  if ((await this.getApiLevel()) < 23) {
    // Doze mode has only been added since Android 6
    return [];
  }

  log.info('Listing packages in Doze whitelist');
  const output = await this.shell(['dumpsys', 'deviceidle', 'whitelist']);
  return _.trim(output)
    .split(/\n/)
    .map((line) => _.trim(line))
    .filter(Boolean);
}

/**
 * Adds an existing package(s) into the Doze whitelist on Android 8+
 *
 * @param packages One or more packages to add. If the package
 * already exists in the whitelist then it is only going to be added once.
 * If the package with the given name is not installed/not known then an error
 * will be thrown.
 * @returns `true` if the command to add package(s) has been executed
 */
export async function addToDeviceIdleWhitelist(this: ADB, ...packages: string[]): Promise<boolean> {
  if (_.isEmpty(packages) || (await this.getApiLevel()) < 23) {
    // Doze mode has only been added since Android 6
    return false;
  }

  log.info(
    `Adding ${util.pluralize('package', packages.length)} ${JSON.stringify(packages)} to Doze whitelist`,
  );
  await this.shellChunks((pkg) => ['dumpsys', 'deviceidle', 'whitelist', `+${pkg}`], packages);
  return true;
}

/**
 * Check the state of Airplane mode on the device under test.
 *
 * @returns True if Airplane mode is enabled.
 */
export async function isAirplaneModeOn(this: ADB): Promise<boolean> {
  const stdout = await this.getSetting('global', 'airplane_mode_on');
  return parseInt(stdout, 10) !== 0;
  // Alternatively for Android 11+:
  // return (await this.shell(['cmd', 'connectivity', 'airplane-mode'])).stdout.trim() === 'enabled';
}

/**
 * Change the state of Airplane mode in Settings on the device under test.
 *
 * @param on - True to enable the Airplane mode in Settings and false to disable it.
 */
export async function setAirplaneMode(this: ADB, on: boolean): Promise<void> {
  if ((await this.getApiLevel()) < 30) {
    // This requires to call broadcastAirplaneMode afterwards to apply
    await this.setSetting('global', 'airplane_mode_on', on ? 1 : 0);
    return;
  }

  await this.shell(['cmd', 'connectivity', 'airplane-mode', on ? 'enable' : 'disable']);
}

/**
 * Change the state of the bluetooth service on the device under test.
 *
 * @param on - True to enable bluetooth service and false to disable it.
 */
export async function setBluetoothOn(this: ADB, on: boolean): Promise<void> {
  if ((await this.getApiLevel()) < 30) {
    throw new Error('Changing of the bluetooth state is not supported on your device');
  }

  await this.shell(['cmd', 'bluetooth_manager', on ? 'enable' : 'disable']);
}

/**
 * Change the state of the NFC service on the device under test.
 *
 * @param on - True to enable NFC service and false to disable it.
 * @throws If there was an error while changing the service state
 */
export async function setNfcOn(this: ADB, on: boolean): Promise<void> {
  const {stdout, stderr} = (await this.shell(['svc', 'nfc', on ? 'enable' : 'disable'], {
    outputFormat: 'full',
  })) as {stdout: string; stderr: string};
  const output = stderr || stdout;
  log.debug(output);
  if (output.includes('null NfcAdapter')) {
    throw new Error(
      `Cannot turn ${on ? 'on' : 'off'} the NFC adapter. Does the device under test have it?`,
    );
  }
}

/**
 * Broadcast the state of Airplane mode on the device under test.
 * This method should be called after {@link #setAirplaneMode}, otherwise
 * the mode change is not going to be applied for the device.
 * ! This API requires root since Android API 24. Since API 30
 * there is a dedicated adb command to change airplane mode state, which
 * does not require to call this one afterwards.
 *
 * @param on - True to broadcast enable and false to broadcast disable.
 */
export async function broadcastAirplaneMode(this: ADB, on: boolean): Promise<void> {
  const args = [
    'am',
    'broadcast',
    '-a',
    'android.intent.action.AIRPLANE_MODE',
    '--ez',
    'state',
    on ? 'true' : 'false',
  ];
  try {
    await this.shell(args);
  } catch (e) {
    const err = e as ExecError;
    // https://github.com/appium/appium/issues/17422
    if (_.includes(err.stderr, 'SecurityException')) {
      try {
        await this.shell(args, {privileged: true});
        return;
      } catch {}
    }
    throw err;
  }
}

/**
 * Check the state of WiFi on the device under test.
 *
 * @returns True if WiFi is enabled.
 */
export async function isWifiOn(this: ADB): Promise<boolean> {
  const stdout = await this.getSetting('global', 'wifi_on');
  return parseInt(stdout, 10) !== 0;
  // Alternative for Android 11+:
  // return (await this.shell(['cmd', 'wifi', 'status']).stdout.includes('Wifi is enabled'));
}

/**
 * Check the state of Data transfer on the device under test.
 *
 * @returns True if Data transfer is enabled.
 */
export async function isDataOn(this: ADB): Promise<boolean> {
  const stdout = await this.getSetting('global', 'mobile_data');
  return parseInt(stdout, 10) !== 0;
}

/**
 * Check the state of animation on the device under test below:
 *   - animator_duration_scale
 *   - transition_animation_scale
 *   - window_animation_scale
 *
 * @returns True if at least one of animation scale settings
 *                   is not equal to '0.0'.
 */
export async function isAnimationOn(this: ADB): Promise<boolean> {
  return (
    await B.all(
      ANIMATION_SCALE_KEYS.map(async (k) => (await this.getSetting('global', k)) !== '0.0'),
    )
  ).includes(true);
}

/**
 * Set animation scale with the given value via adb shell settings command.
 *   - animator_duration_scale
 *   - transition_animation_scale
 *   - window_animation_scale
 * API level 24 and newer OS versions may change the animation, at least emulators are so.
 * API level 28+ real devices checked this worked, but we haven't checked older ones
 * with real devices.
 *
 * @param value Animation scale value (int or float) to set.
 *                       The minimum value of zero disables animations.
 *                       By increasing the value, animations become slower.
 *                       '1' is the system default animation scale.
 * @throws If the adb setting command raises an exception.
 */
export async function setAnimationScale(this: ADB, value: number): Promise<void> {
  await B.all(ANIMATION_SCALE_KEYS.map((k) => this.setSetting('global', k, value)));
}

/**
 * Retrieve current screen orientation of the device under test.
 *
 * @returns The current orientation encoded as an integer number.
 */
export async function getScreenOrientation(this: ADB): Promise<number | null> {
  const stdout = await this.shell(['dumpsys', 'input']);
  return getSurfaceOrientation(stdout);
}

// #region Private functions

/**
 * Reads SurfaceOrientation in dumpsys output
 *
 * @param dumpsys
 */
function getSurfaceOrientation(dumpsys: string): number | null {
  const m = /SurfaceOrientation: \d/gi.exec(dumpsys);
  return m ? parseInt(m[0].split(':')[1], 10) : null;
}

// #endregion
