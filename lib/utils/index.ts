import * as helpers from './helpers';
import * as lodash from './lodash';
import {util} from '@appium/support';
import {isDeepStrictEqual} from 'node:util';

export const APKS_EXTENSION = helpers.APKS_EXTENSION;
export const APK_EXTENSION = helpers.APK_EXTENSION;
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
export const isArray = Array.isArray;
export const isEmpty = util.isEmpty;
export const flatten = <T>(value: T[][]) => value.flat();
export const isNull = (value: unknown): value is null => value === null;
export const cloneDeep = lodash.cloneDeep;
export const isNil = (value: unknown): value is null | undefined => value == null;
export const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && !Number.isNaN(value);
export const toLower = (value: string) => value.toLowerCase();
export const last = <T>(value: ArrayLike<T>): T | undefined => value[value.length - 1];
export const trim = (value: string) => value.trim();
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
export const uniq = util.uniq;
export const includes = <T>(
  collection: string | ArrayLike<T> | Record<string, T>,
  value: T | string
) => {
  if (typeof collection === 'string') {
    return collection.includes(String(value));
  }
  if (Array.isArray(collection)) {
    return collection.includes(value as T);
  }
  return Object.values(collection).includes(value as T);
};
export const some = <T>(collection: T[], predicate: (item: T) => boolean) =>
  collection.some(predicate);
export const every = <T>(collection: T[], predicate: (item: T) => boolean) =>
  collection.every(predicate);
export const find = <T>(collection: T[], predicate: (item: T) => boolean) =>
  collection.find(predicate);
export const values = <T extends Record<string, any>>(obj: T): Array<T[keyof T]> =>
  Object.values(obj);
export const isInteger = Number.isInteger;
export const isUndefined = (value: unknown): value is undefined => value === undefined;
export const escapeRegExp = util.escapeRegExp;
export const truncate = (value: string, opts?: {length?: number; omission?: string}) =>
  util.truncateString(value, opts);
export const difference = <T>(arr: T[], valuesArg: T[]) =>
  arr.filter((item) => !valuesArg.includes(item));
export const startsWith = (value: string, search: string) => value.startsWith(search);
export const clone = <T>(value: T): T =>
  Array.isArray(value)
    ? ([...value] as T)
    : util.isPlainObject(value)
      ? ({...value} as T)
      : value;
export const defaults = lodash.defaults;
export const intersectionWith = lodash.intersectionWith;
export const isEqual = (left: unknown, right: unknown) => isDeepStrictEqual(left, right);
export const trimEnd = (value: string) => value.trimEnd();
export const trimStart = (value: string) => value.trimStart();
export const keys = Object.keys;
export const zip = lodash.zip;
export const toPairs = <T extends Record<string, any>>(obj: T): [string, T[keyof T]][] =>
  Object.entries(obj);
export const first = <T>(arr: T[]) => arr[0];
export const has = (obj: Record<string, any>, path: string) => path in obj;
export const pick = lodash.pick;
export const defaultsDeep = lodash.defaultsDeep;
export const isNaN = Number.isNaN;
export const isString = (value: unknown): value is string => typeof value === 'string';
export const range = (length: number) => Array.from({length}, (_, idx) => idx);

export type {BuildInstallArgsOptions} from './helpers';
