import {ADB} from '../../lib/adb';
import path from 'path';
import { apiLevel, MOCHA_TIMEOUT } from './setup';
import { waitForCondition } from 'asyncbox';

const CONTACT_MANAGER_PATH = apiLevel < 23
  ? path.resolve(__dirname, '..', 'fixtures', 'ContactManager-old.apk')
  : path.resolve(__dirname, '..', 'fixtures', 'ContactManager.apk');
const CONTACT_MANAGER_PKG = apiLevel < 23
  ? 'com.example.android.contactmanager'
  : 'com.saucelabs.ContactManager';
const CONTACT_MANAGER_ACTIVITY = apiLevel < 23
  ? 'ContactManager'
  : 'com.saucelabs.ContactManager.ContactManager';

describe('process commands', function () {
  this.timeout(MOCHA_TIMEOUT);

  let adb;
  let chai;
  const androidInstallTimeout = 90000;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.should();
    chai.use(chaiAsPromised.default);

    adb = await ADB.createADB({ adbExecTimeout: 60000 });
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
    // Install and start the test app
    await adb.install(CONTACT_MANAGER_PATH, {
      timeout: androidInstallTimeout,
      grantPermissions: true,
    });
    await adb.startApp({pkg: CONTACT_MANAGER_PKG, activity: CONTACT_MANAGER_ACTIVITY});

    // Verify the process is running
    const pids = await adb.getProcessIdsByName(CONTACT_MANAGER_PKG);
    pids.should.have.length.above(0);

    // Kill the processes by name
    await adb.killProcessesByName(CONTACT_MANAGER_PKG);

    // Verify the process is no longer running
    await waitForCondition(async () => !(await adb.processExists(CONTACT_MANAGER_PKG)), {
      waitMs: 5000,
      intervalMs: 500,
    });
  });

  it('should be able to kill process by PID', async function () {
    // Install and start the test app
    await adb.install(CONTACT_MANAGER_PATH, {
      timeout: androidInstallTimeout,
      grantPermissions: true,
    });
    await adb.startApp({pkg: CONTACT_MANAGER_PKG, activity: CONTACT_MANAGER_ACTIVITY});

    // Get the process ID
    const pids = await adb.getProcessIdsByName(CONTACT_MANAGER_PKG);
    pids.should.have.length.above(0);
    const pid = pids[0];

    // Kill the process by PID
    await adb.killProcessByPID(pid);

    // Verify the process is no longer running
    await waitForCondition(async () => !(await adb.processExists(CONTACT_MANAGER_PKG)), {
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
