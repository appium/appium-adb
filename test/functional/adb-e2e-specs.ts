import _ from 'lodash';
import {ADB} from '../../lib/adb';
import {fs} from '@appium/support';
import path from 'node:path';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

describe('ADB', function () {
  it('should correctly return adb if present', async function () {
    const adb = await ADB.createADB();
    expect(adb.executable.path);
  });
  it('should throw when ANDROID_HOME is ivalid', async function () {
    const opts = {sdkRoot: '/aasdasdds'};
    await expect(ADB.createADB(opts)).to.eventually.be.rejected;
  });
  it.skip('should error out if binary not persent', async function () {
    // TODO write a negative test
  });
  it('should initialize aapt', async function () {
    const adb = new ADB();
    await adb.initAapt();
    expect(adb.binaries!.aapt).to.contain('aapt');
  });
  it('should initialize aapt using the enforced build tools path', async function () {
    const buildToolsRoot = path.resolve(process.env.ANDROID_HOME!, 'build-tools');
    const buildToolsVersion = _.first(await fs.readdir(buildToolsRoot));
    const adb = new ADB({buildToolsVersion: buildToolsVersion || undefined});
    await adb.initAapt();
    expect(adb.binaries!.aapt).to.contain('aapt');
  });
  it('should initialize zipAlign', async function () {
    const adb = new ADB();
    await adb.initZipAlign();
    expect(adb.binaries!.zipalign).to.contain('zipalign');
  });
  it('should correctly initialize adb from parent', async function () {
    const adb = await ADB.createADB();
    expect(adb.executable.path);
    const clone = adb.clone();
    expect(clone.executable.path);
    expect(adb.executable.path).to.equal(clone.executable.path);
  });
});
