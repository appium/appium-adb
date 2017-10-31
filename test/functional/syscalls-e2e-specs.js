import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import { apiLevel, avdName, MOCHA_TIMEOUT, MOCHA_LONG_TIMEOUT } from './setup';


chai.use(chaiAsPromised);

describe('System calls', function () {
  this.timeout(MOCHA_TIMEOUT);

  let adb;
  before(async () => {
    adb = await ADB.createADB();
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
    (await adb.shell(['getprop', 'ro.build.version.sdk'])).should.equal(`${apiLevel}`);
  });
  it('getConnectedEmulators should get all connected emulators', async () => {
    (await adb.getConnectedEmulators()).length.should.be.above(0);
  });
  it('getRunningAVD should get all connected avd', async () => {
    (await adb.getRunningAVD(avdName)).should.not.be.null;
  });
  it('getRunningAVDWithRetry should get all connected avds', async () => {
    (await adb.getRunningAVDWithRetry(avdName)).should.not.be.null;
  });
  // Skipping for now. Will unskip depending on how it behaves on CI
  it.skip('launchAVD should get all connected avds', async function () {
    this.timeout(MOCHA_LONG_TIMEOUT);
    let proc = await adb.launchAVD(avdName);
    (await adb.getConnectedEmulators()).length.should.be.above(0);
    proc.stop();
  });
  it('waitForDevice should get all connected avds', async function () {
    await adb.waitForDevice(2);
  });
  it('reboot should reboot the device', async function () {
    this.timeout(MOCHA_LONG_TIMEOUT);
    await adb.reboot(process.env.TRAVIS ? 200 : undefined);
    await adb.ping();
  });
  it('fileExists should detect when files do and do not exist', async function () {
    (await adb.fileExists('/foo/bar/baz.zip')).should.be.false;
    (await adb.fileExists('/system/')).should.be.true;
  });
  it('ls should list files', async function () {
    (await adb.ls('/foo/bar')).should.eql([]);
    (await adb.ls('/system/')).should.contain('etc');
  });
});
