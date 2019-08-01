import { getAndroidPlatformAndPath,
         buildStartCmd, isShowingLockscreen, getBuildToolsDirs, parseManifest } from '../../lib/helpers';
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
    const manifestXml = `<?xml version="1.0" encoding="utf-8"?>
<manifest
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:versionCode="697"
    android:versionName="3.27.697"
    package="com.example"
    platformBuildVersionCode="697"
    platformBuildVersionName="3.27.697">

    <uses-sdk
        android:minSdkVersion="17"
        android:targetSdkVersion="27" />

    <uses-permission
        android:name="android.permission.ACCESS_NETWORK_STATE" />

    <uses-permission
        android:name="android.permission.WRITE_EXTERNAL_STORAGE" />

    <uses-permission
        android:name="android.permission.INTERNET" />

    <uses-permission
        android:name="android.permission.READ_CONTACTS" />

    <uses-permission
        android:name="android.permission.RECORD_AUDIO" />

    <uses-permission
        android:name="android.permission.VIBRATE" />

    <uses-permission
        android:name="android.permission.CAMERA" />

    <uses-permission
        android:name="android.permission.FLASHLIGHT" />

    <uses-permission
        android:name="android.permission.READ_PHONE_STATE" />

    <uses-permission
        android:name="android.permission.MODIFY_AUDIO_SETTINGS" />

    <uses-permission
        android:name="android.permission.BLUETOOTH" />

    <uses-permission
        android:name="android.permission.WAKE_LOCK" />

    <uses-permission
        android:name="com.google.android.c2dm.permission.RECEIVE" />

    <uses-permission
        android:name="android.permission.ACCESS_FINE_LOCATION" />

    <uses-permission
        android:name="android.permission.RECEIVE_BOOT_COMPLETED" />

    <uses-feature
        android:name="android.hardware.camera"
        android:required="false" />

    <uses-feature
        android:name="android.hardware.camera.front"
        android:required="false" />

    <uses-feature
        android:name="android.hardware.camera.autofocus"
        android:required="false" />

    <uses-permission
        android:name="android.permission.READ_EXTERNAL_STORAGE" />

    <uses-feature
        android:glEsVersion="0x20000"
        android:required="true" />

    <application
        android:theme="@ref/0x7f100148"
        android:label="Example"
        android:icon="@ref/0x7f0800cd"
        android:name="com.example.Application"
        android:allowBackup="false"
        android:vmSafeMode="false"
        android:hardwareAccelerated="true"
        android:supportsRtl="true">

        <activity
            android:theme="@ref/0x7f100148"
            android:name="com.example.Application.MainActivity"
            android:launchMode="2"
            android:configChanges="0x4a0"
            android:windowSoftInputMode="0x12"
            android:hardwareAccelerated="true">

            <intent-filter>

                <data
                    android:scheme="example"
                    android:host="password-reset-successful" />

                <action
                    android:name="android.intent.action.VIEW" />

                <category
                    android:name="android.intent.category.DEFAULT" />

                <category
                    android:name="android.intent.category.BROWSABLE" />

                <category
                    android:name="android.intent.category.VIEW" />
            </intent-filter>
        </activity>

        <activity
            android:theme="@ref/0x7f100148"
            android:label="@ref/0x7f0f004c"
            android:name="com.example.LaunchActivity"
            android:launchMode="2"
            android:noHistory="true">

            <intent-filter>

                <action
                    android:name="android.intent.action.MAIN" />

                <category
                    android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <activity
            android:theme="@ref/0x7f10013d"
            android:name="com.example.CallingActivity"
            android:launchMode="2"
            android:screenOrientation="1"
            android:windowSoftInputMode="0x2"
            android:hardwareAccelerated="true"
            android:showOnLockScreen="true" />

        <activity
            android:theme="@ref/0x7f100141"
            android:label="@ref/0x7f0f01bc"
            android:name="com.example.PreferencesActivity"
            android:launchMode="2"
            android:hardwareAccelerated="true" />

        <activity
            android:theme="@ref/0x7f10014c"
            android:name="com.example.PopupActivity"
            android:taskAffinity="@string/0x25"
            android:excludeFromRecents="true"
            android:launchMode="1"
            android:screenOrientation="-1"
            android:windowSoftInputMode="0x4"
            android:hardwareAccelerated="true" />
    </application>
</manifest>`;

    it('should parse manifest', function () {
      const {pkg, activity, versionCode, versionName} = parseManifest(manifestXml);
      pkg.should.eql('com.example');
      activity.should.eql('com.example.LaunchActivity');
      versionCode.should.eql(697);
      versionName.should.eql('3.27.697');
    });
  });
}));
