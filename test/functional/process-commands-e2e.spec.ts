import assert from 'node:assert/strict';
import {describe, it, before, type TestContext} from 'node:test';

import {waitForCondition} from 'asyncbox';

import {ADB} from '../../lib/adb.js';
import {E2E_TIMEOUT, APIDEMOS_PKG, APIDEMOS_ACTIVITY, getApiDemosPath, ensureRootAccess} from './setup.js';

describe('process commands', {timeout: E2E_TIMEOUT}, function () {
  let adb: ADB;
  let apiDemosPath: string;
  const androidInstallTimeout = 90000;

  before(async function () {
    adb = await ADB.createADB({adbExecTimeout: 60000});
    apiDemosPath = await getApiDemosPath();
  });

  it('processExists should be able to find ui process', async function () {
    assert.strictEqual(await adb.processExists('com.android.systemui'), true);
  });

  it('getProcessIdsByName should return pids', async function () {
    assert.ok((await adb.getProcessIdsByName('com.android.phone')).length > 0);
  });

  it('should be able to get process name by ID', async function () {
    const pids = await adb.getProcessIdsByName('com.android.systemui');
    if (pids.length > 0) {
      const processName = await adb.getProcessNameById(pids[0]);
      assert.strictEqual(processName, 'com.android.systemui');
    }
  });

  it('should be able to kill processes by name', async function (ctx: TestContext) {
    if (!(await ensureRootAccess(adb))) {
      return ctx.skip();
    }

    // Install and start the test app
    await adb.install(apiDemosPath, {
      timeout: androidInstallTimeout,
      grantPermissions: true,
    });
    await adb.startApp({pkg: APIDEMOS_PKG, activity: APIDEMOS_ACTIVITY});

    // Verify the process is running
    const pids = await adb.getProcessIdsByName(APIDEMOS_PKG);
    assert.ok(pids.length > 0);

    // Kill the processes by name
    await adb.killProcessesByName(APIDEMOS_PKG);

    // Verify the process is no longer running
    await waitForCondition(async () => !(await adb.processExists(APIDEMOS_PKG)), {
      waitMs: 5000,
      intervalMs: 500,
    });
  });

  it('should be able to kill process by PID', async function (ctx: TestContext) {
    if (!(await ensureRootAccess(adb))) {
      return ctx.skip();
    }

    // Install and start the test app
    await adb.install(apiDemosPath, {
      timeout: androidInstallTimeout,
      grantPermissions: true,
    });
    await adb.startApp({pkg: APIDEMOS_PKG, activity: APIDEMOS_ACTIVITY});

    // Get the process ID
    const pids = await adb.getProcessIdsByName(APIDEMOS_PKG);
    assert.ok(pids.length > 0);
    const pid = pids[0];

    // Kill the process by PID
    await adb.killProcessByPID(pid);

    // Verify the process is no longer running
    await waitForCondition(async () => !(await adb.processExists(APIDEMOS_PKG)), {
      waitMs: 5000,
      intervalMs: 500,
    });
  });

  it('should handle non-existent process gracefully', async function () {
    // Try to get process IDs for a non-existent process
    const pids = await adb.getProcessIdsByName('com.nonexistent.app');
    assert.strictEqual(pids.length, 0);

    // Try to kill a non-existent process
    await adb.killProcessesByName('com.nonexistent.app');
    // Should not throw an error
  });

  it('should handle invalid PID gracefully', async function () {
    // Try to get process name for invalid PID
    try {
      await adb.getProcessNameById('invalid');
      // Should not reach here
      assert.fail('Expected error for invalid PID');
    } catch (error) {
      assert.ok((error as Error).message.includes('valid number'));
    }
  });
});
