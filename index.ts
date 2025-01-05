import {install} from 'source-map-support';
install();

export * from './lib/adb';
export {getAndroidBinaryPath} from './lib/tools/system-calls';
export {getSdkRootFromEnv} from './lib/helpers';
export type * from './lib/tools/types';
export type * from './lib/types';

import {ADB} from './lib/adb';
export default ADB;
