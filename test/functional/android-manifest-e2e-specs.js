import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import path from 'path';
import { fs, util } from 'appium-support';
import { rootDir } from '../../lib/helpers.js';


// All paths below assume tests run under /build/test/ so paths are relative from
// that directory.
const contactManagerPath = path.resolve(rootDir, 'test', 'fixtures', 'ContactManager.apk');
const contactMangerSelendroidPath = path.resolve(rootDir, 'test', 'fixtures', 'ContactManager-selendroid.apk');
const tmpDir = path.resolve(rootDir, 'test', 'temp');
const srcManifest = path.resolve(rootDir, 'test', 'fixtures', 'selendroid', 'AndroidManifest.xml');
const serverPath = path.resolve(rootDir, 'test', 'fixtures', 'selendroid', 'selendroid.apk');

chai.use(chaiAsPromised);

describe('Android-manifest', function () {
  let adb;
  before(async function () {
    adb = await ADB.createADB();
  });
  it('packageAndLaunchActivityFromManifest should parse package and Activity', async function () {
    let {apkPackage, apkActivity} = await adb.packageAndLaunchActivityFromManifest(contactManagerPath);
    apkPackage.should.equal('com.example.android.contactmanager');
    apkActivity.endsWith('.ContactManager').should.be.true;
  });
  it('hasInternetPermissionFromManifest should be true', async function () {
    let flag = await adb.hasInternetPermissionFromManifest(contactMangerSelendroidPath);
    flag.should.be.true;
  });
  it('hasInternetPermissionFromManifest should be false', async function () {
    let flag = await adb.hasInternetPermissionFromManifest(contactManagerPath);
    flag.should.be.false;
  });
  // TODO fix this test
  it.skip('should compile and insert manifest', async function () {
    let appPackage = 'com.example.android.contactmanager',
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
    (await util.fileExists(dstManifest)).should.be.true;
    await adb.insertManifest(dstManifest, serverPath, newServerPath);
    (await util.fileExists(newServerPath)).should.be.true;
    // deleting temp directory
    try {
      await fs.rimraf(tmpDir);
    } catch (e) {
      console.log(`Unable to delete temp directory. It might not be present. ${e.message}`); // eslint-disable-line no-console
    }
  });
});
