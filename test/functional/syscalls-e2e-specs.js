import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import ADB from '../../lib/adb.js';

chai.use(chaiAsPromised);

describe('System calls', () => {
  let adb = new ADB();
  const apiLevel = '21';

  before(async () => {
    await adb.createADB();
  });
  it('getConnectedDevices should get devices', async () => {
    let devices = await adb.getConnectedDevices();
    devices.should.have.length.above(0);
  });
  it('getDevicesWithRetry should get devices', async () => {
    let devices = await adb.getDevicesWithRetry();
    devices.should.have.length.above(0);
  });
  it('adbExec should get devices when with devices', async () => {
    (await adb.adbExec("devices")).should.contain("List of devices attached");
  });
  it('isDeviceConnected should be true', async () => {
    (await adb.isDeviceConnected()).should.be.true;
  });
  it('shell should execute command in adb shell ', async () => {
    (await adb.shell(['getprop', 'ro.build.version.sdk'])).should.equal(apiLevel);
  });
});
