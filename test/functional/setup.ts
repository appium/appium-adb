import path from 'node:path';
import {fs, net} from '@appium/support';
import type {ADB} from '../../lib/adb.js';
import {FIXTURES_ROOT} from '../constants.js';
export const E2E_TIMEOUT = process.env.CI ? 240000 : 60000;
export const E2E_LONG_TIMEOUT = E2E_TIMEOUT * 10;

// Re-export ApiDemos constants from common constants file
export {APIDEMOS_PKG, APIDEMOS_ACTIVITY, APIDEMOS_ACTIVITY_SHORT} from '../constants.js';

const APIDEMOS_URL =
  'https://github.com/appium/android-apidemos/releases/download/v6.0.0/ApiDemos-debug.apk';
const APIDEMOS_CACHE_PATH = path.resolve(FIXTURES_ROOT, 'ApiDemos-debug.apk');

// Cache the download promise to prevent concurrent downloads
let downloadPromise: Promise<string> | null = null;

/**
 * Downloads and caches the ApiDemos APK from GitHub if it doesn't already exist locally.
 * This function handles concurrent requests by reusing the same download promise.
 *
 * @returns The path to the cached APK file
 * @throws If the download fails
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

/**
 * Ensures the device has root access, skipping the test if root cannot be obtained.
 * This is useful for tests that require root privileges (e.g., killing processes).
 *
 * @param adb - The ADB instance
 * @returns True if root access is available, false if test was skipped
 */
export async function ensureRootAccess(adb: ADB): Promise<boolean> {
  const hasRoot = await adb.isRoot().catch(() => false);
  if (!hasRoot) {
    // Try to get root, but skip if it fails
    const rootResult = await adb.root();
    if (!rootResult.isSuccessful) {
      return false;
    }
  }
  return true;
}
