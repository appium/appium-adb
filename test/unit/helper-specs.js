import {
  getAndroidPlatformAndPath,
  buildStartCmd, isShowingLockscreen, getBuildToolsDirs,
  parseManifest, parseAaptStrings, parseAapt2Strings,
} from '../../lib/helpers';
import { withMocks } from 'appium-test-support';
import { fs } from 'appium-support';
import path from 'path';
import _ from 'lodash';


describe('helpers', withMocks({fs}, function (mocks) {
  afterEach(function () {
    mocks.verify();
  });

  describe('getAndroidPlatformAndPath', function () {
    let oldAndroidHome;
    before(function () {
      oldAndroidHome = process.env.ANDROID_HOME;
    });
    after(function () {
      process.env.ANDROID_HOME = oldAndroidHome;
    });

    it('should get the latest available API', async function () {
      process.env.ANDROID_HOME = '/path/to/android/home';

      mocks.fs.expects('glob').returns([
        path.resolve(process.env.ANDROID_HOME, 'platforms', 'android-17', 'build.prop'),
        path.resolve(process.env.ANDROID_HOME, 'platforms', 'android-25', 'build.prop'),
        path.resolve(process.env.ANDROID_HOME, 'platforms', 'android-22', 'build.prop'),
      ]);
      mocks.fs.expects('readFile')
        .exactly(3)
        .onCall(0).returns(`
          ro.build.version.incremental=1425461
          ro.build.version.sdk=17
          ro.build.version.codename=REL
          ro.build.version.release=4.2.2`)
        .onCall(1).returns(`
          ro.build.version.incremental=1425461
          ro.build.version.sdk=25
          ro.build.version.codename=REL
          ro.build.version.release=7.0`)
        .onCall(2).returns(`
          ro.build.version.incremental=1425461
          ro.build.version.sdk=22
          ro.build.version.codename=REL
          ro.build.version.release=5.1`);
      let platformAndPath = await getAndroidPlatformAndPath();
      platformAndPath.platform.should.equal('android-25');
      platformAndPath.platformPath.should
        .equal(path.resolve(process.env.ANDROID_HOME, 'platforms', 'android-25'));
    });
  });

  describe('isShowingLockscreen', function () {
    it('should return true if mShowingLockscreen is true', async function () {
      let dumpsys = 'mShowingLockscreen=true mShowingDream=false mDreamingLockscreen=false mTopIsFullscreen=false';
      (await isShowingLockscreen(dumpsys)).should.be.true;
    });
    it('should return true if mDreamingLockscreen is true', async function () {
      let dumpsys = 'mShowingLockscreen=false mShowingDream=false mDreamingLockscreen=true mTopIsFullscreen=false';
      (await isShowingLockscreen(dumpsys)).should.be.true;
    });
    it('should return false if mShowingLockscreen and mDreamingLockscreen are false', async function () {
      let dumpsys = 'mShowingLockscreen=false mShowingDream=false mDreamingLockscreen=false mTopIsFullscreen=false';
      (await isShowingLockscreen(dumpsys)).should.be.false;
    });
    it('should assume that screen is unlocked if can not determine lock state', async function () {
      let dumpsys = 'mShowingDream=false mTopIsFullscreen=false';
      (await isShowingLockscreen(dumpsys)).should.be.false;
    });
  });

  describe('buildStartCmd', function () {
    let startOptions = {
      pkg: 'com.something',
      activity: '.SomeActivity'
    };

    it('should parse optionalIntentArguments with single key', function () {
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: '-d key'}, startOptions), 20);
      cmd[cmd.length - 2].should.eql('-d');
      cmd[cmd.length - 1].should.eql('key');
    });
    it('should parse optionalIntentArguments with single key/value pair', function () {
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: '-d key value'}, startOptions), 20);
      cmd[cmd.length - 3].should.eql('-d');
      cmd[cmd.length - 2].should.eql('key');
      cmd[cmd.length - 1].should.eql('value');
    });
    it('should parse optionalIntentArguments with single key/value pair with spaces', function () {
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: '-d key value value2'}, startOptions), 20);
      cmd[cmd.length - 3].should.eql('-d');
      cmd[cmd.length - 2].should.eql('key');
      cmd[cmd.length - 1].should.eql('value value2');
    });
    it('should parse optionalIntentArguments with multiple keys', function () {
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: '-d key1 -e key2'}, startOptions), 20);
      cmd[cmd.length - 4].should.eql('-d');
      cmd[cmd.length - 3].should.eql('key1');
      cmd[cmd.length - 2].should.eql('-e');
      cmd[cmd.length - 1].should.eql('key2');
    });
    it('should parse optionalIntentArguments with multiple key/value pairs', function () {
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: '-d key1 value1 -e key2 value2'}, startOptions), 20);
      cmd[cmd.length - 6].should.eql('-d');
      cmd[cmd.length - 5].should.eql('key1');
      cmd[cmd.length - 4].should.eql('value1');
      cmd[cmd.length - 3].should.eql('-e');
      cmd[cmd.length - 2].should.eql('key2');
      cmd[cmd.length - 1].should.eql('value2');
    });
    it('should parse optionalIntentArguments with hyphens', function () {
      let arg = 'http://some-url-with-hyphens.com/';
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: `-d ${arg}`}, startOptions), 20);
      cmd[cmd.length - 2].should.eql('-d');
      cmd[cmd.length - 1].should.eql(arg);
    });
    it('should parse optionalIntentArguments with multiple arguments with hyphens', function () {
      let arg1 = 'http://some-url-with-hyphens.com/';
      let arg2 = 'http://some-other-url-with-hyphens.com/';
      let cmd = buildStartCmd(_.defaults({
        optionalIntentArguments: `-d ${arg1} -e key ${arg2}`
      }, startOptions), 20);
      cmd[cmd.length - 5].should.eql('-d');
      cmd[cmd.length - 4].should.eql(arg1);
      cmd[cmd.length - 3].should.eql('-e');
      cmd[cmd.length - 2].should.eql('key');
      cmd[cmd.length - 1].should.eql(arg2);
    });
    it('should have -S option when stopApp is set', function () {
      let cmd = buildStartCmd(_.defaults({stopApp: true}, startOptions), 20);
      cmd[cmd.length - 1].should.eql('-S');
    });
    it('should not have -S option when stopApp is not set', function () {
      let cmd = buildStartCmd(_.defaults({stopApp: false}, startOptions), 20);
      cmd[cmd.length - 1].should.not.eql('-S');
    });
  });

  describe('getBuildToolsDirs', function () {
    it('should sort build-tools folder names by semantic version', async function () {
      mocks.fs.expects('glob').once().returns([
        '/some/path/1.2.3',
        '/some/path/4.5.6',
        '/some/path/2.3.1',
      ]);
      (await getBuildToolsDirs('/dummy/path')).should.be.eql([
        '/some/path/4.5.6',
        '/some/path/2.3.1',
        '/some/path/1.2.3',
      ]);
    });
  });

  describe('parseManifest', function () {
    const manifest = {
      versionCode: 1,
      versionName: '1.0',
      package: 'com.example.hello.helloapp.app',
      usesPermissions: [],
      permissions: [],
      permissionTrees: [],
      permissionGroups: [],
      instrumentation: null,
      usesSdk: { minSdkVersion: 7, targetSdkVersion: 19 },
      usesConfiguration: null,
      usesFeatures: [],
      supportsScreens: null,
      compatibleScreens: [],
      supportsGlTextures: [],
      application: {
        theme: 'resourceId:0x7f0b0000',
        label: 'resourceId:0x7f0a000e',
        icon: 'resourceId:0x7f020057',
        debuggable: true,
        allowBackup: true,
        activities: [{
          label: 'resourceId:0x7f0a000e',
          name: 'com.example.hello.helloapp.app.MainActivity',
          intentFilters: [{
            actions: [{
              name: 'android.intent.action.MAIN'
            }],
            categories: [{
              name: 'android.intent.category.LAUNCHER'
            }],
            data: []
          }],
          metaData: []
        }],
        activityAliases: [],
        launcherActivities: [{
          label: 'resourceId:0x7f0a000e',
          name: 'com.example.hello.helloapp.app.MainActivity',
          intentFilters: [{
            actions: [{
              name: 'android.intent.action.MAIN'
            }],
            categories: [{
              name: 'android.intent.category.LAUNCHER'
            }],
            data: []
          }],
          metaData: []
        }],
        services: [],
        receivers: [],
        providers: [],
        usesLibraries: []
      }
    };

    it('should parse manifest', function () {
      const {pkg, activity, versionCode, versionName} = parseManifest(manifest);
      pkg.should.eql('com.example.hello.helloapp.app');
      activity.should.eql('com.example.hello.helloapp.app.MainActivity');
      versionCode.should.eql(1);
      versionName.should.eql('1.0');
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
      aaptStrings.linear_layout_8_horizontal.should.eql('Horizontal');
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
      aaptStrings.abc_action_bar_home_description.should.eql('Navigate "home"');
      aaptStrings.calling__conversation_full__message.should.eql([
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
      aapt2Strings.linear_layout_8_horizontal.should.eql('Horizontal');
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
      aapt2Strings.connect_inbox__link__name.should.eql([
        'Eine Kontaktanfrage',
        '%1$s Kontaktanfragen\\n\\n"blabla"',
      ]);
    });
  });
}));
