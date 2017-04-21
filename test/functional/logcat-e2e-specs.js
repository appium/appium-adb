import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../../lib/adb';
import Logcat from '../../lib/logcat';
import { MOCHA_TIMEOUT } from './setup';

chai.use(chaiAsPromised);

describe('logcat', function () {
  this.timeout(MOCHA_TIMEOUT);

  let adb;
  let logcat;
  before(async () => {
    adb = await ADB.createADB();
    logcat = new Logcat({adb: adb.executable, debug: false, debugTrace: false});
  });
  it('getLogs should return logs', async function () {
    await logcat.startCapture();
    let logs = logcat.getLogs();
    logs.should.have.length.above(0);
    await logcat.stopCapture();
  });
  it('getAllLogs should return all logs', async function () {
    await logcat.startCapture();
    let logs = logcat.getAllLogs();
    logs.should.have.length.above(0);
    await logcat.stopCapture();
  });
});
