/* eslint-disable import/no-unresolved */
import {install} from 'source-map-support';

install();

import {ADB, DEFAULT_ADB_PORT, getAndroidBinaryPath, getSdkRootFromEnv} from './lib/adb';

export * from './lib/mixins';
// export various typedefs; these should probably be moved
export * from './lib/tools/apk-utils';

export {ADB, DEFAULT_ADB_PORT, getAndroidBinaryPath, getSdkRootFromEnv};
export default ADB;
