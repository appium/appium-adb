import assert from 'node:assert/strict';
import {describe, it, before, type TestContext} from 'node:test';

import {ADB} from '../../lib/adb.js';

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
    assert.strictEqual(await adb.verifyLockCredential(), true);
    assert.strictEqual(await adb.isLockEnabled(), false);
  });

  describe('Lock and unlock life cycle', function () {
    const password = '1234';

    it('device lock and unlock scenario should work', async function (ctx: TestContext) {
      // We don't want to lock the device for all other tests if this test fails
      if (process.env.CI) {
        return ctx.skip();
      }

      try {
        await adb.setLockCredential('password', password);
        await adb.keyevent(26);
        assert.strictEqual(await adb.isLockEnabled(), true);
        assert.strictEqual(await adb.isScreenLocked(), true);
        await adb.clearLockCredential(password);
        await adb.cycleWakeUp();
        await adb.dismissKeyguard();
        assert.strictEqual(await adb.isLockEnabled(), false);
        assert.strictEqual(await adb.isScreenLocked(), false);
      } finally {
        await adb.clearLockCredential(password);
      }
    });
  });
});
