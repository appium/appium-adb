import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { getAndroidPlatformAndPath, assertZipArchive, rootDir } from '../../lib/helpers.js';
import path from 'path';


const should = chai.should(),
      apkPath = path.resolve(rootDir, 'test',
                             'fixtures', 'ContactManager.apk');
chai.use(chaiAsPromised);

describe('Helpers', () => {
  it('getAndroidPlatformAndPath should return null', async () => {
    let android_home = process.env.ANDROID_HOME;
    // temp setting android_home to null.
    process.env.ANDROID_HOME = null;
    let result = await getAndroidPlatformAndPath();
    should.not.exist(result);
    // resetting ANDROID_HOME
    process.env.ANDROID_HOME = android_home;
  });

  it('getAndroidPlatformAndPath should return platform and path for android', async () => {
    let {platform, platformPath} = await getAndroidPlatformAndPath();
    platform.should.exist;
    platformPath.should.exist;
  });
  // TODO make it work on CI
  it.skip('assertZipArchive should assert zip existing', async () => {
    await assertZipArchive(apkPath);
  });

});
