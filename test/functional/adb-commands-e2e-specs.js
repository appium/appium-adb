import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import path from 'path';
import { rootDir } from '../../lib/helpers.js';
import { apiLevel, platformVersion, MOCHA_TIMEOUT } from './setup';


chai.use(chaiAsPromised);
let expect = chai.expect;

// change according to CI
const IME = 'com.example.android.softkeyboard/.SoftKeyboard',
      defaultIMEs = ['com.android.inputmethod.latin/.LatinIME',
                     'io.appium.android.ime/.UnicodeIME'],
      contactManagerPath = path.resolve(rootDir, 'test',
                                        'fixtures', 'ContactManager.apk'),
      pkg = 'com.example.android.contactmanager',
      activity = 'ContactManager';

describe('adb commands', function () {
  this.timeout(MOCHA_TIMEOUT);

  let adb;
  before(async () => {
    adb = await ADB.createADB();
  });
  it('getApiLevel should get correct api level', async () => {
    (await adb.getApiLevel()).should.equal(apiLevel);
  });
  it('getPlatformVersion should get correct platform version', async () => {
    (await adb.getPlatformVersion()).should.include(platformVersion);
  });
  it('availableIMEs should get list of available IMEs', async () => {
    (await adb.availableIMEs()).should.have.length.above(0);
  });
  it('enabledIMEs should get list of enabled IMEs', async () => {
    (await adb.enabledIMEs()).should.have.length.above(0);
  });
  it('defaultIME should get default IME', async () => {
    defaultIMEs.should.include(await adb.defaultIME());
  });
  it('enableIME and disableIME should enable and disble IME', async () => {
    await adb.disableIME(IME);
    (await adb.enabledIMEs()).should.not.include(IME);
    await adb.enableIME(IME);
    (await adb.enabledIMEs()).should.include(IME);
    await adb.enabledIMEs();
  });
  it('processExists should be able to find ui process', async () => {
    (await adb.processExists('com.android.systemui')).should.be.true;
  });
  it('ping should return true', async () => {
    (await adb.ping()).should.be.true;
  });
  it('getPIDsByName should return pids', async () => {
    (await adb.getPIDsByName('m.android.phone')).should.have.length.above(0);
  });
  it('killProcessesByName should kill process', async () => {
    await adb.install(contactManagerPath);
    await adb.startApp({pkg, activity});
    await adb.killProcessesByName(pkg);
    (await adb.getPIDsByName(pkg)).should.have.length(0);
  });
  it('killProcessByPID should kill process', async () => {
    await adb.install(contactManagerPath);
    await adb.startApp({pkg, activity});
    let pids = await adb.getPIDsByName(pkg);
    pids.should.have.length.above(0);
    await adb.killProcessByPID(pids[0]);
    (await adb.getPIDsByName(pkg)).length.should.equal(0);
  });
  it('should get device language and country', async function () {
    if (parseInt(apiLevel, 10) >= 23) return this.skip();
    if (process.env.TRAVIS) return this.skip();

    ['en', 'fr'].should.contain(await adb.getDeviceSysLanguage());
    ['US', 'EN_US', 'EN', 'FR'].should.contain(await adb.getDeviceSysCountry());
  });
  it('should set device language and country', async function () {
    if (parseInt(apiLevel, 10) >= 23) return this.skip();
    if (process.env.TRAVIS) return this.skip();

    await adb.setDeviceSysLanguage('fr');
    await adb.setDeviceSysCountry('fr');
    await adb.reboot();
    await adb.getDeviceSysLanguage().should.eventually.equal('fr');
    await adb.getDeviceSysCountry().should.eventually.equal('FR');
    // cleanup
    await adb.setDeviceSysLanguage('en');
    await adb.setDeviceSysCountry('us');
  });
  it('should get device locale', async function () {
    if (parseInt(apiLevel, 10) < 23) return this.skip();

    ['us'].should.contain(await adb.getDeviceLocale());
  });
  it('should forward the port', async () => {
    await adb.forwardPort(4724, 4724);
  });
  it('should remove forwarded port', async () => {
    await adb.forwardPort(8200, 6790);
    (await adb.adbExec([`forward`, `--list`])).should.contain('tcp:8200');
    await adb.removePortForward(8200);
    (await adb.adbExec([`forward`, `--list`])).should.not.contain('tcp:8200');

  });
  it('should start logcat from adb', async () => {
    await adb.startLogcat();
    let logs = adb.logcat.getLogs();
    logs.should.have.length.above(0);
    await adb.stopLogcat();
  });
  it('should get model', async () => {
    (await adb.getModel()).should.not.be.null;
  });
  it('should get manufacturer', async () => {
    (await adb.getManufacturer()).should.not.be.null;
  });
  it('should get screen size', async () => {
    (await adb.getScreenSize()).should.not.be.null;
  });
  describe('app permissions', async () => {
    before(async function () {
      let deviceApiLevel = await adb.getApiLevel();
      if (deviceApiLevel < 23) {
        //test should skip if the device API < 23
        this.skip();
      }
      let isInstalled = await adb.isAppInstalled('io.appium.android.apis');
      if (isInstalled) {
        await adb.uninstallApk('io.appium.android.apis');
      }
    });
    it('should install and grant all permission', async () => {
      let apiDemos = path.resolve(rootDir, 'test',
          'fixtures', 'ApiDemos-debug.apk');
      await adb.install(apiDemos);
      (await adb.isAppInstalled('io.appium.android.apis')).should.be.true;
      await adb.grantAllPermissions('io.appium.android.apis');
      let requestedPermissions = await adb.getReqPermissions('io.appium.android.apis');
      expect(await adb.getGrantedPermissions('io.appium.android.apis')).to.have.members(requestedPermissions);
    });
    it('should revoke permission', async () => {
      await adb.revokePermission('io.appium.android.apis', 'android.permission.RECEIVE_SMS');
      expect(await adb.getGrantedPermissions('io.appium.android.apis')).to.not.have.members(['android.permission.RECEIVE_SMS']);
    });
    it('should grant permission', async () => {
      await adb.grantPermission('io.appium.android.apis', 'android.permission.RECEIVE_SMS');
      expect(await adb.getGrantedPermissions('io.appium.android.apis')).to.include.members(['android.permission.RECEIVE_SMS']);
    });
  });
});
