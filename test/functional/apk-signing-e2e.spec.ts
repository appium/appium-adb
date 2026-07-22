import {ADB} from '../../lib/adb.js';
import path from 'node:path';
import {fs, tempDir} from '@appium/support';
import {unsignApk} from '../../lib/tools/apk-signing.js';
import {getApiDemosPath} from './setup.js';
import {FIXTURES_ROOT} from '../constants.js';
import {use, expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {describe, it, before, beforeEach, afterEach} from 'node:test';

use(chaiAsPromised);

const keystorePath = path.resolve(FIXTURES_ROOT, 'appiumtest.keystore');
const keyAlias = 'appiumtest';

describe('Apk-signing', function () {
  let adb: ADB;
  let tmpDir: string;
  let apiDemosPath: string;

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
    expect(await adb.checkApkCert(apkCopy)).to.be.false;
  });
  it('checkApkCert should return true for signed apk', async function () {
    // ApiDemos APK is signed but not with the default Appium certificate
    // So we check with requireDefaultCert: false to verify it's signed
    expect(await adb.checkApkCert(apiDemosPath, {requireDefaultCert: false})).to.be.true;
  });
  it('signWithDefaultCert should sign apk', async function () {
    const apkCopy = path.resolve(tmpDir, path.basename(apiDemosPath));
    await fs.copyFile(apiDemosPath, apkCopy);
    await unsignApk(apkCopy);
    await adb.signWithDefaultCert(apkCopy);
    expect(await adb.checkApkCert(apkCopy)).to.be.true;
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
    expect(await customAdb.checkApkCert(apkCopy)).to.be.true;
  });
});
