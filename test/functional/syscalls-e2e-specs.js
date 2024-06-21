// eslint-disable-next-line import/no-unresolved
import {ADB} from '../../lib/adb';
import { apiLevel, avdName, MOCHA_TIMEOUT, MOCHA_LONG_TIMEOUT } from './setup';
import path from 'path';
import { getResourcePath } from '../../lib/helpers.js';
import { fs } from '@appium/support';
import _ from 'lodash';

const DEFAULT_CERTIFICATE = path.join('keys', 'testkey.x509.pem');

describe('System calls', function () {
  this.timeout(MOCHA_TIMEOUT);

  let adb;
  let chai;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.should();
    chai.use(chaiAsPromised.default);

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
  it('shell should return stderr from adb with full output', async function () {
    const minStderrApiLevel = 24;
    let fullShellOutput = await adb.shell(['content', 'read', '--uri', 'content://doesnotexist'], {outputFormat: adb.EXEC_OUTPUT_FORMAT.FULL});
    let outputWithError = apiLevel < minStderrApiLevel ? fullShellOutput.stdout : fullShellOutput.stderr;
    outputWithError.should.contain('Error while accessing provider');
  });
  it('shell should return stdout from adb shell with full output', async function () {
    let fullShellOutput = await adb.shell(['getprop', 'ro.build.version.sdk'], {outputFormat: adb.EXEC_OUTPUT_FORMAT.FULL});
    fullShellOutput.stderr.should.equal('');
    fullShellOutput.stdout.should.equal(`${apiLevel}`);
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
    if (process.env.CI) {
      // The test makes CI unstable
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
    (await adb.fileExists('/data/local/tmp')).should.be.true;
  });
  it('ls should list files', async function () {
    (await adb.ls('/foo/bar')).should.eql([]);
    await adb.shell(['touch', '/data/local/tmp/test']);
    (await adb.ls('/data/local/tmp')).should.contain('test');
  });
  it('should check if the given certificate is already installed', async function () {
    const certBuffer = await fs.readFile(await getResourcePath(DEFAULT_CERTIFICATE));
    (await adb.isMitmCertificateInstalled(certBuffer)).should.be.false;
  });
  it('should return version', async function () {
    const {binary, bridge} = await adb.getVersion();
    if (binary) {
      _.has(binary, 'version').should.be.true;
      _.has(binary, 'build').should.be.true;
    }
    _.has(bridge, 'version').should.be.true;
  });
});
