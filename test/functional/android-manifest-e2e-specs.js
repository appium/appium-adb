import {ADB} from '../../lib/adb';
import path from 'path';
import { fs } from '@appium/support';
import { CONTACT_MANAGER_PKG, CONTACT_MANAGER_PATH } from './setup';


// All paths below assume tests run under /build/test/ so paths are relative from
// that directory.
const contactMangerSelendroidPath = path.resolve(__dirname, '..', 'fixtures', 'ContactManager-selendroid.apk');
const tmpDir = path.resolve(__dirname, '..', 'temp');
const srcManifest = path.resolve(__dirname, '..', 'fixtures', 'selendroid', 'AndroidManifest.xml');
const serverPath = path.resolve(__dirname, '..', 'fixtures', 'selendroid', 'selendroid.apk');

describe('Android-manifest', function () {
  let adb;
  let chai;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.should();
    chai.use(chaiAsPromised.default);

    adb = await ADB.createADB();
  });
  it('packageAndLaunchActivityFromManifest should parse package and Activity', async function () {
    let {apkPackage, apkActivity} = await adb.packageAndLaunchActivityFromManifest(CONTACT_MANAGER_PATH);
    apkPackage.should.equal(CONTACT_MANAGER_PKG);
    apkActivity.endsWith('.ContactManager').should.be.true;
  });
  it('hasInternetPermissionFromManifest should be true', async function () {
    let flag = await adb.hasInternetPermissionFromManifest(contactMangerSelendroidPath);
    flag.should.be.true;
  });
  it('hasInternetPermissionFromManifest should be false', async function () {
    let flag = await adb.hasInternetPermissionFromManifest(CONTACT_MANAGER_PATH);
    flag.should.be.false;
  });
  // TODO fix this test
  it.skip('should compile and insert manifest', async function () {
    let appPackage = CONTACT_MANAGER_PKG,
        newServerPath = path.resolve(tmpDir, `selendroid.${appPackage}.apk`),
        newPackage = 'com.example.android.contactmanager.selendroid',
        dstDir = path.resolve(tmpDir, appPackage),
        dstManifest = path.resolve(dstDir, 'AndroidManifest.xml');
    // deleting temp directory if present
    try {
      await fs.rimraf(tmpDir);
    } catch (e) {
      console.log(`Unable to delete temp directory. It might not be present. ${e.message}`); // eslint-disable-line no-console
    }
    await fs.mkdir(tmpDir);
    await fs.mkdir(dstDir);
    await fs.writeFile(dstManifest, await fs.readFile(srcManifest, 'utf8'), 'utf8');
    await adb.compileManifest(dstManifest, newPackage, appPackage);
    (await fs.fileExists(dstManifest)).should.be.true;
    await adb.insertManifest(dstManifest, serverPath, newServerPath);
    (await fs.fileExists(newServerPath)).should.be.true;
    // deleting temp directory
    try {
      await fs.rimraf(tmpDir);
    } catch (e) {
      console.log(`Unable to delete temp directory. It might not be present. ${e.message}`); // eslint-disable-line no-console
    }
  });
});
