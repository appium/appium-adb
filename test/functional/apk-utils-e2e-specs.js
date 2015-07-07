import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import ADB from '../../lib/adb.js';
import path from 'path';
import * as utils from '../../lib/utils.js';

chai.use(chaiAsPromised);

describe('apk utils', function () {
  let adb;
  const contactManagerPath = path.resolve(utils.rootDir, 'test',
                                          'fixtures', 'ContactManager.apk');
  const deviceTempPath = '/data/local/tmp/';
  const assertPackageAndActivity = async () => {
    let {appPackage, appActivity} = await adb.getFocusedPackageAndActivity();
    appPackage.should.equal('com.example.android.contactmanager');
    appActivity.should.equal('.ContactManager');
  };
  this.timeout(60000);
  before(async () => {
    adb = await ADB.createADB();
  });
  it('should be able to install/remove app and detect its status', async () => {
    (await adb.isAppInstalled('foo')).should.be.false;
    await adb.install(contactManagerPath);
    (await adb.isAppInstalled('com.example.android.contactmanager')).should.be.true;
    (await adb.uninstallApk('com.example.android.contactmanager')).should.be.true;
    (await adb.isAppInstalled('com.example.android.contactmanager')).should.be.false;
    (await adb.uninstallApk('com.example.android.contactmanager')).should.be.false;
    await adb.rimraf(deviceTempPath + 'ContactManager.apk');
    await adb.push(contactManagerPath, deviceTempPath);
    await adb.installFromDevicePath(deviceTempPath + 'ContactManager.apk');
  });
  describe('startApp', async () => {
    it('should be able to start', async () => {
      await adb.install(contactManagerPath);
      await adb.startApp({pkg: 'com.example.android.contactmanager',
                          activity: 'ContactManager'});
      await assertPackageAndActivity();

    });
    it('should throw error for wrong activity', async () => {
      await adb.install(contactManagerPath);
      await adb.startApp({pkg: 'com.example.android.contactmanager',
                          activity: 'ContactManage'}).should.eventually
                                                     .be.rejectedWith('Activity');
    });
    it('should throw error for wrong wait activity', async () => {
      await adb.install(contactManagerPath);
      await adb.startApp({pkg: 'com.example.android.contactmanager',
                          activity: 'ContactManager',
                          waitActivity: 'foo',
                          waitDuration: 1000}).should.eventually
                                              .be.rejectedWith('foo');
    });
    it('should start activity with wait activity', async () => {
      await adb.install(contactManagerPath);
      await adb.startApp({pkg: 'com.example.android.contactmanager',
                          activity: 'ContactManager',
                          waitActivity: '.ContactManager'});
      await assertPackageAndActivity();
    });

  });
  it('getFocusedPackageAndActivity should be able get package and activity', async () => {
    await adb.install(contactManagerPath);
    await adb.startApp({pkg: 'com.example.android.contactmanager',
                        activity: 'ContactManager'});
    await assertPackageAndActivity();
  });
});
