import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {node} from '@appium/support';

/**
 * ApiDemos test app constants
 * These constants are used by both unit and functional test suites
 */
export const APIDEMOS_PKG = 'io.appium.android.apis';
export const APIDEMOS_ACTIVITY = 'io.appium.android.apis.ApiDemos';
export const APIDEMOS_ACTIVITY_SHORT = '.ApiDemos';

export const MODULE_ROOT = node.getModuleRootSync('appium-adb', fileURLToPath(import.meta.url))!;
export const FIXTURES_ROOT = path.join(MODULE_ROOT, 'test', 'fixtures');
