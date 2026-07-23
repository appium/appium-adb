import {ADB} from '../../lib/adb.js';
import {E2E_TIMEOUT, APIDEMOS_PKG, APIDEMOS_ACTIVITY, getApiDemosPath} from './setup.js';
import {waitForCondition} from 'asyncbox';
import {use, expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {describe, it, before, type TestContext} from 'node:test';

use(chaiAsPromised);

describe('app commands', {timeout: E2E_TIMEOUT}, function () {
  let adb: ADB;
  let apiDemosPath: string;
  const androidInstallTimeout = 90000;
  before(async function () {
    adb = await ADB.createADB({adbExecTimeout: 60000});
    apiDemosPath = await getApiDemosPath();
  });

  describe('app process management', function () {
    it('isAppRunning should be able to find ui process', async function () {
      expect(await adb.isAppRunning('com.android.systemui')).to.be.true;
    });

    it('listAppProcessIds should return pids', async function () {
      expect(await adb.listAppProcessIds('com.android.phone')).to.have.length.above(0);
    });

    it('forceStop should kill process', async function () {
      await adb.install(apiDemosPath, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.startApp({pkg: APIDEMOS_PKG, activity: APIDEMOS_ACTIVITY});
      const pids = await adb.listAppProcessIds(APIDEMOS_PKG);
      expect(pids).to.have.length.above(0);
      await adb.forceStop(APIDEMOS_PKG);
      // Add a small delay to allow the process to fully stop
      await new Promise((resolve) => setTimeout(resolve, 500));
      await waitForCondition(async () => !(await adb.isAppRunning(APIDEMOS_PKG)), {
        waitMs: 10000,
        intervalMs: 500,
      });
    });
  });

  describe('app data management', function () {
    it('should clear app data', async function () {
      await adb.install(apiDemosPath, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.startApp({pkg: APIDEMOS_PKG, activity: APIDEMOS_ACTIVITY});
      await adb.clear(APIDEMOS_PKG);
      // App should be stopped after clear
    });

    it('should stop and clear app', async function () {
      await adb.install(apiDemosPath, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.startApp({pkg: APIDEMOS_PKG, activity: APIDEMOS_ACTIVITY});
      await adb.stopAndClear(APIDEMOS_PKG);
      // App should be stopped and cleared
    });
  });

  describe('app permissions', function () {
    it('should grant all permissions', async function () {
      await adb.install(apiDemosPath, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.grantAllPermissions(APIDEMOS_PKG);
      // Should not throw an error
    });
  });

  describe('app information', function () {
    it('should get package info', async function () {
      await adb.install(apiDemosPath, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      const packageInfo = await adb.getPackageInfo(APIDEMOS_PKG);
      expect(packageInfo.name).to.equal(APIDEMOS_PKG);
      expect(packageInfo.isInstalled).to.be.true;
    });

    it('should get focused package and activity', async function (ctx: TestContext) {
      if ((await adb.getApiLevel()) > 30) {
        return ctx.skip();
      }
      await adb.install(apiDemosPath, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.startApp({pkg: APIDEMOS_PKG, activity: APIDEMOS_ACTIVITY});
      const {appPackage} = await adb.getFocusedPackageAndActivity();
      expect(appPackage).to.equal(APIDEMOS_PKG);
    });

    it('should dump windows', async function () {
      const windows = await adb.dumpWindows();
      expect(windows).to.be.a('string');
      expect(windows.length).to.be.above(0);
    });
  });

  describe('activity waiting', function () {
    it('should wait for activity', async function (ctx: TestContext) {
      if ((await adb.getApiLevel()) > 30) {
        return ctx.skip();
      }
      await adb.install(apiDemosPath, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.startApp({pkg: APIDEMOS_PKG, activity: APIDEMOS_ACTIVITY});
      await adb.waitForActivity(APIDEMOS_PKG, APIDEMOS_ACTIVITY, 5000);
      // Should not throw an error
    });

    it('should wait for not activity', async function () {
      await adb.install(apiDemosPath, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.startApp({pkg: APIDEMOS_PKG, activity: APIDEMOS_ACTIVITY});
      await adb.forceStop(APIDEMOS_PKG);
      // Add a small delay to allow the activity to fully stop
      await new Promise((resolve) => setTimeout(resolve, 500));
      await adb.waitForNotActivity(APIDEMOS_PKG, APIDEMOS_ACTIVITY, 10000);
      // Should not throw an error
    });

    it('should wait for activity or not', async function () {
      await adb.install(apiDemosPath, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      await adb.startApp({pkg: APIDEMOS_PKG, activity: APIDEMOS_ACTIVITY});
      await adb.waitForActivityOrNot(APIDEMOS_PKG, APIDEMOS_ACTIVITY, false, 5000);
      // Should not throw an error
    });
  });
});
