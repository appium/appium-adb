import {util} from '@appium/support';
import {log} from '../../logger.js';

export interface BuildInstallArgsOptions {
  replace?: boolean;
  allowTestPackages?: boolean;
  useSdcard?: boolean;
  grantPermissions?: boolean;
  partialInstall?: boolean;
}

/**
 * Builds command-line arguments for `adb install`.
 *
 * @param apiLevel - Android API level of the target device
 * @param options - Install options mapped to adb flags
 * @returns A list of install flags
 */
export function buildInstallArgs(
  apiLevel: number,
  options: BuildInstallArgsOptions = {},
): string[] {
  const result: string[] = [];

  if (!util.hasValue(options.replace) || options.replace) {
    result.push('-r');
  }
  if (options.allowTestPackages) {
    result.push('-t');
  }
  if (options.useSdcard) {
    result.push('-s');
  }
  if (options.grantPermissions) {
    if (apiLevel < 23) {
      log.debug(
        `Skipping permissions grant option, since ` +
          `the current API level ${apiLevel} does not support applications ` +
          `permissions customization`,
      );
    } else {
      result.push('-g');
    }
  }
  if (options.partialInstall) {
    result.push('-p');
  }

  return result;
}
