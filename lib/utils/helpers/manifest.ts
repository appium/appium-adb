import {util} from '@appium/support';
import {exec, type ExecError} from 'teen_process';
import {log} from '../../logger.js';
import type {ADB} from '../../adb.js';
import type {ApkManifest} from '../../tools/types.js';

/**
 * Reads and parses Android manifest metadata from an APK via `aapt2`.
 *
 * @param apkPath - Local path to the APK file
 * @returns Parsed manifest data
 */
export async function readPackageManifest(this: ADB, apkPath: string): Promise<ApkManifest> {
  await this.initAapt2();
  const aapt2Binary = this.binaries?.aapt2;
  if (!aapt2Binary) {
    throw new Error('aapt2 binary is not available');
  }

  const args = ['dump', 'badging', apkPath];
  log.debug(`Reading package manifest: '${util.quote([aapt2Binary, ...args])}'`);
  let stdout: string;
  try {
    ({stdout} = await exec(aapt2Binary, args));
  } catch (e: unknown) {
    const error = e as ExecError;
    const prefix = `Cannot read the manifest from '${apkPath}'`;
    const suffix = `Original error: ${error.stderr || error.message}`;
    if (error.stderr && error.stderr.includes(`Unable to open 'badging'`)) {
      throw new Error(`${prefix}. Update build tools to use a newer aapt2 version. ${suffix}`, {
        cause: e,
      });
    }
    throw new Error(`${prefix}. ${suffix}`, {cause: e});
  }

  const extractValue = (
    line: string,
    propPattern: RegExp,
    valueTransformer: ((x: string) => any) | null,
  ): any => {
    const match = propPattern.exec(line);
    if (match) {
      return valueTransformer ? valueTransformer(match[1]) : match[1];
    }
    return undefined;
  };
  const extractArray = (
    line: string,
    propPattern: RegExp,
    valueTransformer: ((x: string) => any) | null,
  ): any[] => {
    let match: RegExpExecArray | null;
    const resultArray: any[] = [];
    while ((match = propPattern.exec(line))) {
      resultArray.push(valueTransformer ? valueTransformer(match[1]) : match[1]);
    }
    return resultArray;
  };

  const toInt = (x: string): number => parseInt(x, 10);

  const result: ApkManifest = {
    name: '',
    versionCode: 0,
    minSdkVersion: 0,
    compileSdkVersion: 0,
    usesPermissions: [],
    launchableActivity: {
      name: '',
    },
    architectures: [],
    locales: [],
    densities: [],
  };
  for (const line of stdout.split('\n')) {
    if (line.startsWith('package:')) {
      for (const [name, pattern, transformer] of [
        ['name', /name='([^']+)'/, null],
        ['versionCode', /versionCode='([^']+)'/, toInt],
        ['versionName', /versionName='([^']+)'/, null],
        ['platformBuildVersionName', /platformBuildVersionName='([^']+)'/, null],
        ['platformBuildVersionCode', /platformBuildVersionCode='([^']+)'/, toInt],
        ['compileSdkVersion', /compileSdkVersion='([^']+)'/, toInt],
        ['compileSdkVersionCodename', /compileSdkVersionCodename='([^']+)'/, null],
      ] as const) {
        const value = extractValue(line, pattern, transformer);
        if (value !== undefined) {
          (result as Record<string, any>)[name] = value;
        }
      }
    } else if (line.startsWith('sdkVersion:') || line.startsWith('minSdkVersion:')) {
      const value = extractValue(line, /[sS]dkVersion:'([^']+)'/, toInt);
      if (value) {
        result.minSdkVersion = value;
      }
    } else if (line.startsWith('targetSdkVersion:')) {
      const value = extractValue(line, /targetSdkVersion:'([^']+)'/, toInt);
      if (value) {
        result.targetSdkVersion = value;
      }
    } else if (line.startsWith('uses-permission:')) {
      const value = extractValue(line, /name='([^']+)'/, null);
      if (value) {
        result.usesPermissions.push(value);
      }
    } else if (line.startsWith('launchable-activity:')) {
      for (const [name, pattern] of [
        ['name', /name='([^']+)'/],
        ['label', /label='([^']+)'/],
        ['icon', /icon='([^']+)'/],
      ] as const) {
        const value = extractValue(line, pattern, null);
        if (value) {
          (result.launchableActivity as Record<string, any>)[name] = value;
        }
      }
    } else if (line.startsWith('locales:')) {
      result.locales = extractArray(line, /'([^']+)'/g, null) as string[];
    } else if (line.startsWith('native-code:')) {
      result.architectures = extractArray(line, /'([^']+)'/g, null) as string[];
    } else if (line.startsWith('densities:')) {
      result.densities = extractArray(line, /'([^']+)'/g, toInt) as number[];
    }
  }
  return result;
}
