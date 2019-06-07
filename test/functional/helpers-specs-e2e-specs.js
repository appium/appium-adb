import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { getAndroidPlatformAndPath } from '../../lib/helpers.js';

chai.use(chaiAsPromised);

describe('Helpers', function () {
  it('getAndroidPlatformAndPath should return empty object when no ANDROID_HOME is set', async function () {
    let android_home = process.env.ANDROID_HOME;
    // temp setting android_home to null.
    delete process.env.ANDROID_HOME;

    try {
      await getAndroidPlatformAndPath().should.eventually.be.rejectedWith(/environment/);
    } finally {
      // resetting ANDROID_HOME
      process.env.ANDROID_HOME = android_home;
    }
  });

  it('getAndroidPlatformAndPath should return platform and path for android', async function () {
    let {platform, platformPath} = await getAndroidPlatformAndPath();
    platform.should.exist;
    platformPath.should.exist;
  });

});
