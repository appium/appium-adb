import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import * as teen_process from 'teen_process';
import { fs } from 'appium-support';
import ADB from '../..';
import { withMocks } from 'appium-test-support';


chai.use(chaiAsPromised);
const should = chai.should(),
      pkg = 'com.example.android.contactmanager',
      uri = 'content://contacts/people/1',
      act = '.ContactManager',
      startAppOptions = {stopApp: true, action: 'action', category: 'cat',
                         flags: 'flags', pkg: 'pkg', activity: 'act',
                         optionalIntentArguments: '-x options -y option argument -z option arg with spaces'},
      cmd = ['am', 'start', '-W', '-n', 'pkg/act', '-S', '-a', 'action', '-c', 'cat',
             '-f', 'flags', '-x', 'options', '-y', 'option', 'argument',
             '-z', 'option', 'arg with spaces'],
      language = 'en',
      country = 'US',
      locale = 'en-US';

describe('Apk-utils', () => {
  let adb = new ADB();
  describe('isAppInstalled', withMocks({adb}, (mocks) => {
    it('should parse correctly and return true', async () => {
      const pkg = 'dummy.package';
      mocks.adb.expects('shell')
        .once().withExactArgs(['pm', 'list', 'packages', pkg])
        .returns(`package:${pkg}`);
      (await adb.isAppInstalled(pkg)).should.be.true;
      mocks.adb.verify();
    });
    it('should parse correctly and return false', async () => {
      const pkg = 'dummy.package';
      mocks.adb.expects('shell')
        .once().withExactArgs(['pm', 'list', 'packages', pkg])
        .returns("");
      (await adb.isAppInstalled(pkg)).should.be.false;
      mocks.adb.verify();
    });
  }));
  describe('getFocusedPackageAndActivity', withMocks({adb}, (mocks) => {
    it('should parse correctly and return package and activity', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/${act} t181}}}`);

      let {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
      appPackage.should.equal(pkg);
      appActivity.should.equal(act);
      mocks.adb.verify();
    });
    it('should parse correctly and return package and activity when a comma is present', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{20fe217e token=Token{21878739 ` +
                 `ActivityRecord{16425300 u0 ${pkg}/${act}, isShadow:false t10}}}`);

      let {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
      appPackage.should.equal(pkg);
      appActivity.should.equal(act);
      mocks.adb.verify();
    });
    it('should parse correctly and return null', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns('mFocusedApp=null');
      let {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
      should.not.exist(appPackage);
      should.not.exist(appActivity);
      mocks.adb.verify();
    });
  }));
  describe('waitForActivityOrNot', withMocks({adb}, (mocks) => {
    it('should call shell once and should return', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/${act} t181}}}`);

      await adb.waitForActivityOrNot(pkg, act, false);
      mocks.adb.verify();
    });
    it('should call shell multiple times and return', async () => {
      mocks.adb.expects('shell').onCall(0)
        .returns('mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ' +
                 'ActivityRecord{2c7c4318 u0 foo/bar t181}}}');
      mocks.adb.expects('shell')
        .returns('mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ' +
                 'ActivityRecord{2c7c4318 u0 com.example.android.contactmanager/.ContactManager t181}}}');

      await adb.waitForActivityOrNot(pkg, act, false);
      mocks.adb.verify();
    });
    it('should call shell once return for not', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns('mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ' +
                 'ActivityRecord{c 0 foo/bar t181}}}');

      await adb.waitForActivityOrNot(pkg, act, true);
      mocks.adb.verify();
    });
    it('should call shell multiple times and return for not', async () => {
      mocks.adb.expects('shell').onCall(0)
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/${act} t181}}}`);
      mocks.adb.expects('shell')
        .returns('mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ' +
                 'ActivityRecord{2c7c4318 u0 foo/bar t181}}}');
      await adb.waitForActivityOrNot(pkg, act, true);
      mocks.adb.verify();
    });
    it('should be able to get first of a comma-separated list of activities', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, '.ContactManager, .OtherManager', false);
      mocks.adb.verify();
    });
    it('should be able to get second of a comma-separated list of activities', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.OtherManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, '.ContactManager, .OtherManager', false);
      mocks.adb.verify();
    });
    it('should fail if no activity in a comma-separated list is available', async () => {
      mocks.adb.expects('shell')
        .atLeast(1)
        .withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/${act} t181}}}`);

      await adb.waitForActivityOrNot(pkg, '.SuperManager, .OtherManager', false, 1000)
        .should.eventually.be.rejected;
      mocks.adb.verify();
    });
    it('should be able to match activities if waitActivity is a wildcard', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `*`, false);
      mocks.adb.verify();
    });
    it('should be able to match activities if waitActivity is shortened and contains a whildcard', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `.*Manager`, false);
      mocks.adb.verify();
    });
    it('should be able to match activities if waitActivity contains a wildcard alternative to activity', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `${pkg}.*`, false);
      mocks.adb.verify();
    });
    it('should be able to match activities if waitActivity contains a wildcard on head', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `*.contactmanager.ContactManager`, false);
      mocks.adb.verify();
    });
    it('should be able to match activities if waitActivity contains a wildcard across a pkg name and an activity name', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `com.*Manager`, false);
      mocks.adb.verify();
    });
    it('should be able to match activities if waitActivity contains wildcards in both a pkg name and an activity name', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `com.*.contactmanager.*Manager`, false);
      mocks.adb.verify();
    });
    it('should fail if activity not to match from regexp activities', async () => {
      mocks.adb.expects('shell')
        .atLeast(1).withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u com.example.android.supermanager/.SuperManager t181}}}`);

      await adb.waitForActivityOrNot('com.example.android.supermanager', `${pkg}.*`, false, 1000)
        .should.eventually.be.rejected;
      mocks.adb.verify();
    });
    it('should be able to get an activity that is an inner class', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u ${pkg}/.Settings$AppDrawOverlaySettingsActivity t181}}}`);

      await adb.waitForActivityOrNot(pkg, '.Settings$AppDrawOverlaySettingsActivity', false);
      mocks.adb.verify();
    });
    it('should be able to get first activity from first package in a comma-separated list of packages + activities', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u com.android.settings/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot('com.android.settings,com.example.android.supermanager', '.ContactManager,.OtherManager', false);
      mocks.adb.verify();
    });
    it('should be able to get first activity from second package in a comma-separated list of packages + activities', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u com.example.android.supermanager/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot('com.android.settings,com.example.android.supermanager', '.ContactManager,.OtherManager', false);
      mocks.adb.verify();
    });
    it('should be able to get second activity from first package in a comma-separated list of packages + activities', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u com.android.settings/.OtherManager t181}}}`);

      await adb.waitForActivityOrNot('com.android.settings,com.example.android.supermanager', '.ContactManager,.OtherManager', false);
      mocks.adb.verify();
    });
    it('should be able to get second activity from second package in a comma-separated list of packages', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u com.example.android.supermanager/.OtherManager t181}}}`);

      await adb.waitForActivityOrNot('com.android.settings,com.example.android.supermanager', '.ContactManager,.OtherManager', false);
      mocks.adb.verify();
    });
    it('should fail to get activity when focused activity matches none of the provided list of packages', async () => {
      mocks.adb.expects('shell')
        .atLeast(1).withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u com.otherpackage/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot('com.android.settings,com.example.android.supermanager', '.ContactManager, .OtherManager', false, 1000)
        .should.eventually.be.rejected;
      mocks.adb.verify();
    });
  }));
  describe('waitForActivity', withMocks({adb}, (mocks) => {
    it('should call waitForActivityOrNot with correct arguments', async () => {
      mocks.adb.expects('waitForActivityOrNot')
        .once().withExactArgs(pkg, act, false, 20000)
        .returns('');
      await adb.waitForActivity(pkg, act);
      mocks.adb.verify();
    });
  }));
  describe('waitForNotActivity', withMocks({adb}, (mocks) => {
    it('should call waitForActivityOrNot with correct arguments', async () => {
      mocks.adb.expects('waitForActivityOrNot')
        .once().withExactArgs(pkg, act, true, 20000)
        .returns('');
      await adb.waitForNotActivity(pkg, act);
      mocks.adb.verify();
    });
  }));
  describe('uninstallApk', withMocks({adb}, (mocks) => {
    it('should call forceStop and adbExec with correct arguments', async () => {
      mocks.adb.expects('isAppInstalled')
        .once().withExactArgs(pkg)
        .returns(true);
      mocks.adb.expects('forceStop')
        .once().withExactArgs(pkg)
        .returns('');
      mocks.adb.expects('adbExec')
        .once().withExactArgs(['uninstall', pkg], {timeout: 20000})
        .returns('Success');
      (await adb.uninstallApk(pkg)).should.be.true;
      mocks.adb.verify();
    });
    it('should not call forceStop and adbExec if app not installed', async () => {
      mocks.adb.expects('isAppInstalled')
        .once().withExactArgs(pkg)
        .returns(false);
      mocks.adb.expects('forceStop')
        .never();
      mocks.adb.expects('adbExec')
        .never();
      (await adb.uninstallApk(pkg)).should.be.false;
      mocks.adb.verify();
    });
  }));
  describe('installFromDevicePath', withMocks({adb}, (mocks) => {
    it('should call forceStop and adbExec with correct arguments', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['pm', 'install', '-r', 'foo'], {})
        .returns('');
      (await adb.installFromDevicePath('foo'));
      mocks.adb.verify();
    });
  }));
  describe('install', withMocks({adb}, (mocks) => {
    it('should call forceStop and adbExec with correct arguments', async () => {
      mocks.adb.expects('adbExec')
        .once().withExactArgs(['install', '-r', 'foo'], {timeout: 60000})
        .returns('');
      (await adb.install('foo'));
      mocks.adb.verify();
    });
    it('should call forceStop and adbExec with correct arguments when not replacing', async () => {
      mocks.adb.expects('adbExec')
        .once().withExactArgs(['install', 'foo'], {timeout: 60000})
        .returns('');
      (await adb.install('foo', false));
      mocks.adb.verify();
    });
  }));
  describe('startUri', withMocks({adb}, (mocks) => {
    it('should fail if uri or pkg are not provided', async () => {
      await adb.startUri().should.eventually.be.rejectedWith(/arguments are required/);
      await adb.startUri('foo').should.eventually.be.rejectedWith(/arguments are required/);
    });
    it('should build a call to a VIEW intent with the uri', async () => {
      mocks.adb.expects('shell')
        .once().withExactArgs(['am', 'start', '-W', '-a',
                               'android.intent.action.VIEW', '-d', uri, pkg]);
      await adb.startUri(uri, pkg);
      mocks.adb.verify();
    });
  }));
  describe('startApp', withMocks({adb}, (mocks) => {
    it('should call getApiLevel and shell with correct arguments', async () => {
      mocks.adb.expects('getApiLevel')
        .once().withExactArgs()
        .returns(17);
      mocks.adb.expects('shell')
        .once().withExactArgs(cmd)
        .returns('');
      (await adb.startApp(startAppOptions));
      mocks.adb.verify();
    });
    it('should call getApiLevel and shell with correct arguments', async () => {
      mocks.adb.expects('getApiLevel')
        .twice()
        .returns(17);
      mocks.adb.expects('shell')
        .onCall(0)
        .returns('Error: Activity class foo does not exist');
      mocks.adb.expects('shell')
        .returns('');
      (await adb.startApp(startAppOptions));
      mocks.adb.verify();
    });
    it('should call getApiLevel and shell with correct arguments when activity is inner class', async () => {
      const startAppOptionsWithInnerClass = { pkg: 'pkg', activity: 'act$InnerAct'},
            cmdWithInnerClass = ['am', 'start', '-W', '-n', 'pkg/act\\$InnerAct', '-S'];

      mocks.adb.expects('getApiLevel')
        .once().withExactArgs()
        .returns(17);
      mocks.adb.expects('shell')
        .once().withExactArgs(cmdWithInnerClass)
        .returns('');
      (await adb.startApp(startAppOptionsWithInnerClass));
      mocks.adb.verify();
    });
  }));
  describe('getDeviceLanguage', withMocks({adb}, (mocks) => {
    it('should call shell one time with correct args and return language when API < 23', async () => {
      mocks.adb.expects("getApiLevel").returns(18);
      mocks.adb.expects("shell")
        .once().withExactArgs(['getprop', 'persist.sys.language'])
        .returns(language);
      (await adb.getDeviceLanguage()).should.equal(language);
      mocks.adb.verify();
    });
    it('should call shell two times with correct args and return language when API < 23', async () => {
      mocks.adb.expects("getApiLevel").returns(18);
      mocks.adb.expects("shell")
        .once().withExactArgs(['getprop', 'persist.sys.language'])
        .returns('');
      mocks.adb.expects("shell")
        .once().withExactArgs(['getprop', 'ro.product.locale.language'])
        .returns(language);
      (await adb.getDeviceLanguage()).should.equal(language);
      mocks.adb.verify();
    });
    it('should call shell one time with correct args and return language when API = 23', async () => {
      mocks.adb.expects("getApiLevel").returns(23);
      mocks.adb.expects("shell")
        .once().withExactArgs(['getprop', 'persist.sys.locale'])
        .returns(locale);
      (await adb.getDeviceLanguage()).should.equal(language);
      mocks.adb.verify();
    });
    it('should call shell two times with correct args and return language when API = 23', async () => {
      mocks.adb.expects("getApiLevel").returns(23);
      mocks.adb.expects("shell")
        .once().withExactArgs(['getprop', 'persist.sys.locale'])
        .returns('');
      mocks.adb.expects("shell")
        .once().withExactArgs(['getprop', 'ro.product.locale'])
        .returns(locale);
      (await adb.getDeviceLanguage()).should.equal(language);
      mocks.adb.verify();
    });
  }));
  describe('setDeviceLanguage', withMocks({adb}, (mocks) => {
    it('should call shell one time with correct args when API < 23', async () => {
      mocks.adb.expects("getApiLevel")
        .once().returns(21);
      mocks.adb.expects("shell")
        .once().withExactArgs(['setprop', 'persist.sys.language', language])
        .returns("");
      await adb.setDeviceLanguage(language);
      mocks.adb.verify();
    });
  }));
  describe('getDeviceCountry', withMocks({adb}, (mocks) => {
    it('should call shell one time with correct args and return country', async () => {
      mocks.adb.expects("shell")
        .once().withExactArgs(['getprop', 'persist.sys.country'])
        .returns(country);
      (await adb.getDeviceCountry()).should.equal(country);
      mocks.adb.verify();
    });
    it('should call shell two times with correct args and return country', async () => {
      mocks.adb.expects("shell")
        .once().withExactArgs(['getprop', 'persist.sys.country'])
        .returns('');
      mocks.adb.expects("shell")
        .once().withExactArgs(['getprop', 'ro.product.locale.region'])
        .returns(country);
      (await adb.getDeviceCountry()).should.equal(country);
      mocks.adb.verify();
    });
  }));
  describe('setDeviceCountry', withMocks({adb}, (mocks) => {
    it('should call shell one time with correct args', async () => {
      mocks.adb.expects("getApiLevel")
        .once().returns(21);
      mocks.adb.expects("shell")
        .once().withExactArgs(['setprop', 'persist.sys.country', country])
        .returns("");
      await adb.setDeviceCountry(country);
      mocks.adb.verify();
    });
  }));
  describe('getDeviceLocale', withMocks({adb}, (mocks) => {
    it('should call shell one time with correct args and return locale', async () => {
      mocks.adb.expects("shell")
        .once().withExactArgs(['getprop', 'persist.sys.locale'])
        .returns(locale);
      (await adb.getDeviceLocale()).should.equal(locale);
      mocks.adb.verify();
    });
    it('should call shell two times with correct args and return locale', async () => {
      mocks.adb.expects("shell")
        .once().withExactArgs(['getprop', 'persist.sys.locale'])
        .returns('');
      mocks.adb.expects("shell")
        .once().withExactArgs(['getprop', 'ro.product.locale'])
        .returns(locale);
      (await adb.getDeviceLocale()).should.equal(locale);
      mocks.adb.verify();
    });
  }));
  describe('setDeviceLocale', withMocks({adb}, (mocks) => {
    it('should call shell one time with correct args', async () => {
      mocks.adb.expects("getApiLevel")
        .once().returns(21);
      mocks.adb.expects("shell")
        .once().withExactArgs(['setprop', 'persist.sys.locale', locale])
        .returns("");
      await adb.setDeviceLocale(locale);
      mocks.adb.verify();
    });
  }));
  describe('getApkInfo', withMocks({adb, teen_process, fs}, (mocks) => {
    it('should properly parse apk info', async () => {
      mocks.fs.expects('exists').once().returns(true);
      mocks.adb.expects('initAapt').once().returns(true);
      mocks.teen_process.expects('exec').once().returns({stdout: `package: name='io.appium.settings' versionCode='2' versionName='1.1' platformBuildVersionName='6.0-2166767'
      sdkVersion:'17'
      targetSdkVersion:'23'
      uses-permission: name='android.permission.INTERNET'
      uses-permission: name='android.permission.CHANGE_NETWORK_STATE'
      uses-permission: name='android.permission.ACCESS_NETWORK_STATE'
      uses-permission: name='android.permission.READ_PHONE_STATE'
      uses-permission: name='android.permission.WRITE_SETTINGS'
      uses-permission: name='android.permission.CHANGE_WIFI_STATE'
      uses-permission: name='android.permission.ACCESS_WIFI_STATE'
      uses-permission: name='android.permission.ACCESS_FINE_LOCATION'
      uses-permission: name='android.permission.ACCESS_COARSE_LOCATION'
      uses-permission: name='android.permission.ACCESS_MOCK_LOCATION'
      application-label:'Appium Settings'
      application-icon-120:'res/drawable-ldpi-v4/ic_launcher.png'
      application-icon-160:'res/drawable-mdpi-v4/ic_launcher.png'
      application-icon-240:'res/drawable-hdpi-v4/ic_launcher.png'
      application-icon-320:'res/drawable-xhdpi-v4/ic_launcher.png'
      application: label='Appium Settings' icon='res/drawable-mdpi-v4/ic_launcher.png'
      application-debuggable
      launchable-activity: name='io.appium.settings.Settings'  label='Appium Settings' icon=''
      feature-group: label=''
        uses-feature: name='android.hardware.wifi'
        uses-feature: name='android.hardware.location'
        uses-implied-feature: name='android.hardware.location' reason='requested android.permission.ACCESS_COARSE_LOCATION permission, requested android.permission.ACCESS_FINE_LOCATION permission, and requested android.permission.ACCESS_MOCK_LOCATION permission'
        uses-feature: name='android.hardware.location.gps'
        uses-implied-feature: name='android.hardware.location.gps' reason='requested android.permission.ACCESS_FINE_LOCATION permission'
        uses-feature: name='android.hardware.location.network'
        uses-implied-feature: name='android.hardware.location.network' reason='requested android.permission.ACCESS_COARSE_LOCATION permission'
        uses-feature: name='android.hardware.touchscreen'
        uses-implied-feature: name='android.hardware.touchscreen' reason='default feature for all apps'
      main
      other-receivers
      other-services
      supports-screens: 'small' 'normal' 'large' 'xlarge'
      supports-any-density: 'true'
      locales: '--_--'
      densities: '120' '160' '240' '320'`});
      const result = await adb.getApkInfo('/some/folder/path.apk');
      for (let [name, value] of [['name', 'io.appium.settings'],
                                 ['versionCode', 2],
                                 ['versionName', '1.1']]) {
        result.should.have.property(name, value);
      }
    });
  }));
  describe('getPackageInfo', withMocks({adb}, (mocks) => {
    it('should properly parse installed package info', async () => {
      mocks.adb.expects('shell').once().returns(`Packages:
      Package [com.example.testapp.first] (2036fd1):
        userId=10225
        pkg=Package{42e7a36 com.example.testapp.first}
        codePath=/data/app/com.example.testapp.first-1
        resourcePath=/data/app/com.example.testapp.first-1
        legacyNativeLibraryDir=/data/app/com.example.testapp.first-1/lib
        primaryCpuAbi=null
        secondaryCpuAbi=null
        versionCode=1 minSdk=21 targetSdk=24
        versionName=1.0
        splits=[base]
        apkSigningVersion=1
        applicationInfo=ApplicationInfo{29cb2a4 com.example.testapp.first}
        flags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP ]
        privateFlags=[ RESIZEABLE_ACTIVITIES ]
        dataDir=/data/user/0/com.example.testapp.first
        supportsScreens=[small, medium, large, xlarge, resizeable, anyDensity]
        timeStamp=2016-11-03 01:12:08
        firstInstallTime=2016-11-03 01:12:09
        lastUpdateTime=2016-11-03 01:12:09
        signatures=PackageSignatures{9fe380d [53ea108d]}
        installPermissionsFixed=true installStatus=1
        pkgFlags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP ]
        User 0: ceDataInode=474317 installed=true hidden=false suspended=false stopped=true notLaunched=true enabled=0
          runtime permissions:`);
      const result = await adb.getPackageInfo('com.example.testapp.first');
      for (let [name, value] of [['name', 'com.example.testapp.first'],
                                 ['versionCode', 1],
                                 ['versionName', '1.0']]) {
        result.should.have.property(name, value);
      }
    });
  }));
  describe('installOrUpgrade', withMocks({adb}, (mocks) => {
    const pkgId = 'io.appium.settings';
    const apkPath = '/path/to/my.apk';

    it('should execute install if the package is not present', async () => {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).once().returns({
        name: pkgId
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(false);
      mocks.adb.expects('install').withArgs(apkPath, false).once().returns(true);
      await adb.installOrUpgrade(apkPath);
      mocks.adb.verify();
    });
    it('should return if the same package version is already installed', async () => {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).once().returns({
        versionCode: 1
      });
      mocks.adb.expects('getPackageInfo').once().returns({
        versionCode: 1
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      await adb.installOrUpgrade(apkPath, pkgId);
      mocks.adb.verify();
    });
    it('should return if newer package version is already installed', async () => {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).once().returns({
        name: pkgId,
        versionCode: 1
      });
      mocks.adb.expects('getPackageInfo').once().returns({
        versionCode: 2
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      await adb.installOrUpgrade(apkPath);
      mocks.adb.verify();
    });
    it('should not throw an error if apk version code cannot be read', async () => {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).once().returns({
        name: pkgId
      });
      mocks.adb.expects('getPackageInfo').once().returns({
        versionCode: 2
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      await adb.installOrUpgrade(apkPath);
      mocks.adb.verify();
    });
    it('should not throw an error if pkg version code cannot be read', async () => {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).once().returns({
        name: pkgId,
        versionCode: 1
      });
      mocks.adb.expects('getPackageInfo').once().returns({});
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      await adb.installOrUpgrade(apkPath);
      mocks.adb.verify();
    });
    it('should not throw an error if pkg id cannot be read', async () => {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).once().returns({});
      await adb.installOrUpgrade(apkPath);
      mocks.adb.verify();
    });
    it('should perform upgrade if older package version is installed', async () => {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).once().returns({
        name: pkgId,
        versionCode: 2
      });
      mocks.adb.expects('getPackageInfo').once().returns({
        versionCode: 1
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      mocks.adb.expects('install').withArgs(apkPath, true).once().returns(true);
      await adb.installOrUpgrade(apkPath);
      mocks.adb.verify();
    });
    it('should uninstall and re-install if older package version is installed and upgrade fails', async () => {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).once().returns({
        name: pkgId,
        versionCode: 2
      });
      mocks.adb.expects('getPackageInfo').once().returns({
        versionCode: 1
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      mocks.adb.expects('install').withArgs(apkPath, true).once().throws();
      mocks.adb.expects('uninstallApk').withExactArgs(pkgId).once().returns(true);
      mocks.adb.expects('install').withArgs(apkPath, false).once().returns(true);
      await adb.installOrUpgrade(apkPath);
      mocks.adb.verify();
    });
    it('should throw an exception if upgrade and reinstall fail', async () => {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).once().returns({
        name: pkgId,
        versionCode: 2
      });
      mocks.adb.expects('getPackageInfo').once().returns({
        versionCode: 1
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      mocks.adb.expects('uninstallApk').withExactArgs(pkgId).once().returns(true);
      mocks.adb.expects('install').withArgs(apkPath).twice().throws();
      let isExceptionThrown = false;
      try {
        await adb.installOrUpgrade(apkPath);
      } catch (e) {
        isExceptionThrown = true;
      }
      isExceptionThrown.should.be.true;
      mocks.adb.verify();
    });
    it('should throw an exception if upgrade and uninstall fail', async () => {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).once().returns({
        name: pkgId,
        versionCode: 2
      });
      mocks.adb.expects('getPackageInfo').once().returns({
        versionCode: 1
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      mocks.adb.expects('uninstallApk').withExactArgs(pkgId).once().returns(false);
      mocks.adb.expects('install').withArgs(apkPath, true).once().throws();
      let isExceptionThrown = false;
      try {
        await adb.installOrUpgrade(apkPath);
      } catch (e) {
        isExceptionThrown = true;
      }
      isExceptionThrown.should.be.true;
      mocks.adb.verify();
    });
  }));
});
