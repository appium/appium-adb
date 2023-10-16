import { logger, util } from '@appium/support';
import B from 'bluebird';
import _ from 'lodash';
import { EventEmitter } from 'node:events';
import { SubProcess, exec } from 'teen_process';

const log = logger.getLogger('Logcat');
const MAX_BUFFER_SIZE = 10000;
const LOGCAT_PROC_STARTUP_TIMEOUT = 10000;
const SUPPORTED_FORMATS = ['brief', 'process', 'tag', 'thread', 'raw', 'time', 'threadtime', 'long'];
const SUPPORTED_PRIORITIES = ['v', 'd', 'i', 'w', 'e', 'f', 's'];
const DEFAULT_PRIORITY = 'v';
const DEFAULT_TAG = '*';
const DEFAULT_FORMAT = 'threadtime';

/**
 * @typedef {Object} LogcatOpts
 * @property {string} [format] The log print format, where <format> is one of:
 *   brief process tag thread raw time threadtime long
 * `threadtime` is the default value.
 * @property {Array<string>} [filterSpecs] Series of `<tag>[:priority]`
 * where `<tag>` is a log component tag (or `*` for all) and priority is:
 *  V    Verbose
 *  D    Debug
 *  I    Info
 *  W    Warn
 *  E    Error
 *  F    Fatal
 *  S    Silent (supress all output)
 *
 * `'*'` means `'*:d'` and `<tag>` by itself means `<tag>:v`
 *
 * If not specified on the commandline, filterspec is set from `ANDROID_LOG_TAGS`.
 * If no filterspec is found, filter defaults to `'*:I'`
 */

function requireFormat (format) {
  if (!SUPPORTED_FORMATS.includes(format)) {
    log.info(`The format value '${format}' is unknown. Supported values are: ${SUPPORTED_FORMATS}`);
    log.info(`Defaulting to '${DEFAULT_FORMAT}'`);
    return DEFAULT_FORMAT;
  }
  return format;
}

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

function formatFilterSpecs (filterSpecs) {
  if (!_.isArray(filterSpecs)) {
    filterSpecs = [filterSpecs];
  }
  return filterSpecs
    .filter((spec) => spec && _.isString(spec) && !spec.startsWith('-'))
    .map((spec) => spec.includes(':') ? requireSpec(spec) : spec);
}


class Logcat extends EventEmitter {
  constructor (opts = {}) {
    super();
    this.adb = opts.adb;
    this.clearLogs = opts.clearDeviceLogsOnStart || false;
    this.debug = opts.debug;
    this.debugTrace = opts.debugTrace;
    this.maxBufferSize = opts.maxBufferSize || MAX_BUFFER_SIZE;
    this.logs = [];
    this.logIdxSinceLastRequest = 0;
  }

  async startCapture (opts = {}) {
    let started = false;
    return await new B(async (_resolve, _reject) => { // eslint-disable-line promise/param-names
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
      this.proc.on('lines-stderr', (lines) => {
        for (let line of lines) {
          if (/execvp\(\)/.test(line)) {
            log.error('Logcat process failed to start');
            reject(new Error(`Logcat process failed to start. stderr: ${line}`));
          }
          this.outputHandler(_.trim(line), 'STDERR: ');
        }
        resolve();
      });
      this.proc.on('lines-stdout', (lines) => {
        resolve();
        for (let line of lines) {
          this.outputHandler(_.trim(line));
        }
      });
      await this.proc.start(0);
      // resolve after a timeout, even if no output was recorded
      setTimeout(resolve, LOGCAT_PROC_STARTUP_TIMEOUT);
    });
  }

  outputHandler (output, prefix = '') {
    if (!output) {
      return;
    }

    if (this.logs.length >= this.maxBufferSize) {
      this.logs.shift();
      if (this.logIdxSinceLastRequest > 0) {
        --this.logIdxSinceLastRequest;
      }
    }
    const outputObj = {
      timestamp: Date.now(),
      level: 'ALL',
      message: output,
    };
    this.logs.push(outputObj);
    this.emit('output', outputObj);
    const isTrace = /W\/Trace/.test(output);
    if (this.debug && (!isTrace || this.debugTrace)) {
      log.debug(prefix + output);
    }
  }

  async stopCapture () {
    log.debug('Stopping logcat capture');
    if (!this.proc || !this.proc.isRunning) {
      log.debug('Logcat already stopped');
      this.proc = null;
      return;
    }
    this.proc.removeAllListeners('exit');
    await this.proc.stop();
    this.proc = null;
  }

  getLogs () {
    if (this.logIdxSinceLastRequest < this.logs.length) {
      const result = this.logs.slice(this.logIdxSinceLastRequest);
      this.logIdxSinceLastRequest = this.logs.length;
      return result;
    }
    return [];
  }

  getAllLogs () {
    return this.logs;
  }

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
