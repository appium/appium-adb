import {ADB} from '../../lib/adb';
import net from 'node:net';
import {Logcat} from '../../lib/logcat.js';
import * as teen_process from 'teen_process';
import sinon from 'sinon';
import {
  parseLaunchableActivityNames,
  matchComponentName,
  buildStartCmd,
  extractMatchingPermissions,
} from '../../lib/tools/app-commands';
import {getBuildToolsDirs} from '../../lib/tools/system-calls';
import {parseAapt2Strings, parseAaptStrings} from '../../lib/tools/apk-utils';
import {fs} from '@appium/support';
import _ from 'lodash';
import {APIDEMOS_PKG, APIDEMOS_ACTIVITY_SHORT} from '../constants';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

const apiDemosPackage = APIDEMOS_PKG;

const adb = new ADB({adbExecTimeout: 60000});
const logcat = new Logcat({
  adb: adb.executable,
  debug: false,
  debugTrace: false,
});

describe('app commands', function () {
  let sandbox: sinon.SinonSandbox;
  let mocks: {
    adb: any;
    logcat: any;
    teen_process: any;
    net: any;
    fs: any;
  };

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    mocks = {
      adb: sandbox.mock(adb),
      logcat: sandbox.mock(logcat),
      teen_process: sandbox.mock(teen_process),
      net: sandbox.mock(net),
      fs: sandbox.mock(fs),
    };
  });

  afterEach(function () {
    sandbox.verify();
    sandbox.restore();
  });

  describe('isAppRunning', function () {
    it('should call listAppProcessIds and return true when app is running', async function () {
      mocks.adb
        .expects('listAppProcessIds')
        .once()
        .withExactArgs(apiDemosPackage)
        .returns([123, 456]);
      expect(await adb.isAppRunning(apiDemosPackage)).to.be.true;
    });
    it('should call listAppProcessIds and return false when app is not running', async function () {
      mocks.adb.expects('listAppProcessIds').once().withExactArgs(apiDemosPackage).returns([]);
      expect(await adb.isAppRunning(apiDemosPackage)).to.be.false;
    });
  });

  describe('listAppProcessIds', function () {
    it('should call shell with correct args and parse process IDs', async function () {
      const mockOutput = `ProcessRecord{abc123 123:io.appium.android.apis/u0a123}
ProcessRecord{def456 456:io.appium.android.apis/u0a123}`;
      mocks.adb
        .expects('shell')
        .once()
        .withExactArgs(['dumpsys', 'activity', 'processes'])
        .returns(mockOutput);
      expect(await adb.listAppProcessIds(apiDemosPackage)).to.eql([123, 456]);
    });
    it('should return empty array when no processes found', async function () {
      mocks.adb
        .expects('shell')
        .once()
        .withExactArgs(['dumpsys', 'activity', 'processes'])
        .returns('No processes found');
      expect(await adb.listAppProcessIds(apiDemosPackage)).to.eql([]);
    });
  });

  describe('killPackage', function () {
    it('should call shell with correct args', async function () {
      mocks.adb.expects('shell').once().withExactArgs(['am', 'kill', apiDemosPackage]).returns('');
      await adb.killPackage(apiDemosPackage);
    });
  });

  describe('forceStop', function () {
    it('should call shell with correct args', async function () {
      mocks.adb
        .expects('shell')
        .once()
        .withExactArgs(['am', 'force-stop', apiDemosPackage])
        .returns('');
      await adb.forceStop(apiDemosPackage);
    });
  });

  describe('clear', function () {
    it('should call shell with correct args', async function () {
      mocks.adb.expects('shell').once().withExactArgs(['pm', 'clear', apiDemosPackage]).returns('');
      await adb.clear(apiDemosPackage);
    });
  });

  describe('stopAndClear', function () {
    it('should call forceStop and clear', async function () {
      mocks.adb.expects('forceStop').once().withExactArgs(apiDemosPackage).returns('');
      mocks.adb.expects('clear').once().withExactArgs(apiDemosPackage).returns('');
      await adb.stopAndClear(apiDemosPackage);
    });
  });

  describe('listInstalledPackages', function () {
    it('should parse package names and version codes from shell output', async function () {
      mocks.adb.expects('getApiLevel').once().returns(28);
      const mockOutput = `package:com.android.managedprovisioning versionCode:35
package:com.google.android.apps.wallpaper.nexus versionCode:170000000
package:com.android.chrome versionCode:636771932`;
      mocks.adb
        .expects('shell')
        .once()
        .withExactArgs(['cmd', 'package', 'list', 'packages', '--show-versioncode'])
        .returns(mockOutput);
      const result = await adb.listInstalledPackages();
      expect(result).to.eql([
        {appPackage: 'com.android.managedprovisioning', versionCode: '35'},
        {appPackage: 'com.google.android.apps.wallpaper.nexus', versionCode: '170000000'},
        {appPackage: 'com.android.chrome', versionCode: '636771932'},
      ]);
    });
    it('should parse package names without version code', async function () {
      mocks.adb.expects('getApiLevel').once().returns(27);
      const mockOutput = `package:com.android.managedprovisioning
package:com.google.android.apps.wallpaper.nexus
package:com.android.chrome`;
      mocks.adb
        .expects('shell')
        .once()
        .withExactArgs(['cmd', 'package', 'list', 'packages'])
        .returns(mockOutput);
      const result = await adb.listInstalledPackages();
      expect(result).to.eql([
        {appPackage: 'com.android.managedprovisioning', versionCode: null},
        {appPackage: 'com.google.android.apps.wallpaper.nexus', versionCode: null},
        {appPackage: 'com.android.chrome', versionCode: null},
      ]);
    });
    it('should handle user option with api level 26', async function () {
      mocks.adb.expects('getApiLevel').once().returns(26);
      const mockOutput = `package:com.android.chrome`;
      mocks.adb
        .expects('shell')
        .once()
        .withExactArgs(['cmd', 'package', 'list', 'packages', '--user', '10'])
        .returns(mockOutput);
      const result = await adb.listInstalledPackages({user: '10'});
      expect(result).to.eql([{appPackage: 'com.android.chrome', versionCode: null}]);
    });
    it('should handle user option with api level 28', async function () {
      mocks.adb.expects('getApiLevel').once().returns(28);
      const mockOutput = `package:com.android.chrome versionCode:636771932`;
      mocks.adb
        .expects('shell')
        .once()
        .withExactArgs(['cmd', 'package', 'list', 'packages', '--show-versioncode', '--user', '10'])
        .returns(mockOutput);
      const result = await adb.listInstalledPackages({user: '10'});
      expect(result).to.eql([{appPackage: 'com.android.chrome', versionCode: '636771932'}]);
    });
  });

  describe('startUri', function () {
    it('should call shell with correct args', async function () {
      const uri = 'https://example.com';
      mocks.adb
        .expects('shell')
        .once()
        .withExactArgs(['am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', uri])
        .returns('');
      await adb.startUri(uri);
    });
    it('should call shell with package when provided', async function () {
      const uri = 'https://example.com';
      mocks.adb
        .expects('shell')
        .once()
        .withExactArgs([
          'am',
          'start',
          '-W',
          '-a',
          'android.intent.action.VIEW',
          '-d',
          uri,
          apiDemosPackage,
        ])
        .returns('');
      await adb.startUri(uri, apiDemosPackage);
    });
  });

  describe('dumpWindows', function () {
    it('should call shell with correct args', async function () {
      mocks.adb.expects('getApiLevel').once().returns(25);
      mocks.adb
        .expects('shell')
        .once()
        .withExactArgs(['dumpsys', 'window', 'windows'])
        .returns('Window information');
      const result = await adb.dumpWindows();
      expect(result).to.equal('Window information');
    });
  });

  describe('getFocusedPackageAndActivity', function () {
    it('should parse focused package and activity', async function () {
      // The regex expects format: ActivityRecord{... package/activity ...}
      // Format should be: ActivityRecord{... package/activity ...}
      // APIDEMOS_ACTIVITY_SHORT is '.ApiDemos', so we use package/.ApiDemos
      const mockOutput = `mFocusedApp=AppWindowToken{abc123 token=Token{def456 ActivityRecord{ghi789 u0 ${APIDEMOS_PKG}/${APIDEMOS_ACTIVITY_SHORT} t181}}}`;
      mocks.adb.expects('getApiLevel').once().returns(25);
      mocks.adb
        .expects('shell')
        .once()
        .withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(mockOutput);
      const result = await adb.getFocusedPackageAndActivity();
      expect(result.appPackage).to.equal(APIDEMOS_PKG);
      expect(result.appActivity).to.equal(APIDEMOS_ACTIVITY_SHORT);
    });
  });

  describe('waitForActivity', function () {
    it('should wait for activity to appear', async function () {
      mocks.adb
        .expects('getFocusedPackageAndActivity')
        .exactly(2)
        .onCall(0)
        .returns({appPackage: 'other.package', appActivity: '.Other'})
        .onCall(1)
        .returns({appPackage: apiDemosPackage, appActivity: APIDEMOS_ACTIVITY_SHORT});
      await adb.waitForActivity(apiDemosPackage, APIDEMOS_ACTIVITY_SHORT, 1000);
    });
  });

  describe('waitForNotActivity', function () {
    it('should wait for activity to disappear', async function () {
      mocks.adb
        .expects('getFocusedPackageAndActivity')
        .exactly(2)
        .onCall(0)
        .returns({appPackage: apiDemosPackage, appActivity: APIDEMOS_ACTIVITY_SHORT})
        .onCall(1)
        .returns({appPackage: 'other.package', appActivity: '.Other'});
      await adb.waitForNotActivity(apiDemosPackage, APIDEMOS_ACTIVITY_SHORT, 1000);
    });
  });

  describe('waitForActivityOrNot', function () {
    it('should wait for activity to appear when waitForStop is false', async function () {
      mocks.adb
        .expects('getFocusedPackageAndActivity')
        .exactly(2)
        .onCall(0)
        .returns({appPackage: 'other.package', appActivity: '.Other'})
        .onCall(1)
        .returns({appPackage: apiDemosPackage, appActivity: APIDEMOS_ACTIVITY_SHORT});
      await adb.waitForActivityOrNot(apiDemosPackage, APIDEMOS_ACTIVITY_SHORT, false, 1000);
    });
    it('should wait for activity to disappear when waitForStop is true', async function () {
      mocks.adb
        .expects('getFocusedPackageAndActivity')
        .exactly(2)
        .onCall(0)
        .returns({appPackage: apiDemosPackage, appActivity: APIDEMOS_ACTIVITY_SHORT})
        .onCall(1)
        .returns({appPackage: 'other.package', appActivity: '.Other'});
      await adb.waitForActivityOrNot(apiDemosPackage, APIDEMOS_ACTIVITY_SHORT, true, 1000);
    });
  });

  describe('buildStartCmd', function () {
    const startOptions = {
      pkg: 'com.something',
      activity: '.SomeActivity',
    };

    it('should use start', function () {
      const cmd = buildStartCmd(startOptions, 20);
      expect(cmd[1]).to.eql('start');
    });
    it('should use start-activity', function () {
      const cmd = buildStartCmd(startOptions, 26);
      expect(cmd[1]).to.eql('start-activity');
    });
    it('should not repeat package name', function () {
      const cmd = buildStartCmd(
        {
          pkg: 'com.package',
          activity: 'com.package/.activity',
        },
        20,
      );
      expect(cmd.includes('com.package/.activity')).to.be.true;
    });
    it('should include package name', function () {
      const cmd = buildStartCmd(startOptions, 20);
      expect(cmd.includes(`${startOptions.pkg}/${startOptions.activity}`)).to.be.true;
    });
    it('should parse optionalIntentArguments with single key', function () {
      const cmd = buildStartCmd(_.defaults({optionalIntentArguments: '-d key'}, startOptions), 20);
      expect(cmd[cmd.length - 2]).to.eql('-d');
      expect(cmd[cmd.length - 1]).to.eql('key');
    });
    it('should parse optionalIntentArguments with single key/value pair', function () {
      const cmd = buildStartCmd(
        _.defaults({optionalIntentArguments: '-d key value'}, startOptions),
        20,
      );
      expect(cmd[cmd.length - 3]).to.eql('-d');
      expect(cmd[cmd.length - 2]).to.eql('key');
      expect(cmd[cmd.length - 1]).to.eql('value');
    });
    it('should parse optionalIntentArguments with single key/value pair with spaces', function () {
      const cmd = buildStartCmd(
        _.defaults({optionalIntentArguments: '-d key value value2'}, startOptions),
        20,
      );
      expect(cmd[cmd.length - 3]).to.eql('-d');
      expect(cmd[cmd.length - 2]).to.eql('key');
      expect(cmd[cmd.length - 1]).to.eql('value value2');
    });
    it('should parse optionalIntentArguments with multiple keys', function () {
      const cmd = buildStartCmd(
        _.defaults({optionalIntentArguments: '-d key1 -e key2'}, startOptions),
        20,
      );
      expect(cmd[cmd.length - 4]).to.eql('-d');
      expect(cmd[cmd.length - 3]).to.eql('key1');
      expect(cmd[cmd.length - 2]).to.eql('-e');
      expect(cmd[cmd.length - 1]).to.eql('key2');
    });
    it('should parse optionalIntentArguments with multiple key/value pairs', function () {
      const cmd = buildStartCmd(
        _.defaults({optionalIntentArguments: '-d key1 value1 -e key2 value2'}, startOptions),
        20,
      );
      expect(cmd[cmd.length - 6]).to.eql('-d');
      expect(cmd[cmd.length - 5]).to.eql('key1');
      expect(cmd[cmd.length - 4]).to.eql('value1');
      expect(cmd[cmd.length - 3]).to.eql('-e');
      expect(cmd[cmd.length - 2]).to.eql('key2');
      expect(cmd[cmd.length - 1]).to.eql('value2');
    });
    it('should parse optionalIntentArguments with hyphens', function () {
      const arg = 'http://some-url-with-hyphens.com/';
      const cmd = buildStartCmd(
        _.defaults({optionalIntentArguments: `-d ${arg}`}, startOptions),
        20,
      );
      expect(cmd[cmd.length - 2]).to.eql('-d');
      expect(cmd[cmd.length - 1]).to.eql(arg);
    });
    it('should parse optionalIntentArguments with multiple arguments with hyphens', function () {
      const arg1 = 'http://some-url-with-hyphens.com/';
      const arg2 = 'http://some-other-url-with-hyphens.com/';
      const cmd = buildStartCmd(
        _.defaults(
          {
            optionalIntentArguments: `-d ${arg1} -e key ${arg2}`,
          },
          startOptions,
        ),
        20,
      );
      expect(cmd[cmd.length - 5]).to.eql('-d');
      expect(cmd[cmd.length - 4]).to.eql(arg1);
      expect(cmd[cmd.length - 3]).to.eql('-e');
      expect(cmd[cmd.length - 2]).to.eql('key');
      expect(cmd[cmd.length - 1]).to.eql(arg2);
    });
    it('should have -S option when stopApp is set', function () {
      const cmd = buildStartCmd(_.defaults({stopApp: true}, startOptions), 20);
      expect(cmd[cmd.length - 1]).to.eql('-S');
    });
    it('should not have -S option when stopApp is not set', function () {
      const cmd = buildStartCmd(_.defaults({stopApp: false}, startOptions), 20);
      expect(cmd[cmd.length - 1]).to.not.eql('-S');
    });
  });

  describe('getBuildToolsDirs', function () {
    it('should sort build-tools folder names by semantic version', async function () {
      mocks.fs
        .expects('glob')
        .once()
        .returns(['/some/path/1.2.3', '/some/path/4.5.6', '/some/path/2.3.1']);
      expect(await getBuildToolsDirs('/dummy/path')).to.be.eql([
        '/some/path/4.5.6',
        '/some/path/2.3.1',
        '/some/path/1.2.3',
      ]);
    });
  });

  describe('parseAaptStrings', function () {
    it('should parse strings received from aapt output', function () {
      const aaptOutput = `
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
      `;
      const aaptStrings = parseAaptStrings(aaptOutput, '(default)');
      expect(aaptStrings.linear_layout_8_horizontal).to.eql('Horizontal');
    });
    it('should parse plurals received from aapt output', function () {
      const aaptOutput = `
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
      `;
      const aaptStrings = parseAaptStrings(aaptOutput, 'de-rDE');
      expect(aaptStrings.abc_action_bar_home_description).to.eql('Navigate "home"');
      expect(aaptStrings.calling__conversation_full__message).to.eql([
        'Calls work in conversations with up to 1 person.',
        'Calls work in conversations with up to %1$d people. "blabla"',
      ]);
    });
  });

  describe('parseAapt2Strings', function () {
    it('should parse strings received from aapt2 output', function () {
      const aapt2Output = `
      Binary APK
      Package name=io.appium.android.apis id=7f
        type string id=0c entryCount=944
          resource 0x7f0c0215 string/linear_layout_8_vertical
            () "Vertical"
            (fr) "Vertical"
          resource 0x7f0c0216 string/linear_layout_8_horizontal
            () "Horizontal"
            (fr) "Horizontal"
          resource 0x7f0c0217 string/linear_layout_8_top
            () "Top"
            (fr) "Top"
      `;
      const aapt2Strings = parseAapt2Strings(aapt2Output, '');
      expect(aapt2Strings.linear_layout_8_horizontal).to.eql('Horizontal');
    });
    it('should parse plurals received from aapt2 output', function () {
      const aapt2Output = `
      Binary APK
      Package name=io.appium.android.apis id=7f
        type plurals id=0d entryCount=27
          resource 0x7f0d0002 plurals/connect_inbox__link__name
            () (plurals) size=2
              one="1 person waiting"
              other="%1$s people waiting"
            (da) (plurals) size=2
              one="1 person venter"
              other="%1$s personer venter"
            (fa) (plurals) size=2
              one="1 نفر در انتظار است"
              other="%1$s در انتظار هستند"
            (ja) (plurals) size=1
              other="%1$s 人が待機中"
            (de) (plurals) size=2
              one="Eine Kontaktanfrage"
              other="%1$s Kontaktanfragen

              "blabla""
            (fi) (plurals) size=2
              one="1 ihminen odottaa"
              other="%1$s ihmistä odottaa"
            (sk) (plurals) size=4
              one="1 osoba čaká"
              few="%1$s ľudí čaká"
              many="%1$s ľudí čaká"
              other="%1$s ľudí čaká"
            (uk) (plurals) size=4
              one="1 людина очікує"
              few="%1$s людей очікує"
              many="%1$s людей очікує"
              other="%1$s людей очікує"
            (el) (plurals) size=2
              one="1 άτομο σε αναμονή"
              other="%1$s άτομα σε αναμονή"
            (nl) (plurals) size=2
              one="1 persoon wacht"
              other="%1$s mensen die wachten"
            (pl) (plurals) size=4
              one="1 osoba czeka"
              few="%1$s ludzi oczekujących"
              many="%1$s ludzi oczekujących"
              other="%1$s ludzi oczekujących"
      `;
      const aapt2Strings = parseAapt2Strings(aapt2Output, 'de');
      expect(aapt2Strings.connect_inbox__link__name).to.eql([
        'Eine Kontaktanfrage',
        '%1$s Kontaktanfragen\\n\\n"blabla"',
      ]);
    });
  });

  describe('parsePermissions', function () {
    const dumpsysOutput = `
    supportsScreens=[small, medium, large, xlarge, resizeable, anyDensity]
    timeStamp=2020-03-16 20:11:46
    firstInstallTime=2020-03-16 20:11:46
    lastUpdateTime=2020-03-16 20:11:46
    signatures=PackageSignatures{2cb80c0 [a2b14acf]}
    installPermissionsFixed=true installStatus=1
    pkgFlags=[ SYSTEM DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP ]
    requested permissions:
      android.xx.INTERNET
      com.google.android.c2dm.permission.RECEIVE
      android.permission.ACCESS_WIFI_STATE
      android.xxx.permission.CAR_VENDOR_EXTENSION
      android.123.permission.CAR_CABIN
      android.car.permission.CAR_CHARGE
      android.permission.WAKE_LOCK
      android.permission.WRITE_EXTERNAL_STORAGE
      android.permission.READ_EXTERNAL_STORAGE
    install permissions:
      android.car.permission.CAR_VENDOR_EXTENSION: granted=true
      android.123.permission.CAR_CONTROL_AUDIO_VOLUME: granted=true
      android.xxx.BLUETOOTH: granted=true
      com.google.android.c2dm.permission.RECEIVE: granted=true
      android.permission.BLUETOOTH_ADMIN: granted=true
      android.car.123.CAR_CONTROL_AUDIO_SETTINGS: granted=true
    User 0: ceDataInode=32838 installed=true hidden=false suspended=false stopped=false notLaunched=false enabled=0 instant=false virtual=false
      gids=[3002, 3003, 3001]
      runtime permissions:
        android.car.permission.CAR_MILEAGE: granted=true, flags=[ GRANTED_BY_DEFAULT ]
        `;
    it('test install permission', function () {
      const per = extractMatchingPermissions(dumpsysOutput, ['install'], true);
      expect(per.length).to.eql(4);
    });
    it('test install permission with granted false', function () {
      const per = extractMatchingPermissions(dumpsysOutput, ['install'], false);
      expect(per.length).to.eql(0);
    });
    it('test requested permission', function () {
      const per = extractMatchingPermissions(dumpsysOutput, ['requested'], true);
      expect(per.length).to.eql(0);
    });
    it('test runtime permission', function () {
      const per = extractMatchingPermissions(dumpsysOutput, ['runtime'], true);
      expect(per.length).to.eql(1);
    });
  });

  describe('parseLaunchableActivityNames', function () {
    it('test valid output parsing', function () {
      const dumpsysOutput = `
      Activity Resolver Table:
        Schemes:
            com.sunpower.elc2:
              e0a7ea1 com.sunpower.energylink.commissioning2/.MainActivity filter a38e087
                Action: "android.intent.action.VIEW"
                Category: "android.intent.category.DEFAULT"
                Category: "android.intent.category.BROWSABLE"
                Scheme: "com.sunpower.elc2"
            :
              e0a7ea1 com.sunpower.energylink.commissioning2/.MainActivity filter e0aebb4
                Action: "android.intent.action.VIEW"
                Category: "android.intent.category.DEFAULT"
                Category: "android.intent.category.BROWSABLE"
                Scheme: " "
                Authority: " ": -1
                Path: "PatternMatcher{PREFIX: /}"

        Non-Data Actions:
            android.intent.action.MAIN:
              e0a7ea1 com.sunpower.energylink.commissioning2/.MainActivity2 filter e9328c6
                Action: "android.intent.action.MAIN"
                Category: "android.intent.category.BROWSABLE"
            android.intent.action.MAIN:
              e0a7ea1 com.sunpower.energylink.commissioning2/.MainActivity filter e9328c6
                Action: "android.intent.action.MAIN"
                Category: "android.intent.category.LAUNCHER"

      Domain verification status:
      `;
      const names = parseLaunchableActivityNames(dumpsysOutput);
      expect(names).to.eql(['com.sunpower.energylink.commissioning2/.MainActivity']);
    });
    it('test valid output parsing (older Android versions)', function () {
      const dumpsysOutput = `
      Activity Resolver Table:
        Non-Data Actions:
             android.intent.action.MAIN:
               376f0635 com.example.android.contactmanager/.ContactManager2
               376f0636 com.example.android.contactmanager/.ContactManager3
               376f0637 com.example.android.contactmanager/.ContactManager

      Key Set Manager:
        [com.example.android.contactmanager]
             Signing KeySets: 2
      `;
      const names = parseLaunchableActivityNames(dumpsysOutput);
      expect(names).to.eql([
        'com.example.android.contactmanager/.ContactManager2',
        'com.example.android.contactmanager/.ContactManager3',
        'com.example.android.contactmanager/.ContactManager',
      ]);
    });
    it('test error output parsing', function () {
      const dumpsysOutput = `
      Domain verification status:
      Failure printing domain verification information
      `;
      const names = parseLaunchableActivityNames(dumpsysOutput);
      expect(names).to.be.eql([]);
    });
  });
  describe('matchComponentName', function () {
    it('test valid activity name', function () {
      const activity = 'ןذأצЮυπиС.נפשוקשΤπΟ.ЦοКسئοهΦΦ';
      const names = matchComponentName(activity);
      expect(names).to.eql([activity]);
    });
    it('test invalid activity name', function () {
      const activity = 'User@123';
      expect(_.isNull(matchComponentName(activity))).to.be.true;
    });
  });
});
