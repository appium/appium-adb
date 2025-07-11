import { logger, util } from '@appium/support';
import B from 'bluebird';
import _ from 'lodash';
import { EventEmitter } from 'node:events';
import { SubProcess, exec } from 'teen_process';
import { LRUCache } from 'lru-cache';

const log = logger.getLogger('Logcat');
const MAX_BUFFER_SIZE = 10000;
const LOGCAT_PROC_STARTUP_TIMEOUT = 10000;
const SUPPORTED_FORMATS = ['brief', 'process', 'tag', 'thread', 'raw', 'time', 'threadtime', 'long'];
const SUPPORTED_PRIORITIES = ['v', 'd', 'i', 'w', 'e', 'f', 's'];
const DEFAULT_PRIORITY = 'v';
const DEFAULT_TAG = '*';
const DEFAULT_FORMAT = 'threadtime';
const TRACE_PATTERN = /W\/Trace/;
const EXECVP_ERR_PATTERN = /execvp\(\)/;

function requireFormat (format) {
  if (!SUPPORTED_FORMATS.includes(format)) {
    log.info(`The format value '${format}' is unknown. Supported values are: ${SUPPORTED_FORMATS}`);
    log.info(`Defaulting to '${DEFAULT_FORMAT}'`);
    return DEFAULT_FORMAT;
  }
  return format;
}

/**
 *
 * @param {string} message
 * @param {number} timestamp
 * @returns {import('./tools/types').LogEntry}
 */
function toLogEntry(message, timestamp) {
  return {
    timestamp,
    level: 'ALL',
    message,
  };
}

/**
 *
 * @param {string} spec
 * @returns {string}
 */
function requireSpec (spec) {
  const [tag, priority] = spec.split(':');
  let resultTag = tag;
  if (!resultTag) {
    log.info(`The tag value in spec '${spec}' cannot be empty`);
    log.info(`Defaulting to '${DEFAULT_TAG}'`);
    resultTag = DEFAULT_TAG;
  }
  if (!priority) {
    log.info(`The priority value in spec '${spec}' is empty. Defaulting to Verbose (${DEFAULT_PRIORITY})`);
    return `${resultTag}:${DEFAULT_PRIORITY}`;
  }
  if (!SUPPORTED_PRIORITIES.some((p) => _.toLower(priority) === _.toLower(p))) {
    log.info(`The priority value in spec '${spec}' is unknown. Supported values are: ${SUPPORTED_PRIORITIES}`);
    log.info(`Defaulting to Verbose (${DEFAULT_PRIORITY})`);
    return `${resultTag}:${DEFAULT_PRIORITY}`;
  }
  return spec;
}

/**
 *
 * @param {string|string[]} filterSpecs
 * @returns {string[]}
 */
function formatFilterSpecs (filterSpecs) {
  if (!_.isArray(filterSpecs)) {
    filterSpecs = [filterSpecs];
  }
  return filterSpecs
    .filter((spec) => spec && _.isString(spec) && !spec.startsWith('-'))
    .map((spec) => spec.includes(':') ? requireSpec(spec) : spec);
}


export class Logcat extends EventEmitter {
  constructor (opts = {}) {
    super();
    this.adb = opts.adb;
    this.clearLogs = opts.clearDeviceLogsOnStart || false;
    this.debug = opts.debug;
    this.debugTrace = opts.debugTrace;
    this.maxBufferSize = opts.maxBufferSize || MAX_BUFFER_SIZE;
    /** @type {LRUCache<number, [string, number]>} */
    this.logs = new LRUCache({
      max: this.maxBufferSize,
    });
    /** @type {number?} */
    this.logIndexSinceLastRequest = null;
  }

  async startCapture (opts = {}) {
    let started = false;
    return await new B(async (_resolve, _reject) => {
      const resolve = function (...args) {
        started = true;
        _resolve(...args);
      };
      const reject = function (...args) {
        started = true;
        _reject(...args);
      };

      if (this.clearLogs) {
        await this.clear();
      }

      const {
        format = DEFAULT_FORMAT,
        filterSpecs = [],
      } = opts;
      const cmd = [
        ...this.adb.defaultArgs,
        'logcat',
        '-v', requireFormat(format),
        ...formatFilterSpecs(filterSpecs),
      ];
      log.debug(`Starting logs capture with command: ${util.quote([this.adb.path, ...cmd])}`);
      this.proc = new SubProcess(this.adb.path, cmd);
      this.proc.on('exit', (code, signal) => {
        log.error(`Logcat terminated with code ${code}, signal ${signal}`);
        this.proc = null;
        if (!started) {
          log.warn('Logcat not started. Continuing');
          resolve();
        }
      });
      this.proc.on('line-stderr', (line) => {
        if (!started && EXECVP_ERR_PATTERN.test(line)) {
          log.error('Logcat process failed to start');
          return reject(new Error(`Logcat process failed to start. stderr: ${line}`));
        }
        this.outputHandler(line, 'STDERR: ');
        resolve();
      });
      this.proc.on('line-stdout', (line) => {
        this.outputHandler(line);
        resolve();
      });
      await this.proc.start(0);
      // resolve after a timeout, even if no output was recorded
      setTimeout(resolve, LOGCAT_PROC_STARTUP_TIMEOUT);
    });
  }

  /**
   *
   * @param {string} logLine
   * @param {string} [prefix='']
   * @returns {void}
   */
  outputHandler (logLine, prefix = '') {
    const timestamp = Date.now();
    let recentIndex = -1;
    for (const key of this.logs.keys()) {
      recentIndex = key;
      break;
    }
    this.logs.set(++recentIndex, [logLine, timestamp]);
    if (this.listenerCount('output')) {
      this.emit('output', toLogEntry(logLine, timestamp));
    }
    if (this.debug && (this.debugTrace || !TRACE_PATTERN.test(logLine))) {
      log.debug(prefix + logLine);
    }
  }

  /**
   *
   * @returns {Promise<void>}
   */
  async stopCapture () {
    log.debug('Stopping logcat capture');
    if (!this.proc?.isRunning) {
      log.debug('Logcat already stopped');
      this.proc = null;
      return;
    }
    this.proc.removeAllListeners('exit');
    await this.proc.stop();
    this.proc = null;
  }

  /**
   * @returns {import('./tools/types').LogEntry[]}
   */
  getLogs () {
    /** @type {import('./tools/types').LogEntry[]} */
    const result = [];
    /** @type {number?} */
    let recentLogIndex = null;
    for (const [index, [message, timestamp]] of /** @type {Generator} */ (this.logs.rentries())) {
      if (this.logIndexSinceLastRequest && index > this.logIndexSinceLastRequest
          || !this.logIndexSinceLastRequest) {
        recentLogIndex = index;
        result.push(toLogEntry(message, timestamp));
      }
    }
    if (_.isInteger(recentLogIndex)) {
      this.logIndexSinceLastRequest = recentLogIndex;
    }
    return result;
  }

  /**
   * @returns {import('./tools/types').LogEntry[]}
   */
  getAllLogs () {
    /** @type {import('./tools/types').LogEntry[]} */
    const result = [];
    for (const [message, timestamp] of /** @type {Generator} */ (this.logs.rvalues())) {
      result.push(toLogEntry(message, timestamp));
    }
    return result;
  }

  /**
   * @returns {Promise<void>}
   */
  async clear () {
    log.debug('Clearing logcat logs from device');
    try {
      const args = [...this.adb.defaultArgs, 'logcat', '-c'];
      await exec(this.adb.path, args);
    } catch (err) {
      log.warn(`Failed to clear logcat logs: ${err.stderr || err.message}`);
    }
  }
}

export default Logcat;
