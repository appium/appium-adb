import * as helpers from './helpers';
import * as lodash from './lodash';
import {util} from '@appium/support';

export const APKS_EXTENSION = helpers.APKS_EXTENSION;
export const APK_INSTALL_TIMEOUT = helpers.APK_INSTALL_TIMEOUT;
export const DEFAULT_ADB_EXEC_TIMEOUT = helpers.DEFAULT_ADB_EXEC_TIMEOUT;
export const buildInstallArgs = helpers.buildInstallArgs;
export const readPackageManifest = helpers.readPackageManifest;
export const getResourcePath = helpers.getResourcePath;
export const unzipFile = helpers.unzipFile;
export const getSdkRootFromEnv = helpers.getSdkRootFromEnv;
export const requireSdkRoot = helpers.requireSdkRoot;
export const getJavaHome = helpers.getJavaHome;
export const getJavaForOs = helpers.getJavaForOs;

export const memoize = util.memoize;
export const cloneDeep = lodash.cloneDeep;
export const defaults = lodash.defaults;
export const intersectionWith = lodash.intersectionWith;
export const zip = lodash.zip;
export const pick = lodash.pick;
export const defaultsDeep = lodash.defaultsDeep;

export type {BuildInstallArgsOptions} from './helpers';
