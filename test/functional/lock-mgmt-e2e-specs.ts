import {ADB} from '../../lib/adb';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

describe('Lock Management', function () {
  let adb;

  before(async function () {
    adb = await ADB.createADB();
    if (!(await adb.isLockManagementSupported())) {
      return this.skip();
    }
  });

  it('lock credential cleanup should work', async function () {
    if ((await adb.getApiLevel()) < 27) {
      return this.skip();
    }
    await adb.clearLockCredential();
    await expect(adb.verifyLockCredential()).to.eventually.be.true;
    await expect(adb.isLockEnabled()).to.eventually.be.false;
  });

  describe('Lock and unlock life cycle', function () {
    const password = '1234';

    before(function () {
      if (process.env.CI) {
        // We don't want to lock the device for all other tests if this test fails
        return this.skip();
      }
    });
    afterEach(async function () {
      await adb.clearLockCredential(password);
    });

    it('device lock and unlock scenario should work', async function () {
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
