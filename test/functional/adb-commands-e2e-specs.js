import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import path from 'path';
import { rootDir } from '../../lib/helpers.js';
import { apiLevel, platformVersion, MOCHA_TIMEOUT } from './setup';
import { fs, mkdirp } from 'appium-support';
import temp from 'temp';


chai.should();
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
  before(async function () {
    adb = await ADB.createADB();
  });
  it('getApiLevel should get correct api level', async function () {
    (await adb.getApiLevel()).should.equal(apiLevel);
  });
  it('getPlatformVersion should get correct platform version', async function () {
    (await adb.getPlatformVersion()).should.include(platformVersion);
  });
  it('availableIMEs should get list of available IMEs', async function () {
    (await adb.availableIMEs()).should.have.length.above(0);
  });
  it('enabledIMEs should get list of enabled IMEs', async function () {
    (await adb.enabledIMEs()).should.have.length.above(0);
  });
  it('defaultIME should get default IME', async function () {
    defaultIMEs.should.include(await adb.defaultIME());
  });
  it('enableIME and disableIME should enable and disble IME', async function () {
    await adb.disableIME(IME);
    (await adb.enabledIMEs()).should.not.include(IME);
    await adb.enableIME(IME);
    (await adb.enabledIMEs()).should.include(IME);
    await adb.enabledIMEs();
  });
  it('processExists should be able to find ui process', async function () {
    (await adb.processExists('com.android.systemui')).should.be.true;
  });
  it('ping should return true', async function () {
    (await adb.ping()).should.be.true;
  });
  it('getPIDsByName should return pids', async function () {
    (await adb.getPIDsByName('m.android.phone')).should.have.length.above(0);
  });
  it('killProcessesByName should kill process', async function () {
    await adb.install(contactManagerPath);
    await adb.startApp({pkg, activity});
    await adb.killProcessesByName(pkg);
    (await adb.getPIDsByName(pkg)).should.have.length(0);
  });
  it('killProcessByPID should kill process', async function () {
    await adb.install(contactManagerPath);
    await adb.startApp({pkg, activity});
    let pids = await adb.getPIDsByName(pkg);
    pids.should.have.length.above(0);
    await adb.killProcessByPID(pids[0]);
    (await adb.getPIDsByName(pkg)).length.should.equal(0);
  });
  it('should get device language and country', async function () {
    if (parseInt(apiLevel, 10) >= 23) return this.skip(); // eslint-disable-line curly
    if (process.env.TRAVIS) return this.skip(); // eslint-disable-line curly

    ['en', 'fr'].should.contain(await adb.getDeviceSysLanguage());
    ['US', 'EN_US', 'EN', 'FR'].should.contain(await adb.getDeviceSysCountry());
  });
  it('should set device language and country', async function () {
    if (parseInt(apiLevel, 10) >= 23) return this.skip(); // eslint-disable-line curly
    if (process.env.TRAVIS) return this.skip(); // eslint-disable-line curly

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
    if (parseInt(apiLevel, 10) < 23) return this.skip(); // eslint-disable-line curly

    ['us', 'en', 'ca_en'].should.contain(await adb.getDeviceLocale());
  });
  it('should forward the port', async function () {
    await adb.forwardPort(4724, 4724);
  });
  it('should remove forwarded port', async function () {
    await adb.forwardPort(8200, 6790);
    (await adb.adbExec([`forward`, `--list`])).should.contain('tcp:8200');
    await adb.removePortForward(8200);
    (await adb.adbExec([`forward`, `--list`])).should.not.contain('tcp:8200');

  });
  it('should start logcat from adb', async function () {
    await adb.startLogcat();
    let logs = adb.logcat.getLogs();
    logs.should.have.length.above(0);
    await adb.stopLogcat();
  });
  it('should get model', async function () {
    (await adb.getModel()).should.not.be.null;
  });
  it('should get manufacturer', async function () {
    (await adb.getManufacturer()).should.not.be.null;
  });
  it('should get screen size', async function () {
    (await adb.getScreenSize()).should.not.be.null;
  });
  it('should get screen density', async function () {
    (await adb.getScreenDensity()).should.not.be.null;
  });
  it('should be able to toggle gps location provider', async function () {
    await adb.toggleGPSLocationProvider(true);
    (await adb.getLocationProviders()).should.include('gps');
    await adb.toggleGPSLocationProvider(false);
    (await adb.getLocationProviders()).should.not.include('gps');
  });
  it('should be able to toogle airplane mode', async function () {
    await adb.setAirplaneMode(true);
    (await adb.isAirplaneModeOn()).should.be.true;
    await adb.setAirplaneMode(false);
    (await adb.isAirplaneModeOn()).should.be.false;
  });
  it('should be able to toogle wifi @skip-ci', async function () {
    this.retries(3);

    await adb.setWifiState(true);
    (await adb.isWifiOn()).should.be.true;
    await adb.setWifiState(false);
    (await adb.isWifiOn()).should.be.false;
  });
  it('should be able to turn off animation @skip-ci', async function () {
    await adb.setAnimationState(false);
    (await adb.isAnimationOn()).should.be.false;
  });
  it('should be able to turn on animation @skip-ci', async function () {
    await adb.setAnimationState(true);
    (await adb.isAnimationOn()).should.be.true;
  });
  it('should be able to set device locale via setting app @skip-ci', async function () {
    // Operation not allowed: java.lang.SecurityException: Package io.appium.settings has not requested permission android.permission.CHANGE_CONFIGURATION
    // is shown if the setting apk is not updated.
    await adb.grantPermission('io.appium.settings', 'android.permission.CHANGE_CONFIGURATION');

    await adb.setDeviceSysLocaleViaSettingApp('fr', 'fr');
    (await adb.getDeviceSysLocale()).should.equal('fr-FR');

    await adb.setDeviceSysLocaleViaSettingApp('en', 'us');
    (await adb.getDeviceSysLocale()).should.equal('en-US');
  });
  describe('app permissions', async function () {
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
    it('should install and grant all permission', async function () {
      let apiDemos = path.resolve(rootDir, 'test',
          'fixtures', 'ApiDemos-debug.apk');
      await adb.install(apiDemos);
      (await adb.isAppInstalled('io.appium.android.apis')).should.be.true;
      await adb.grantAllPermissions('io.appium.android.apis');
      let requestedPermissions = await adb.getReqPermissions('io.appium.android.apis');
      expect(await adb.getGrantedPermissions('io.appium.android.apis')).to.have.members(requestedPermissions);
    });
    it('should revoke permission', async function () {
      await adb.revokePermission('io.appium.android.apis', 'android.permission.RECEIVE_SMS');
      expect(await adb.getGrantedPermissions('io.appium.android.apis')).to.not.have.members(['android.permission.RECEIVE_SMS']);
    });
    it('should grant permission', async function () {
      await adb.grantPermission('io.appium.android.apis', 'android.permission.RECEIVE_SMS');
      expect(await adb.getGrantedPermissions('io.appium.android.apis')).to.include.members(['android.permission.RECEIVE_SMS']);
    });
  });

  describe('push file', function () {
    function getRandomDir () {
      return `/data/local/tmp/test${Math.random()}`;
    }

    let localFile = temp.path({prefix: 'appium', suffix: '.tmp'});
    let tempFile = temp.path({prefix: 'appium', suffix: '.tmp'});
    const stringData = `random string data ${Math.random()}`;
    before(async function () {
      await mkdirp(path.dirname(localFile));
      await mkdirp(path.dirname(tempFile));

      await fs.writeFile(localFile, stringData);
    });
    after(async function () {
      if (await fs.exists(localFile)) {
        await fs.unlink(localFile);
      }
    });
    afterEach(async function () {
      if (await fs.exists(tempFile)) {
        await fs.unlink(tempFile);
      }
    });
    it('should push file to a valid location', async function () {
      let remoteFile = `${getRandomDir()}/remote.txt`;

      await adb.push(localFile, remoteFile);

      // get the file and its contents, to check
      await adb.pull(remoteFile, tempFile);
      let remoteData = await fs.readFile(tempFile);
      remoteData.toString().should.equal(stringData);
    });
    it('should throw error if it cannot write to the remote file', async function () {
      let remoteFile = '/foo/bar/remote.txt';

      await adb.push(localFile, remoteFile).should.be.rejectedWith(/\/foo\/bar\/remote.txt/);
    });
  });

  describe('bugreport', function () {
    it('should return the report as raw string by default', async function () {
      (await adb.bugreport()).should.not.be.empty;
    });

    it('should return the report as base64-encoded .zip archive if needed', async function () {
      if (await adb.getApiLevel() < 23) {
        // This option does not work with older APIs
        return this.skip();
      }
      const base64 = await adb.bugreport(false);
      Buffer.from(base64, 'base64')
        .toString('ascii')
        .startsWith('PK')
        .should.be.true;
    });
  });

});
