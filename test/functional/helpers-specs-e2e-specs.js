import { getAndroidPlatformAndPath, requireSdkRoot } from '../../lib/helpers.js';

describe('Helpers', function () {
  let chai;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.should();
    chai.use(chaiAsPromised.default);
  });

  it('getAndroidPlatformAndPath should return platform and path for android', async function () {
    const sdkRoot = await requireSdkRoot();
    const {platform, platformPath} = await getAndroidPlatformAndPath(sdkRoot);
    platform.should.exist;
    platformPath.should.exist;
  });

});
