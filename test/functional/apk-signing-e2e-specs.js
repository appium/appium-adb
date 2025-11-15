import {ADB} from '../../lib/adb';
import path from 'path';
import { fs, tempDir } from '@appium/support';
import { unsignApk } from '../../lib/tools/apk-signing';
import { CONTACT_MANAGER_PATH, CONTACT_MANAGER_PKG } from './setup';

const fixturesRoot = path.resolve(__dirname, '..', 'fixtures');
const keystorePath = path.resolve(fixturesRoot, 'appiumtest.keystore');
const keyAlias = 'appiumtest';

describe('Apk-signing', function () {
  let adb;
  let expect;
  let tmpDir;

  before(async function () {
    const chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.use(chaiAsPromised.default);
    expect = chai.expect;

    adb = await ADB.createADB();
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
    const apkCopy = path.resolve(tmpDir, path.basename(CONTACT_MANAGER_PATH));
    await fs.copyFile(CONTACT_MANAGER_PATH, apkCopy);
    await unsignApk(apkCopy);
    expect(await adb.checkApkCert(apkCopy, CONTACT_MANAGER_PKG)).to.be.false;
  });
  it('checkApkCert should return true for signed apk', async function () {
    expect(await adb.checkApkCert(CONTACT_MANAGER_PATH, CONTACT_MANAGER_PKG)).to.be.true;
  });
  it('signWithDefaultCert should sign apk', async function () {
    const apkCopy = path.resolve(tmpDir, path.basename(CONTACT_MANAGER_PATH));
    await fs.copyFile(CONTACT_MANAGER_PATH, apkCopy);
    await unsignApk(apkCopy);
    (await adb.signWithDefaultCert(apkCopy));
    expect(await adb.checkApkCert(apkCopy, CONTACT_MANAGER_PKG)).to.be.true;
  });
  it('signWithCustomCert should sign apk with custom certificate', async function () {
    const customAdb = await ADB.createADB();
    const apkCopy = path.resolve(tmpDir, path.basename(CONTACT_MANAGER_PATH));
    await fs.copyFile(CONTACT_MANAGER_PATH, apkCopy);
    await unsignApk(apkCopy);
    customAdb.keystorePath = keystorePath;
    customAdb.keyAlias = keyAlias;
    customAdb.useKeystore = true;
    customAdb.keystorePassword = 'android';
    customAdb.keyPassword = 'android';
    (await customAdb.signWithCustomCert(apkCopy));
    expect(await customAdb.checkApkCert(apkCopy, CONTACT_MANAGER_PKG)).to.be.true;
  });
});
