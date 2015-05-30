import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import ADB from '../lib/adb.js';
import path from 'path';
import _fs from 'fs';
import B from 'bluebird';
import { util } from 'appium-support';
import _rimraf from 'rimraf';

const fs = {
  mkdir: B.promisify(_fs.mkdir),
  writeFile: B.promisify(_fs.writeFile),
  readFile: B.promisify(_fs.readFile),
  unlink: B.promisify(_fs.unlink)
};
// All paths below assume tests run under /build/test/ so paths are relative from
// that directory.
const rimraf = B.promisify(_rimraf),
      contactManagerPath = path.resolve(__dirname, '..', '..', 'test',
                                        'ContactManager.apk'),
      contactMangerSelendroidPath = path.resolve(__dirname, '..', '..', 'test',
                                                'ContactManager-selendroid.apk'),
      tmpDir = path.resolve(__dirname, '..', '..', 'test', 'temp'),
      srcManifest = path.resolve(__dirname, '..', '..', 'test', 'selendroid',
                                 'AndroidManifest.xml'),
      serverPath = path.resolve(__dirname, '..', '..', 'test', 'selendroid',
                                'selendroid.apk');

chai.use(chaiAsPromised);

describe('Android-manifest', async () => {
  let adb = new ADB();
  before(async () => {
    await adb.createADB();

  });
  it('should correctly parse packageAndLaunchActivityFromManifest', async () => {
    let {apkPackage, apkActivity} = await adb.packageAndLaunchActivityFromManifest(contactManagerPath);
    apkPackage.should.be.equal('com.example.android.contactmanager');
    apkActivity.should.be.equal('com.example.android.contactmanager.ContactManager');
  });
  it('should correctly have internet permission', async () => {
    let flag = await adb.hasInternetPermissionFromManifest(contactMangerSelendroidPath);
    flag.should.be.true;
  });
  it('should correctly not have internet permission', async () => {
    let flag = await adb.hasInternetPermissionFromManifest(contactManagerPath);
    flag.should.be.false;
  });
  it('should compile and insert manifest', async () => {
    let appPackage = 'com.example.android.contactmanager',
        newServerPath = path.resolve(tmpDir, `selendroid.${appPackage}.apk`),
        newPackage = 'com.example.android.contactmanager.selendroid',
        dstDir = path.resolve(tmpDir, appPackage),
        dstManifest = path.resolve(dstDir, 'AndroidManifest.xml');
    // deleting temp directory if present
    await rimraf(tmpDir);
    await fs.mkdir(tmpDir);
    await fs.mkdir(dstDir);
    await fs.writeFile(dstManifest, await fs.readFile(srcManifest, "utf8"), "utf8");
    await adb.compileManifest(dstManifest, newPackage, appPackage);
    (await util.fileExists(dstManifest)).should.be.true;
    await adb.insertManifest(dstManifest, serverPath, newServerPath);
    (await util.fileExists(newServerPath)).should.be.true;
    // deleting temp directory
    await rimraf(tmpDir);
  });
});

describe.skip('Android-manifest To be implemented methods', () => {
  it('should return correct processFromManifest', async () => { });
});
