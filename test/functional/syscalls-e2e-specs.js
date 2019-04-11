import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import { apiLevel, avdName, MOCHA_TIMEOUT, MOCHA_LONG_TIMEOUT } from './setup';
import path from 'path';
import { rootDir } from '../../lib/helpers.js';
import { fs } from 'appium-support';

const DEFAULT_CERTIFICATE = path.resolve(rootDir, 'keys', 'testkey.x509.pem');

chai.use(chaiAsPromised);

describe('System calls', function () {
  this.timeout(MOCHA_TIMEOUT);

  let adb;
  before(async function () {
    adb = await ADB.createADB();
  });
  it('getConnectedDevices should get devices', async function () {
    let devices = await adb.getConnectedDevices();
    devices.should.have.length.above(0);
  });
  it('getDevicesWithRetry should get devices', async function () {
    let devices = await adb.getDevicesWithRetry();
    devices.should.have.length.above(0);
  });
  it('adbExec should get devices when with devices', async function () {
    (await adb.adbExec('devices')).should.contain('List of devices attached');
  });
  it('isDeviceConnected should be true', async function () {
    (await adb.isDeviceConnected()).should.be.true;
  });
  it('shell should execute command in adb shell ', async function () {
    (await adb.shell(['getprop', 'ro.build.version.sdk'])).should.equal(`${apiLevel}`);
  });
  it('getConnectedEmulators should get all connected emulators', async function () {
    (await adb.getConnectedEmulators()).length.should.be.above(0);
  });
  it('getRunningAVD should get all connected avd', async function () {
    (await adb.getRunningAVD(avdName)).should.not.be.null;
  });
  it('getRunningAVDWithRetry should get all connected avds', async function () {
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
    if (process.env.TRAVIS) {
      // The test is very slow on CI
      return this.skip();
    }
    this.timeout(MOCHA_LONG_TIMEOUT);
    try {
      await adb.reboot();
      await adb.ping();
    } catch (e) {
      e.message.should.include('must be root');
    }
  });
  it('fileExists should detect when files do and do not exist', async function () {
    (await adb.fileExists('/foo/bar/baz.zip')).should.be.false;
    (await adb.fileExists('/system/')).should.be.true;
  });
  it('ls should list files', async function () {
    (await adb.ls('/foo/bar')).should.eql([]);
    (await adb.ls('/system/')).should.contain('etc');
  });
  it('should check if the given certificate is already installed', async function () {
    const certBuffer = await fs.readFile(DEFAULT_CERTIFICATE);
    (await adb.isMitmCertificateInstalled(certBuffer)).should.be.false;
  });
});
