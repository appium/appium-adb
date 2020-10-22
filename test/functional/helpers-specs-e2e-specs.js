import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { getAndroidPlatformAndPath, requireSdkRoot } from '../../lib/helpers.js';

chai.use(chaiAsPromised);

describe('Helpers', function () {
  it('getAndroidPlatformAndPath should return platform and path for android', async function () {
    const sdkRoot = await requireSdkRoot();
    const {platform, platformPath} = await getAndroidPlatformAndPath(sdkRoot);
    platform.should.exist;
    platformPath.should.exist;
  });

});
