import path from 'node:path';

/**
 * ApiDemos test app constants
 * These constants are used by both unit and functional test suites
 */
export const APIDEMOS_PKG = 'io.appium.android.apis';
export const APIDEMOS_ACTIVITY = 'io.appium.android.apis.ApiDemos';
export const APIDEMOS_ACTIVITY_SHORT = '.ApiDemos';
export const APIDEMOS_PATH = path.resolve(__dirname, 'fixtures', 'ApiDemos-debug.apk');

