import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import path from 'path';
import { rootDir } from '../../lib/helpers.js';


chai.use(chaiAsPromised);
// change according to CI
const apiLevel = '18',
      platformVersion = '4.3',
      IME = 'com.example.android.softkeyboard/.SoftKeyboard',
      defaultIMEs = ['com.android.inputmethod.latin/.LatinIME',
                     'io.appium.android.ime/.UnicodeIME'],
      contactManagerPath = path.resolve(rootDir, 'test',
                                        'fixtures', 'ContactManager.apk'),
      pkg = 'com.example.android.contactmanager',
      activity = 'ContactManager';

describe('adb commands', function () {
  let adb;
  this.timeout(60000);
  before(async () => {
    adb = await ADB.createADB();
  });
  it('getApiLevel should get correct api level', async () => {
    (await adb.getApiLevel()).should.equal(apiLevel);
  });
  it('getPlatformVersion should get correct platform version', async () => {
    (await adb.getPlatformVersion()).should.equal(platformVersion);
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
  it('should get device language and country', async () => {
    ['en', 'fr'].should.contain(await adb.getDeviceSysLanguage());
    ['US', 'EN_US', 'EN', 'FR'].should.contain(await adb.getDeviceSysCountry());
  });
  it('should set device language and country', async () => {
    await adb.setDeviceSysLanguage('fr');
    await adb.setDeviceSysCountry('fr');
    await adb.reboot();
    await adb.getDeviceSysLanguage().should.eventually.equal('fr');
    await adb.getDeviceSysCountry().should.eventually.equal('FR');
    // cleanup
    await adb.setDeviceSysLanguage('en');
    await adb.setDeviceSysCountry('us');
  });
  it('should forward the port', async () => {
    await adb.forwardPort(4724, 4724);
  });
  it('should start logcat from adb', async () => {
    await adb.startLogcat();
    let logs = adb.logcat.getLogs();
    logs.should.have.length.above(0);
    await adb.stopLogcat();
  });
});
