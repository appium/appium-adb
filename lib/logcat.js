import { SubProcess } from 'teen_process';
import { logger } from 'appium-support';
import B from 'bluebird';


const log = logger.getLogger('Logcat');

class Logcat {
  constructor (opts = {}) {
    this.adb = opts.adb;
    this.debug = opts.debug;
    this.debugTrace = opts.debugTrace;
    this.logs = [];
    this.logsSinceLastRequest = [];
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
    });
  }

  outputHandler (output, prefix = '') {
    output = output.trim();
    if (output) {
      let outputObj = {
        timestamp: Date.now(),
        level: 'ALL',
        message: output
      };
      this.logs.push(outputObj);
      this.logsSinceLastRequest.push(outputObj);
      let isTrace = /W\/Trace/.test(output);
      if (this.debug && (!isTrace || this.debugTrace)) {
        log.debug(prefix + output);
      }
    }
  }

  async stopCapture () {
    log.debug("Stopping logcat capture");
    if (this.proc === null) {
      log.debug("Logcat already stopped");
      return;
    }
    this.proc.removeAllListeners('exit');
    await this.proc.stop();
    this.proc = null;
  }

  getLogs () {
    let logs = this.logsSinceLastRequest;
    this.logsSinceLastRequest = [];
    return logs;
  }

  getAllLogs () {
    return this.logs;
  }
}

export default Logcat;
