import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import ADB from '../lib/adb.js';

chai.use(chaiAsPromised);

describe('Android-manifest', async () => {
  it('packageAndLaunchActivityFromManifest', async () => {
    let adb = new ADB();
    await adb.createADB();
    let {apkPackage, apkActivity} = await adb.packageAndLaunchActivityFromManifest('./test/ContactManager.apk');
    apkPackage.should.be.equal('com.example.android.contactmanager');
    apkActivity.should.be.equal('com.example.android.contactmanager.ContactManager');
  });
});

describe.skip('Android-manifest To be implemented methods', () => {
  it('should return correct processFromManifest', async () => { });
  it('compileManifest', async () => { });
  it('insertManifest', async () => { });
  it('hasInternetPermissionFromManifest', async () => { });
});
