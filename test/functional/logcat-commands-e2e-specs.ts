import {ADB} from '../../lib/adb';
import {Logcat} from '../../lib/logcat';
import {MOCHA_TIMEOUT} from './setup';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

describe('logcat commands', function () {
  this.timeout(MOCHA_TIMEOUT);

  async function runClearDeviceLogTest(adb, logcat, clear = true) {
    const logs = await adb.adbExec(['logcat', '-d']);
    await logcat.startCapture();
    await logcat.stopCapture();
    const newLogs = await adb.adbExec(['logcat', '-d']);
    if (clear) {
      expect(newLogs).to.not.include(logs);
    } else {
      expect(newLogs).to.include(logs);
    }
  }

  let adb;
  let logcat;

  before(async function () {
    adb = await ADB.createADB();
  });
  afterEach(async function () {
    if (logcat) {
      await logcat.stopCapture();
    }
  });
  describe('clearDeviceLogsOnStart = false', function () {
    before(function () {
      logcat = new Logcat({
        adb: adb.executable,
        debug: false,
        debugTrace: false,
      });
    });
    it('getLogs should return logs', async function () {
      await logcat.startCapture();
      const logs = logcat.getLogs();
      expect(logs).to.have.length.above(0);
    });
    it('getAllLogs should return all logs', async function () {
      await logcat.startCapture();
      const logs = logcat.getAllLogs();
      expect(logs).to.have.length.above(0);
    });
    it('should not affect device logs', async function () {
      if (process.env.CI) {
        return this.skip();
      }
      await runClearDeviceLogTest(adb, logcat, false);
    });
  });
  describe('clearDeviceLogsOnStart = true', function () {
    before(function () {
      logcat = new Logcat({
        adb: adb.executable,
        debug: false,
        debugTrace: false,
        clearDeviceLogsOnStart: true,
      });
    });
    it('should clear the logs before starting capture', async function () {
      await runClearDeviceLogTest(adb, logcat, true);
    });
  });
});
