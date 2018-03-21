import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import * as teen_process from 'teen_process';
import * as helpers from '../../lib/helpers.js';
import { withMocks } from 'appium-test-support';


chai.use(chaiAsPromised);

describe('android-manifest', function () {
  let adb = new ADB();
  describe('processFromManifest', withMocks({adb, teen_process}, (mocks) => {
    it('should correctly parse process from manifest', async function () {
      adb.binaries.aapt = 'dummy_aapt';
      const localApk = 'dummyAPK',
            dummyProcess = 'dummyProcess';
      mocks.adb.expects("initAapt")
        .once().withExactArgs()
              .returns('');
      mocks.teen_process.expects("exec")
        .once().withExactArgs('dummy_aapt', ['dump', 'xmltree', localApk,
                              'AndroidManifest.xml'])
        .returns({stdout: ` E: application (line=234)
                          A: android:process(0x01010011)="${dummyProcess}"`});
      (await adb.processFromManifest(localApk)).should.equal(dummyProcess);
      mocks.adb.verify();
    });
  }));
  describe('packageAndLaunchActivityFromManifest', withMocks({adb, helpers, teen_process}, (mocks) => {
    it('should correctly parse package and activity from manifest with apkanalyzer tool', async function () {
      const apkanalyzerDummyPath = 'apkanalyzer';
      mocks.helpers.expects("getApkanalyzerForOs").returns(apkanalyzerDummyPath);
      const localApk = 'dummyAPK';
      const dummyPackageName = 'io.appium.android';
      const dummyActivityName = 'io.appium.mainactivity.MainTabActivity';
      mocks.teen_process.expects("exec")
        .once().withArgs(apkanalyzerDummyPath)
        .returns({stdout: `
        <?xml version="1.0" encoding="utf-8"?>
        <manifest
          xmlns:amazon="http://schemas.amazon.com/apk/res/android"
          xmlns:android="http://schemas.android.com/apk/res/android"
          android:versionCode="1234"
          android:versionName="3.0.0"
          android:installLocation="0"
          package="${dummyPackageName}">

          <application
              android:theme="@ref/0x7f0f00ef"
              android:label="@ref/0x7f0e00b4"
              android:icon="@ref/0x7f0b0001"
              android:name="io.appium.app.testappAppShell"
              android:debuggable="false"
              android:allowTaskReparenting="true"
              android:allowBackup="false"
              android:hardwareAccelerated="true"
              android:supportsRtl="true">

              <activity
                  android:name="io.appium.mainactivity.MainTabActivity"
                  android:exported="true"
                  android:clearTaskOnLaunch="false"
                  android:launchMode="1"
                  android:screenOrientation="1"
                  android:configChanges="0x4a0"
                  android:alwaysRetainTaskState="true"
                  android:windowSoftInputMode="0x30" />

              <activity-alias
                  android:name="${dummyActivityName}"
                  android:exported="true"
                  android:clearTaskOnLaunch="false"
                  android:launchMode="1"
                  android:screenOrientation="1"
                  android:configChanges="0x4a0"
                  android:targetActivity="io.appium.mainactivity.MainTabActivity"
                  android:alwaysRetainTaskState="true"
                  android:windowSoftInputMode="0x30">

                  <intent-filter>

                      <action
                          android:name="android.intent.action.MAIN" />

                      <category
                          android:name="android.intent.category.LAUNCHER" />
                  </intent-filter>

                  <intent-filter>

                      <action
                          android:name="android.intent.action.VIEW" />

                      <category
                          android:name="android.intent.category.DEFAULT" />

                      <category
                          android:name="android.intent.category.BROWSABLE" />

                      <data
                          android:scheme="testapp"
                          android:host="headline_event" />

                      <data
                          android:scheme="testapp"
                          android:host="story-camera" />

                      <data
                          android:scheme="testapp"
                          android:host="direct-inbox" />

                      <data
                          android:scheme="testapp"
                          android:host="share" />
                  </intent-filter>
              </activity-alias>

              <activity
                  android:name="io.appium.mainactivity.MainActivity"
                  android:exported="true"
                  android:clearTaskOnLaunch="false"
                  android:launchMode="1"
                  android:screenOrientation="1"
                  android:configChanges="0x4a0"
                  android:alwaysRetainTaskState="true"
                  android:windowSoftInputMode="0x30" />

              <activity
                  android:name="io.appium.nux.activity.SignedOutFragmentActivity"
                  android:screenOrientation="1"
                  android:configChanges="0x4a0"
                  android:windowSoftInputMode="0x2" />

              <activity
                  android:name="io.appium.nux.impl.OnboardingActivity"
                  android:exported="false"
                  android:screenOrientation="1"
                  android:configChanges="0x4a0"
                  android:windowSoftInputMode="0x2" />

              <activity
                  android:theme="@ref/0x7f0f009e"
                  android:name="io.appium.creation.activity.MediaCaptureActivity"
                  android:screenOrientation="1" />

              <activity
                  android:theme="@ref/0x7f0f009e"
                  android:name="io.appium.video.videocall.activity.VideoCallActivity"
                  android:exported="false"
                  android:launchMode="1"
                  android:screenOrientation="1"
                  android:configChanges="0x4a0"
                  android:windowSoftInputMode="0x2" />

              <activity
                  android:name="io.appium.bugreporter.BugReporterActivity"
                  android:launchMode="2"
                  android:screenOrientation="1" />

              <activity
                  android:name="io.appium.osversionblock.OsVersionBlockingActivity"
                  android:exported="false"
                  android:screenOrientation="1" />

              <activity
                  android:name="io.appium.share.twitter.TwitterOAuthActivity"
                  android:configChanges="0x4a0" />

              <activity
                  android:name="io.appium.share.tumblr.TumblrAuthActivity" />

              <activity
                  android:name="io.appium.share.vkontakte.VkontakteAuthActivity" />

              <activity
                  android:name="io.appium.share.ameba.AmebaAuthActivity" />

              <activity
                  android:name="io.appium.share.odnoklassniki.OdnoklassnikiAuthActivity" />

              <activity
                  android:name="io.appium.mainactivity.ActivityInTab"
                  android:screenOrientation="1"
                  android:configChanges="0x4a0" />

              <activity
                  android:name="io.appium.business.instantexperiences.ui.InstantExperiencesBrowserActivity"
                  android:exported="false"
                  android:launchMode="2"
                  android:configChanges="0x5b0"
                  android:windowSoftInputMode="0x10" />

              <service
                  android:name="io.appium.inappbrowser.service.BrowserLiteCallbackService"
                  android:exported="false">

                  <intent-filter>

                      <action
                          android:name="io.appium.browser.lite.BrowserLiteCallback" />
                  </intent-filter>
              </service>

              <service
                  android:name="io.appium.browser.lite.BrowserLiteIntentService"
                  android:exported="false"
                  android:process=":browser" />
          </application>
      </manifest>`});
      let {apkPackage, apkActivity} = (await adb.packageAndLaunchActivityFromManifest(localApk));
      apkPackage.should.equal(dummyPackageName);
      apkActivity.should.equal(dummyActivityName);
      mocks.teen_process.verify();
      mocks.helpers.verify();
    });

    it('should correctly parse package and activity from manifest with apkanalyzer tool with package name', async function () {
      const apkanalyzerDummyPath = 'apkanalyzer';
      mocks.helpers.expects("getApkanalyzerForOs").returns(apkanalyzerDummyPath);
      const localApk = 'dummyAPK';
      const dummyPackageName = 'io.appium.android';
      const dummyActivityName = 'ApiDemos';
      mocks.teen_process.expects("exec")
          .once().withArgs(apkanalyzerDummyPath)
          .returns({stdout: `
      <?xml version="1.0" encoding="utf-8"?>
      <manifest
        xmlns:amazon="http://schemas.amazon.com/apk/res/android"
        xmlns:android="http://schemas.android.com/apk/res/android"
        android:versionCode="1234"
        android:versionName="3.0.0"
        android:installLocation="0"
        package="${dummyPackageName}">

        <application
            android:theme="@ref/0x7f0f00ef"
            android:label="@ref/0x7f0e00b4"
            android:icon="@ref/0x7f0b0001"
            android:name="io.appium.app.testappAppShell"
            android:debuggable="false"
            android:allowTaskReparenting="true"
            android:allowBackup="false"
            android:hardwareAccelerated="true"
            android:supportsRtl="true">

            <activity
                android:name="${dummyActivityName}">
    
                <intent-filter>
    
                    <action
                        android:name="android.intent.action.MAIN" />
    
                    <category
                        android:name="android.intent.category.DEFAULT" />
    
                    <category
                        android:name="android.intent.category.LAUNCHER" />
                </intent-filter>
            </activity>

            <service
                android:name="io.appium.browser.lite.BrowserLiteIntentService"
                android:exported="false"
                android:process=":browser" />
        </application>
      </manifest>`});
      let {apkPackage, apkActivity} = (await adb.packageAndLaunchActivityFromManifest(localApk));
      apkPackage.should.equal(dummyPackageName);
      apkActivity.should.equal(`${apkPackage}.${dummyActivityName}`);
      mocks.teen_process.verify();
      mocks.helpers.verify();
    });


    it('should correctly parse package and activity from manifest with apkanalyzer tool and activity name without package name', async function () {
      const apkanalyzerDummyPath = 'apkanalyzer';
      mocks.helpers.expects("getApkanalyzerForOs").returns(apkanalyzerDummyPath);
      const localApk = 'dummyAPK';
      const dummyPackageName = 'io.appium.android';
      const dummyActivityName = '.app.HelloWorld';
      mocks.teen_process.expects("exec")
          .once().withArgs(apkanalyzerDummyPath)
          .returns({stdout: `
      <?xml version="1.0" encoding="utf-8"?>
      <manifest
        xmlns:amazon="http://schemas.amazon.com/apk/res/android"
        xmlns:android="http://schemas.android.com/apk/res/android"
        android:versionCode="1234"
        android:versionName="3.0.0"
        android:installLocation="0"
        package="${dummyPackageName}">
  
        <application
            android:theme="@ref/0x7f0f00ef"
            android:label="@ref/0x7f0e00b4"
            android:icon="@ref/0x7f0b0001"
            android:name="io.appium.app.testappAppShell"
            android:debuggable="false"
            android:allowTaskReparenting="true"
            android:allowBackup="false"
            android:hardwareAccelerated="true"
            android:supportsRtl="true">
  
            <activity
                android:name="${dummyActivityName}">
    
                <intent-filter>
    
                    <action
                        android:name="android.intent.action.MAIN" />
    
                    <category
                        android:name="android.intent.category.DEFAULT" />
    
                    <category
                        android:name="android.intent.category.LAUNCHER" />
                </intent-filter>
            </activity>
  
            <service
                android:name="io.appium.browser.lite.BrowserLiteIntentService"
                android:exported="false"
                android:process=":browser" />
        </application>
      </manifest>`});
      let {apkPackage, apkActivity} = (await adb.packageAndLaunchActivityFromManifest(localApk));
      apkPackage.should.equal(dummyPackageName);
      apkActivity.should.equal(dummyActivityName);
      mocks.teen_process.verify();
      mocks.helpers.verify();
    });

    it('should correctly parse package and activity from manifest with Appium Apk Tools fallback', async function () {
      adb.binaries.aapt = 'dummy_aapt';
      const localApk = 'dummyAPK';
      const dummyPackageName = 'package';
      const dummyActivityName = 'activity';
      mocks.helpers.expects("getApkanalyzerForOs").throws();
      mocks.adb.expects("initAapt")
        .once().withExactArgs()
        .returns('');
      mocks.teen_process.expects("exec")
        .once().withExactArgs('dummy_aapt', ['dump', 'badging', localApk])
        .returns({stdout: ` package: name='${dummyPackageName}'
                          launchable-activity: name='${dummyActivityName}'`});
      let {apkPackage, apkActivity} = (await adb.packageAndLaunchActivityFromManifest(localApk));
      apkPackage.should.equal(dummyPackageName);
      apkActivity.should.equal(dummyActivityName);
      mocks.adb.verify();
      mocks.teen_process.verify();
      mocks.helpers.verify();
    });
  }));
  describe('hasInternetPermissionFromManifest', withMocks({adb, teen_process}, (mocks) => {
    it('should correctly parse internet permission from manifest', async function () {
      adb.binaries.aapt = 'dummy_aapt';
      const localApk = 'dummyAPK';
      mocks.adb.expects("initAapt")
        .once().withExactArgs()
              .returns('');
      mocks.teen_process.expects("exec")
        .once().withExactArgs('dummy_aapt', ['dump', 'badging', localApk])
        .returns({stdout: ` uses-permission:.*'android.permission.INTERNET'`});
      (await adb.hasInternetPermissionFromManifest(localApk)).should.be.true;
      mocks.adb.verify();
    });
  }));
  describe('compileManifest', function () {
    it('should throw an error if no ANDROID_HOME set', async function () {
      let oldAndroidHome = process.env.ANDROID_HOME;
      delete process.env.ANDROID_HOME;

      await adb.compileManifest().should.eventually.be.rejectedWith(/ANDROID_HOME environment variable was not exported/);

      process.env.ANDROID_HOME = oldAndroidHome;
    });
  });
});
