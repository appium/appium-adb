import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import * as teen_process from 'teen_process';
import { withMocks } from 'appium-test-support';


chai.use(chaiAsPromised);

describe('android-manifest', () => {
  let adb = new ADB();
  describe('processFromManifest', withMocks({adb, teen_process}, (mocks) => {
    it('should correctly parse process from manifest', async () => {
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
  describe('packageAndLaunchActivityFromManifest', withMocks({adb, teen_process}, (mocks) => {
    it('should correctly parse package and activity from manifest', async () => {
      adb.binaries.aapt = 'dummy_aapt';
      const localApk = 'dummyAPK',
            dummyPackageName = 'package',
            dummyActivityName = 'activity';
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
    });
  }));
  describe('hasInternetPermissionFromManifest', withMocks({adb, teen_process}, (mocks) => {
    it('should correctly parse internet permission from manifest', async () => {
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
