import {util} from '@appium/support';
import {isDeepStrictEqual} from 'node:util';

type AnyObject = Record<string, any>;

const isPlainObject = (value: unknown): value is AnyObject =>
  Object.prototype.toString.call(value) === '[object Object]';

export const cloneDeep = <T>(value: T): T => {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

export const defaults = (target: AnyObject, ...sources: AnyObject[]): AnyObject => {
  for (const source of sources) {
    if (!source) {
      continue;
    }
    for (const [key, value] of Object.entries(source)) {
      if (target[key] === undefined) {
        target[key] = value;
      }
    }
  }
  return target;
};

const _defaultsDeep = (target: AnyObject, ...sources: AnyObject[]): AnyObject => {
  for (const source of sources) {
    if (!source) {
      continue;
    }
    for (const [key, value] of Object.entries(source)) {
      const current = target[key];
      if (current === undefined) {
        target[key] = isPlainObject(value) || Array.isArray(value) ? cloneDeep(value) : value;
        continue;
      }
      if (isPlainObject(current) && isPlainObject(value)) {
        _defaultsDeep(current, value);
      }
    }
  }
  return target;
};

export const intersectionWith = <T>(
  first: T[],
  second: T[],
  comparator: (left: T, right: T) => boolean
): T[] => first.filter((item) => second.some((other) => comparator(item, other)));

export const memoize = util.memoize;
export const isArray = Array.isArray;
export const isEmpty = util.isEmpty;
export const flatten = <T>(value: T[][]) => value.flat();
export const isNull = (value: unknown): value is null => value === null;
export const isNil = (value: unknown): value is null | undefined => value == null;
export const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && !Number.isNaN(value);
export const toLower = (value: string) => value.toLowerCase();
export const last = <T>(value: ArrayLike<T>): T | undefined => value[value.length - 1];
export const trim = (value: string) => value.trim();
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
export const uniq = util.uniq;
export const includes = <T>(collection: string | ArrayLike<T> | AnyObject, value: T | string) => {
  if (typeof collection === 'string') {
    return collection.includes(String(value));
  }
  if (Array.isArray(collection)) {
    return collection.includes(value as T);
  }
  return Object.values(collection).includes(value);
};
export const some = <T>(collection: T[], predicate: (item: T) => boolean) =>
  collection.some(predicate);
export const every = <T>(collection: T[], predicate: (item: T) => boolean) =>
  collection.every(predicate);
export const find = <T>(collection: T[], predicate: (item: T) => boolean) =>
  collection.find(predicate);
export const values = <T extends AnyObject>(obj: T): Array<T[keyof T]> => Object.values(obj);
export const isInteger = Number.isInteger;
export const isUndefined = (value: unknown): value is undefined => value === undefined;
export const escapeRegExp = util.escapeRegExp;
export const truncate = (value: string, opts?: {length?: number; omission?: string}) =>
  util.truncateString(value, opts);
export const difference = <T>(arr: T[], valuesArg: T[]) =>
  arr.filter((item) => !valuesArg.includes(item));
export const startsWith = (value: string, search: string) => value.startsWith(search);
export const clone = <T>(value: T): T =>
  Array.isArray(value) ? ([...value] as T) : isPlainObject(value) ? ({...value} as T) : value;
export const isEqual = (left: unknown, right: unknown) => isDeepStrictEqual(left, right);
export const trimEnd = (value: string) => value.trimEnd();
export const trimStart = (value: string) => value.trimStart();
export const keys = Object.keys;
export const zip = <A, B>(
  arrA: readonly A[],
  arrB: readonly B[]
): Array<[A | undefined, B | undefined]> => {
  const length = Math.max(arrA.length, arrB.length);
  return Array.from({length}, (_, idx) => [arrA[idx], arrB[idx]]);
};
export const toPairs = <T extends AnyObject>(obj: T): [string, T[keyof T]][] => Object.entries(obj);
export const first = <T>(arr: T[]) => arr[0];
export const has = (obj: AnyObject, path: string) => path in obj;
export const pick = <T extends AnyObject>(obj: T, keysArg: string[]) =>
  keysArg.reduce((acc, key) => {
    if (key in obj) {
      acc[key] = obj[key];
    }
    return acc;
  }, {} as AnyObject) as Partial<T>;
export const defaultsDeep = <T extends AnyObject>(target: T, ...sources: AnyObject[]): T =>
  _defaultsDeep(target, ...sources) as T;
export const isNaN = Number.isNaN;
export const isString = (value: unknown): value is string => typeof value === 'string';
export const range = (length: number) => Array.from({length}, (_, idx) => idx);
