import {ADB} from '../../lib/adb';
import path from 'path';
import {fs, tempDir} from '@appium/support';
import {unsignApk} from '../../lib/tools/apk-signing';
import {APIDEMOS_PKG, getApiDemosPath} from './setup';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

const fixturesRoot = path.resolve(__dirname, '..', 'fixtures');
const keystorePath = path.resolve(fixturesRoot, 'appiumtest.keystore');
const keyAlias = 'appiumtest';

describe('Apk-signing', function () {
  let adb;
  let tmpDir;
  let apiDemosPath;

  before(async function () {
    adb = await ADB.createADB();
    apiDemosPath = await getApiDemosPath();
  });

  beforeEach(async function () {
    tmpDir = await tempDir.openDir();
  });

  afterEach(async function () {
    if (tmpDir) {
      await fs.rimraf(tmpDir);
    }
  });

  it('checkApkCert should return false for unsigned apk', async function () {
    const apkCopy = path.resolve(tmpDir, path.basename(apiDemosPath));
    await fs.copyFile(apiDemosPath, apkCopy);
    await unsignApk(apkCopy);
    expect(await adb.checkApkCert(apkCopy, APIDEMOS_PKG)).to.be.false;
  });
  it('checkApkCert should return true for signed apk', async function () {
    // ApiDemos APK is signed but not with the default Appium certificate
    // So we check with requireDefaultCert: false to verify it's signed
    expect(await adb.checkApkCert(apiDemosPath, APIDEMOS_PKG, {requireDefaultCert: false})).to.be
      .true;
  });
  it('signWithDefaultCert should sign apk', async function () {
    const apkCopy = path.resolve(tmpDir, path.basename(apiDemosPath));
    await fs.copyFile(apiDemosPath, apkCopy);
    await unsignApk(apkCopy);
    await adb.signWithDefaultCert(apkCopy);
    expect(await adb.checkApkCert(apkCopy, APIDEMOS_PKG)).to.be.true;
  });
  it('signWithCustomCert should sign apk with custom certificate', async function () {
    const customAdb = await ADB.createADB();
    const apkCopy = path.resolve(tmpDir, path.basename(apiDemosPath));
    await fs.copyFile(apiDemosPath, apkCopy);
    await unsignApk(apkCopy);
    customAdb.keystorePath = keystorePath;
    customAdb.keyAlias = keyAlias;
    customAdb.useKeystore = true;
    customAdb.keystorePassword = 'android';
    customAdb.keyPassword = 'android';
    await customAdb.signWithCustomCert(apkCopy);
    expect(await customAdb.checkApkCert(apkCopy, APIDEMOS_PKG)).to.be.true;
  });
});
