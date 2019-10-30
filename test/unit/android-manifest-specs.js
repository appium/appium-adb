import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import * as teen_process from 'teen_process';
import * as helpers from '../../lib/helpers.js';
import { withMocks } from 'appium-test-support';


chai.use(chaiAsPromised);

const adb = new ADB();

describe('android-manifest', withMocks({adb, teen_process, helpers}, function (mocks) {
  afterEach(function () {
    mocks.verify();
  });

  describe('hasInternetPermissionFromManifest', function () {
    it('should correctly parse internet permission from manifest', async function () {
      adb.binaries.aapt = 'dummy_aapt';
      const localApk = 'dummyAPK';
      mocks.adb.expects('initAapt')
        .once().withExactArgs()
              .returns('');
      mocks.teen_process.expects('exec')
        .once().withExactArgs('dummy_aapt', ['dump', 'badging', localApk])
        .returns({stdout: ` uses-permission:.*'android.permission.INTERNET'`});
      (await adb.hasInternetPermissionFromManifest(localApk)).should.be.true;
    });
  });
  describe('compileManifest', function () {
    it('should throw an error if no ANDROID_HOME set', async function () {
      let oldAndroidHome = process.env.ANDROID_HOME;
      let oldAndroidSdkRoot = process.env.ANDROID_SDK_ROOT;

      delete process.env.ANDROID_HOME;
      delete process.env.ANDROID_SDK_ROOT;

      await adb.compileManifest().should.eventually.be.rejectedWith(/environment/);

      process.env.ANDROID_HOME = oldAndroidHome;
      process.env.ANDROID_SDK_ROOT = oldAndroidSdkRoot;
    });
  });
}));
