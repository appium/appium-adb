import path from 'node:path';
import { fs, net } from '@appium/support';

// https://developer.android.com/guide/topics/manifest/uses-sdk-element.html
const API_LEVEL_MAP = {
  4.1: '16',
  4.2: '17',
  4.3: '18',
  4.4: '19',
  5: '21',
  5.1: '22',
  6: '23',
  7: '24',
  7.1: '25',
  8.0: '26',
  8.1: '27',
  9: '28',
  10: '29',
  11: '30',
  12: '32', // and 31
  13: '33',
  14: '34',
  15: '35',
  16: '36',
};

export const avdName = process.env.ANDROID_AVD || 'NEXUS_S_18_X86';
export const platformVersion = process.env.PLATFORM_VERSION || 4.3;

export const apiLevel = parseInt(process.env.ANDROID_SDK_VERSION
  || process.env.API_LEVEL
  || API_LEVEL_MAP[platformVersion], 10);

export const MOCHA_TIMEOUT = process.env.CI ? 240000 : 60000;
export const MOCHA_LONG_TIMEOUT = MOCHA_TIMEOUT * 10;

// Re-export ApiDemos constants from common constants file
export { APIDEMOS_PKG, APIDEMOS_ACTIVITY, APIDEMOS_ACTIVITY_SHORT } from '../constants.js';

const APIDEMOS_URL = 'https://github.com/appium/android-apidemos/releases/download/v6.0.0/ApiDemos-debug.apk';
const APIDEMOS_CACHE_PATH = path.resolve(__dirname, '..', 'fixtures', 'ApiDemos-debug.apk');

// Cache the download promise to prevent concurrent downloads
let downloadPromise = null;

/**
 * Downloads and caches the ApiDemos APK from GitHub if it doesn't already exist locally.
 * This function handles concurrent requests by reusing the same download promise.
 *
 * @returns {Promise<string>} The path to the cached APK file
 * @throws {Error} If the download fails
 */
export async function getApiDemosPath() {
  // If a download is already in progress, wait for it first
  // This prevents returning a partially downloaded file
  if (downloadPromise) {
    return downloadPromise;
  }

  // Check if the APK already exists locally (only after ensuring no download is in progress)
  if (await fs.exists(APIDEMOS_CACHE_PATH)) {
    return APIDEMOS_CACHE_PATH;
  }

  // Start the download
  downloadPromise = (async () => {
    try {
      // Double-check if file exists (another process might have downloaded it)
      if (await fs.exists(APIDEMOS_CACHE_PATH)) {
        return APIDEMOS_CACHE_PATH;
      }

      // Ensure the fixtures directory exists
      const fixturesDir = path.dirname(APIDEMOS_CACHE_PATH);
      await fs.mkdir(fixturesDir, {recursive: true});

      // Download the APK
      await net.downloadFile(APIDEMOS_URL, APIDEMOS_CACHE_PATH);

      return APIDEMOS_CACHE_PATH;
    } finally {
      // Clear the promise so future calls can download again if needed
      downloadPromise = null;
    }
  })();

  return downloadPromise;
}
