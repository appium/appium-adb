import {ADB} from '../../lib/adb';
import {
  MOCHA_TIMEOUT,
  APIDEMOS_PKG,
  APIDEMOS_ACTIVITY,
  getApiDemosPath,
} from './setup';
import { waitForCondition } from 'asyncbox';

describe('process commands', function () {
  this.timeout(MOCHA_TIMEOUT);

  let adb;
  let chai;
  let apiDemosPath;
  const androidInstallTimeout = 90000;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.should();
    chai.use(chaiAsPromised.default);

    adb = await ADB.createADB({ adbExecTimeout: 60000 });
    apiDemosPath = await getApiDemosPath();
  });

  it('processExists should be able to find ui process', async function () {
    (await adb.processExists('com.android.systemui')).should.be.true;
  });

  it('getProcessIdsByName should return pids', async function () {
    (await adb.getProcessIdsByName('com.android.phone')).should.have.length.above(0);
  });

  it('should be able to get process name by ID', async function () {
    const pids = await adb.getProcessIdsByName('com.android.systemui');
    if (pids.length > 0) {
      const processName = await adb.getProcessNameById(pids[0]);
      processName.should.equal('com.android.systemui');
    }
  });

  it('should be able to kill processes by name', async function () {
    // Skip if device doesn't have root access (required for killing processes)
    const hasRoot = await adb.isRoot().catch(() => false);
    if (!hasRoot) {
      // Try to get root, but skip if it fails
      const rootResult = await adb.root();
      if (!rootResult.isSuccessful) {
        return this.skip('Device does not have root access, which is required for killing processes');
      }
    }

    // Install and start the test app
    await adb.install(apiDemosPath, {
      timeout: androidInstallTimeout,
      grantPermissions: true,
    });
    await adb.startApp({pkg: APIDEMOS_PKG, activity: APIDEMOS_ACTIVITY});

    // Verify the process is running
    const pids = await adb.getProcessIdsByName(APIDEMOS_PKG);
    pids.should.have.length.above(0);

    // Kill the processes by name
    await adb.killProcessesByName(APIDEMOS_PKG);

    // Verify the process is no longer running
    await waitForCondition(async () => !(await adb.processExists(APIDEMOS_PKG)), {
      waitMs: 5000,
      intervalMs: 500,
    });
  });

  it('should be able to kill process by PID', async function () {
    // Skip if device doesn't have root access (required for killing processes)
    const hasRoot = await adb.isRoot().catch(() => false);
    if (!hasRoot) {
      // Try to get root, but skip if it fails
      const rootResult = await adb.root();
      if (!rootResult.isSuccessful) {
        return this.skip('Device does not have root access, which is required for killing processes');
      }
    }

    // Install and start the test app
    await adb.install(apiDemosPath, {
      timeout: androidInstallTimeout,
      grantPermissions: true,
    });
    await adb.startApp({pkg: APIDEMOS_PKG, activity: APIDEMOS_ACTIVITY});

    // Get the process ID
    const pids = await adb.getProcessIdsByName(APIDEMOS_PKG);
    pids.should.have.length.above(0);
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
    pids.should.have.length(0);

    // Try to kill a non-existent process
    await adb.killProcessesByName('com.nonexistent.app');
    // Should not throw an error
  });

  it('should handle invalid PID gracefully', async function () {
    // Try to get process name for invalid PID
    try {
      await adb.getProcessNameById('invalid');
      // Should not reach here
      chai.should().fail('Expected error for invalid PID');
    } catch (error) {
      error.message.should.include('valid number');
    }
  });
});
