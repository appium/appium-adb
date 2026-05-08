import {util} from '@appium/support';

type AnyObject = Record<string, any>;

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
        target[key] = util.isPlainObject(value) || Array.isArray(value) ? cloneDeep(value) : value;
        continue;
      }
      if (util.isPlainObject(current) && util.isPlainObject(value)) {
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
export const zip = <A, B>(
  arrA: readonly A[],
  arrB: readonly B[]
): Array<[A | undefined, B | undefined]> => {
  const length = Math.max(arrA.length, arrB.length);
  return Array.from({length}, (_, idx) => [arrA[idx], arrB[idx]]);
};
export const pick = <T extends AnyObject>(obj: T, keysArg: string[]) =>
  keysArg.reduce((acc, key) => {
    if (key in obj) {
      acc[key] = obj[key];
    }
    return acc;
  }, {} as AnyObject) as Partial<T>;
export const defaultsDeep = <T extends AnyObject>(target: T, ...sources: AnyObject[]): T =>
  _defaultsDeep(target, ...sources) as T;
