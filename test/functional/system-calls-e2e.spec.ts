import {ADB} from '../../lib/adb';
import {E2E_TIMEOUT, E2E_LONG_TIMEOUT} from './setup';
import path from 'node:path';
import {fs} from '@appium/support';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {getResourcePath} from '../../lib/utils';
import {describe, it, before, type TestContext} from 'node:test';

chai.use(chaiAsPromised);

const DEFAULT_CERTIFICATE = path.join('keys', 'testkey.x509.pem');
const avdName = process.env.ANDROID_AVD || 'Android Emulator';

describe('system calls', {timeout: E2E_TIMEOUT}, function () {
  let adb: ADB;

  before(async function () {
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
    const fullShellOutput = await adb.shell(
      ['content', 'read', '--uri', 'content://doesnotexist'],
      {outputFormat: adb.EXEC_OUTPUT_FORMAT.FULL},
    );
    const outputWithError =
      apiLevel < minStderrApiLevel ? fullShellOutput.stdout : fullShellOutput.stderr;
    expect(outputWithError).to.contain('Error while accessing provider');
  });
  it('shell should return stdout from adb shell with full output', async function () {
    const apiLevel = await adb.getApiLevel();
    const fullShellOutput = await adb.shell(['getprop', 'ro.build.version.sdk'], {
      outputFormat: adb.EXEC_OUTPUT_FORMAT.FULL,
    });
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
  it.skip(
    'launchAVD should get all connected avds',
    {timeout: E2E_LONG_TIMEOUT},
    async function () {
      const proc = await adb.launchAVD(avdName);
      try {
        expect(await adb.getConnectedEmulators()).to.have.length.above(0);
      } finally {
        await proc.stop();
      }
    },
  );
  it('waitForDevice should get all connected avds', async function () {
    await adb.waitForDevice(2);
  });
  it(
    'reboot should reboot the device',
    {timeout: E2E_LONG_TIMEOUT},
    async function (ctx: TestContext) {
      if (process.env.CI) {
        // The test makes CI unstable
        return ctx.skip();
      }
      try {
        await adb.reboot();
        await adb.ping();
      } catch (e) {
        expect((e as Error).message).to.include('must be root');
      }
    },
  );
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
      expect(binary).to.have.property('version');
      expect(binary).to.have.property('build');
    }
    expect(bridge).to.have.property('version');
  });
});
