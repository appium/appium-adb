import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import ADB from '../../lib/adb.js';
import path from 'path';
import * as utils from '../../lib/utils.js';

chai.use(chaiAsPromised);
// change according to CI
const apiLevel = '18',
      IME = 'com.example.android.softkeyboard/.SoftKeyboard',
      defaultIME = 'com.android.inputmethod.latin/.LatinIME',
      contactManagerPath = path.resolve(utils.rootDir, 'test',
                                        'fixtures', 'ContactManager.apk'),
      pkgName = 'com.example.android.contactmanager',
      actName = 'ContactManager';

describe('adb commands', function () {
  let adb;
  this.timeout(60000);
  before(async () => {
    adb = await ADB.createADB();
  });
  it('getApiLevel should get correct api level', async () => {
    (await adb.getApiLevel()).should.equal(apiLevel);
  });
  it('availableIMEs should get list of available IMEs', async () => {
    (await adb.availableIMEs()).should.have.length.above(0);
  });
  it('enabledIMEs should get list of enabled IMEs', async () => {
    (await adb.enabledIMEs()).should.have.length.above(0);
  });
  it('defaultIME should get default IME', async () => {
    (await adb.defaultIME()).should.equal(defaultIME);
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
    await adb.startApp({pkg: pkgName,
                        activity: actName});
    await adb.killProcessesByName(pkgName);
    (await adb.getPIDsByName(pkgName)).should.have.length(0);
  });
  it('killProcessByPID should kill process', async () => {
    await adb.install(contactManagerPath);
    await adb.startApp({pkg: pkgName,
                        activity: actName});
    let pids = await adb.getPIDsByName(pkgName);
    pids.should.have.length.above(0);
    await adb.killProcessByPID(pids[0]);
    (await adb.getPIDsByName(pkgName)).length.should.equal(0);
  });
  it('should get device language and country', async () => {
    await adb.getDeviceLanguage().should.eventually.equal('en');
    await adb.getDeviceCountry().should.eventually.equal('US');
  });
  it('should set device language and country', async () => {
    await adb.setDeviceLanguage('fr');
    await adb.setDeviceCountry('fr');
    await adb.reboot();
    await adb.getDeviceLanguage().should.eventually.equal('fr');
    await adb.getDeviceCountry().should.eventually.equal('FR');
    // cleanup
    await adb.setDeviceLanguage('en');
    await adb.setDeviceCountry('us');
  });
  it('it should forward the port', async () => {
    await adb.forwardPort(4724, 4724);
  });
});
