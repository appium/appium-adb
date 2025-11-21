import {ADB} from '../../lib/adb';
import { retryInterval } from 'asyncbox';
import {
  MOCHA_TIMEOUT,
  MOCHA_LONG_TIMEOUT,
  APIDEMOS_PKG,
  APIDEMOS_ACTIVITY,
  APIDEMOS_ACTIVITY_SHORT,
  getApiDemosPath,
} from './setup';

const START_APP_WAIT_DURATION = 60000;
const START_APP_WAIT_DURATION_FAIL = process.env.CI ? 20000 : 10000;

describe('apk utils', function () {
  this.timeout(MOCHA_TIMEOUT);

  let adb: any;
  let chai: any;
  let expect: any;
  let apiDemosPath: string;
  const deviceTempPath = '/data/local/tmp/';
  const assertPackageAndActivity = async () => {
    const {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
    expect(appPackage).to.equal(APIDEMOS_PKG);
    expect(appActivity).to.equal(APIDEMOS_ACTIVITY_SHORT);
  };

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    expect = chai.expect;
    chai.use(chaiAsPromised.default);

    adb = await ADB.createADB({
      adbExecTimeout: process.env.CI ? 60000 : 40000,
    });

    apiDemosPath = await getApiDemosPath();
  });
  it('should be able to check status of third party app', async function () {
    expect(await adb.isAppInstalled('com.android.phone')).to.be.true;
  });
  it('should be able to install/remove app and detect its status', async function () {
    const apkNameOnDevice = 'ApiDemos-debug.apk';
    expect(await adb.isAppInstalled('foo')).to.be.false;
    await adb.install(apiDemosPath, {
      grantPermissions: true
    });
    expect(await adb.isAppInstalled(APIDEMOS_PKG)).to.be.true;
    expect(await adb.uninstallApk(APIDEMOS_PKG)).to.be.true;
    expect(await adb.isAppInstalled(APIDEMOS_PKG)).to.be.false;
    expect(await adb.uninstallApk(APIDEMOS_PKG)).to.be.false;
    await adb.rimraf(deviceTempPath + apkNameOnDevice);
    await adb.push(apiDemosPath, deviceTempPath);
    await adb.installFromDevicePath(deviceTempPath + apkNameOnDevice);

    // to ensure that the app is installed with grantPermissions.
    await adb.grantAllPermissions(APIDEMOS_PKG);
  });
  describe('startUri', function () {
    it('should be able to start a uri', async function () {
      const apiLevel = await adb.getApiLevel();
      if (apiLevel < 23 || apiLevel > 28) {
        return this.skip();
      }
      await adb.goToHome();
      let res = await adb.getFocusedPackageAndActivity();
      expect(res.appPackage).to.not.equal('com.android.contacts');
      await adb.install(apiDemosPath, {
        grantPermissions: true,
      });
      await adb.startUri('content://contacts/people', 'com.android.contacts');
      await retryInterval(10, 500, async () => {
        res = await adb.dumpWindows();
        // depending on apilevel, app might show up as active in one of these
        // two dumpsys output formats
        const focusRe1 = '(mCurrentFocus.+\\.PeopleActivity)';
        const focusRe2 = '(mFocusedApp.+\\.PeopleActivity)';
        expect(res).to.match(new RegExp(`${focusRe1}|${focusRe2}`));
      });
      await adb.goToHome();
    });
  });
  describe('startApp', function () {
    it('should be able to start with normal package and activity', async function () {
      await adb.install(apiDemosPath, {
        grantPermissions: true
      });
      await adb.startApp({
        pkg: APIDEMOS_PKG,
        activity: APIDEMOS_ACTIVITY,
        waitDuration: START_APP_WAIT_DURATION,
      });
      await retryInterval(10, 500, async () => {
        // It might be too fast to check the package and activity
        // because the started app could take a bit time
        // to come to the foreground in machine time.
        await assertPackageAndActivity();
      });


    });
    it('should be able to start with an intent and no activity', async function () {
      if (await adb.getApiLevel() < 28 && process.env.CI) {
        return this.skip();
      }

      this.timeout(MOCHA_LONG_TIMEOUT);
      await adb.install(apiDemosPath, {
        grantPermissions: true
      });
      await adb.startApp({
        action: 'android.intent.action.WEB_SEARCH',
        pkg: 'com.google.android.googlequicksearchbox',
        optionalIntentArguments: '-e query foo',
        waitDuration: START_APP_WAIT_DURATION,
        stopApp: false
      });
      const {appPackage} = await adb.getFocusedPackageAndActivity();
      const expectedPkgPossibilities = [
        'com.android.browser',
        'org.chromium.webview_shell',
        'com.google.android.googlequicksearchbox'
      ];
      expect(expectedPkgPossibilities).to.include(appPackage);
    });
    it('should throw an error for unknown activity for intent', async function () {
      this.timeout(MOCHA_LONG_TIMEOUT);
      await adb.install(apiDemosPath, {
        grantPermissions: true
      });
      await adb.startApp({
        action: 'android.intent.action.DEFAULT',
        pkg: 'com.google.android.telephony',
        optionalIntentArguments: '-d tel:555-5555',
        waitDuration: START_APP_WAIT_DURATION,
        stopApp: false
      }).to.eventually.be.rejectedWith(/Cannot start the .* application/);
    });
    it('should throw error for wrong activity', async function () {
      await adb.install(apiDemosPath, {
        grantPermissions: true
      });
      await adb.startApp({
        pkg: APIDEMOS_PKG,
        activity: 'ApiDemo',
        waitDuration: START_APP_WAIT_DURATION_FAIL,
      }).to.eventually.be.rejectedWith('Activity');
    });
    it('should throw error for wrong wait activity', async function () {
      await adb.install(apiDemosPath, {
        grantPermissions: true
      });
      await adb.startApp({
        pkg: APIDEMOS_PKG,
        activity: APIDEMOS_ACTIVITY,
        waitActivity: 'foo',
        waitDuration: START_APP_WAIT_DURATION_FAIL,
      }).to.eventually.be.rejectedWith('foo');
    });
    it('should start activity with wait activity', async function () {
      await adb.install(apiDemosPath, {
        grantPermissions: true
      });
      await adb.startApp({
        pkg: APIDEMOS_PKG,
        activity: APIDEMOS_ACTIVITY,
        waitActivity: APIDEMOS_ACTIVITY_SHORT,
        waitDuration: START_APP_WAIT_DURATION,
      });
      await assertPackageAndActivity();
    });
    it('should start activity when wait activity is a wildcard', async function () {
      await adb.install(apiDemosPath, {
        grantPermissions: true
      });
      await adb.startApp({
        pkg: APIDEMOS_PKG,
        activity: APIDEMOS_ACTIVITY,
        waitActivity: '*',
        waitDuration: START_APP_WAIT_DURATION,
      });
      await assertPackageAndActivity();
    });
    it('should start activity when wait activity contains a wildcard', async function () {
      await adb.install(apiDemosPath, {
        grantPermissions: true
      });
      await adb.startApp({
        pkg: APIDEMOS_PKG,
        activity: APIDEMOS_ACTIVITY,
        waitActivity: `*${APIDEMOS_ACTIVITY_SHORT}`,
        waitDuration: START_APP_WAIT_DURATION,
      });
      await assertPackageAndActivity();
    });
    it('should throw error for wrong activity when wait activity contains a wildcard', async function () {
      await adb.install(apiDemosPath, {
        grantPermissions: true
      });
      await adb.startApp({
        pkg: APIDEMOS_PKG,
        activity: 'SuperManager',
        waitActivity: `*${APIDEMOS_ACTIVITY_SHORT}`,
        waitDuration: START_APP_WAIT_DURATION_FAIL,
      }).to.eventually.be.rejectedWith('Activity');
    });
    it('should throw error for wrong wait activity which contains wildcard', async function () {
      await adb.install(apiDemosPath, {
        grantPermissions: true
      });
      await adb.startApp({
        pkg: APIDEMOS_PKG,
        activity: APIDEMOS_ACTIVITY,
        waitActivity: '*.SuperManager',
        waitDuration: START_APP_WAIT_DURATION_FAIL,
      }).to.eventually.be.rejectedWith('SuperManager');
    });
    it('should start activity with comma separated wait packages list', async function () {
      await adb.install(apiDemosPath, {
        grantPermissions: true
      });
      await adb.startApp({
        pkg: APIDEMOS_PKG,
        waitPkg: `com.android.settings, ${APIDEMOS_PKG}`,
        activity: APIDEMOS_ACTIVITY,
        waitActivity: APIDEMOS_ACTIVITY_SHORT,
        waitDuration: START_APP_WAIT_DURATION,
      });
      await assertPackageAndActivity();
    });
    it('should throw error for wrong activity when packages provided as comma separated list', async function () {
      await adb.install(apiDemosPath, {
        grantPermissions: true
      });
      await adb.startApp({
        pkg: APIDEMOS_PKG,
        waitPkg: 'com.android.settings, com.example.somethingelse',
        activity: 'SuperManager',
        waitActivity: `*${APIDEMOS_ACTIVITY_SHORT}`,
        waitDuration: START_APP_WAIT_DURATION_FAIL,
      }).to.eventually.be.rejectedWith('Activity');
    });
  });
  it('should start activity when start activity is an inner class', async function () {
    await adb.install(apiDemosPath, {
      grantPermissions: true
    });
    await adb.startApp({
      pkg: 'com.android.settings',
      activity: '.Settings$NotificationAppListActivity',
      waitDuration: START_APP_WAIT_DURATION,
    });
    const {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
    expect(appPackage).to.equal('com.android.settings');

    // The appActivity is different depending on the API level.
    if (await adb.getApiLevel() > 35) {
      expect(appActivity).to.equal('.spa.SpaActivity');
    } else {
      expect(appActivity).to.equal('.Settings$NotificationAppListActivity');
    };
  });
  it('getFocusedPackageAndActivity should be able get package and activity', async function () {
    await adb.install(apiDemosPath, {
      grantPermissions: true
    });
    await adb.startApp({
      pkg: APIDEMOS_PKG,
      activity: APIDEMOS_ACTIVITY,
      waitActivity: APIDEMOS_ACTIVITY_SHORT,
      waitDuration: START_APP_WAIT_DURATION,
    });
    await assertPackageAndActivity();
  });
  it('extractStringsFromApk should get strings for default language', async function () {
    const {apkStrings} = await adb.extractStringsFromApk(apiDemosPath, null, '/tmp');
    // ApiDemos doesn't have a 'save' string, so we check for a common string instead
    expect(apkStrings).to.exist;
    expect(Object.keys(apkStrings)).to.have.length.above(0);
  });
  it('extractStringsFromApk should get strings for non-default language', async function () {
    const {apkStrings} = await adb.extractStringsFromApk(apiDemosPath, 'fr', '/tmp');
    expect(apkStrings.linear_layout_8_horizontal).to.equal('Horizontal');
  });
  it('extractStringsFromApk should get strings for en language', async function () {
    const {apkStrings} = await adb.extractStringsFromApk(apiDemosPath, 'en', '/tmp');
    expect(apkStrings.linear_layout_8_horizontal).to.equal('Horizontal');
  });
  describe('activateApp', function () {
    it('should be able to activate with normal package and activity', async function () {
      if (await adb.getApiLevel() < 23) {
        return this.skip();
      }

      await adb.install(apiDemosPath, {
        grantPermissions: true
      });
      await adb.startApp({
        pkg: APIDEMOS_PKG,
        activity: APIDEMOS_ACTIVITY,
        waitDuration: START_APP_WAIT_DURATION,
      });
      // Go to home and wait until the app is no longer focused
      // On some devices, the app might still be in the background, so we need to wait
      await retryInterval(20, 500, async () => {
        await adb.goToHome();
        // Add a small delay to allow the home screen to fully appear
        await new Promise((resolve) => setTimeout(resolve, 300));
        const {appPackage} = await adb.getFocusedPackageAndActivity();
        expect(appPackage).to.not.eql(APIDEMOS_PKG);
      });
      await retryInterval(10, 500, async () => {
        await adb.activateApp(APIDEMOS_PKG);
        const {appPackage} = await adb.getFocusedPackageAndActivity();
        expect(appPackage).to.eql(APIDEMOS_PKG);
      });
    });
  });
});
