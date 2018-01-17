import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';

const should = chai.should();
chai.use(chaiAsPromised);

describe('ADB', function () {
  it('should correctly return adb if present', async function () {
    let adb = await ADB.createADB();
    should.exist(adb.executable.path);
  });
  it('should correctly return adb from path when ANDROID_HOME is not set', async function () {
    let opts = {sdkRoot: ''};
    let adb = await ADB.createADB(opts);
    should.exist(adb.executable.path);
  });
  it.skip('should error out if binary not persent', async () => {
    // TODO write a negative test
  });
  it('should initialize aapt', async function () {
    let adb = new ADB();
    await adb.initAapt();
    adb.binaries.aapt.should.contain('aapt');
  });
  it('should initialize zipAlign', async function () {
    let adb = new ADB();
    await adb.initZipAlign();
    adb.binaries.zipalign.should.contain('zipalign');
  });
});
