import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import * as teen_process from 'teen_process';
import { fs } from 'appium-support';
import ADB from '../..';
import { withMocks } from 'appium-test-support';
import path from 'path';
import _ from 'lodash';
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
  describe('extractStringsFromApk', function () {
    it('should fallback to default if en locale is not present in the config', async function () {
      mocks.teen_process.expects('exec').onCall(0)
      .returns({stdout: `
      Package Groups (1)
      Package Group 0 id=0x7f packageCount=1 name=io.appium.android.apis
      Package 0 id=0x7f name=io.appium.android.apis
        type 0 configCount=1 entryCount=6
          config (default):
            resource 0x7f0c0215 io.appium.android.apis:string/linear_layout_8_vertical: t=0x03 d=0x0000044c (s=0x0008 r=0x00)
              (string16) "Vertical"
            resource 0x7f0c0216 io.appium.android.apis:string/linear_layout_8_horizontal: t=0x03 d=0x0000044d (s=0x0008 r=0x00)
              (string16) "Horizontal"
          config fr:
            resource 0x7f0c0215 io.appium.android.apis:string/linear_layout_8_vertical: t=0x03 d=0x0000044c (s=0x0008 r=0x00)
              (string16) "Vertical"
            resource 0x7f0c0216 io.appium.android.apis:string/linear_layout_8_horizontal: t=0x03 d=0x0000044d (s=0x0008 r=0x00)
              (string16) "Horizontal"
      `});
      mocks.teen_process.expects('exec')
      .returns({stdout: `
      nodpi-v4

      xlarge-v4
      v9
      v11
      v12
      v13
      w600dp-v13
      w720dp-v13
      w1024dp-v13
      h550dp-v13
      h670dp-v13
      h974dp-v13
      sw480dp-v13
      sw600dp-v13
      sw720dp-v13
      v14
      v16
      v17
      land
      land-v13
      ldpi-v4
      mdpi-v4
      hdpi-v4
      xhdpi-v4
      fr
      `});
      mocks.fs.expects('writeFile').once();
      const {apkStrings, localPath} = await adb.extractStringsFromApk('/fake/path.apk', 'en', '/tmp');
      apkStrings.linear_layout_8_horizontal.should.eql('Horizontal');
      localPath.should.eql(path.resolve('/tmp', 'strings.json'));
    });
    it('should properly parse aapt output', async function () {
      mocks.teen_process.expects('exec').once()
        .returns({stdout: `
        Package Groups (1)
        Package Group 0 id=0x7f packageCount=1 name=io.appium.test
          Package 0 id=0x7f name=io.appium.test
            type 0 configCount=1 entryCount=685
              spec resource 0x7f010000 io.appium.test:attr/audioMessageDuration: flags=0x00000000
              spec resource 0x7f010001 io.appium.test:attr/callingChatheadFooter: flags=0x00000000
              spec resource 0x7f010002 io.appium.test:attr/callingChatheadInitials: flags=0x00000000
              spec resource 0x7f010003 io.appium.test:attr/callingControlButtonLabel: flags=0x00000000
              spec resource 0x7f010004 io.appium.test:attr/circleRadius: flags=0x00000000
              config de-rDE:
                resource 0x7f010000 io.appium.test:attr/audioMessageDuration: <bag>
                  Parent=0x00000000(Resolved=0x7f000000), Count=1
                  #0 (Key=0x01000000): (color) #00000001
                resource 0x7f010001 io.appium.test:attr/callingChatheadFooter: <bag>
                  Parent=0x00000000(Resolved=0x7f000000), Count=1
                  #0 (Key=0x01000000): (color) #00000001
              config de-rDE:
                resource 0x7f080000 io.appium.test:string/abc_action_bar_home_description: t=0x03 d=0x00000c27 (s=0x0008 r=0x00)
                  (string8) "Navigate \\"home\\""
                resource 0x7f080001 io.appium.test:string/abc_action_bar_home_description_format: t=0x03 d=0x00000ad1 (s=0x0008 r=0x00)
                  (string8) "%1$s, %2$s"
                resource 0x7f080002 io.appium.test:string/abc_action_bar_home_subtitle_description_format: t=0x03 d=0x00000ad0 (s=0x0008 r=0x00)
                  (string8) "%1$s, %2$s, %3$s"
            type 1 configCount=1 entryCount=685
              config de-rDE:
                resource 0x7f0a0000 io.appium.test:plurals/calling__conversation_full__message: <bag>
                  Parent=0x00000000(Resolved=0x7f000000), Count=2
                  #0 (Key=0x01000004): (string8) "Calls work in conversations with up to 1 person."
                  #1 (Key=0x01000005): (string8) "Calls work in conversations with up to %1$d people. \\"blabla\\""
                resource 0x7f0a0001 io.appium.test:plurals/calling__voice_channel_full__message: <bag>
                  Parent=0x00000000(Resolved=0x7f000000), Count=6
                  #0 (Key=0x01000004): (string8) "There's only room for %1$d people in here."
                  #1 (Key=0x01000005): (string8) "There's only room for %1$d people in here."
                  #2 (Key=0x01000006): (string8) "There's only room for %1$d people in here."
                  #3 (Key=0x01000007): (string8) "There's only room for %1$d people in here."
                  #4 (Key=0x01000008): (string8) "There's only room for %1$d people in here."
                  #5 (Key=0x01000009): (string8) "There's only room for %1$d people in here."
            type 16 configCount=1 entryCount=8
              spec resource 0x7f110000 io.appium.test:menu/conversation_header_menu_audio: flags=0x00000000
              spec resource 0x7f110001 io.appium.test:menu/conversation_header_menu_collection: flags=0x00000000
              spec resource 0x7f110002 io.appium.test:menu/conversation_header_menu_collection_searching: flags=0x00000000
              spec resource 0x7f110003 io.appium.test:menu/conversation_header_menu_video: flags=0x00000000
              spec resource 0x7f110004 io.appium.test:menu/conversation_multiuse: flags=0x00000000
              spec resource 0x7f110005 io.appium.test:menu/toolbar_close_white: flags=0x00000000
              spec resource 0x7f110006 io.appium.test:menu/toolbar_collection: flags=0x00000000
              spec resource 0x7f110007 io.appium.test:menu/toolbar_sketch: flags=0x00000000
              config (default):
                resource 0x7f110000 io.appium.test:menu/conversation_header_menu_audio: t=0x03 d=0x000000b6 (s=0x0008 r=0x00)
                  (string8) "res/menu/conversation_header_menu_audio.xml"
                resource 0x7f110001 io.appium.test:menu/conversation_header_menu_collection: t=0x03 d=0x000000b7 (s=0x0008 r=0x00)
                  (string8) "res/menu/conversation_header_menu_collection.xml"
                resource 0x7f110002 io.appium.test:menu/conversation_header_menu_collection_searching: t=0x03 d=0x000000b8 (s=0x0008 r=0x00)
                  (string8) "res/menu/conversation_header_menu_collection_searching.xml"
                resource 0x7f110003 io.appium.test:menu/conversation_header_menu_video: t=0x03 d=0x000000b9 (s=0x0008 r=0x00)
                  (string8) "res/menu/conversation_header_menu_video.xml"
                resource 0x7f110004 io.appium.test:menu/conversation_multiuse: t=0x03 d=0x000000ba (s=0x0008 r=0x00)
                  (string8) "res/menu/conversation_multiuse.xml"
                resource 0x7f110005 io.appium.test:menu/toolbar_close_white: t=0x03 d=0x000000bb (s=0x0008 r=0x00)
                  (string8) "res/menu/toolbar_close_white.xml"
                resource 0x7f110006 io.appium.test:menu/toolbar_collection: t=0x03 d=0x000000bc (s=0x0008 r=0x00)
                  (string8) "res/menu/toolbar_collection.xml"
                resource 0x7f110007 io.appium.test:menu/toolbar_sketch: t=0x03 d=0x0000007f (s=0x0008 r=0x00)
                  (string8) "res/menu/toolbar_sketch.xml"
        `});
      mocks.fs.expects('writeFile').once();
      const {apkStrings, localPath} = await adb.extractStringsFromApk('/fake/path.apk', 'de-DE', '/tmp');
      apkStrings.abc_action_bar_home_description.should.eql('Navigate "home"');
      apkStrings.calling__conversation_full__message.should.eql([
        'Calls work in conversations with up to 1 person.',
        'Calls work in conversations with up to %1$d people. "blabla"',
      ]);
      localPath.should.eql(path.resolve('/tmp', 'strings.json'));
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
    it('should call shell with correct arguments when not replacing', async function () {
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
  describe('getApkInfo', function () {
    const APK_INFO = `package: name='io.appium.settings' versionCode='2' versionName='1.1' platformBuildVersionName='6.0-2166767'
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
    densities: '120' '160' '240' '320'`;

    it('should properly parse apk info', async function () {
      mocks.fs.expects('exists').once().returns(true);
      mocks.adb.expects('initAapt').once().returns(true);
      mocks.teen_process.expects('exec').once().returns({stdout: APK_INFO});
      const result = await adb.getApkInfo('/some/folder/path.apk');
      for (let [name, value] of [
        ['name', 'io.appium.settings'],
        ['versionCode', 2],
        ['versionName', '1.1']]) {
        result.should.have.property(name, value);
      }
    });
    it('should extract base apk first in order to retrieve apks info', async function () {
      mocks.adb.expects('extractBaseApk').once().returns('/some/otherfolder/path.apk');
      mocks.fs.expects('exists').once().returns(true);
      mocks.adb.expects('initAapt').once().returns(true);
      mocks.teen_process.expects('exec').once().returns({stdout: APK_INFO});
      const result = await adb.getApkInfo('/some/folder/path.apks');
      for (let [name, value] of [
        ['name', 'io.appium.settings'],
        ['versionCode', 2],
        ['versionName', '1.1']]) {
        result.should.have.property(name, value);
      }
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
