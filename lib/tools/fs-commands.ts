import _ from 'lodash';
import path from 'path';
import type {ADB} from '../adb.js';
import type {TeenProcessExecOptions} from 'teen_process';

/**
 * Verify whether a remote path exists on the device under test.
 *
 * @param remotePath - The remote path to verify.
 * @return True if the given path exists on the device.
 */
export async function fileExists(this: ADB, remotePath: string): Promise<boolean> {
  const passFlag = '__PASS__';
  const checkCmd = `[ -e '${remotePath.replace(/'/g, `\\'`)}' ] && echo ${passFlag}`;
  try {
    return _.includes(await this.shell([checkCmd]), passFlag);
  } catch {
    return false;
  }
}

/**
 * Get the output of _ls_ command on the device under test.
 *
 * @param remotePath - The remote path (the first argument to the _ls_ command).
 * @param opts - Additional _ls_ options.
 * @return The _ls_ output as an array of split lines.
 *                          An empty array is returned of the given _remotePath_
 *                          does not exist.
 */
export async function ls(this: ADB, remotePath: string, opts: string[] = []): Promise<string[]> {
  try {
    const args = ['ls', ...opts, remotePath];
    const stdout = await this.shell(args);
    const lines = stdout.split('\n');
    return lines
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => l.indexOf('No such file') === -1);
  } catch (err) {
    if ((err as Error).message.indexOf('No such file or directory') === -1) {
      throw err;
    }
    return [];
  }
}

/**
 * Get the size of the particular file located on the device under test.
 *
 * @param remotePath - The remote path to the file.
 * @return File size in bytes.
 * @throws {Error} If there was an error while getting the size of the given file.
 */
export async function fileSize(this: ADB, remotePath: string): Promise<number> {
  try {
    const files = await this.ls(remotePath, ['-la']);
    if (files.length !== 1) {
      throw new Error(`Remote path is not a file`);
    }
    // https://regex101.com/r/fOs4P4/8
    const match = /[rwxsStT\-+]{10}[\s\d]*\s[^\s]+\s+[^\s]+\s+(\d+)/.exec(files[0]);
    if (!match || _.isNaN(parseInt(match[1], 10))) {
      throw new Error(`Unable to parse size from list output: '${files[0]}'`);
    }
    return parseInt(match[1], 10);
  } catch (err) {
    throw new Error(`Unable to get file size for '${remotePath}': ${(err as Error).message}`);
  }
}

/**
 * Forcefully recursively remove a path on the device under test.
 * Be careful while calling this method.
 *
 * @param path - The path to be removed recursively.
 */
export async function rimraf(this: ADB, path: string): Promise<void> {
  await this.shell(['rm', '-rf', path]);
}

/**
 * Send a file to the device under test.
 *
 * @param localPath - The path to the file on the local file system.
 * @param remotePath - The destination path on the remote device.
 * @param opts - Additional options mapping. See
 *                        https://github.com/appium/node-teen_process,
 *                        _exec_ method options, for more information about available
 *                        options.
 */
export async function push(
  this: ADB,
  localPath: string,
  remotePath: string,
  opts?: TeenProcessExecOptions,
): Promise<void> {
  await this.mkdir(path.posix.dirname(remotePath));
  await this.adbExec(['push', localPath, remotePath], opts);
}

/**
 * Receive a file from the device under test.
 *
 * @param remotePath - The source path on the remote device.
 * @param localPath - The destination path to the file on the local file system.
 * @param opts - Additional options mapping. See
 * https://github.com/appium/node-teen_process,
 * _exec_ method options, for more information about available
 * options.
 */
export async function pull(
  this: ADB,
  remotePath: string,
  localPath: string,
  opts: TeenProcessExecOptions = {},
): Promise<void> {
  // pull folder can take more time, increasing time out to 60 secs
  await this.adbExec(['pull', remotePath, localPath], {...opts, timeout: opts.timeout ?? 60000});
}

/**
 * Recursively create a new folder on the device under test.
 *
 * @param remotePath - The new path to be created.
 * @return mkdir command output.
 */
export async function mkdir(this: ADB, remotePath: string): Promise<string> {
  return /\s+/.test(remotePath)
    ? await this.shell([`mkdir -p '${remotePath.replace(/'/g, `\\'`)}'`])
    : await this.shell(['mkdir', '-p', remotePath]);
}

