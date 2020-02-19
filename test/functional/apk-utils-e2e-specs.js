import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import path from 'path';
import { rootDir } from '../../lib/helpers.js';
import { retryInterval } from 'asyncbox';
import { MOCHA_TIMEOUT, MOCHA_LONG_TIMEOUT, apiLevel } from './setup';

const START_APP_WAIT_DURATION = 60000;
const START_APP_WAIT_DURATION_FAIL = process.env.CI ? 30000 : 10000;

chai.should();
chai.use(chaiAsPromised);

describe('apk utils', function () {
  this.timeout(MOCHA_TIMEOUT);

  let adb;
  const contactManagerPath = path.resolve(rootDir, 'test',
                                          'fixtures', 'ContactManager.apk');
  const apiDemosPath = path.resolve(rootDir, 'test',
                                    'fixtures', 'ApiDemos-debug.apk');
  const deviceTempPath = '/data/local/tmp/';
  const assertPackageAndActivity = async () => {
    let {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
    appPackage.should.equal('com.example.android.contactmanager');
    appActivity.should.equal('.ContactManager');
  };

  before(async function () {
    adb = await ADB.createADB({
      adbExecTimeout: (process.env.TRAVIS || process.env.CI) ? 60000 : 40000,
    });
  });
  it('should be able to check status of third party app', async function () {
    (await adb.isAppInstalled('com.android.phone')).should.be.true;
  });
  it('should be able to install/remove app and detect its status', async function () {
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
  describe('startUri', function () {
    it('should be able to start a uri', async function () {
      if (apiLevel < 23) {
        return this.skip();
      }
      await adb.goToHome();
      let res = await adb.getFocusedPackageAndActivity();
      res.appPackage.should.not.equal('com.android.contacts');
      await adb.install(contactManagerPath);
      await adb.startUri('content://contacts/people', 'com.android.contacts');
      await retryInterval(10, 500, async () => {
        res = await adb.dumpWindows();
        // depending on apilevel, app might show up as active in one of these
        // two dumpsys output formats
        let focusRe1 = '(mCurrentFocus.+\\.PeopleActivity)';
        let focusRe2 = '(mFocusedApp.+\\.PeopleActivity)';
        res.should.match(new RegExp(`${focusRe1}|${focusRe2}`));
      });
      await adb.goToHome();
    });
  });
  describe('startApp', function () {
    it('should be able to start with normal package and activity', async function () {
      await adb.install(contactManagerPath);
      await adb.startApp({
        pkg: 'com.example.android.contactmanager',
        activity: 'ContactManager',
        waitDuration: START_APP_WAIT_DURATION,
      });
      await assertPackageAndActivity();

    });
    it('should be able to start with an intent and no activity', async function () {
      this.timeout(MOCHA_LONG_TIMEOUT);
      await adb.install(contactManagerPath);
      await adb.startApp({
        action: 'android.intent.action.WEB_SEARCH',
        pkg: 'com.google.android.googlequicksearchbox',
        optionalIntentArguments: '-e query foo',
        waitDuration: START_APP_WAIT_DURATION,
        stopApp: false
      });
      let {appPackage} = await adb.getFocusedPackageAndActivity();
      const expectedPkgPossibilities = [
        'com.android.browser',
        'org.chromium.webview_shell',
        'com.google.android.googlequicksearchbox'
      ];
      expectedPkgPossibilities.should.include(appPackage);
    });
    it('should throw an error for unknown activity for intent', async function () {
      this.timeout(MOCHA_LONG_TIMEOUT);
      await adb.install(contactManagerPath);
      await adb.startApp({
        action: 'android.intent.action.DEFAULT',
        pkg: 'com.google.android.telephony',
        optionalIntentArguments: '-d tel:555-5555',
        waitDuration: START_APP_WAIT_DURATION,
        stopApp: false
      }).should.eventually.be.rejectedWith(/Cannot start the .* application/);
    });
    it('should throw error for wrong activity', async function () {
      await adb.install(contactManagerPath);
      await adb.startApp({
        pkg: 'com.example.android.contactmanager',
        activity: 'ContactManage',
        waitDuration: START_APP_WAIT_DURATION_FAIL,
      }).should.eventually.be.rejectedWith('Activity');
    });
    it('should throw error for wrong wait activity', async function () {
      await adb.install(contactManagerPath);
      await adb.startApp({
        pkg: 'com.example.android.contactmanager',
        activity: 'ContactManager',
        waitActivity: 'foo',
        waitDuration: START_APP_WAIT_DURATION_FAIL,
      }).should.eventually.be.rejectedWith('foo');
    });
    it('should start activity with wait activity', async function () {
      await adb.install(contactManagerPath);
      await adb.startApp({
        pkg: 'com.example.android.contactmanager',
        activity: 'ContactManager',
        waitActivity: '.ContactManager',
        waitDuration: START_APP_WAIT_DURATION,
      });
      await assertPackageAndActivity();
    });
    it('should start activity when wait activity is a wildcard', async function () {
      await adb.install(contactManagerPath);
      await adb.startApp({
        pkg: 'com.example.android.contactmanager',
        activity: 'ContactManager',
        waitActivity: '*',
        waitDuration: START_APP_WAIT_DURATION,
      });
      await assertPackageAndActivity();
    });
    it('should start activity when wait activity contains a wildcard', async function () {
      await adb.install(contactManagerPath);
      await adb.startApp({
        pkg: 'com.example.android.contactmanager',
        activity: 'ContactManager',
        waitActivity: '*.ContactManager',
        waitDuration: START_APP_WAIT_DURATION,
      });
      await assertPackageAndActivity();
    });
    it('should throw error for wrong activity when wait activity contains a wildcard', async function () {
      await adb.install(contactManagerPath);
      await adb.startApp({
        pkg: 'com.example.android.contactmanager',
        activity: 'SuperManager',
        waitActivity: '*.ContactManager',
        waitDuration: START_APP_WAIT_DURATION_FAIL,
      }).should.eventually.be.rejectedWith('Activity');
    });
    it('should throw error for wrong wait activity which contains wildcard', async function () {
      await adb.install(contactManagerPath);
      await adb.startApp({
        pkg: 'com.example.android.contactmanager',
        activity: 'ContactManager',
        waitActivity: '*.SuperManager',
        waitDuration: START_APP_WAIT_DURATION_FAIL,
      }).should.eventually.be.rejectedWith('SuperManager');
    });
    it('should start activity with comma separated wait packages list', async function () {
      await adb.install(contactManagerPath);
      await adb.startApp({
        pkg: 'com.example.android.contactmanager',
        waitPkg: 'com.android.settings, com.example.android.contactmanager',
        activity: 'ContactManager',
        waitActivity: '.ContactManager',
        waitDuration: START_APP_WAIT_DURATION,
      });
      await assertPackageAndActivity();
    });
    it('should throw error for wrong activity when packages provided as comma separated list', async function () {
      await adb.install(contactManagerPath);
      await adb.startApp({
        pkg: 'com.example.android.contactmanager',
        waitPkg: 'com.android.settings, com.example.somethingelse',
        activity: 'SuperManager',
        waitActivity: '*.ContactManager',
        waitDuration: START_APP_WAIT_DURATION_FAIL,
      }).should.eventually.be.rejectedWith('Activity');
    });
  });
  it('should start activity when start activity is an inner class', async function () {
    await adb.install(contactManagerPath);
    await adb.startApp({
      pkg: 'com.android.settings',
      activity: '.Settings$NotificationAppListActivity',
      waitDuration: START_APP_WAIT_DURATION,
    });
    let {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
    appPackage.should.equal('com.android.settings');
    appActivity.should.equal('.Settings$NotificationAppListActivity');
  });
  it('getFocusedPackageAndActivity should be able get package and activity', async function () {
    // The test sometimes fails due to Emulator slowness on Travis
    this.retries(2);

    await adb.install(contactManagerPath);
    await adb.startApp({
      pkg: 'com.example.android.contactmanager',
      activity: 'ContactManager',
      waitDuration: START_APP_WAIT_DURATION,
    });
    await assertPackageAndActivity();
  });
  it('extractStringsFromApk should get strings for default language', async function () {
    let {apkStrings} = await adb.extractStringsFromApk(contactManagerPath, null, '/tmp');
    apkStrings.save.should.equal('Save');
  });
  it('extractStringsFromApk should get strings for non-default language', async function () {
    let {apkStrings} = await adb.extractStringsFromApk(apiDemosPath, 'fr', '/tmp');
    apkStrings.linear_layout_8_horizontal.should.equal('Horizontal');
  });
  it('extractStringsFromApk should get strings for en language', async function () {
    let {apkStrings} = await adb.extractStringsFromApk(apiDemosPath, 'en', '/tmp');
    apkStrings.linear_layout_8_horizontal.should.equal('Horizontal');
  });
});
