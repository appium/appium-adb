import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../../lib/adb.js';
import path from 'path';
import { exec } from 'teen_process';
import { system } from 'appium-support';
import { rootDir } from '../../lib/helpers.js';


const selendroidTestApp = path.resolve(rootDir, 'test',
                                       'fixtures', 'selendroid-test-app.apk'),
      contactManagerPath = path.resolve(rootDir, 'test',
                                        'fixtures', 'ContactManager.apk'),
      unsignJar = path.resolve(rootDir, 'jars', 'unsign.jar'),
      tmp = system.isWindows() ? 'C:\\Windows\\Temp' : '/tmp',
      keystorePath = path.resolve(rootDir, 'test',
                                  'fixtures', 'appiumtest.keystore'),
      keyAlias = 'appiumtest';

chai.use(chaiAsPromised);

describe('Apk-signing', async () => {
  let adb,
      unsignApk = async (apk) => { await exec('java', ['-jar', unsignJar, apk]); };

  before(async () => {
    adb = await ADB.createADB();
  });
  it('checkApkCert should return false for unsigned apk', async () => {
    await unsignApk(selendroidTestApp);
    (await adb.checkApkCert(selendroidTestApp, 'io.selendroid.testapp')).should.be.false;
  });
  it('checkApkCert should return true for signed apk', async () => {
    (await adb.checkApkCert(contactManagerPath, 'com.example.android.contactmanager')).should.be.true;
  });
  it('signWithDefaultCert should sign apk', async () => {
    await unsignApk(selendroidTestApp);
    (await adb.signWithDefaultCert(selendroidTestApp));
    (await adb.checkApkCert(selendroidTestApp, 'io.selendroid.testapp')).should.be.true;
  });
  it('signWithCustomCert should sign apk with custom certificate', async () => {
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
