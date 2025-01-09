import _ from 'lodash';
import path from 'path';

/**
 * Verify whether a remote path exists on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} remotePath - The remote path to verify.
 * @return {Promise<boolean>} True if the given path exists on the device.
 */
export async function fileExists (remotePath) {
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
 * @this {import('../adb.js').ADB}
 * @param {string} remotePath - The remote path (the first argument to the _ls_ command).
 * @param {string[]} [opts] - Additional _ls_ options.
 * @return {Promise<string[]>} The _ls_ output as an array of split lines.
 *                          An empty array is returned of the given _remotePath_
 *                          does not exist.
 */
export async function ls (remotePath, opts = []) {
  try {
    let args = ['ls', ...opts, remotePath];
    let stdout = await this.shell(args);
    let lines = stdout.split('\n');
    return lines.map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => l.indexOf('No such file') === -1);
  } catch (err) {
    if (err.message.indexOf('No such file or directory') === -1) {
      throw err;
    }
    return [];
  }
}

/**
 * Get the size of the particular file located on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} remotePath - The remote path to the file.
 * @return {Promise<number>} File size in bytes.
 * @throws {Error} If there was an error while getting the size of the given file.
 */
export async function fileSize (remotePath) {
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
    throw new Error(`Unable to get file size for '${remotePath}': ${err.message}`);
  }
}

/**
 * Forcefully recursively remove a path on the device under test.
 * Be careful while calling this method.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} path - The path to be removed recursively.
 */
export async function rimraf (path) {
  await this.shell(['rm', '-rf', path]);
}

/**
 * Send a file to the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} localPath - The path to the file on the local file system.
 * @param {string} remotePath - The destination path on the remote device.
 * @param {object} [opts] - Additional options mapping. See
 *                        https://github.com/appium/node-teen_process,
 *                        _exec_ method options, for more information about available
 *                        options.
 */
export async function push (localPath, remotePath, opts) {
  await this.mkdir(path.posix.dirname(remotePath));
  await this.adbExec(['push', localPath, remotePath], opts);
}

/**
 * Receive a file from the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} remotePath - The source path on the remote device.
 * @param {string} localPath - The destination path to the file on the local file system.
 * @param {import('teen_process').TeenProcessExecOptions} [opts={}] - Additional options mapping. See
 * https://github.com/appium/node-teen_process,
 * _exec_ method options, for more information about available
 * options.
 */
export async function pull (remotePath, localPath, opts = {}) {
  // pull folder can take more time, increasing time out to 60 secs
  await this.adbExec(['pull', remotePath, localPath], {...opts, timeout: opts.timeout ?? 60000});
}

/**
 * Recursively create a new folder on the device under test.
 *
 * @this {import('../adb.js').ADB}
 * @param {string} remotePath - The new path to be created.
 * @return {Promise<string>} mkdir command output.
 */
export async function mkdir (remotePath) {
  return await this.shell(['mkdir', '-p', remotePath]);
}
