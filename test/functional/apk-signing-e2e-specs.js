import {ADB} from '../../lib/adb';
import path from 'path';
import os from 'os';
import { unsignApk } from '../../lib/tools/apk-signing';
import { apiLevel } from './setup';

apiLevel
const fixturesRoot = path.resolve(__dirname, '..', 'fixtures');
const selendroidTestApp = path.resolve(fixturesRoot, 'selendroid-test-app.apk');
const contactManagerPath = apiLevel < 23
  ? path.resolve(fixturesRoot, 'ContactManager-old.apk')
  : path.resolve(fixturesRoot, 'ContactManager.apk');
const tmp = os.tmpdir();
const keystorePath = path.resolve(fixturesRoot, 'appiumtest.keystore');
const keyAlias = 'appiumtest';
const CONTACT_MANAGER_APP_ID = apiLevel < 23
  ? 'com.example.android.contactmanager'
  : 'com.saucelabs.contactmanager';

  describe('Apk-signing', function () {
  let adb;
  let chai;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.should();
    chai.use(chaiAsPromised.default);

    adb = await ADB.createADB();
  });
  it('checkApkCert should return false for unsigned apk', async function () {
    await unsignApk(selendroidTestApp);
    (await adb.checkApkCert(selendroidTestApp, 'io.selendroid.testapp')).should.be.false;
  });
  it('checkApkCert should return true for signed apk', async function () {
    (await adb.checkApkCert(contactManagerPath, CONTACT_MANAGER_APP_ID)).should.be.true;
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
    (await adb.checkApkCert(selendroidTestApp, 'io.selendroid.testapp')).should.be.true;
  });
});
