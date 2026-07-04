import {ADB} from '../../lib/adb';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {describe, it, before, afterEach, type TestContext} from 'node:test';

chai.use(chaiAsPromised);

describe('Lock Management', function () {
  let adb: ADB;

  before(async function () {
    adb = await ADB.createADB();
  });

  it('lock credential cleanup should work', async function (ctx: TestContext) {
    if ((await adb.getApiLevel()) < 27 || !(await adb.isLockManagementSupported())) {
      return ctx.skip();
    }
    await adb.clearLockCredential();
    await expect(adb.verifyLockCredential()).to.eventually.be.true;
    await expect(adb.isLockEnabled()).to.eventually.be.false;
  });

  describe('Lock and unlock life cycle', function () {
    const password = '1234';

    afterEach(async function () {
      await adb.clearLockCredential(password);
    });

    it('device lock and unlock scenario should work', async function (ctx: TestContext) {
      // We don't want to lock the device for all other tests if this test fails
      if (process.env.CI) {
        return ctx.skip();
      }

      await adb.setLockCredential('password', password);
      await adb.keyevent(26);
      await expect(adb.isLockEnabled()).to.eventually.be.true;
      await expect(adb.isScreenLocked()).to.eventually.be.true;
      await adb.clearLockCredential(password);
      await adb.cycleWakeUp();
      await adb.dismissKeyguard();
      await expect(adb.isLockEnabled()).to.eventually.be.false;
      await expect(adb.isScreenLocked()).to.eventually.be.false;
    });
  });
});
