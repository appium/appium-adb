import assert from 'node:assert/strict';
import path from 'node:path';
import {describe, it, before, type TestContext} from 'node:test';

import {fs} from '@appium/support';

import {ADB} from '../../lib/adb.js';
import {getResourcePath} from '../../lib/utils/index.js';
import {E2E_TIMEOUT, E2E_LONG_TIMEOUT} from './setup.js';

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
    assert.ok(devices.length > 0);
  });
  it('getDevicesWithRetry should get devices', async function () {
    const devices = await adb.getDevicesWithRetry();
    assert.ok(devices.length > 0);
  });
  it('adbExec should get devices when with devices', async function () {
    assert.ok((await adb.adbExec('devices')).includes('List of devices attached'));
  });
  it('isDeviceConnected should be true', async function () {
    assert.strictEqual(await adb.isDeviceConnected(), true);
  });
  it('shell should execute command in adb shell ', async function () {
    const apiLevel = await adb.getApiLevel();
    assert.strictEqual(await adb.shell(['getprop', 'ro.build.version.sdk']), `${apiLevel}`);
  });
  it('shell should return stderr from adb with full output', async function () {
    const apiLevel = await adb.getApiLevel();
    const minStderrApiLevel = 24;
    const fullShellOutput = await adb.shell(['content', 'read', '--uri', 'content://doesnotexist'], {
      outputFormat: adb.EXEC_OUTPUT_FORMAT.FULL,
    });
    const outputWithError = apiLevel < minStderrApiLevel ? fullShellOutput.stdout : fullShellOutput.stderr;
    assert.ok(outputWithError.includes('Error while accessing provider'));
  });
  it('shell should return stdout from adb shell with full output', async function () {
    const apiLevel = await adb.getApiLevel();
    const fullShellOutput = await adb.shell(['getprop', 'ro.build.version.sdk'], {
      outputFormat: adb.EXEC_OUTPUT_FORMAT.FULL,
    });
    assert.strictEqual(fullShellOutput.stderr, '');
    assert.strictEqual(fullShellOutput.stdout, `${apiLevel}`);
  });
  it('getConnectedEmulators should get all connected emulators', async function () {
    assert.ok((await adb.getConnectedEmulators()).length > 0);
  });
  it('getRunningAVD should get all connected avd', async function () {
    assert.notStrictEqual(await adb.getRunningAVD(avdName), null);
  });
  it('getRunningAVDWithRetry should get all connected avds', async function () {
    assert.notStrictEqual(await adb.getRunningAVDWithRetry(avdName), null);
  });
  // Skipping for now. Will unskip depending on how it behaves on CI
  it.skip('launchAVD should get all connected avds', {timeout: E2E_LONG_TIMEOUT}, async function () {
    const proc = await adb.launchAVD(avdName);
    try {
      assert.ok((await adb.getConnectedEmulators()).length > 0);
    } finally {
      await proc.stop();
    }
  });
  it('waitForDevice should get all connected avds', async function () {
    await adb.waitForDevice(2);
  });
  it('reboot should reboot the device', {timeout: E2E_LONG_TIMEOUT}, async function (ctx: TestContext) {
    if (process.env.CI) {
      // The test makes CI unstable
      return ctx.skip();
    }
    try {
      await adb.reboot();
      await adb.ping();
    } catch (e) {
      assert.ok((e as Error).message.includes('must be root'));
    }
  });
  it('fileExists should detect when files do and do not exist', async function () {
    assert.strictEqual(await adb.fileExists('/foo/bar/baz.zip'), false);
    assert.strictEqual(await adb.fileExists('/data/local/tmp'), true);
  });
  it('ls should list files', async function () {
    assert.deepStrictEqual(await adb.ls('/foo/bar'), []);
    await adb.shell(['touch', '/data/local/tmp/test']);
    assert.ok((await adb.ls('/data/local/tmp')).includes('test'));
  });
  it('should check if the given certificate is already installed', async function () {
    const certBuffer = await fs.readFile(await getResourcePath(DEFAULT_CERTIFICATE));
    assert.strictEqual(await adb.isMitmCertificateInstalled(certBuffer), false);
  });
  it('should return version', async function () {
    const {binary, bridge} = await adb.getVersion();
    if (binary) {
      assert.ok('version' in binary);
      assert.ok('build' in binary);
    }
    assert.ok('version' in bridge);
  });
});
