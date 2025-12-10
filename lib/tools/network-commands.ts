import {EOL} from 'os';
import _ from 'lodash';
import {log} from '../logger.js';
import type {ADB} from '../adb.js';
import type {PortFamily, PortInfo} from './types.js';

/**
 * Get TCP port forwarding with adb on the device under test.
 *
 * @return The output of the corresponding adb command.
 * An array contains each forwarding line of output
 */
export async function getForwardList(this: ADB): Promise<string[]> {
  log.debug(`List forwarding ports`);
  const connections = await this.adbExec(['forward', '--list']);
  return connections.split(EOL).filter((line) => Boolean(line.trim()));
}

/**
 * Setup TCP port forwarding with adb on the device under test.
 *
 * @param systemPort - The number of the local system port.
 * @param devicePort - The number of the remote device port.
 */
export async function forwardPort(
  this: ADB,
  systemPort: string | number,
  devicePort: string | number,
): Promise<void> {
  log.debug(`Forwarding system: ${systemPort} to device: ${devicePort}`);
  await this.adbExec(['forward', `tcp:${systemPort}`, `tcp:${devicePort}`]);
}

/**
 * Remove TCP port forwarding with adb on the device under test. The forwarding
 * for the given port should be setup with {@link #forwardPort} first.
 *
 * @param systemPort - The number of the local system port
 *                                     to remove forwarding on.
 */
export async function removePortForward(this: ADB, systemPort: string | number): Promise<void> {
  log.debug(`Removing forwarded port socket connection: ${systemPort} `);
  await this.adbExec(['forward', `--remove`, `tcp:${systemPort}`]);
}

/**
 * Get TCP port forwarding with adb on the device under test.
 *
 * @return The output of the corresponding adb command.
 * An array contains each forwarding line of output
 */
export async function getReverseList(this: ADB): Promise<string[]> {
  log.debug(`List reverse forwarding ports`);
  const connections = await this.adbExec(['reverse', '--list']);
  return connections.split(EOL).filter((line) => Boolean(line.trim()));
}

/**
 * Setup TCP port forwarding with adb on the device under test.
 * Only available for API 21+.
 *
 * @param devicePort - The number of the remote device port.
 * @param systemPort - The number of the local system port.
 */
export async function reversePort(
  this: ADB,
  devicePort: string | number,
  systemPort: string | number,
): Promise<void> {
  log.debug(`Forwarding device: ${devicePort} to system: ${systemPort}`);
  await this.adbExec(['reverse', `tcp:${devicePort}`, `tcp:${systemPort}`]);
}

/**
 * Remove TCP port forwarding with adb on the device under test. The forwarding
 * for the given port should be setup with {@link #forwardPort} first.
 *
 * @param devicePort - The number of the remote device port
 *                                     to remove forwarding on.
 */
export async function removePortReverse(
  this: ADB,
  devicePort: string | number,
): Promise<void> {
  log.debug(`Removing reverse forwarded port socket connection: ${devicePort} `);
  await this.adbExec(['reverse', `--remove`, `tcp:${devicePort}`]);
}

/**
 * Setup TCP port forwarding with adb on the device under test. The difference
 * between {@link #forwardPort} is that this method does setup for an abstract
 * local port.
 *
 * @param systemPort - The number of the local system port.
 * @param devicePort - The number of the remote device port.
 */
export async function forwardAbstractPort(
  this: ADB,
  systemPort: string | number,
  devicePort: string | number,
): Promise<void> {
  log.debug(`Forwarding system: ${systemPort} to abstract device: ${devicePort}`);
  await this.adbExec(['forward', `tcp:${systemPort}`, `localabstract:${devicePort}`]);
}

/**
 * Execute ping shell command on the device under test.
 *
 * @return True if the command output contains 'ping' substring.
 * @throws {Error} If there was an error while executing 'ping' command on the
 *                 device under test.
 */
export async function ping(this: ADB): Promise<boolean> {
  const stdout = await this.shell(['echo', 'ping']);
  if (stdout.indexOf('ping') === 0) {
    return true;
  }
  throw new Error(`ADB ping failed, returned ${stdout}`);
}

/**
 * Returns the list of TCP port states of the given family.
 * Could be empty if no ports are opened.
 *
 * @param family - Port family ('4' for IPv4, '6' for IPv6)
 * @returns Array of port information
 */
export async function listPorts(this: ADB, family: PortFamily = '4'): Promise<PortInfo[]> {
  const sourceProcName = `/proc/net/tcp${family === '6' ? '6' : ''}`;
  const output = await this.shell(['cat', sourceProcName]);
  const lines = output.split('\n');
  if (_.isEmpty(lines)) {
    log.debug(output);
    throw new Error(`Cannot parse the payload of ${sourceProcName}`);
  }
  //   sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt  uid  timeout inode
  const colHeaders = lines[0].split(/\s+/).filter(Boolean);
  const localAddressCol = colHeaders.findIndex((x) => x === 'local_address');
  const stateCol = colHeaders.findIndex((x) => x === 'st');
  if (localAddressCol < 0 || stateCol < 0) {
    log.debug(lines[0]);
    throw new Error(`Cannot parse the header row of ${sourceProcName} payload`);
  }
  const result: PortInfo[] = [];
  // 2: 1002000A:D036 24CE3AD8:01BB 08 00000000:00000000 00:00000000 00000000 10132 0 49104 1 0000000000000000 21 4 20 10 -1
  for (const line of lines.slice(1)) {
    const values = line.split(/\s+/).filter(Boolean);
    const portStr = values[localAddressCol]?.split(':')?.[1];
    const stateStr = values[stateCol];
    if (!portStr || !stateStr) {
      continue;
    }
    result.push({
      port: parseInt(portStr, 16),
      family,
      state: parseInt(stateStr, 16),
    });
  }
  return result;
}

