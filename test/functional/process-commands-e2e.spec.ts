import {ADB} from '../../lib/adb';
import {
  E2E_TIMEOUT,
  APIDEMOS_PKG,
  APIDEMOS_ACTIVITY,
  getApiDemosPath,
  ensureRootAccess,
} from './setup';
import {waitForCondition} from 'asyncbox';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {describe, it, before, type TestContext} from 'node:test';

chai.use(chaiAsPromised);

describe('process commands', {timeout: E2E_TIMEOUT}, function () {
  let adb: ADB;
  let apiDemosPath: string;
  const androidInstallTimeout = 90000;

  before(async function () {
    adb = await ADB.createADB({adbExecTimeout: 60000});
    apiDemosPath = await getApiDemosPath();
  });

  it('processExists should be able to find ui process', async function () {
    expect(await adb.processExists('com.android.systemui')).to.be.true;
  });

  it('getProcessIdsByName should return pids', async function () {
    expect(await adb.getProcessIdsByName('com.android.phone')).to.have.length.above(0);
  });

  it('should be able to get process name by ID', async function () {
    const pids = await adb.getProcessIdsByName('com.android.systemui');
    if (pids.length > 0) {
      const processName = await adb.getProcessNameById(pids[0]);
      expect(processName).to.equal('com.android.systemui');
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
    expect(pids).to.have.length.above(0);

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
    expect(pids).to.have.length.above(0);
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
    expect(pids).to.have.length(0);

    // Try to kill a non-existent process
    await adb.killProcessesByName('com.nonexistent.app');
    // Should not throw an error
  });

  it('should handle invalid PID gracefully', async function () {
    // Try to get process name for invalid PID
    try {
      await adb.getProcessNameById('invalid');
      // Should not reach here
      expect.fail('Expected error for invalid PID');
    } catch (error) {
      expect((error as Error).message).to.include('valid number');
    }
  });
});
