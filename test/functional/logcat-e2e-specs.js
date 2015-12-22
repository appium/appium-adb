import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../../lib/adb';
import Logcat from '../../lib/logcat';

chai.use(chaiAsPromised);

describe('logcat', () => {
  let adb;
  let logcat;
  before(async () => {
    adb = await ADB.createADB();
    logcat = new Logcat({adb: adb.executable, debug: false, debugTrace: false});
  });
  it('getLogs should return logs', async function () {
    this.timeout(30000);
    await logcat.startCapture();
    let logs = logcat.getLogs();
    logs.should.have.length.above(0);
    await logcat.stopCapture();
  });
  it('getAllLogs should return all logs', async function () {
    this.timeout(30000);
    await logcat.startCapture();
    let logs = logcat.getAllLogs();
    logs.should.have.length.above(0);
    await logcat.stopCapture();
  });
});
