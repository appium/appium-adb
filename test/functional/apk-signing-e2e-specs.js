import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../../lib/adb.js';
import path from 'path';
import os from 'os';
import { rootDir, unsignApk } from '../../lib/helpers.js';


const fixturesRoot = path.resolve(rootDir, 'test', 'fixtures');
const selendroidTestApp = path.resolve(fixturesRoot, 'selendroid-test-app.apk');
const contactManagerPath = path.resolve(fixturesRoot, 'ContactManager.apk');
const tmp = os.tmpdir();
const keystorePath = path.resolve(fixturesRoot, 'appiumtest.keystore');
const keyAlias = 'appiumtest';

chai.use(chaiAsPromised);

describe('Apk-signing', function () {
  let adb;

  before(async function () {
    adb = await ADB.createADB();
  });
  it('checkApkCert should return false for unsigned apk', async function () {
    await unsignApk(selendroidTestApp);
    (await adb.checkApkCert(selendroidTestApp, 'io.selendroid.testapp')).should.be.false;
  });
  it('checkApkCert should return true for signed apk', async function () {
    (await adb.checkApkCert(contactManagerPath, 'com.example.android.contactmanager')).should.be.true;
  });
  it('signWithDefaultCert should sign apk', async function () {
    await unsignApk(selendroidTestApp);
    (await adb.signWithDefaultCert(selendroidTestApp));
    (await adb.checkApkCert(selendroidTestApp, 'io.selendroid.testapp')).should.be.true;
  });
  it('signWithCustomCert should sign apk with custom certificate', async function () {
    await unsignApk(selendroidTestApp);
    adb.keystorePath = keystorePath;
    adb.keyAlias = keyAlias;
    adb.useKeystore = true;
    adb.keystorePassword = 'android';
    adb.keyPassword = 'android';
    adb.tmpDir = tmp;
    (await adb.signWithCustomCert(selendroidTestApp));
    (await adb.checkCustomApkCert(selendroidTestApp, 'io.selendroid.testapp')).should.be.true;
  });
});
