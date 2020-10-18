import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { getAndroidPlatformAndPath, requireSdkRoot } from '../../lib/helpers.js';

chai.use(chaiAsPromised);

describe('Helpers', function () {
  it('requireSdkRoot should throw when no ANDROID_HOME is set', async function () {
    // Skipping in CI. Can't reproduce locally :shrug:
    if (process.env.CI) {
      return this.skip();
    }
    let android_home = process.env.ANDROID_HOME;
    // temp setting android_home to null.
    delete process.env.ANDROID_HOME;

    try {
      await requireSdkRoot().should.eventually.be.rejectedWith(/environment/);
    } finally {
      // resetting ANDROID_HOME
      process.env.ANDROID_HOME = android_home;
    }
  });

  it('getAndroidPlatformAndPath should return platform and path for android', async function () {
    const sdkRoot = await requireSdkRoot();
    const {platform, platformPath} = await getAndroidPlatformAndPath(sdkRoot);
    platform.should.exist;
    platformPath.should.exist;
  });

});
