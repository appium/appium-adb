import { getAndroidPlatformAndPath } from '../../lib/tools/android-manifest';
import { withMocks } from '@appium/test-support';
import { fs } from '@appium/support';
import path from 'path';

describe('android manifest', withMocks({fs}, function (mocks) {
  let chai;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.should();
    chai.use(chaiAsPromised.default);
  });

  afterEach(function () {
    mocks.verify();
  });

  describe('getAndroidPlatformAndPath', function () {
    it('should get the latest available API', async function () {
      const ANDROID_HOME = '/path/to/android/home';

      mocks.fs.expects('glob').returns([
        path.resolve(ANDROID_HOME, 'platforms', 'android-17', 'build.prop'),
        path.resolve(ANDROID_HOME, 'platforms', 'android-25', 'build.prop'),
        path.resolve(ANDROID_HOME, 'platforms', 'android-22', 'build.prop'),
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
      let platformAndPath = await getAndroidPlatformAndPath(ANDROID_HOME);
      platformAndPath.platform.should.equal('android-25');
      platformAndPath.platformPath.should
        .equal(path.resolve(ANDROID_HOME, 'platforms', 'android-25'));
    });
  });
}));
