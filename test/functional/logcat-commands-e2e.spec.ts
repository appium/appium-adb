import {ADB} from '../../lib/adb.js';
import {Logcat} from '../../lib/logcat.js';
import {E2E_TIMEOUT} from './setup.js';
import {use, expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {describe, it, before, afterEach, type TestContext} from 'node:test';

use(chaiAsPromised);

describe('logcat commands', {timeout: E2E_TIMEOUT}, function () {
  async function runClearDeviceLogTest(adb: ADB, logcat: Logcat, clear = true) {
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

  let adb: ADB;
  let logcat: Logcat;

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
    it('should not affect device logs', async function (ctx: TestContext) {
      if (process.env.CI) {
        return ctx.skip();
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
