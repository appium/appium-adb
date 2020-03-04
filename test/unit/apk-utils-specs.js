import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import * as teen_process from 'teen_process';
import { fs } from 'appium-support';
import ADB from '../..';
import { withMocks } from 'appium-test-support';
import _ from 'lodash';
import B from 'bluebird';
import { REMOTE_CACHE_ROOT } from '../../lib/tools/apk-utils';
import apksUtilsMethods from '../../lib/tools/apks-utils';

chai.use(chaiAsPromised);
const should = chai.should(),
      pkg = 'com.example.android.contactmanager',
      uri = 'content://contacts/people/1',
      act = '.ContactManager',
      startAppOptions = {
        stopApp: true,
        action: 'action',
        category: 'cat',
        flags: 'flags',
        pkg: 'pkg',
        activity: 'act',
        optionalIntentArguments: '-x options -y option argument -z option arg with spaces',
      },
      cmd = [
        'am', 'start', '-W', '-n', 'pkg/act', '-S',
        '-a', 'action',
        '-c', 'cat',
        '-f', 'flags',
        '-x', 'options',
        '-y', 'option',
        'argument',
        '-z', 'option',
        'arg with spaces',
      ],
      language = 'en',
      country = 'US',
      locale = 'en-US';

const adb = new ADB({ adbExecTimeout: 60000 });

describe('Apk-utils', withMocks({adb, fs, teen_process}, function (mocks) {
  afterEach(function () {
    mocks.verify();
  });

  describe('isAppInstalled', function () {
    it('should parse correctly and return true', async function () {
      const pkg = 'dummy.package';
      mocks.adb.expects('shell')
        .twice().withExactArgs(['dumpsys', 'package', pkg])
        .returns(`Packages:
          Package [${pkg}] (2469669):
            userId=2000`);
      (await adb.isAppInstalled(pkg)).should.be.true;
    });
    it('should parse correctly and return false', async function () {
      const pkg = 'dummy.package';
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'package', pkg])
        .returns(`Dexopt state:
          Unable to find package: ${pkg}`);
      (await adb.isAppInstalled(pkg)).should.be.false;
    });
  });

  describe('getFocusedPackageAndActivity', function () {
    it('should parse correctly and return package and activity', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/${act} t181}}}\n` +
                 `mCurrentFocus=Window{4330b6c0 com.android.settings/com.android.settings.SubSettings paused=false}`);

      let {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
      appPackage.should.equal(pkg);
      appActivity.should.equal(act);
    });
    it('should parse correctly and return package and activity when a comma is present', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{20fe217e token=Token{21878739 ` +
                 `ActivityRecord{16425300 u0 ${pkg}/${act}, isShadow:false t10}}}`);

      let {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
      appPackage.should.equal(pkg);
      appActivity.should.equal(act);
    });
    it('should parse correctly and return package and activity of only mCurrentFocus is set', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=null\n  mCurrentFocus=Window{4330b6c0 u0 ${pkg}/${act} paused=false}`);

      let {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
      appPackage.should.equal(pkg);
      appActivity.should.equal(act);
    });
    it('should return null if mFocusedApp=null', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns('mFocusedApp=null');
      let {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
      should.not.exist(appPackage);
      should.not.exist(appActivity);
    });
    it('should return null if mCurrentFocus=null', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns('mCurrentFocus=null');
      let {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
      should.not.exist(appPackage);
      should.not.exist(appActivity);
    });
  });
  describe('waitForActivityOrNot', function () {
    it('should call shell once and should return', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/${act} t181}}}`);

      await adb.waitForActivityOrNot(pkg, act, false);
    });
    it('should call shell multiple times and return', async function () {
      mocks.adb.expects('dumpWindows')
        .returns('mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ' +
                 'ActivityRecord{2c7c4318 u0 foo/bar t181}}}');
      mocks.adb.expects('dumpWindows')
        .returns('mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ' +
                 'ActivityRecord{2c7c4318 u0 com.example.android.contactmanager/.ContactManager t181}}}');

      await adb.waitForActivityOrNot(pkg, act, false);
    });
    it('should call shell once return for not', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns('mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ' +
                 'ActivityRecord{c 0 foo/bar t181}}}');

      await adb.waitForActivityOrNot(pkg, act, true);
    });
    it('should call shell multiple times and return for not', async function () {
      mocks.adb.expects('dumpWindows')
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/${act} t181}}}`);
      mocks.adb.expects('dumpWindows')
        .returns('mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ' +
                 'ActivityRecord{2c7c4318 u0 foo/bar t181}}}');
      await adb.waitForActivityOrNot(pkg, act, true);
    });
    it('should be able to get first of a comma-separated list of activities', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, '.ContactManager, .OtherManager', false);
    });
    it('should be able to get second of a comma-separated list of activities', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.OtherManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, '.ContactManager, .OtherManager', false);
    });
    it('should fail if no activity in a comma-separated list is available', async function () {
      mocks.adb.expects('dumpWindows')
        .atLeast(1)
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/${act} t181}}}`);

      await adb.waitForActivityOrNot(pkg, '.SuperManager, .OtherManager', false, 1000)
        .should.eventually.be.rejected;
    });
    it('should be able to match activities if waitActivity is a wildcard', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `*`, false);
    });
    it('should be able to match activities if waitActivity is shortened and contains a whildcard', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `.*Manager`, false);
    });
    it('should be able to match activities if waitActivity contains a wildcard alternative to activity', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `${pkg}.*`, false);
    });
    it('should be able to match activities if waitActivity contains a wildcard on head', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `*.contactmanager.ContactManager`, false);
    });
    it('should be able to match activities if waitActivity contains a wildcard across a pkg name and an activity name', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `com.*Manager`, false);
    });
    it('should be able to match activities if waitActivity contains wildcards in both a pkg name and an activity name', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `com.*.contactmanager.*Manager`, false);
    });
    it('should fail if activity not to match from regexp activities', async function () {
      mocks.adb.expects('dumpWindows')
        .atLeast(1)
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u com.example.android.supermanager/.SuperManager t181}}}`);

      await adb.waitForActivityOrNot('com.example.android.supermanager', `${pkg}.*`, false, 1000)
        .should.eventually.be.rejected;
    });
    it('should be able to get an activity that is an inner class', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u ${pkg}/.Settings$AppDrawOverlaySettingsActivity t181}}}`);

      await adb.waitForActivityOrNot(pkg, '.Settings$AppDrawOverlaySettingsActivity', false);
    });
    it('should be able to get first activity from first package in a comma-separated list of packages + activities', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u com.android.settings/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot('com.android.settings,com.example.android.supermanager', '.ContactManager,.OtherManager', false);
    });
    it('should be able to get first activity from second package in a comma-separated list of packages + activities', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u com.example.android.supermanager/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot('com.android.settings,com.example.android.supermanager', '.ContactManager,.OtherManager', false);
    });
    it('should be able to get second activity from first package in a comma-separated list of packages + activities', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u com.android.settings/.OtherManager t181}}}`);

      await adb.waitForActivityOrNot('com.android.settings,com.example.android.supermanager', '.ContactManager,.OtherManager', false);
    });
    it('should be able to get second activity from second package in a comma-separated list of packages', async function () {
      mocks.adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u com.example.android.supermanager/.OtherManager t181}}}`);

      await adb.waitForActivityOrNot('com.android.settings,com.example.android.supermanager', '.ContactManager,.OtherManager', false);
    });
    it('should fail to get activity when focused activity matches none of the provided list of packages', async function () {
      mocks.adb.expects('dumpWindows')
        .atLeast(1)
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u com.otherpackage/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot('com.android.settings,com.example.android.supermanager', '.ContactManager, .OtherManager', false, 1000)
        .should.eventually.be.rejected;
    });
  });
  describe('waitForActivity', function () {
    it('should call waitForActivityOrNot with correct arguments', async function () {
      mocks.adb.expects('waitForActivityOrNot')
        .once().withExactArgs(pkg, act, false, 20000)
        .returns('');
      await adb.waitForActivity(pkg, act);
    });
  });
  describe('waitForNotActivity', function () {
    it('should call waitForActivityOrNot with correct arguments', async function () {
      mocks.adb.expects('waitForActivityOrNot')
        .once().withExactArgs(pkg, act, true, 20000)
        .returns('');
      await adb.waitForNotActivity(pkg, act);
    });
  });
  describe('uninstallApk', function () {
    it('should call forceStop and adbExec with correct arguments', async function () {
      mocks.adb.expects('isAppInstalled')
        .once().withExactArgs(pkg)
        .returns(true);
      mocks.adb.expects('forceStop')
        .once().withExactArgs(pkg)
        .returns('');
      mocks.adb.expects('adbExec')
        .once().withExactArgs(['uninstall', pkg], {timeout: undefined})
        .returns('Success');
      (await adb.uninstallApk(pkg)).should.be.true;
    });
    it('should not call forceStop and adbExec if app not installed', async function () {
      mocks.adb.expects('isAppInstalled')
        .once().withExactArgs(pkg)
        .returns(false);
      mocks.adb.expects('forceStop')
        .never();
      mocks.adb.expects('adbExec')
        .never();
      (await adb.uninstallApk(pkg)).should.be.false;
    });
  });
  describe('installFromDevicePath', function () {
    it('should call shell with correct arguments', async function () {
      mocks.adb.expects('shell')
        .once().withExactArgs(['pm', 'install', '-r', 'foo'], {})
        .returns('');
      await adb.installFromDevicePath('foo');
    });
  });
  describe('cacheApk', function () {
    it('should remove extra apks from the cache', async function () {
      const apkPath = '/dummy/foo.apk';
      adb._areExtendedLsOptionsSupported = true;
      mocks.adb.expects('shell')
        .once()
        .withExactArgs([`ls -t -1 ${REMOTE_CACHE_ROOT} 2>&1 || echo _ERROR_`])
        .returns(_.range(adb.remoteAppsCacheLimit + 2)
          .map((x) => `${x}.apk`)
          .join('\r\n')
        );
      mocks.adb.expects('shell')
        .once()
        .withExactArgs(['touch', '-am', '/data/local/tmp/appium_cache/1.apk'])
        .returns(B.resolve());
      mocks.fs.expects('hash')
        .withExactArgs(apkPath)
        .returns('1');
      mocks.adb.expects('shell')
        .once()
        .withExactArgs([
          'rm', '-f',
          `${REMOTE_CACHE_ROOT}/${adb.remoteAppsCacheLimit}.apk`,
          `${REMOTE_CACHE_ROOT}/${adb.remoteAppsCacheLimit + 1}.apk`,
        ]);
      await adb.cacheApk(apkPath);
    });
    it('should add apk into the cache if it is not there yet', async function () {
      const apkPath = '/dummy/foo.apk';
      const hash = '12345';
      adb._areExtendedLsOptionsSupported = true;
      mocks.adb.expects('ls')
        .once()
        .withExactArgs([`ls -t -1 ${REMOTE_CACHE_ROOT} 2>&1 || echo _ERROR_`])
        .returns('');
      mocks.fs.expects('hash')
        .withExactArgs(apkPath)
        .returns(hash);
      mocks.adb.expects('shell')
        .once()
        .withExactArgs(['mkdir', '-p', REMOTE_CACHE_ROOT])
        .returns();
      mocks.adb.expects('push')
        .once()
        .withArgs(apkPath, `${REMOTE_CACHE_ROOT}/${hash}.apk`)
        .returns();
      mocks.fs.expects('stat')
        .once()
        .withExactArgs(apkPath)
        .returns({size: 1});
      await adb.cacheApk(apkPath);
    });
  });
  describe('install', function () {
    it('should call shell with correct arguments', async function () {
      mocks.adb.expects('isStreamedInstallSupported')
        .once().returns(false);
      mocks.adb.expects('getApiLevel')
        .once().returns(23);
      mocks.adb.expects('cacheApk')
        .once().withExactArgs('foo', {
          timeout: 60000,
        })
        .returns('bar');
      mocks.adb.expects('shell')
        .once().withExactArgs(['pm', 'install', '-r', 'bar'], {
          timeout: 60000,
          timeoutCapName: 'androidInstallTimeout'
        })
        .returns('');
      await adb.install('foo');
    });
    it('should not cache apk if streamed install is supported', async function () {
      mocks.adb.expects('isStreamedInstallSupported')
        .once().returns(true);
      mocks.adb.expects('getApiLevel')
        .once().returns(23);
      mocks.adb.expects('cacheApk')
        .never();
      mocks.adb.expects('adbExec')
        .once().withExactArgs(['install', '-r', 'foo'], {
          timeout: 60000,
          timeoutCapName: 'androidInstallTimeout'
        })
        .returns('');
      await adb.install('foo');
    });
    it('should call shell with correct arguments when not replacing', async function () {
      mocks.adb.expects('isStreamedInstallSupported')
        .once().returns(false);
      mocks.adb.expects('getApiLevel')
        .once().returns(23);
      mocks.adb.expects('cacheApk')
        .once().withExactArgs('foo', {
          timeout: 60000,
        })
        .returns('bar');
      mocks.adb.expects('shell')
        .once().withExactArgs(['pm', 'install', 'bar'], {
          timeout: 60000,
          timeoutCapName: 'androidInstallTimeout'
        })
        .returns('');
      await adb.install('foo', {replace: false});
    });
    it('should call apks install if the path points to it', async function () {
      mocks.adb.expects('installApks')
        .once().withArgs('foo.apks')
        .returns('');
      await adb.install('foo.apks');
    });
  });
  describe('startUri', function () {
    it('should fail if uri or pkg are not provided', async function () {
      await adb.startUri().should.eventually.be.rejectedWith(/arguments are required/);
      await adb.startUri('foo').should.eventually.be.rejectedWith(/arguments are required/);
    });
    it('should fail if "unable to resolve intent" appears in shell command result', async function () {
      mocks.adb.expects('shell')
        .once().withExactArgs([
          'am', 'start', '-W', '-a',
          'android.intent.action.VIEW', '-d', uri, pkg
        ])
        .returns('Something something something Unable to resolve intent something something');

      await adb.startUri(uri, pkg).should.eventually.be.rejectedWith(/Unable to resolve intent/);
    });
    it('should build a call to a VIEW intent with the uri', async function () {
      mocks.adb.expects('shell')
        .once().withExactArgs([
          'am', 'start', '-W', '-a',
          'android.intent.action.VIEW', '-d', uri, pkg
        ])
        .returns('Passable result');

      await adb.startUri(uri, pkg);
    });
  });
  describe('startApp', function () {
    it('should call getApiLevel and shell with correct arguments', async function () {
      mocks.adb.expects('getApiLevel')
        .once().withExactArgs()
        .returns(17);
      mocks.adb.expects('shell')
        .once().withArgs(cmd)
        .returns('');
      (await adb.startApp(startAppOptions));
    });
    it('should call getApiLevel and shell with correct arguments', async function () {
      mocks.adb.expects('getApiLevel')
        .twice()
        .returns(17);
      mocks.adb.expects('shell')
        .onCall(0)
        .returns('Error: Activity class foo does not exist');
      mocks.adb.expects('shell')
        .returns('');
      (await adb.startApp(startAppOptions));
    });
    it('should call getApiLevel and shell with correct arguments when activity is intent', async function () {
      const startAppOptionsWithIntent = {
        pkg: 'pkg',
        action: 'android.intent.action.VIEW',
        category: 'android.intent.category.DEFAULT',
        optionalIntentArguments: '-d scheme://127.0.0.1'
      };
      const cmdWithIntent = ['am', 'start', '-W', '-S', '-a', 'android.intent.action.VIEW', '-c', 'android.intent.category.DEFAULT', '-d', 'scheme://127.0.0.1'];

      mocks.adb.expects('getApiLevel')
        .once().withExactArgs()
        .returns(17);
      mocks.adb.expects('shell')
        .once().withArgs(cmdWithIntent)
        .returns('');
      (await adb.startApp(startAppOptionsWithIntent));
    });
    it('should throw error when action provided, but pkg not provided', async function () {
      const startAppOptionsWithoutPkg = {
        action: 'android.intent.action.VIEW'
      };
      await adb.startApp(startAppOptionsWithoutPkg).should.eventually.be.rejectedWith(
        `pkg, and activity or intent action, are required to start an application`);
    });
    it('should throw error when activity provided, but pkg not provided', async function () {
      const startAppOptionsWithoutPkg = {
        activity: '.MainActivity'
      };
      await adb.startApp(startAppOptionsWithoutPkg).should.eventually.be.rejectedWith(
        `pkg, and activity or intent action, are required to start an application`);
    });
    it('should throw error when neither action nor activity provided', async function () {
      const startAppOptionsWithoutActivityOrAction = {
        pkg: 'pkg'
      };
      await adb.startApp(startAppOptionsWithoutActivityOrAction).should.eventually.be.rejectedWith(
        `pkg, and activity or intent action, are required to start an application`);
    });
    it('should call getApiLevel and shell with correct arguments when activity is inner class', async function () {
      const startAppOptionsWithInnerClass = { pkg: 'pkg', activity: 'act$InnerAct'},
            cmdWithInnerClass = ['am', 'start', '-W', '-n', 'pkg/act\\$InnerAct', '-S'];

      mocks.adb.expects('getApiLevel')
        .once().withExactArgs()
        .returns(17);
      mocks.adb.expects('shell')
        .once().withArgs(cmdWithInnerClass)
        .returns('');
      (await adb.startApp(startAppOptionsWithInnerClass));
    });
  });
  describe('getDeviceLanguage', function () {
    it('should call shell one time with correct args and return language when API < 23', async function () {
      mocks.adb.expects('getApiLevel').returns(18);
      mocks.adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.language'])
        .returns(language);
      (await adb.getDeviceLanguage()).should.equal(language);
    });
    it('should call shell two times with correct args and return language when API < 23', async function () {
      mocks.adb.expects('getApiLevel').returns(18);
      mocks.adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.language'])
        .returns('');
      mocks.adb.expects('shell')
        .once().withExactArgs(['getprop', 'ro.product.locale.language'])
        .returns(language);
      (await adb.getDeviceLanguage()).should.equal(language);
    });
    it('should call shell one time with correct args and return language when API = 23', async function () {
      mocks.adb.expects('getApiLevel').returns(23);
      mocks.adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.locale'])
        .returns(locale);
      (await adb.getDeviceLanguage()).should.equal(language);
    });
    it('should call shell two times with correct args and return language when API = 23', async function () {
      mocks.adb.expects('getApiLevel').returns(23);
      mocks.adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.locale'])
        .returns('');
      mocks.adb.expects('shell')
        .once().withExactArgs(['getprop', 'ro.product.locale'])
        .returns(locale);
      (await adb.getDeviceLanguage()).should.equal(language);
    });
  });
  describe('getDeviceCountry', function () {
    it('should call shell one time with correct args and return country', async function () {
      mocks.adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.country'])
        .returns(country);
      (await adb.getDeviceCountry()).should.equal(country);
    });
    it('should call shell two times with correct args and return country', async function () {
      mocks.adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.country'])
        .returns('');
      mocks.adb.expects('shell')
        .once().withExactArgs(['getprop', 'ro.product.locale.region'])
        .returns(country);
      (await adb.getDeviceCountry()).should.equal(country);
    });
  });
  describe('getDeviceLocale', function () {
    it('should call shell one time with correct args and return locale', async function () {
      mocks.adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.locale'])
        .returns(locale);
      (await adb.getDeviceLocale()).should.equal(locale);
    });
    it('should call shell two times with correct args and return locale', async function () {
      mocks.adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.locale'])
        .returns('');
      mocks.adb.expects('shell')
        .once().withExactArgs(['getprop', 'ro.product.locale'])
        .returns(locale);
      (await adb.getDeviceLocale()).should.equal(locale);
    });
  });
  describe('ensureCurrentLocale', function () {
    it('should return false if no arguments', async function () {
      (await adb.ensureCurrentLocale()).should.be.false;
    });
    it('should return true when API 22 and only language', async function () {
      mocks.adb.expects('getApiLevel').withExactArgs().once().returns(22);
      mocks.adb.expects('getDeviceLanguage').withExactArgs().once().returns('fr');
      mocks.adb.expects('getDeviceCountry').withExactArgs().never();
      (await adb.ensureCurrentLocale('fr', null)).should.be.true;
    });
    it('should return true when API 22 and only country', async function () {
      mocks.adb.expects('getApiLevel').withExactArgs().once().returns(22);
      mocks.adb.expects('getDeviceCountry').withExactArgs().once().returns('FR');
      mocks.adb.expects('getDeviceLanguage').withExactArgs().never();
      (await adb.ensureCurrentLocale(null, 'FR')).should.be.true;
    });
    it('should return true when API 22', async function () {
      mocks.adb.expects('getApiLevel').withExactArgs().once().returns(22);
      mocks.adb.expects('getDeviceLanguage').withExactArgs().once().returns('fr');
      mocks.adb.expects('getDeviceCountry').withExactArgs().once().returns('FR');
      (await adb.ensureCurrentLocale('FR', 'fr')).should.be.true;
    });
    it('should return false when API 22', async function () {
      mocks.adb.expects('getApiLevel').withExactArgs().once().returns(22);
      mocks.adb.expects('getDeviceLanguage').withExactArgs().once().returns('');
      mocks.adb.expects('getDeviceCountry').withExactArgs().once().returns('FR');
      (await adb.ensureCurrentLocale('en', 'US')).should.be.false;
    });
    it('should return true when API 23', async function () {
      mocks.adb.expects('getApiLevel').withExactArgs().once().returns(23);
      mocks.adb.expects('getDeviceLocale').withExactArgs().once().returns('fr-FR');
      (await adb.ensureCurrentLocale('fr', 'fr')).should.be.true;
    });
    it('should return false when API 23', async function () {
      mocks.adb.expects('getApiLevel').withExactArgs().once().returns(23);
      mocks.adb.expects('getDeviceLocale').withExactArgs().once().returns('');
      (await adb.ensureCurrentLocale('en', 'us')).should.be.false;
    });
    it('should return true when API 23 with script', async function () {
      mocks.adb.expects('getApiLevel').withExactArgs().once().returns(23);
      mocks.adb.expects('getDeviceLocale').withExactArgs().once().returns('zh-Hans-CN');
      (await adb.ensureCurrentLocale('zh', 'CN', 'Hans')).should.be.true;
    });
    it('should return false when API 23 with script', async function () {
      mocks.adb.expects('getApiLevel').withExactArgs().once().returns(23);
      mocks.adb.expects('getDeviceLocale').withExactArgs().once().returns('');
      (await adb.ensureCurrentLocale('zh', 'CN', 'Hans')).should.be.false;
    });
  });
  describe('setDeviceLocale', function () {
    it('should not call setDeviceLanguageCountry because of empty', async function () {
      mocks.adb.expects('setDeviceLanguageCountry').never();
      await adb.setDeviceLocale();
    });
    it('should not call setDeviceLanguageCountry because of invalid format no -', async function () {
      mocks.adb.expects('setDeviceLanguageCountry').never();
      await adb.setDeviceLocale('jp');
    });
    it('should not call setDeviceLanguageCountry because of invalid format /', async function () {
      mocks.adb.expects('setDeviceLanguageCountry').never();
      await adb.setDeviceLocale('en/US');
    });
    it('should call setDeviceLanguageCountry', async function () {
      mocks.adb.expects('setDeviceLanguageCountry').withExactArgs(language, country)
          .once().returns('');
      await adb.setDeviceLocale('en-US');
    });
    it('should call setDeviceLanguageCountry with degits for country', async function () {
      mocks.adb.expects('setDeviceLanguageCountry').withExactArgs(language, country + '0')
          .once().returns('');
      await adb.setDeviceLocale('en-US0');
    });
  });
  describe('setDeviceLanguageCountry', function () {
    it('should return if language and country are not passed', async function () {
      mocks.adb.expects('getDeviceLanguage').never();
      mocks.adb.expects('getDeviceCountry').never();
      mocks.adb.expects('getDeviceLocale').never();
      mocks.adb.expects('setDeviceSysLocaleViaSettingApp').never();
      mocks.adb.expects('reboot').never();
      await adb.setDeviceLanguageCountry();
    });
    it('should return if language or country are not passed', async function () {
      mocks.adb.expects('getDeviceLanguage').never();
      mocks.adb.expects('getDeviceCountry').never();
      mocks.adb.expects('getDeviceLocale').never();
      mocks.adb.expects('setDeviceSysLocaleViaSettingApp').never();
      mocks.adb.expects('reboot').never();
      await adb.setDeviceLanguageCountry('us');
    });
    it('should set language, country and reboot the device when API < 23', async function () {
      mocks.adb.expects('getApiLevel').withExactArgs()
        .once().returns(22);
      mocks.adb.expects('getDeviceLanguage').withExactArgs()
        .once().returns('fr');
      mocks.adb.expects('getDeviceCountry').withExactArgs()
        .once().returns('');
      mocks.adb.expects('setDeviceSysLocaleViaSettingApp').withExactArgs(language, country)
        .once().returns('');
      mocks.adb.expects('reboot').never();
      await adb.setDeviceLanguageCountry(language, country);
    });
    it('should not set language and country if it does not change when API < 23', async function () {
      mocks.adb.expects('getApiLevel').withExactArgs()
          .once().returns(22);
      mocks.adb.expects('getDeviceLanguage').once().returns('en');
      mocks.adb.expects('getDeviceCountry').once().returns('US');
      mocks.adb.expects('getDeviceLocale').never();
      mocks.adb.expects('setDeviceSysLocaleViaSettingApp').never();
      mocks.adb.expects('reboot').never();
      await adb.setDeviceLanguageCountry(language.toLowerCase(), country.toLowerCase());
    });
    it('should call set locale via setting app when API 23+', async function () {
      mocks.adb.expects('getApiLevel').withExactArgs()
          .once().returns(23);
      mocks.adb.expects('getDeviceLocale').withExactArgs()
          .once().returns('fr-FR');
      mocks.adb.expects('setDeviceSysLocaleViaSettingApp').withExactArgs(language, country, null)
          .once().returns('');
      mocks.adb.expects('reboot').never();
      await adb.setDeviceLanguageCountry(language, country);
    });
    it('should call set locale with script via setting app when API 24+', async function () {
      mocks.adb.expects('getApiLevel').withExactArgs()
          .once().returns(24);
      mocks.adb.expects('getDeviceLocale').withExactArgs()
          .once().returns('fr-FR');
      mocks.adb.expects('setDeviceSysLocaleViaSettingApp').withExactArgs('zh', 'CN', 'Hans')
          .once().returns('');
      mocks.adb.expects('reboot').never();
      await adb.setDeviceLanguageCountry('zh', 'CN', 'Hans');
    });
    it('should not set language and country if it does not change when API 24+', async function () {
      mocks.adb.expects('getApiLevel').withExactArgs()
          .once().returns(24);
      mocks.adb.expects('getDeviceLocale').withExactArgs()
          .once().returns(locale);
      mocks.adb.expects('setDeviceSysLocaleViaSettingApp').never();
      mocks.adb.expects('reboot').never();
      await adb.setDeviceLanguageCountry(language, country);
    });
    it('should not set language and country if no language when API 24+', async function () {
      mocks.adb.expects('getApiLevel').withExactArgs()
          .once().returns(24);
      mocks.adb.expects('getDeviceLocale').withExactArgs()
          .once().returns(locale);
      mocks.adb.expects('setDeviceSysLocaleViaSettingApp').never();
      mocks.adb.expects('reboot').never();
      await adb.setDeviceLanguageCountry(country);
    });
    it('should not set language and country if no country when API 24+', async function () {
      mocks.adb.expects('getApiLevel').withExactArgs()
          .once().returns(24);
      mocks.adb.expects('getDeviceLocale').withExactArgs()
          .once().returns(locale);
      mocks.adb.expects('setDeviceSysLocaleViaSettingApp').never();
      mocks.adb.expects('reboot').never();
      await adb.setDeviceLanguageCountry(language);
    });
  });

  describe('getPackageInfo', function () {
    it('should properly parse installed package info', async function () {
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
      for (let [name, value] of [
        ['name', 'com.example.testapp.first'],
        ['versionCode', 1],
        ['versionName', '1.0']]) {
        result.should.have.property(name, value);
      }
    });
  });
  describe('installOrUpgrade', function () {
    const pkgId = 'io.appium.settings';
    const apkPath = '/path/to/my.apk';

    it('should execute install if the package is not present', async function () {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).once().returns({
        name: pkgId
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(false);
      mocks.adb.expects('install').withArgs(apkPath).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should return if the same package version is already installed', async function () {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).once().returns({
        versionCode: 1
      });
      mocks.adb.expects('getPackageInfo').once().returns({
        versionCode: 1
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      await adb.installOrUpgrade(apkPath, pkgId);
    });
    it('should return if newer package version is already installed', async function () {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId,
        versionCode: 1
      });
      mocks.adb.expects('getPackageInfo').once().returns({
        versionCode: 2
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should execute install if apk version code cannot be read', async function () {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId
      });
      mocks.adb.expects('getPackageInfo').once().returns({
        versionCode: 2
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      mocks.adb.expects('install').withArgs(apkPath).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should execute install if pkg version code cannot be read', async function () {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId,
        versionCode: 1
      });
      mocks.adb.expects('getPackageInfo').once().returns({});
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      mocks.adb.expects('install').withArgs(apkPath).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should execute install if pkg id cannot be read', async function () {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({});
      mocks.adb.expects('install').withArgs(apkPath).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should perform upgrade if older package version is installed', async function () {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId,
        versionCode: 2
      });
      mocks.adb.expects('getPackageInfo').once().returns({
        versionCode: 1
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      mocks.adb.expects('install').withArgs(apkPath, {replace: true}).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should perform upgrade if older package version is installed, but version codes are not maintained', async function () {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId,
        versionCode: 1,
        versionName: '2.0.0',
      });
      mocks.adb.expects('getPackageInfo').once().returns({
        versionCode: 1,
        versionName: '1.0.0',
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      mocks.adb.expects('install').withArgs(apkPath, {replace: true}).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should perform upgrade if the same version is installed, but version codes are different', async function () {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId,
        versionCode: 2,
        versionName: '2.0.0',
      });
      mocks.adb.expects('getPackageInfo').once().returns({
        versionCode: 1,
        versionName: '2.0.0',
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      mocks.adb.expects('install').withArgs(apkPath, {replace: true}).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should uninstall and re-install if older package version is installed and upgrade fails', async function () {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId,
        versionCode: 2
      });
      mocks.adb.expects('getPackageInfo').once().returns({
        versionCode: 1
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      mocks.adb.expects('install').withArgs(apkPath, {replace: true}).once().throws();
      mocks.adb.expects('uninstallApk').withExactArgs(pkgId).once().returns(true);
      mocks.adb.expects('install').withArgs(apkPath, {replace: false}).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should throw an exception if upgrade and reinstall fail', async function () {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
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
    });
    it('should throw an exception if upgrade and uninstall fail', async function () {
      mocks.adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId,
        versionCode: 2
      });
      mocks.adb.expects('getPackageInfo').once().returns({
        versionCode: 1
      });
      mocks.adb.expects('isAppInstalled').withExactArgs(pkgId).once().returns(true);
      mocks.adb.expects('uninstallApk').withExactArgs(pkgId).once().returns(false);
      mocks.adb.expects('install').withArgs(apkPath).once().throws();
      let isExceptionThrown = false;
      try {
        await adb.installOrUpgrade(apkPath);
      } catch (e) {
        isExceptionThrown = true;
      }
      isExceptionThrown.should.be.true;
    });
  });
  describe('dumpsys', function () {
    it('should call shell with dumpsys args for sdk < 29', async function () {
      mocks.adb.expects('getApiLevel').returns(28);
      mocks.adb.expects('shell').withArgs(['getprop', 'ro.build.version.sdk']).onCall(0);
      mocks.adb.expects('shell').withArgs(['dumpsys', 'window', 'windows']).onCall(1);
      await adb.dumpWindows();
    });
    it('should call `dumpsys window displays` for sdk >= 29', async function () {
      mocks.adb.expects('getApiLevel').returns(29);
      mocks.adb.expects('shell').withArgs(['getprop', 'ro.build.version.sdk']).onCall(0);
      mocks.adb.expects('shell').withArgs(['dumpsys', 'window', 'displays']).onCall(1);
      await adb.dumpWindows();
    });
  });
  describe('isTestPackageOnly', function () {
    it('should return true on INSTALL_FAILED_TEST_ONLY meesage found in adb install output', function () {
      apksUtilsMethods.isTestPackageOnlyError('[INSTALL_FAILED_TEST_ONLY]').should.equal(true);
      apksUtilsMethods.isTestPackageOnlyError(' [INSTALL_FAILED_TEST_ONLY] ').should.equal(true);
    });
    it('should return false on INSTALL_FAILED_TEST_ONLY meesage not found in adb install output', function () {
      apksUtilsMethods.isTestPackageOnlyError('[INSTALL_FAILED_OTHER]').should.equal(false);
    });
  });
}));
