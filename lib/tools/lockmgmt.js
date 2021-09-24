import log from '../logger.js';
import _ from 'lodash';

const lockManagementMethods = {};

const CREDENTIAL_CANNOT_BE_NULL_OR_EMPTY_ERROR = `Credential can't be null or empty`;
const CREDENTIAL_DID_NOT_MATCH_ERROR = `didn't match`;

function buildCommand (verb, oldCredential = null, ...args) {
  const cmd = ['locksettings', verb];
  if (!_.isEmpty(oldCredential)) {
    cmd.push('--old', oldCredential);
  }
  if (!_.isEmpty(args)) {
    cmd.push(...args);
  }
  return cmd;
}

/**
 * Check whether the device supports lock settings management with `locksettings`
 * command line tool. This tool has been added to Android toolset since  API 27 Oreo
 *
 * @return {boolean} True if the management is supported. The result is cached per ADB instance
 */
lockManagementMethods.isLockManagementSupported = async function isLockManagementSupported () {
  if (!_.isBoolean(this._isLockManagementSupported)) {
    const passFlag = '__PASS__';
    let output = '';
    try {
      output = await this.shell([`locksettings help && echo ${passFlag}`]);
    } catch (ign) {}
    this._isLockManagementSupported = _.includes(output, passFlag);
    log.debug(`Extended lock settings management is ` +
      `${this._isLockManagementSupported ? '' : 'not '}supported`);
  }
  return this._isLockManagementSupported;
};

/**
 * Check whether the given credential is matches to the currently set one.
 *
 * @param {?string} credential [null] The credential value. It could be either
 * pin, password or a pattern. A pattern is specified by a non-separated list
 * of numbers that index the cell on the pattern in a 1-based manner in left
 * to right and top to bottom order, i.e. the top-left cell is indexed with 1,
 * whereas the bottom-right cell is indexed with 9. Example: 1234.
 * null/empty value assumes the device has no lock currently set.
 * @return {boolean} True if the given credential matches to the device's one
 * @throws {Error} If the verification faces an unexpected error
 */
lockManagementMethods.verifyLockCredential = async function verifyLockCredential (credential = null) {
  try {
    const output = await this.shell(buildCommand('verify', credential));
    return _.includes(output, 'verified successfully');
  } catch (e) {
    if (_.includes(e.stderr || e.stdout, CREDENTIAL_CANNOT_BE_NULL_OR_EMPTY_ERROR)) {
      return false;
    }
    throw new Error(`Device lock credential verification failed. Original error: ${e.message}`);
  }
};

/**
 * Clears current lock credentials. Usually it takes several seconds for a device to
 * sync the credential state after this method returns.
 *
 * @param {?string} credential [null] The credential value. It could be either
 * pin, password or a pattern. A pattern is specified by a non-separated list
 * of numbers that index the cell on the pattern in a 1-based manner in left
 * to right and top to bottom order, i.e. the top-left cell is indexed with 1,
 * whereas the bottom-right cell is indexed with 9. Example: 1234.
 * null/empty value assumes the device has no lock currently set.
 * @throws {Error} If operation faces an unexpected error
 */
lockManagementMethods.clearLockCredential = async function clearLockCredential (credential = null) {
  try {
    const output = await this.shell(buildCommand('clear', credential));
    if (!['user has no password', 'Lock credential cleared'].some((x) => _.includes(output, x))) {
      throw new Error(output);
    }
  } catch (e) {
    throw new Error(`Cannot clear device lock credential. Original error: ${e.message}`);
  }
};

/**
 * Checks whether the device is locked with a credential (either pin or a password
 * or a pattern).
 *
 * @returns {boolean} `true` if the device is locked
 * @throws {Error} If operation faces an unexpected error
 */
lockManagementMethods.isLockEnabled = async function isLockEnabled () {
  try {
    const output = await this.shell(buildCommand('get-disabled'));
    return /\bfalse\b/.test(output);
  } catch (e) {
    if ([CREDENTIAL_DID_NOT_MATCH_ERROR, CREDENTIAL_CANNOT_BE_NULL_OR_EMPTY_ERROR]
        .some((x) => _.includes(e.stderr || e.stdout, x))) {
      return true;
    }
    throw new Error(`Cannot check if device lock is enabled. Original error: ${e.message}`);
  }
};

export default lockManagementMethods;
