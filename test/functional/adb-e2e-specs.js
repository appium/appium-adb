import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import ADB from '../../lib/adb.js';

const should = chai.should();
chai.use(chaiAsPromised);

describe('ADB', () => {
  it('should correctly return adb if present', async () => {
    let adb = new ADB();
    let temp = await adb.createADB();
    should.exist(temp.path);
  });
  it('should correctly return adb from path when ANDROID_HOME is not set', async () => {
    let opts = {sdkRoot: ''};
    let adb = new ADB(opts);
    let temp = await adb.createADB(opts);
    should.exist(temp.path);
  });
  it.skip('should error out if binary not persent', async () => {
    // TODO write a negative test
  });
  it('should initialize aapt', async () => {
    let adb = new ADB();
    await adb.initAapt();
    adb.binaries.aapt.should.contain('aapt');
  });
  it('should initialize zipAlign', async () => {
    let adb = new ADB();
    await adb.initZipAlign();
    adb.binaries.zipalign.should.contain('zipalign');
  });
});
