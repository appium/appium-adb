import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import path from 'path';
import { rootDir } from '../../lib/helpers.js';
import { retryInterval } from 'asyncbox';
import { MOCHA_TIMEOUT } from './setup';

chai.should();
chai.use(chaiAsPromised);

describe('apk utils', function () {
  this.timeout(MOCHA_TIMEOUT);

  let adb;
  const contactManagerPath = path.resolve(rootDir, 'test',
                                          'fixtures', 'ContactManager.apk');
  const deviceTempPath = '/data/local/tmp/';
  const assertPackageAndActivity = async () => {
    let {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
    appPackage.should.equal('com.example.android.contactmanager');
    appActivity.should.equal('.ContactManager');
  };

  before(async () => {
    adb = await ADB.createADB();
  });
  it('should be able to check status of third party app', async () => {
    (await adb.isAppInstalled('com.android.phone')).should.be.true;
  });
  it('should be able to install/remove app and detect its status', async () => {
    (await adb.isAppInstalled('foo')).should.be.false;
    await adb.install(contactManagerPath);
    (await adb.isAppInstalled('com.example.android.contactmanager')).should.be.true;
    (await adb.uninstallApk('com.example.android.contactmanager')).should.be.true;
    (await adb.isAppInstalled('com.example.android.contactmanager')).should.be.false;
    (await adb.uninstallApk('com.example.android.contactmanager')).should.be.false;
    await adb.rimraf(deviceTempPath + 'ContactManager.apk');
    await adb.push(contactManagerPath, deviceTempPath);
    await adb.installFromDevicePath(deviceTempPath + 'ContactManager.apk');
  });
  describe('startUri', async () => {
    it('should be able to start a uri', async () => {
      await adb.goToHome();
      let res = await adb.getFocusedPackageAndActivity();
      res.appPackage.should.not.equal('com.android.contacts');
      await adb.install(contactManagerPath);
      await adb.startUri('content://contacts/people', 'com.android.contacts');
      await retryInterval(10, 500, async () => {
        res = await adb.shell(['dumpsys', 'window', 'windows']);
        // depending on apilevel, app might show up as active in one of these
        // two dumpsys output formats
        let focusRe1 = '(mCurrentFocus.+\\.PeopleActivity)';
        let focusRe2 = '(mFocusedApp.+\\.PeopleActivity)';
        res.should.match(new RegExp(`${focusRe1}|${focusRe2}`));
      });
      await adb.goToHome();
    });
  });
  describe('startApp', async () => {
    it('should be able to start', async () => {
      await adb.install(contactManagerPath);
      await adb.startApp({pkg: 'com.example.android.contactmanager',
                          activity: 'ContactManager'});
      await assertPackageAndActivity();

    });
    it('should throw error for wrong activity', async () => {
      await adb.install(contactManagerPath);
      await adb.startApp({pkg: 'com.example.android.contactmanager',
                          activity: 'ContactManage'}).should.eventually
                                                     .be.rejectedWith('Activity');
    });
    it('should throw error for wrong wait activity', async () => {
      await adb.install(contactManagerPath);
      await adb.startApp({pkg: 'com.example.android.contactmanager',
                          activity: 'ContactManager',
                          waitActivity: 'foo',
                          waitDuration: 1000}).should.eventually
                                              .be.rejectedWith('foo');
    });
    it('should start activity with wait activity', async () => {
      await adb.install(contactManagerPath);
      await adb.startApp({pkg: 'com.example.android.contactmanager',
                          activity: 'ContactManager',
                          waitActivity: '.ContactManager'});
      await assertPackageAndActivity();
    });
    it('should start activity when wait activity is a wildcard', async () => {
      await adb.install(contactManagerPath);
      await adb.startApp({pkg: 'com.example.android.contactmanager',
                          activity: 'ContactManager',
                          waitActivity: '*'});
      await assertPackageAndActivity();
    });
    it('should start activity when wait activity contains a wildcard', async () => {
      await adb.install(contactManagerPath);
      await adb.startApp({pkg: 'com.example.android.contactmanager',
                          activity: 'ContactManager',
                          waitActivity: '*.ContactManager'});
      await assertPackageAndActivity();
    });
    it('should throw error for wrong activity when wait activity contains a wildcard', async () => {
      await adb.install(contactManagerPath);
      await adb.startApp({pkg: 'com.example.android.contactmanager',
                          activity: 'SuperManager',
                          waitActivity: '*.ContactManager'}).should.eventually
                                                            .be.rejectedWith('Activity');
    });
    it('should throw error for wrong wait activity which contains wildcard', async () => {
      await adb.install(contactManagerPath);
      await adb.startApp({pkg: 'com.example.android.contactmanager',
                          activity: 'ContactManager',
                          waitActivity: '*.SuperManager'}).should.eventually
                                                          .be.rejectedWith('SuperManager');
    });
    it('should start activity with comma separated wait packages list', async () => {
      await adb.install(contactManagerPath);
      await adb.startApp({pkg: 'com.example.android.contactmanager',
        waitPkg: 'com.android.settings, com.example.android.contactmanager',
        activity: 'ContactManager',
        waitActivity: '.ContactManager'});
      await assertPackageAndActivity();
    });
    it('should throw error for wrong activity when packages provided as comma separated list', async () => {
      await adb.install(contactManagerPath);
      await adb.startApp({pkg: 'com.example.android.contactmanager',
        waitPkg: 'com.android.settings, com.example.somethingelse',
        activity: 'SuperManager',
        waitActivity: '*.ContactManager'}).should.eventually
        .be.rejectedWith('Activity');
    });
  });
  it('should start activity when start activity is an inner class', async () => {
    await adb.install(contactManagerPath);
    await adb.startApp({pkg: 'com.android.settings',
      activity: '.Settings$NotificationAppListActivity'});

    let {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
    appPackage.should.equal('com.android.settings');
    appActivity.should.equal('.Settings$NotificationAppListActivity');
  });
  it('getFocusedPackageAndActivity should be able get package and activity', async () => {
    await adb.install(contactManagerPath);
    await adb.startApp({pkg: 'com.example.android.contactmanager',
                        activity: 'ContactManager'});
    await assertPackageAndActivity();
  });
  it('extractStringsFromApk should get strings for default language', async () => {
    let {apkStrings} = await adb.extractStringsFromApk(contactManagerPath, null, '/tmp');
    apkStrings.save.should.equal('Save');
  });
});
