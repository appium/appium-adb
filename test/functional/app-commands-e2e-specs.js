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

describe('app commands', function () {
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

  describe('app process management', function () {
    it('isAppRunning should be able to find ui process', async function () {
      (await adb.isAppRunning('com.android.systemui')).should.be.true;
    });

    it('listAppProcessIds should return pids', async function () {
      (await adb.listAppProcessIds('com.android.phone')).should.have.length.above(0);
    });

    it('forceStop should kill process', async function () {
      await adb.install(CONTACT_MANAGER_PATH, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.startApp({pkg: CONTACT_MANAGER_PKG, activity: CONTACT_MANAGER_ACTIVITY});
      const pids = await adb.listAppProcessIds(CONTACT_MANAGER_PKG);
      pids.should.have.length.above(0);
      await adb.forceStop(CONTACT_MANAGER_PKG);
      await waitForCondition(async () => !(await adb.isAppRunning(CONTACT_MANAGER_PKG)), {
        waitMs: 5000,
        intervalMs: 500,
      });
    });
  });

  describe('app data management', function () {
    it('should clear app data', async function () {
      await adb.install(CONTACT_MANAGER_PATH, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.startApp({pkg: CONTACT_MANAGER_PKG, activity: CONTACT_MANAGER_ACTIVITY});
      await adb.clear(CONTACT_MANAGER_PKG);
      // App should be stopped after clear
    });

    it('should stop and clear app', async function () {
      await adb.install(CONTACT_MANAGER_PATH, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.startApp({pkg: CONTACT_MANAGER_PKG, activity: CONTACT_MANAGER_ACTIVITY});
      await adb.stopAndClear(CONTACT_MANAGER_PKG);
      // App should be stopped and cleared
    });
  });

  describe('app permissions', function () {
    it('should grant all permissions', async function () {
      await adb.install(CONTACT_MANAGER_PATH, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.grantAllPermissions(CONTACT_MANAGER_PKG);
      // Should not throw an error
    });
  });

  describe('app information', function () {
    it('should get package info', async function () {
      await adb.install(CONTACT_MANAGER_PATH, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      const packageInfo = await adb.getPackageInfo(CONTACT_MANAGER_PKG);
      packageInfo.should.include(CONTACT_MANAGER_PKG);
    });

    it('should get focused package and activity', async function () {
      await adb.install(CONTACT_MANAGER_PATH, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.startApp({pkg: CONTACT_MANAGER_PKG, activity: CONTACT_MANAGER_ACTIVITY});
      const {appPackage} = await adb.getFocusedPackageAndActivity();
      appPackage.should.equal(CONTACT_MANAGER_PKG);
    });

    it('should dump windows', async function () {
      const windows = await adb.dumpWindows();
      windows.should.be.a('string');
      windows.length.should.be.above(0);
    });
  });

  describe('app activation', function () {
    it('should activate app', async function () {
      await adb.install(CONTACT_MANAGER_PATH, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.activateApp(CONTACT_MANAGER_PKG);
      // Should not throw an error
    });

    it('should start URI', async function () {
      await adb.startUri('https://example.com');
      // Should not throw an error
    });
  });

  describe('activity waiting', function () {
    it('should wait for activity', async function () {
      await adb.install(CONTACT_MANAGER_PATH, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.startApp({pkg: CONTACT_MANAGER_PKG, activity: CONTACT_MANAGER_ACTIVITY});
      await adb.waitForActivity(CONTACT_MANAGER_PKG, CONTACT_MANAGER_ACTIVITY, 5000);
      // Should not throw an error
    });

    it('should wait for not activity', async function () {
      await adb.install(CONTACT_MANAGER_PATH, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.startApp({pkg: CONTACT_MANAGER_PKG, activity: CONTACT_MANAGER_ACTIVITY});
      await adb.forceStop(CONTACT_MANAGER_PKG);
      await adb.waitForNotActivity(CONTACT_MANAGER_PKG, CONTACT_MANAGER_ACTIVITY, 5000);
      // Should not throw an error
    });

    it('should wait for activity or not', async function () {
      await adb.install(CONTACT_MANAGER_PATH, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.startApp({pkg: CONTACT_MANAGER_PKG, activity: CONTACT_MANAGER_ACTIVITY});
      await adb.waitForActivityOrNot(CONTACT_MANAGER_PKG, CONTACT_MANAGER_ACTIVITY, false, 5000);
      // Should not throw an error
    });
  });
});
