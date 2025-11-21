import {ADB} from '../../lib/adb';
import { MOCHA_TIMEOUT, MOCHA_LONG_TIMEOUT } from './setup';
import path from 'path';
import { getResourcePath } from '../../lib/helpers.js';
import { fs } from '@appium/support';
import _ from 'lodash';

const DEFAULT_CERTIFICATE = path.join('keys', 'testkey.x509.pem');
const avdName = process.env.ANDROID_AVD || 'Android Emulator';

describe('system calls', function () {
  this.timeout(MOCHA_TIMEOUT);

  let adb;
  let chai;
  let expect;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    expect = chai.expect;
    chai.use(chaiAsPromised.default);

    adb = await ADB.createADB();
  });
  it('waitForEmulatorReady should succeed', async function () {
    await adb.waitForEmulatorReady();
  });
  it('getConnectedDevices should get devices', async function () {
    const devices = await adb.getConnectedDevices();
    expect(devices).to.have.length.above(0);
  });
  it('getDevicesWithRetry should get devices', async function () {
    const devices = await adb.getDevicesWithRetry();
    expect(devices).to.have.length.above(0);
  });
  it('adbExec should get devices when with devices', async function () {
    expect(await adb.adbExec('devices')).to.contain('List of devices attached');
  });
  it('isDeviceConnected should be true', async function () {
    expect(await adb.isDeviceConnected()).to.be.true;
  });
  it('shell should execute command in adb shell ', async function () {
    const apiLevel = await adb.getApiLevel();
    expect(await adb.shell(['getprop', 'ro.build.version.sdk'])).to.equal(`${apiLevel}`);
  });
  it('shell should return stderr from adb with full output', async function () {
    const apiLevel = await adb.getApiLevel();
    const minStderrApiLevel = 24;
    const fullShellOutput = await adb.shell(['content', 'read', '--uri', 'content://doesnotexist'], {outputFormat: adb.EXEC_OUTPUT_FORMAT.FULL});
    const outputWithError = apiLevel < minStderrApiLevel ? fullShellOutput.stdout : fullShellOutput.stderr;
    expect(outputWithError).to.contain('Error while accessing provider');
  });
  it('shell should return stdout from adb shell with full output', async function () {
    const apiLevel = await adb.getApiLevel();
    const fullShellOutput = await adb.shell(['getprop', 'ro.build.version.sdk'], {outputFormat: adb.EXEC_OUTPUT_FORMAT.FULL});
    expect(fullShellOutput.stderr).to.equal('');
    expect(fullShellOutput.stdout).to.equal(`${apiLevel}`);
  });
  it('getConnectedEmulators should get all connected emulators', async function () {
    expect(await adb.getConnectedEmulators()).to.have.length.above(0);
  });
  it('getRunningAVD should get all connected avd', async function () {
    expect(await adb.getRunningAVD(avdName)).to.not.be.null;
  });
  it('getRunningAVDWithRetry should get all connected avds', async function () {
    expect(await adb.getRunningAVDWithRetry(avdName)).to.not.be.null;
  });
  // Skipping for now. Will unskip depending on how it behaves on CI
  it.skip('launchAVD should get all connected avds', async function () {
    this.timeout(MOCHA_LONG_TIMEOUT);
    const proc = await adb.launchAVD(avdName);
    try {
      expect(await adb.getConnectedEmulators()).to.have.length.above(0);
    } finally {
      await proc.stop();
    }
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
      expect(e.message).to.include('must be root');
    }
  });
  it('fileExists should detect when files do and do not exist', async function () {
    expect(await adb.fileExists('/foo/bar/baz.zip')).to.be.false;
    expect(await adb.fileExists('/data/local/tmp')).to.be.true;
  });
  it('ls should list files', async function () {
    expect(await adb.ls('/foo/bar')).to.eql([]);
    await adb.shell(['touch', '/data/local/tmp/test']);
    expect(await adb.ls('/data/local/tmp')).to.contain('test');
  });
  it('should check if the given certificate is already installed', async function () {
    const certBuffer = await fs.readFile(await getResourcePath(DEFAULT_CERTIFICATE));
    expect(await adb.isMitmCertificateInstalled(certBuffer)).to.be.false;
  });
  it('should return version', async function () {
    const {binary, bridge} = await adb.getVersion();
    if (binary) {
      expect(_.has(binary, 'version')).to.be.true;
      expect(_.has(binary, 'build')).to.be.true;
    }
    expect(_.has(bridge, 'version')).to.be.true;
  });
});
