import log from '../logger.js';
import { parseJsonData, escapeShellArg } from '../helpers.js';
import _ from 'lodash';
import { util } from 'appium-support';
import { waitForCondition } from 'asyncbox';
import { imap } from 'utf7';

const SETTINGS_HELPER_ID = 'io.appium.settings';
const SETTINGS_HELPER_MAIN_ACTIVITY = '.Settings';
const WIFI_CONNECTION_SETTING_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.WiFiConnectionSettingReceiver`;
const WIFI_CONNECTION_SETTING_ACTION = `${SETTINGS_HELPER_ID}.wifi`;
const DATA_CONNECTION_SETTING_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.DataConnectionSettingReceiver`;
const DATA_CONNECTION_SETTING_ACTION = `${SETTINGS_HELPER_ID}.data_connection`;
const ANIMATION_SETTING_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.AnimationSettingReceiver`;
const ANIMATION_SETTING_ACTION = `${SETTINGS_HELPER_ID}.animation`;
const LOCALE_SETTING_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.LocaleSettingReceiver`;
const LOCALE_SETTING_ACTION = `${SETTINGS_HELPER_ID}.locale`;
const LOCATION_SERVICE = `${SETTINGS_HELPER_ID}/.LocationService`;
const LOCATION_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.LocationInfoReceiver`;
const LOCATION_RETRIEVAL_ACTION = `${SETTINGS_HELPER_ID}.location`;
const CLIPBOARD_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.ClipboardReceiver`;
const CLIPBOARD_RETRIEVAL_ACTION = `${SETTINGS_HELPER_ID}.clipboard.get`;
const NOTIFICATIONS_RETRIEVAL_ACTION = `${SETTINGS_HELPER_ID}.notifications`;
const SMS_LIST_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.SmsReader`;
const SMS_LIST_RETRIEVAL_ACTION = `${SETTINGS_HELPER_ID}.sms.read`;
const APPIUM_IME = `${SETTINGS_HELPER_ID}/.AppiumIME`;
const UNICODE_IME = `${SETTINGS_HELPER_ID}/.UnicodeIME`;


const commands = {};

/**
 * @typedef {Object} SettingsAppStartupOptions
 * @property {number} timeout [5000] The maximum number of milliseconds
 * to wait until the app has started
 */

/**
 * Ensures that Appium Settings helper application is running
 * and starts it if necessary
 *
 * @param {SettingsAppStartupOptions} opts
 * @throws {Error} If Appium Settings has failed to start
 * @returns {ADB} self instance for chaining
 */
commands.requireRunningSettingsApp = async function requireRunningSettingsApp (opts = {}) {
  if (await this.processExists(SETTINGS_HELPER_ID)) {
    return this;
  }

  log.debug('Starting Appium Settings app');
  const {
    timeout = 5000,
  } = opts;
  await this.startApp({
    pkg: SETTINGS_HELPER_ID,
    activity: SETTINGS_HELPER_MAIN_ACTIVITY,
    action: 'android.intent.action.MAIN',
    category: 'android.intent.category.LAUNCHER',
    stopApp: false,
    waitForLaunch: false,
  });
  try {
    await waitForCondition(async () => await this.processExists(SETTINGS_HELPER_ID), {
      waitMs: timeout,
      intervalMs: 300,
    });
    return this;
  } catch (err) {
    throw new Error(`Appium Settings app is not running after ${timeout}ms`);
  }
};

/**
 * Change the state of WiFi on the device under test.
 *
 * @param {boolean} on - True to enable and false to disable it.
 * @param {boolean} isEmulator [false] - Set it to true if the device under test
 *                                       is an emulator rather than a real device.
 */
commands.setWifiState = async function setWifiState (on, isEmulator = false) {
  if (isEmulator) {
    // The svc command does not require to be root since API 26
    await this.shell(['svc', 'wifi', on ? 'enable' : 'disable'], {
      privileged: await this.getApiLevel() < 26,
    });
  } else {
    await this.shell([
      'am', 'broadcast',
      '-a', WIFI_CONNECTION_SETTING_ACTION,
      '-n', WIFI_CONNECTION_SETTING_RECEIVER,
      '--es', 'setstatus', on ? 'enable' : 'disable'
    ]);
  }
};

/**
 * Change the state of Data transfer on the device under test.
 *
 * @param {boolean} on - True to enable and false to disable it.
 * @param {boolean} isEmulator [false] - Set it to true if the device under test
 *                                       is an emulator rather than a real device.
 */
commands.setDataState = async function setDataState (on, isEmulator = false) {
  if (isEmulator) {
    // The svc command does not require to be root since API 26
    await this.shell(['svc', 'data', on ? 'enable' : 'disable'], {
      privileged: await this.getApiLevel() < 26,
    });
  } else {
    await this.shell([
      'am', 'broadcast',
      '-a', DATA_CONNECTION_SETTING_ACTION,
      '-n', DATA_CONNECTION_SETTING_RECEIVER,
      '--es', 'setstatus', on ? 'enable' : 'disable'
    ]);
  }
};

/**
 * Change the state of animation on the device under test.
 * Animation on the device is controlled by the following global properties:
 * [ANIMATOR_DURATION_SCALE]{@link https://developer.android.com/reference/android/provider/Settings.Global.html#ANIMATOR_DURATION_SCALE},
 * [TRANSITION_ANIMATION_SCALE]{@link https://developer.android.com/reference/android/provider/Settings.Global.html#TRANSITION_ANIMATION_SCALE},
 * [WINDOW_ANIMATION_SCALE]{@link https://developer.android.com/reference/android/provider/Settings.Global.html#WINDOW_ANIMATION_SCALE}.
 * This method sets all this properties to 0.0 to disable (1.0 to enable) animation.
 *
 * Turning off animation might be useful to improve stability
 * and reduce tests execution time.
 *
 * @param {boolean} on - True to enable and false to disable it.
 */
commands.setAnimationState = async function setAnimationState (on) {
  await this.shell([
    'am', 'broadcast',
    '-a', ANIMATION_SETTING_ACTION,
    '-n', ANIMATION_SETTING_RECEIVER,
    '--es', 'setstatus', on ? 'enable' : 'disable'
  ]);
};

/**
 * Change the locale on the device under test. Don't need to reboot the device after changing the locale.
 * This method sets an arbitrary locale following:
 *   https://developer.android.com/reference/java/util/Locale.html
 *   https://developer.android.com/reference/java/util/Locale.html#Locale(java.lang.String,%20java.lang.String)
 *
 * @param {string} language - Language. e.g. en, ja
 * @param {string} country - Country. e.g. US, JP
 * @param {?string} script - Script. e.g. Hans in `zh-Hans-CN`
 */
commands.setDeviceSysLocaleViaSettingApp = async function setDeviceSysLocaleViaSettingApp (language, country, script = null) {
  const params = [
    'am', 'broadcast',
    '-a', LOCALE_SETTING_ACTION,
    '-n', LOCALE_SETTING_RECEIVER,
    '--es', 'lang', language.toLowerCase(),
    '--es', 'country', country.toUpperCase()
  ];

  if (script) {
    params.push('--es', 'script', script);
  }

  await this.shell(params);
};


/**
 * @typedef {Object} Location
 * @property {number|string} longitude - Valid longitude value.
 * @property {number|string} latitude - Valid latitude value.
 * @property {?number|string} altitude - Valid altitude value.
 * @property {?number|string} speed - Valid speed value. Should be greater than 0.0 meters/second.
 */

/**
 * Emulate geolocation coordinates on the device under test.
 *
 * @param {Location} location - Location object. The `altitude` value is ignored
 * while mocking the position.
 * @param {boolean} isEmulator [false] - Set it to true if the device under test
 *                                       is an emulator rather than a real device.
 */
commands.setGeoLocation = async function setGeoLocation (location, isEmulator = false) {
  const formatLocationValue = (valueName, isRequired = true) => {
    if (!util.hasValue(location[valueName])) {
      if (isRequired) {
        throw new Error(`${valueName} must be provided`);
      }
      return null;
    }
    const floatValue = parseFloat(location[valueName]);
    if (!isNaN(floatValue)) {
      return `${_.ceil(floatValue, 5)}`;
    }
    if (isRequired) {
      throw new Error(`${valueName} is expected to be a valid float number. ` +
        `'${location[valueName]}' is given instead`);
    }
    return null;
  };
  const longitude = formatLocationValue('longitude');
  const latitude = formatLocationValue('latitude');
  const altitude = formatLocationValue('altitude', false);
  const speed = formatLocationValue('speed', false);
  if (isEmulator) {
    await this.resetTelnetAuthToken();
    await this.adbExec(['emu', 'geo', 'fix', longitude, latitude]);
    // A workaround for https://code.google.com/p/android/issues/detail?id=206180
    await this.adbExec(['emu', 'geo', 'fix', longitude.replace('.', ','), latitude.replace('.', ',')]);
  } else {
    const args = [
      'am', 'startservice',
      '-e', 'longitude', longitude,
      '-e', 'latitude', latitude,
    ];
    if (util.hasValue(altitude)) {
      args.push('-e', 'altitude', altitude);
    }
    if (util.hasValue(speed)) {
      args.push('-e', 'speed', speed);
    }
    args.push(LOCATION_SERVICE);
    await this.shell(args);
  }
};

/**
 * Get the current geo location from the device under test.
 *
 * @returns {Location} The current location
 * @throws {Error} If the current location cannot be retrieved
 */
commands.getGeoLocation = async function getGeoLocation () {
  let output;
  try {
    output = await this.shell([
      'am', 'broadcast',
      '-n', LOCATION_RECEIVER,
      '-a', LOCATION_RETRIEVAL_ACTION,
    ]);
  } catch (err) {
    throw new Error(`Cannot retrieve the current geo coordinates from the device. ` +
      `Make sure the Appium Settings application is up to date and has location permissions. Also the location ` +
      `services must be enabled on the device. Original error: ${err.message}`);
  }

  const match = /data="(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)"/.exec(output);
  if (!match) {
    throw new Error(`Cannot parse the actual location values from the command output: ${output}`);
  }
  const location = {
    latitude: match[1],
    longitude: match[2],
    altitude: match[3],
  };
  log.debug(`Got geo coordinates: ${JSON.stringify(location)}`);
  return location;
};

/**
 * Performs the given editor action on the focused input field.
 * This method requires Appium Settings helper to be installed on the device.
 * No exception is thrown if there was a failure while performing the action.
 * You must investigate the logcat output if something did not work as expected.
 *
 * @param {string|number} action - Either action code or name. The following action
 *                                 names are supported: `normal, unspecified, none,
 *                                 go, search, send, next, done, previous`
 */
commands.performEditorAction = async function performEditorAction (action) {
  log.debug(`Performing editor action: ${action}`);
  await this.runInImeContext(APPIUM_IME,
    async () => await this.shell(['input', 'text', `/${action}/`]));
};


/**
 * Retrieves the text content of the device's clipboard.
 * The method works for Android below and above 29.
 * It temorarily enforces the IME setting in order to workaround
 * security limitations if needed.
 * This method only works if Appium Settings v. 2.15+ is installed
 * on the device under test
 *
 * @returns {string} The actual content of the main clipboard as
 * base64-encoded string or an empty string if the clipboard is empty
 * @throws {Error} If there was a problem while getting the
 * clipboard contant
 */
commands.getClipboard = async function getClipboard () {
  log.debug('Getting the clipboard content');
  const retrieveClipboard = async () => await this.shell([
    'am', 'broadcast',
    '-n', CLIPBOARD_RECEIVER,
    '-a', CLIPBOARD_RETRIEVAL_ACTION,
  ]);
  let output;
  try {
    output = (await this.getApiLevel() >= 29)
      ? (await this.runInImeContext(APPIUM_IME, retrieveClipboard))
      : (await retrieveClipboard());
  } catch (err) {
    throw new Error(`Cannot retrieve the current clipboard content from the device. ` +
      `Make sure the Appium Settings application is up to date. ` +
      `Original error: ${err.message}`);
  }

  const match = /data="([^"]*)"/.exec(output);
  if (!match) {
    throw new Error(`Cannot parse the actual cliboard content from the command output: ${output}`);
  }
  return _.trim(match[1]);
};

/**
 * Retrieves Android notifications via Appium Settings helper.
 * Appium Settings app itself must be *manually* granted to access notifications
 * under device Settings in order to make this feature working.
 * Appium Settings helper keeps all the active notifications plus
 * notifications that appeared while it was running in the internal buffer,
 * but no more than 100 items altogether. Newly appeared notifications
 * are always added to the head of the notifications array.
 * The `isRemoved` flag is set to `true` for notifications that have been removed.
 *
 * See https://developer.android.com/reference/android/service/notification/StatusBarNotification
 * and https://developer.android.com/reference/android/app/Notification.html
 * for more information on available notification properties and their values.
 *
 * @returns {Object} The example output is:
 * ```json
 * {
 *   "statusBarNotifications":[
 *     {
 *       "isGroup":false,
 *       "packageName":"io.appium.settings",
 *       "isClearable":false,
 *       "isOngoing":true,
 *       "id":1,
 *       "tag":null,
 *       "notification":{
 *         "title":null,
 *         "bigTitle":"Appium Settings",
 *         "text":null,
 *         "bigText":"Keep this service running, so Appium for Android can properly interact with several system APIs",
 *         "tickerText":null,
 *         "subText":null,
 *         "infoText":null,
 *         "template":"android.app.Notification$BigTextStyle"
 *       },
 *       "userHandle":0,
 *       "groupKey":"0|io.appium.settings|1|null|10133",
 *       "overrideGroupKey":null,
 *       "postTime":1576853518850,
 *       "key":"0|io.appium.settings|1|null|10133",
 *       "isRemoved":false
 *     }
 *   ]
 * }
 * ```
 * @throws {Error} If there was an error while getting the notifications list
 */
commands.getNotifications = async function getNotifications () {
  log.debug('Retrieving notifications');
  // Somehow providing the `-n` arg to the `am` underneath
  // renders the broadcast to fail instead of starting the
  // Appium Settings app. This only happens to the notifications
  // receiver
  await this.requireRunningSettingsApp();
  let output;
  try {
    output = await this.shell([
      'am', 'broadcast',
      '-a', NOTIFICATIONS_RETRIEVAL_ACTION,
    ]);
  } catch (err) {
    throw new Error(`Cannot retrieve notifications from the device. ` +
      `Make sure the Appium Settings application is installed and is up to date. ` +
      `Original error: ${err.message}`);
  }
  return parseJsonData(output, 'notifications');
};

/**
 * @typedef {Object} SmsListOptions
 * @property {number} max [100] - The maximum count of recent messages
 * to retrieve
 */

/**
 * Retrieves the list of the most recent SMS
 * properties list via Appium Settings helper.
 * Messages are sorted by date in descending order.
 *
 * @param {SmsListOptions} opts
 * @returns {Object} The example output is:
 * ```json
 * {
 *   "items":[
 *     {
 *       "id":"2",
 *       "address":"+123456789",
 *       "person":null,
 *       "date":"1581936422203",
 *       "read":"0",
 *       "status":"-1",
 *       "type":"1",
 *       "subject":null,
 *       "body":"\"text message2\"",
 *       "serviceCenter":null
 *     },
 *     {
 *       "id":"1",
 *       "address":"+123456789",
 *       "person":null,
 *       "date":"1581936382740",
 *       "read":"0",
 *       "status":"-1",
 *       "type":"1",
 *       "subject":null,
 *       "body":"\"text message\"",
 *       "serviceCenter":null
 *     }
 *   ],
 *   "total":2
 * }
 * ```
 * @throws {Error} If there was an error while getting the SMS list
 */
commands.getSmsList = async function getSmsList (opts = {}) {
  log.debug('Retrieving the recent SMS messages');
  const args = [
    'am', 'broadcast',
    '-n', SMS_LIST_RECEIVER,
    '-a', SMS_LIST_RETRIEVAL_ACTION,
  ];
  if (opts.max) {
    args.push('--es', 'max', opts.max);
  }
  let output;
  try {
    output = await this.shell(args);
  } catch (err) {
    throw new Error(`Cannot retrieve SMS list from the device. ` +
      `Make sure the Appium Settings application is installed and is up to date. ` +
      `Original error: ${err.message}`);
  }
  return parseJsonData(output, 'SMS list');
};

/**
 * Types the given Unicode string.
 * It is expected that the focus is already put
 * to the destination input field before this method is called.
 *
 * @param {string} text The string to type
 * @returns {boolean} `true` if the input text has been successfully sent to adb
 */
commands.typeUnicode = async function typeUnicode (text) {
  if (_.isNil(text)) {
    return false;
  }

  text = `${text}`;
  log.debug(`Typing ${util.pluralize('character', text.length, true)}`);
  if (!text) {
    return false;
  }
  await this.runInImeContext(UNICODE_IME,
    async () => await this.shell(['input', 'text', escapeShellArg(imap.encode(text))]));
  return true;
};

export default commands;
