import {getAndroidPlatformAndPath} from '../../lib/tools/android-manifest';
import sinon from 'sinon';
import {fs} from '@appium/support';
import path from 'node:path';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

describe('android manifest', function () {
  let sandbox: sinon.SinonSandbox;
  let mocks: {fs: any};

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    mocks = {
      fs: sandbox.mock(fs),
    };
  });

  afterEach(function () {
    sandbox.verify();
    sandbox.restore();
  });

  describe('getAndroidPlatformAndPath', function () {
    it('should get the latest available API', async function () {
      const ANDROID_HOME = '/path/to/android/home';

      mocks.fs
        .expects('glob')
        .returns([
          path.resolve(ANDROID_HOME, 'platforms', 'android-17', 'build.prop'),
          path.resolve(ANDROID_HOME, 'platforms', 'android-25', 'build.prop'),
          path.resolve(ANDROID_HOME, 'platforms', 'android-22', 'build.prop'),
        ]);
      mocks.fs
        .expects('readFile')
        .exactly(3)
        .onCall(0)
        .returns(
          `
          ro.build.version.incremental=1425461
          ro.build.version.sdk=17
          ro.build.version.codename=REL
          ro.build.version.release=4.2.2`,
        )
        .onCall(1)
        .returns(
          `
          ro.build.version.incremental=1425461
          ro.build.version.sdk=25
          ro.build.version.codename=REL
          ro.build.version.release=7.0`,
        )
        .onCall(2).returns(`
          ro.build.version.incremental=1425461
          ro.build.version.sdk=22
          ro.build.version.codename=REL
          ro.build.version.release=5.1`);
      const platformAndPath = await getAndroidPlatformAndPath(ANDROID_HOME);
      expect(platformAndPath.platform).to.equal('android-25');
      expect(platformAndPath.platformPath).to.equal(
        path.resolve(ANDROID_HOME, 'platforms', 'android-25'),
      );
    });
  });
});
