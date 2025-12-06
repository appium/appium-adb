import _ from 'lodash';
import {log} from '../logger.js';
import B from 'bluebird';
import type {ExecError} from 'teen_process';
import type {ADB} from '../adb.js';

const PID_COLUMN_TITLE: string = 'PID';
const PROCESS_NAME_COLUMN_TITLE: string = 'NAME';
const PS_TITLE_PATTERN: RegExp = new RegExp(
  `^(.*\\b${PID_COLUMN_TITLE}\\b.*\\b${PROCESS_NAME_COLUMN_TITLE}\\b.*)$`,
  'm',
);

/**
 * At some point of time Google has changed the default `ps` behaviour, so it only
 * lists processes that belong to the current shell user rather to all
 * users. It is necessary to execute ps with -A command line argument
 * to mimic the previous behaviour.
 *
 * @returns the output of `ps` command where all processes are included
 */
export async function listProcessStatus(this: ADB): Promise<string> {
  if (!_.isBoolean(this._doesPsSupportAOption)) {
    try {
      this._doesPsSupportAOption = /^-A\b/m.test(await this.shell(['ps', '--help']));
    } catch (e: unknown) {
      const error: Error = e as Error;
      log.debug(error.stack);
      this._doesPsSupportAOption = false;
    }
  }
  return await this.shell(this._doesPsSupportAOption ? ['ps', '-A'] : ['ps']);
}

/**
 * Returns process name for the given process identifier
 *
 * @param pid - The valid process identifier
 * @returns The process name
 * @throws {Error} If the given PID is either invalid or is not present
 * in the active processes list
 */
export async function getProcessNameById(this: ADB, pid: string | number): Promise<string> {
  // @ts-ignore This validation works as expected
  if (isNaN(Number(pid))) {
    throw new Error(`The PID value must be a valid number. '${pid}' is given instead`);
  }
  const numericPid: number = parseInt(`${pid}`, 10);

  const stdout: string = await this.listProcessStatus();
  const titleMatch: RegExpExecArray | null = PS_TITLE_PATTERN.exec(stdout);
  if (!titleMatch) {
    log.debug(stdout);
    throw new Error(`Could not get the process name for PID '${numericPid}'`);
  }
  const allTitles: string[] = titleMatch[1].trim().split(/\s+/);
  const pidIndex: number = allTitles.indexOf(PID_COLUMN_TITLE);
  // it might not be stable to take NAME by index, because depending on the
  // actual SDK the ps output might not contain an abbreviation for the S flag:
  // USER     PID   PPID  VSIZE  RSS     WCHAN    PC        NAME
  // USER     PID   PPID  VSIZE  RSS     WCHAN    PC   S    NAME
  const nameOffset: number = allTitles.indexOf(PROCESS_NAME_COLUMN_TITLE) - allTitles.length;
  const pidRegex: RegExp = new RegExp(`^(.*\\b${numericPid}\\b.*)$`, 'gm');
  let matchedLine: RegExpExecArray | null;
  while ((matchedLine = pidRegex.exec(stdout))) {
    const items: string[] = matchedLine[1].trim().split(/\s+/);
    if (parseInt(items[pidIndex], 10) === numericPid && items[items.length + nameOffset]) {
      return items[items.length + nameOffset];
    }
  }
  log.debug(stdout);
  throw new Error(`Could not get the process name for PID '${numericPid}'`);
}

/**
 * Get the list of process ids for the particular process on the device under test.
 *
 * @param name - The part of process name.
 * @returns The list of matched process IDs or an empty list.
 */
export async function getProcessIdsByName(this: ADB, name: string): Promise<number[]> {
  log.debug(`Getting IDs of all '${name}' processes`);

  const stdout: string = await this.listProcessStatus();
  const titleMatch: RegExpExecArray | null = PS_TITLE_PATTERN.exec(stdout);
  if (!titleMatch) {
    log.debug(stdout);
    throw new Error(`Could not parse process list for name '${name}'`);
  }
  const allTitles: string[] = titleMatch[1].trim().split(/\s+/);
  const pidIndex: number = allTitles.indexOf(PID_COLUMN_TITLE);
  const nameIndex: number = allTitles.indexOf(PROCESS_NAME_COLUMN_TITLE);

  const pids: number[] = [];
  const lines: string[] = stdout.split('\n');

  for (const line of lines) {
    const items: string[] = line.trim().split(/\s+/);
    if (
      items.length > Math.max(pidIndex, nameIndex) &&
      items[nameIndex] &&
      items[pidIndex] &&
      items[nameIndex] === name
    ) {
      const pid: number = parseInt(items[pidIndex], 10);
      if (!isNaN(pid)) {
        pids.push(pid);
      }
    }
  }

  return _.uniq(pids);
}

/**
 * Kill all processes with the given name on the device under test.
 *
 * @param name - The part of process name.
 * @param signal - The signal to send to the process. Default is 'SIGTERM' ('15').
 * @throws {Error} If the processes cannot be killed.
 */
export async function killProcessesByName(
  this: ADB,
  name: string,
  signal: string = 'SIGTERM',
): Promise<void> {
  try {
    log.debug(`Attempting to kill all ${name} processes`);
    const pids: number[] = await this.getProcessIdsByName(name);
    if (_.isEmpty(pids)) {
      log.info(`No '${name}' process has been found`);
    } else {
      await B.all(pids.map((p: number) => this.killProcessByPID(p, signal)));
    }
  } catch (e: unknown) {
    const err: Error = e as Error;
    throw new Error(`Unable to kill ${name} processes. Original error: ${err.message}`);
  }
}

/**
 * Kill the particular process on the device under test.
 * The current user is automatically switched to root if necessary in order
 * to properly kill the process.
 *
 * @param pid - The ID of the process to be killed.
 * @param signal - The signal to send to the process. Default is 'SIGTERM' ('15').
 * @throws {Error} If the process cannot be killed.
 */
export async function killProcessByPID(
  this: ADB,
  pid: string | number,
  signal: string = 'SIGTERM',
): Promise<void> {
  log.debug(`Attempting to kill process ${pid}`);
  const noProcessFlag: string = 'No such process';
  try {
    // Check if the process exists and throw an exception otherwise
    await this.shell(['kill', `-${signal}`, `${pid}`]);
  } catch (e: unknown) {
    const err: ExecError = e as ExecError;
    if (_.includes(err.stderr, noProcessFlag)) {
      return;
    }
    if (!_.includes(err.stderr, 'Operation not permitted')) {
      throw err;
    }
    log.info(`Cannot kill PID ${pid} due to insufficient permissions. Retrying as root`);
    try {
      await this.shell(['kill', `${pid}`], {
        privileged: true,
      });
    } catch (e1: unknown) {
      const err1: ExecError = e1 as ExecError;
      if (_.includes(err1.stderr, noProcessFlag)) {
        return;
      }
      throw err1;
    }
  }
}

/**
 * Check whether the process with the particular name is running on the device
 * under test.
 *
 * @param processName - The name of the process to be checked.
 * @returns True if the given process is running.
 * @throws {Error} If the given process name is not a valid class name.
 */
export async function processExists(this: ADB, processName: string): Promise<boolean> {
  return !_.isEmpty(await this.getProcessIdsByName(processName));
}
