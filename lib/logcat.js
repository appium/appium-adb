import { SubProcess, exec } from 'teen_process';
import { logger } from 'appium-support';
import B from 'bluebird';
import events from 'events';
const { EventEmitter } = events;


const log = logger.getLogger('Logcat');
const MAX_BUFFER_SIZE = 10000;
const LOGCAT_PROC_STARTUP_TIMEOUT = 10000;

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

  startCapture () {
    let started = false;
    return new B(async (_resolve, _reject) => { // eslint-disable-line promise/param-names
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

      log.debug('Starting logcat capture');
      this.proc = new SubProcess(this.adb.path, this.adb.defaultArgs.concat(['logcat', '-v', 'threadtime']));
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
          this.outputHandler(line, 'STDERR: ');
        }
        resolve();
      });
      this.proc.on('lines-stdout', (lines) => {
        resolve();
        for (let line of lines) {
          this.outputHandler(line);
        }
      });
      await this.proc.start(0);
      // resolve after a timeout, even if no output was recorded
      setTimeout(resolve, LOGCAT_PROC_STARTUP_TIMEOUT);
    });
  }

  outputHandler (output, prefix = '') {
    output = output.trim();
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
    log.debug("Stopping logcat capture");
    if (!this.proc || !this.proc.isRunning) {
      log.debug("Logcat already stopped");
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
      const args = this.adb.defaultArgs.concat(['logcat', '-c']);
      log.debug(`Running '${this.adb.path} ${args.join(' ')}'`);
      await exec(this.adb.path, args);
    } catch (err) {
      log.warn(`Failed to clear logcat logs: ${err.message}`);
    }
  }
}

export default Logcat;
