import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../../lib/adb';
import Logcat from '../../lib/logcat';
import { MOCHA_TIMEOUT } from './setup';


chai.use(chaiAsPromised);
chai.should();

describe('logcat', function () {
  this.timeout(MOCHA_TIMEOUT);

  async function runClearDeviceLogTest (adb, logcat, clear = true) {
    let logs = await adb.adbExec(['logcat', '-d']);
    await logcat.startCapture();
    await logcat.stopCapture();
    let newLogs = await adb.adbExec(['logcat', '-d']);
    if (clear) {
      newLogs.should.not.include(logs);
    } else {
      newLogs.should.include(logs);
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
      let logs = logcat.getLogs();
      logs.should.have.length.above(0);
    });
    it('getAllLogs should return all logs', async function () {
      await logcat.startCapture();
      let logs = logcat.getAllLogs();
      logs.should.have.length.above(0);
    });
    it('should not affect device logs @skip-ci', async function () {
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
