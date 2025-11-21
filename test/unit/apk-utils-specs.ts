import * as teen_process from 'teen_process';
import { fs } from '@appium/support';
import {ADB} from '../../lib/adb';
import { withMocks } from '@appium/test-support';
import _ from 'lodash';
import B from 'bluebird';
import { REMOTE_CACHE_ROOT } from '../../lib/tools/apk-utils';
import * as apksUtilsMethods from '../../lib/tools/apks-utils';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

const pkg = 'com.example.android.contactmanager',
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
    it('should parse correctly and return true for older versions', async function () {
      const pkg = 'dummy.package';
      (mocks as any).adb.expects('getApiLevel')
        .returns(25);
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['pm', 'path', pkg])
        .returns(`package:/system/priv-app/TeleService/TeleService.apk`);
      expect(await adb.isAppInstalled(pkg)).to.be.true;
    });
    it('should parse correctly and return false for older versions', async function () {
      const pkg = 'dummy.package';
      (mocks as any).adb.expects('getApiLevel')
        .returns(25);
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['pm', 'path', pkg])
        .throws();
      expect(await adb.isAppInstalled(pkg)).to.be.false;
    });
    it('should parse correctly and return true for newer versions', async function () {
      const pkg = 'dummy.package';
      (mocks as any).adb.expects('getApiLevel')
        .returns(26);
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['cmd', 'package', 'list', 'packages'])
        .returns(`package:dummy.package\npackage:other.package\n`);
      expect(await adb.isAppInstalled(pkg)).to.be.true;
    });
    it('should parse correctly and return false for newer versions', async function () {
      const pkg = 'dummy.package';
      (mocks as any).adb.expects('getApiLevel')
        .returns(26);
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['cmd', 'package', 'list', 'packages'])
        .returns(`package:dummy.package1`);
      expect(await adb.isAppInstalled(pkg)).to.be.false;
    });
    it('should parse correctly and return true for older versions with user', async function () {
      const pkg = 'dummy.package';
      (mocks as any).adb.expects('getApiLevel')
        .returns(25);
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['pm', 'path', '--user', '1', pkg])
        .returns(`package:/system/priv-app/TeleService/TeleService.apk with user`);
      expect(await adb.isAppInstalled(pkg, {user: '1'})).to.be.true;
    });
    it('should parse correctly and return false for older versions for user', async function () {
      const pkg = 'dummy.package';
      (mocks as any).adb.expects('getApiLevel')
        .returns(25);
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['pm', 'path', '--user', '1', pkg])
        .throws();
      expect(await adb.isAppInstalled(pkg, {user: '1'})).to.be.false;
    });

    it('should parse correctly and return true for newer versions with user', async function () {
      const pkg = 'dummy.package';
      (mocks as any).adb.expects('getApiLevel')
        .returns(26);
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['cmd', 'package', 'list', 'packages', '--user', '1'])
        .returns(`package:dummy.package\npackage:other.package\n`);
      expect(await adb.isAppInstalled(pkg, {user: '1'})).to.be.true;
    });
    it('should parse correctly and return false for newer versions with user', async function () {
      const pkg = 'dummy.package';
      (mocks as any).adb.expects('getApiLevel')
        .returns(26);
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['cmd', 'package', 'list', 'packages', '--user', '1'])
        .returns(`package:dummy.package1`);
      expect(await adb.isAppInstalled(pkg, {user: '1'})).to.be.false;
    });
  });

  describe('getFocusedPackageAndActivity', function () {
    it('should parse correctly and return package and activity', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/${act} t181}}}\n` +
                 `mCurrentFocus=Window{4330b6c0 com.android.settings/com.android.settings.SubSettings paused=false}`);

      const {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
      expect(appPackage).to.equal(pkg);
      expect(appActivity).to.equal(act);
    });
    it('should return package and activity if multiple apps are active', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=ActivityRecord{14d88c3 u0 com.android.systemui/.subscreen.SubHomeActivity t9}
        mFocusedApp=ActivityRecord{d72327 u0 eu.niko.smart.universal/crc648a3abc16689e594e.MainActivity t409}
        mCurrentFocus=Window{2785a60 u0 eu.niko.smart.universal/crc648a3abc16689e594e.MainActivity}
        mCurrentFocus=null`);
      const {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
      expect(appPackage).to.equal('eu.niko.smart.universal');
      expect(appActivity).to.equal('crc648a3abc16689e594e.MainActivity');
    });
    it('should return package and activity if the activity name has the package name itself', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=null
        mFocusedApp=ActivityRecord{caf038a u0 com.android.systemui/.subscreen.SubHomeActivity t7}
        mFocusedApp=ActivityRecord{a646676 u0 com.example.android/.activity.main.MainActivity t285}
        mCurrentFocus=null
        mCurrentFocus=null
        mCurrentFocus=Window{5e9b13b u0 com.example.android/com.example.android.activity.main.MainActivity}}`);
      const {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
      expect(appPackage).to.equal('com.example.android');
      expect(appActivity).to.equal('.activity.main.MainActivity');
    });
    it('should parse correctly and return package and activity when a comma is present', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{20fe217e token=Token{21878739 ` +
                 `ActivityRecord{16425300 u0 ${pkg}/${act}, isShadow:false t10}}}`);

      const {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
      expect(appPackage).to.equal(pkg);
      expect(appActivity).to.equal(act);
    });
    it('should parse correctly and return package and activity of only mCurrentFocus is set', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=null\n  mCurrentFocus=Window{4330b6c0 u0 ${pkg}/${act} paused=false}`);

      const {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
      expect(appPackage).to.equal(pkg);
      expect(appActivity).to.equal(act);
    });
    it('should return null if mFocusedApp=null', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns('mFocusedApp=null');
      const {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
      expect(appPackage);
      expect(appActivity);
    });
    it('should return null if mCurrentFocus=null', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns('mCurrentFocus=null');
      const {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
      expect(appPackage);
      expect(appActivity);
    });
  });
  describe('waitForActivityOrNot', function () {
    it('should call shell once and should return', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/${act} t181}}}`);

      await adb.waitForActivityOrNot(pkg, act, false);
    });
    it('should call shell multiple times and return', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .returns('mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ' +
                 'ActivityRecord{2c7c4318 u0 foo/bar t181}}}');
      (mocks as any).adb.expects('dumpWindows')
        .returns('mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ' +
                 'ActivityRecord{2c7c4318 u0 com.example.android.contactmanager/.ContactManager t181}}}');

      await adb.waitForActivityOrNot(pkg, act, false);
    });
    it('should call shell once return for not', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns('mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ' +
                 'ActivityRecord{c 0 foo/bar t181}}}');

      await adb.waitForActivityOrNot(pkg, act, true);
    });
    it('should call shell multiple times and return for not', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/${act} t181}}}`);
      (mocks as any).adb.expects('dumpWindows')
        .returns('mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ' +
                 'ActivityRecord{2c7c4318 u0 foo/bar t181}}}');
      await adb.waitForActivityOrNot(pkg, act, true);
    });
    it('should be able to get first of a comma-separated list of activities', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, '.ContactManager, .OtherManager', false);
    });
    it('should be able to get second of a comma-separated list of activities', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.OtherManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, '.ContactManager, .OtherManager', false);
    });
    it('should fail if no activity in a comma-separated list is available', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .atLeast(1)
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/${act} t181}}}`);

      await expect(adb.waitForActivityOrNot(pkg, '.SuperManager, .OtherManager', false, 1000)).to.eventually.be.rejected;
    });
    it('should be able to match activities if waitActivity is a wildcard', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `*`, false);
    });
    it('should be able to match activities if waitActivity is shortened and contains a whildcard', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `.*Manager`, false);
    });
    it('should be able to match activities if waitActivity contains a wildcard alternative to activity', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `${pkg}.*`, false);
    });
    it('should be able to match activities if waitActivity contains a wildcard on head', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `*.contactmanager.ContactManager`, false);
    });
    it('should be able to match activities if waitActivity contains a wildcard across a pkg name and an activity name', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `com.*Manager`, false);
    });
    it('should be able to match activities if waitActivity contains wildcards in both a pkg name and an activity name', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u ${pkg}/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot(pkg, `com.*.contactmanager.*Manager`, false);
    });
    it('should fail if activity not to match from regexp activities', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .atLeast(1)
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
                 `ActivityRecord{2 u com.example.android.supermanager/.SuperManager t181}}}`);

      await expect(adb.waitForActivityOrNot('com.example.android.supermanager', `${pkg}.*`, false, 1000)).to.eventually.be.rejected;
    });
    it('should be able to get an activity that is an inner class', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u ${pkg}/.Settings$AppDrawOverlaySettingsActivity t181}}}`);

      await adb.waitForActivityOrNot(pkg, '.Settings$AppDrawOverlaySettingsActivity', false);
    });
    it('should be able to get first activity from first package in a comma-separated list of packages + activities', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u com.android.settings/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot('com.android.settings,com.example.android.supermanager', '.ContactManager,.OtherManager', false);
    });
    it('should be able to get first activity from second package in a comma-separated list of packages + activities', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u com.example.android.supermanager/.ContactManager t181}}}`);

      await adb.waitForActivityOrNot('com.android.settings,com.example.android.supermanager', '.ContactManager,.OtherManager', false);
    });
    it('should be able to get second activity from first package in a comma-separated list of packages + activities', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u com.android.settings/.OtherManager t181}}}`);

      await adb.waitForActivityOrNot('com.android.settings,com.example.android.supermanager', '.ContactManager,.OtherManager', false);
    });
    it('should be able to get second activity from second package in a comma-separated list of packages', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .once()
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u com.example.android.supermanager/.OtherManager t181}}}`);

      await adb.waitForActivityOrNot('com.android.settings,com.example.android.supermanager', '.ContactManager,.OtherManager', false);
    });
    it('should fail to get activity when focused activity matches none of the provided list of packages', async function () {
      (mocks as any).adb.expects('dumpWindows')
        .atLeast(1)
        .returns(`mFocusedApp=AppWindowToken{38600b56 token=Token{9ea1171 ` +
          `ActivityRecord{2 u com.otherpackage/.ContactManager t181}}}`);

      await expect(adb.waitForActivityOrNot('com.android.settings,com.example.android.supermanager', '.ContactManager, .OtherManager', false, 1000)).to.eventually.be.rejected;
    });
  });
  describe('waitForActivity', function () {
    it('should call waitForActivityOrNot with correct arguments', async function () {
      (mocks as any).adb.expects('waitForActivityOrNot')
        .once().withExactArgs(pkg, act, false, 20000)
        .returns('');
      await adb.waitForActivity(pkg, act);
    });
  });
  describe('waitForNotActivity', function () {
    it('should call waitForActivityOrNot with correct arguments', async function () {
      (mocks as any).adb.expects('waitForActivityOrNot')
        .once().withExactArgs(pkg, act, true, 20000)
        .returns('');
      await adb.waitForNotActivity(pkg, act);
    });
  });
  describe('uninstallApk', function () {
    it('should call forceStop and adbExec with correct arguments', async function () {
      (mocks as any).adb.expects('isAppInstalled')
        .once().withExactArgs(pkg)
        .returns(true);
      (mocks as any).adb.expects('forceStop')
        .once().withExactArgs(pkg)
        .returns('');
      (mocks as any).adb.expects('adbExec')
        .once().withExactArgs(['uninstall', pkg], {timeout: undefined})
        .returns('Success');
      const result = await adb.uninstallApk(pkg);
      expect(result).to.be.true;
    });
    it('should not call forceStop and adbExec if app not installed', async function () {
      (mocks as any).adb.expects('isAppInstalled')
        .once().withExactArgs(pkg)
        .returns(false);
      (mocks as any).adb.expects('forceStop')
        .never();
      (mocks as any).adb.expects('adbExec')
        .never();
      const result = await adb.uninstallApk(pkg);
      expect(result).to.be.false;
    });
  });
  describe('installFromDevicePath', function () {
    it('should call shell with correct arguments', async function () {
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['pm', 'install', '-r', 'foo'], {})
        .returns('');
      await adb.installFromDevicePath('foo');
    });
  });
  describe('cacheApk', function () {
    it('should remove extra apks from the cache', async function () {
      const apkPath = '/dummy/foo.apk';
      adb._areExtendedLsOptionsSupported = true;
      (mocks as any).adb.expects('shell')
        .once()
        .withExactArgs([`ls -t -1 ${REMOTE_CACHE_ROOT} 2>&1 || echo _ERROR_`])
        .returns(_.range(adb.remoteAppsCacheLimit! + 2)
          .map((x) => `${x}.apk`)
          .join('\r\n')
        );
      (mocks as any).adb.expects('shell')
        .once()
        .withExactArgs(['touch', '-am', '/data/local/tmp/appium_cache/1.apk'])
        .returns(B.resolve());
      (mocks as any).fs.expects('hash')
        .withExactArgs(apkPath)
        .returns('1');
      (mocks as any).adb.expects('shell')
        .once()
        .withExactArgs([
          'rm', '-f',
          `${REMOTE_CACHE_ROOT}/${adb.remoteAppsCacheLimit!}.apk`,
          `${REMOTE_CACHE_ROOT}/${adb.remoteAppsCacheLimit! + 1}.apk`,
        ]);
      await adb.cacheApk(apkPath);
    });
    it('should add apk into the cache if it is not there yet', async function () {
      const apkPath = '/dummy/foo.apk';
      const hash = '12345';
      adb._areExtendedLsOptionsSupported = true;
      (mocks as any).adb.expects('ls')
        .once()
        .withExactArgs([`ls -t -1 ${REMOTE_CACHE_ROOT} 2>&1 || echo _ERROR_`])
        .returns('');
      (mocks as any).fs.expects('hash')
        .withExactArgs(apkPath)
        .returns(hash);
      (mocks as any).adb.expects('shell')
        .once()
        .withExactArgs(['mkdir', '-p', REMOTE_CACHE_ROOT])
        .returns();
      (mocks as any).adb.expects('push')
        .once()
        .withArgs(apkPath, `${REMOTE_CACHE_ROOT}/${hash}.apk`)
        .returns();
      (mocks as any).fs.expects('stat')
        .once()
        .withExactArgs(apkPath)
        .returns({size: 1});
      await adb.cacheApk(apkPath);
    });
  });
  describe('install', function () {
    it('should call shell with correct arguments', async function () {
      (mocks as any).adb.expects('isStreamedInstallSupported')
        .once().returns(false);
      (mocks as any).adb.expects('getApiLevel')
        .once().returns(23);
      (mocks as any).adb.expects('cacheApk')
        .once().withExactArgs('foo', {
          timeout: 60000,
        })
        .returns('bar');
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['pm', 'install', '-r', 'bar'], {
          timeout: 60000,
          timeoutCapName: 'androidInstallTimeout'
        })
        .returns('');
      await adb.install('foo');
    });
    it('should not cache apk if streamed install is supported', async function () {
      (mocks as any).adb.expects('isStreamedInstallSupported')
        .once().returns(true);
      (mocks as any).adb.expects('getApiLevel')
        .once().returns(23);
      (mocks as any).adb.expects('cacheApk')
        .never();
      (mocks as any).adb.expects('adbExec')
        .once().withExactArgs(['install', '-r', 'foo'], {
          timeout: 60000,
          timeoutCapName: 'androidInstallTimeout'
        })
        .returns('');
      await adb.install('foo');
    });
    it('should call shell with correct arguments when not replacing', async function () {
      (mocks as any).adb.expects('isStreamedInstallSupported')
        .once().returns(false);
      (mocks as any).adb.expects('getApiLevel')
        .once().returns(23);
      (mocks as any).adb.expects('cacheApk')
        .once().withExactArgs('foo', {
          timeout: 60000,
        })
        .returns('bar');
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['pm', 'install', 'bar'], {
          timeout: 60000,
          timeoutCapName: 'androidInstallTimeout'
        })
        .returns('');
      await adb.install('foo', {replace: false});
    });
    it('should call apks install if the path points to it', async function () {
      (mocks as any).adb.expects('installApks')
        .once().withArgs('foo.apks')
        .returns('');
      await adb.install('foo.apks');
    });
  });
  describe('startUri', function () {
    it('should fail if uri is not provided', async function () {
      await expect(adb.startUri('' as any)).to.eventually.be.rejectedWith(/argument is required/);
    });
    it('should fail if "unable to resolve intent" appears in shell command result', async function () {
      (mocks as any).adb.expects('shell')
        .once().withExactArgs([
          'am', 'start', '-W', '-a',
          'android.intent.action.VIEW', '-d', uri, pkg
        ])
        .returns('Something something something Unable to resolve intent something something');

      await expect(adb.startUri(uri, pkg)).to.eventually.be.rejectedWith(/Unable to resolve intent/);
    });
    it('should build a call to a VIEW intent with the uri', async function () {
      (mocks as any).adb.expects('shell')
        .once().withExactArgs([
          'am', 'start', '-W', '-a',
          'android.intent.action.VIEW', '-d', uri
        ])
        .returns('Passable result');

      await adb.startUri(uri);
    });
    it('should build a call to a VIEW intent with the uri and package', async function () {
      (mocks as any).adb.expects('shell')
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
      (mocks as any).adb.expects('getApiLevel')
        .once().withExactArgs()
        .returns(17);
      (mocks as any).adb.expects('shell')
        .once().withArgs(cmd)
        .returns('');
      await adb.startApp(startAppOptions);
    });
    it('should call getApiLevel and shell with correct arguments for class error', async function () {
      (mocks as any).adb.expects('getApiLevel')
        .twice()
        .returns(17);
      (mocks as any).adb.expects('shell')
        .onCall(0)
        .returns('Error: Activity class foo does not exist');
      (mocks as any).adb.expects('shell')
        .returns('');
      await adb.startApp(startAppOptions);
    });
    it('should call getApiLevel and shell with correct arguments when activity is intent', async function () {
      const startAppOptionsWithIntent = {
        pkg: 'pkg',
        action: 'android.intent.action.VIEW',
        category: 'android.intent.category.DEFAULT',
        optionalIntentArguments: '-d scheme://127.0.0.1'
      };
      const cmdWithIntent = ['am', 'start', '-W', '-S', '-a', 'android.intent.action.VIEW', '-c', 'android.intent.category.DEFAULT', '-d', 'scheme://127.0.0.1'];

      (mocks as any).adb.expects('getApiLevel')
        .once().withExactArgs()
        .returns(17);
      (mocks as any).adb.expects('shell')
        .once().withArgs(cmdWithIntent)
        .returns('');
      await adb.startApp(startAppOptionsWithIntent);
    });
    it('should throw error when action provided, but pkg not provided', async function () {
      const startAppOptionsWithoutPkg = {
        action: 'android.intent.action.VIEW'
      };
      await expect(adb.startApp(startAppOptionsWithoutPkg as any)).to.eventually.be.rejectedWith(
        `pkg, and activity or intent action, are required to start an application`);
    });
    it('should throw error when activity provided, but pkg not provided', async function () {
      const startAppOptionsWithoutPkg = {
        activity: '.MainActivity'
      };
      await expect(adb.startApp(startAppOptionsWithoutPkg as any)).to.eventually.be.rejectedWith(
        `pkg, and activity or intent action, are required to start an application`);
    });
    it('should throw error when neither action nor activity provided', async function () {
      const startAppOptionsWithoutActivityOrAction = {
        pkg: 'pkg'
      };
      await expect(adb.startApp(startAppOptionsWithoutActivityOrAction)).to.eventually.be.rejectedWith(
        `pkg, and activity or intent action, are required to start an application`);
    });
    it('should call getApiLevel and shell with correct arguments when activity is inner class', async function () {
      const startAppOptionsWithInnerClass = { pkg: 'pkg', activity: 'act$InnerAct'},
            cmdWithInnerClass = ['am', 'start', '-W', '-n', 'pkg/act\\$InnerAct', '-S'];

      (mocks as any).adb.expects('getApiLevel')
        .once().withExactArgs()
        .returns(17);
      (mocks as any).adb.expects('shell')
        .once().withArgs(cmdWithInnerClass)
        .returns('');
      await adb.startApp(startAppOptionsWithInnerClass);
    });
  });
  describe('getDeviceLanguage', function () {
    it('should call shell one time with correct args and return language when API < 23', async function () {
      (mocks as any).adb.expects('getApiLevel').returns(18);
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.language'])
        .returns(language);
      expect(await adb.getDeviceLanguage()).to.equal(language);
    });
    it('should call shell two times with correct args and return language when API < 23', async function () {
      (mocks as any).adb.expects('getApiLevel').returns(18);
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.language'])
        .returns('');
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['getprop', 'ro.product.locale.language'])
        .returns(language);
      expect(await adb.getDeviceLanguage()).to.equal(language);
    });
    it('should call shell one time with correct args and return language when API = 23', async function () {
      (mocks as any).adb.expects('getApiLevel').returns(23);
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.locale'])
        .returns(locale);
      expect(await adb.getDeviceLanguage()).to.equal(language);
    });
    it('should call shell two times with correct args and return language when API = 23', async function () {
      (mocks as any).adb.expects('getApiLevel').returns(23);
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.locale'])
        .returns('');
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['getprop', 'ro.product.locale'])
        .returns(locale);
      expect(await adb.getDeviceLanguage()).to.equal(language);
    });
  });
  describe('getDeviceCountry', function () {
    it('should call shell one time with correct args and return country', async function () {
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.country'])
        .returns(country);
      expect(await adb.getDeviceCountry()).to.equal(country);
    });
    it('should call shell two times with correct args and return country', async function () {
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.country'])
        .returns('');
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['getprop', 'ro.product.locale.region'])
        .returns(country);
      expect(await adb.getDeviceCountry()).to.equal(country);
    });
  });
  describe('getDeviceLocale', function () {
    it('should call shell one time with correct args and return locale', async function () {
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.locale'])
        .returns(locale);
      expect(await adb.getDeviceLocale()).to.equal(locale);
    });
    it('should call shell two times with correct args and return locale', async function () {
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.locale'])
        .returns('');
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['getprop', 'ro.product.locale'])
        .returns(locale);
      expect(await adb.getDeviceLocale()).to.equal(locale);
    });
  });
  describe('ensureCurrentLocale', function () {
    it('should return false if no arguments', async function () {
      expect(await adb.ensureCurrentLocale()).to.be.false;
    });
    it('should return true when API 22 and only language', async function () {
      (mocks as any).adb.expects('getApiLevel').withExactArgs().once().returns(22);
      (mocks as any).adb.expects('getDeviceLanguage').withExactArgs().once().returns('fr');
      (mocks as any).adb.expects('getDeviceCountry').withExactArgs().never();
      expect(await adb.ensureCurrentLocale('fr', undefined)).to.be.true;
    });
    it('should return true when API 22 and only country', async function () {
      (mocks as any).adb.expects('getApiLevel').withExactArgs().once().returns(22);
      (mocks as any).adb.expects('getDeviceCountry').withExactArgs().once().returns('FR');
      (mocks as any).adb.expects('getDeviceLanguage').withExactArgs().never();
      expect(await adb.ensureCurrentLocale(undefined, 'FR')).to.be.true;
    });
    it('should return true when API 22', async function () {
      (mocks as any).adb.expects('getApiLevel').withExactArgs().once().returns(22);
      (mocks as any).adb.expects('getDeviceLanguage').withExactArgs().once().returns('fr');
      (mocks as any).adb.expects('getDeviceCountry').withExactArgs().once().returns('FR');
      expect(await adb.ensureCurrentLocale('FR', 'fr')).to.be.true;
    });
    it('should return false when API 22', async function () {
      (mocks as any).adb.expects('getApiLevel').withExactArgs().once().returns(22);
      (mocks as any).adb.expects('getDeviceLanguage').withExactArgs().once().returns('');
      (mocks as any).adb.expects('getDeviceCountry').withExactArgs().once().returns('FR');
      expect(await adb.ensureCurrentLocale('en', 'US')).to.be.false;
    });
    it('should return true when API 23', async function () {
      (mocks as any).adb.expects('getApiLevel').withExactArgs().once().returns(23);
      (mocks as any).adb.expects('getDeviceLocale').withExactArgs().once().returns('fr-FR');
      expect(await adb.ensureCurrentLocale('fr', 'fr')).to.be.true;
    });
    it('should return false when API 23', async function () {
      (mocks as any).adb.expects('getApiLevel').withExactArgs().once().returns(23);
      (mocks as any).adb.expects('getDeviceLocale').withExactArgs().once().returns('');
      expect(await adb.ensureCurrentLocale('en', 'us')).to.be.false;
    });
    it('should return true when API 23 with script', async function () {
      (mocks as any).adb.expects('getApiLevel').withExactArgs().once().returns(23);
      (mocks as any).adb.expects('getDeviceLocale').withExactArgs().once().returns('zh-Hans-CN');
      expect(await adb.ensureCurrentLocale('zh', 'CN', 'Hans')).to.be.true;
    });
    it('should return false when API 23 with script', async function () {
      (mocks as any).adb.expects('getApiLevel').withExactArgs().once().returns(23);
      (mocks as any).adb.expects('getDeviceLocale').withExactArgs().once().returns('');
      expect(await adb.ensureCurrentLocale('zh', 'CN', 'Hans')).to.be.false;
    });
  });

  describe('getPackageInfo', function () {
    it('should properly parse installed package info', async function () {
      (mocks as any).adb.expects('shell').once().returns(`Packages:
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
      for (const [name, value] of [
        ['name', 'com.example.testapp.first'],
        ['versionCode', 1],
        ['versionName', '1.0'],
        ['isInstalled', true]
      ]) {
        expect(result).to.have.property(name, value);
      }
    });
  });
  describe('installOrUpgrade', function () {
    const pkgId = 'io.appium.settings';
    const apkPath = '/path/to/my.apk';

    it('should execute install if the package is not present', async function () {
      (mocks as any).adb.expects('getApkInfo').withExactArgs(apkPath).once().returns({
        name: pkgId,
      });
      (mocks as any).adb.expects('getApplicationInstallState').withExactArgs(apkPath, pkgId).once()
        .returns(adb.APP_INSTALL_STATE.NOT_INSTALLED);
      (mocks as any).adb.expects('install').withArgs(apkPath).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should return if the same package version is already installed', async function () {
      (mocks as any).adb.expects('getApkInfo').withExactArgs(apkPath).once().returns({
        name: pkgId,
        versionCode: 1
      });
      (mocks as any).adb.expects('getPackageInfo').once().returns({
        name: pkgId,
        versionCode: 1,
        isInstalled: true,
      });
      await adb.installOrUpgrade(apkPath, pkgId);
    });
    it('should return if newer package version is already installed', async function () {
      (mocks as any).adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId,
        versionCode: 1
      });
      (mocks as any).adb.expects('getPackageInfo').once().returns({
        name: pkgId,
        versionCode: 2,
        isInstalled: true,
      });
      await adb.installOrUpgrade(apkPath);
    });
    it('should execute install if apk version code cannot be read', async function () {
      (mocks as any).adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId
      });
      (mocks as any).adb.expects('getPackageInfo').once().returns({
        name: pkgId,
        versionCode: 2,
        isInstalled: true,
      });
      (mocks as any).adb.expects('install').withArgs(apkPath).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should execute install if pkg version code cannot be read', async function () {
      (mocks as any).adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId,
        versionCode: 1
      });
      (mocks as any).adb.expects('getPackageInfo').once().returns({});
      (mocks as any).adb.expects('install').withArgs(apkPath).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should execute install if pkg id cannot be read', async function () {
      (mocks as any).adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({});
      (mocks as any).adb.expects('install').withArgs(apkPath).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should perform upgrade if older package version is installed', async function () {
      (mocks as any).adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId,
        versionCode: 2
      });
      (mocks as any).adb.expects('getPackageInfo').once().returns({
        name: pkgId,
        versionCode: 1,
        isInstalled: true,
      });
      (mocks as any).adb.expects('install').withArgs(apkPath, {replace: true}).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should perform upgrade if older package version is installed, but version codes are not maintained', async function () {
      (mocks as any).adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId,
        versionCode: 1,
        versionName: '2.0.0',
      });
      (mocks as any).adb.expects('getPackageInfo').once().returns({
        name: pkgId,
        versionCode: 1,
        versionName: '1.0.0',
        isInstalled: true,
      });
      (mocks as any).adb.expects('install').withArgs(apkPath, {replace: true}).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should perform upgrade if the same version is installed, but version codes are different', async function () {
      (mocks as any).adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId,
        versionCode: 2,
        versionName: '2.0.0',
      });
      (mocks as any).adb.expects('getPackageInfo').once().returns({
        name: pkgId,
        versionCode: 1,
        versionName: '2.0.0',
        isInstalled: true,
      });
      (mocks as any).adb.expects('install').withArgs(apkPath, {replace: true}).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should uninstall and re-install if older package version is installed and upgrade fails', async function () {
      (mocks as any).adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId,
        versionCode: 2
      });
      (mocks as any).adb.expects('getPackageInfo').once().returns({
        name: pkgId,
        versionCode: 1,
        isInstalled: true,
      });
      (mocks as any).adb.expects('install').withArgs(apkPath, {replace: true}).once().throws();
      (mocks as any).adb.expects('uninstallApk').withArgs(pkgId).once().returns(true);
      (mocks as any).adb.expects('install').withArgs(apkPath, {replace: false}).once().returns(true);
      await adb.installOrUpgrade(apkPath);
    });
    it('should throw an exception if upgrade and reinstall fail', async function () {
      (mocks as any).adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId,
        versionCode: 2
      });
      (mocks as any).adb.expects('getPackageInfo').once().returns({
        name: pkgId,
        versionCode: 1,
        isInstalled: true,
      });
      (mocks as any).adb.expects('uninstallApk').withArgs(pkgId).once().returns(true);
      (mocks as any).adb.expects('install').withArgs(apkPath).twice().throws();
      await expect(adb.installOrUpgrade(apkPath)).to.be.rejected;
    });
    it('should throw an exception if upgrade and uninstall fail', async function () {
      (mocks as any).adb.expects('getApkInfo').withExactArgs(apkPath).atLeast(1).returns({
        name: pkgId,
        versionCode: 2
      });
      (mocks as any).adb.expects('getPackageInfo').once().returns({
        name: pkgId,
        versionCode: 1,
        isInstalled: true,
      });
      (mocks as any).adb.expects('uninstallApk').withArgs(pkgId).once().returns(false);
      (mocks as any).adb.expects('install').withArgs(apkPath).once().throws();
      await expect(adb.installOrUpgrade(apkPath)).to.be.rejected;
    });
  });
  describe('dumpsys', function () {
    it('should call shell with dumpsys args for sdk < 29', async function () {
      (mocks as any).adb.expects('getApiLevel').returns(28);
      (mocks as any).adb.expects('shell').withArgs(['getprop', 'ro.build.version.sdk']).onCall(0);
      (mocks as any).adb.expects('shell').withArgs(['dumpsys', 'window', 'windows']).onCall(1);
      await adb.dumpWindows();
    });
    it('should call `dumpsys window displays` for sdk >= 29', async function () {
      (mocks as any).adb.expects('getApiLevel').returns(29);
      (mocks as any).adb.expects('shell').withArgs(['getprop', 'ro.build.version.sdk']).onCall(0);
      (mocks as any).adb.expects('shell').withArgs(['dumpsys', 'window', 'displays']).onCall(1);
      await adb.dumpWindows();
    });
  });
  describe('isTestPackageOnly', function () {
    it('should return true on INSTALL_FAILED_TEST_ONLY message found in adb install output', function () {
      expect(apksUtilsMethods.isTestPackageOnlyError('[INSTALL_FAILED_TEST_ONLY]')).to.equal(true);
      expect(apksUtilsMethods.isTestPackageOnlyError(' [INSTALL_FAILED_TEST_ONLY] ')).to.equal(true);
    });
    it('should return false on INSTALL_FAILED_TEST_ONLY message not found in adb install output', function () {
      expect(apksUtilsMethods.isTestPackageOnlyError('[INSTALL_FAILED_OTHER]')).to.equal(false);
    });
  });
  describe('installMultipleApks', function () {
    it('should call adbExec with an apk', async function () {
      (mocks as any).adb.expects('getApiLevel').once().returns(28);
      (mocks as any).adb.expects('adbExec').withArgs([
        'install-multiple', '-r', '/dummy/apk.apk'
      ], {
        timeout: undefined, timeoutCapName: undefined
      }).once();
      await adb.installMultipleApks(['/dummy/apk.apk'], {});
    });

    it('should call adbExec with two apks', async function () {
      (mocks as any).adb.expects('getApiLevel').once().returns(28);
      (mocks as any).adb.expects('adbExec').withArgs([
        'install-multiple', '-r', '/dummy/apk.apk', '/dummy/apk2.apk'
      ], {
        timeout: undefined, timeoutCapName: undefined
      }).once();
      await adb.installMultipleApks(['/dummy/apk.apk', '/dummy/apk2.apk'], {});
    });

    it('should call adbExec with an apk and options', async function () {
      (mocks as any).adb.expects('getApiLevel').once().returns(28);
      (mocks as any).adb.expects('adbExec').withArgs([
        'install-multiple',
        '-r', '-t', '-s', '-g', '-p',
        '/dummy/apk.apk'
      ], {
        timeout: 60,
        timeoutCapName: 'androidInstallTimeout',
      }).once();
      await adb.installMultipleApks(['/dummy/apk.apk'], {
        timeout: 60,
        timeoutCapName: 'androidInstallTimeout',
        grantPermissions: true,
        useSdcard: true,
        allowTestPackages: true,
        partialInstall: true
      } as any);
    });
  });
}));
