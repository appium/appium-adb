import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../../lib/adb.js';

chai.use(chaiAsPromised);

describe('Lock Management', function () {
  let adb;

  before(async function () {
    adb = await ADB.createADB();
    if (!await adb.isLockManagementSupported()) {
      return this.skip();
    }
  });
  it('lock credential cleanup should work', async function () {
    await adb.clearLockCredentials();
    await adb.isLockEnabled().should.eventually.be.false;
  });
});
