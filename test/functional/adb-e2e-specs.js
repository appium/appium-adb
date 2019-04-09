import _ from 'lodash';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import { fs } from 'appium-support';
import path from 'path';

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
  it.skip('should error out if binary not persent', async function () {
    // TODO write a negative test
  });
  it('should initialize aapt', async function () {
    let adb = new ADB();
    await adb.initAapt();
    adb.binaries.aapt.should.contain('aapt');
  });
  it('should initialize aapt using the enforced build tools path', async function () {
    const buildToolsRoot = path.resolve(process.env.ANDROID_HOME, 'build-tools');
    const buildToolsVersion = _.first(await fs.readdir(buildToolsRoot));
    const adb = new ADB({buildToolsVersion});
    await adb.initAapt();
    adb.binaries.aapt.should.contain('aapt');
  });
  it('should initialize zipAlign', async function () {
    let adb = new ADB();
    await adb.initZipAlign();
    adb.binaries.zipalign.should.contain('zipalign');
  });
});
