import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import ADB from '../../lib/adb.js';

chai.use(chaiAsPromised);

describe('System calls', () => {
  let adb = new ADB();
  const apiLevel = '21',
  // TODO change according to avdName on test machine
        avdName = 'finaltest21';

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
  it('getConnectedEmulators should get all connected emulators', async () => {
    (await adb.getConnectedEmulators()).length.should.be.above(0);
  });
  it('getRunningAVD should get all connected avd', async () => {
    await adb.getRunningAVD(avdName).should.not.be.null;
  });
  it('getRunningAVDWithRetry should get all connected avds', async () => {
    await adb.getRunningAVDWithRetry(avdName).should.not.be.null;
  });
  // Skipping for now. Will unskip depending on how it behaves on CI
  it.skip('launchAVD should get all connected avds', async function () {
    this.timeout(240000);
    let proc = await adb.launchAVD(avdName);
    (await adb.getConnectedEmulators()).length.should.be.above(0);
    proc.kill();
  });
  it('waitForDevice should get all connected avds', async function () {
    this.timeout(60000);
    await adb.waitForDevice(2);
  });
  it('reboot should reboot the device', async function () {
    this.timeout(60000);
    await adb.reboot();
    await adb.ping();
  });
});
