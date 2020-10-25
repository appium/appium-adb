import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import path from 'path';
import { rootDir } from '../../lib/helpers.js';
import { apiLevel, platformVersion, MOCHA_TIMEOUT } from './setup';
import { fs, mkdirp } from 'appium-support';
import temp from 'temp';
import _ from 'lodash';
import { waitForCondition } from 'asyncbox';


chai.should();
chai.use(chaiAsPromised);
const expect = chai.expect;

const DEFAULT_IMES = [
  'com.android.inputmethod.latin/.LatinIME',
  'com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME',
  'io.appium.android.ime/.UnicodeIME',
];
const CONTACT_MANAGER_PATH = path.resolve(rootDir, 'test', 'fixtures', 'ContactManager.apk');
const CONTACT_MANAGER_PKG = 'com.example.android.contactmanager';
const CONTACT_MANAGER_ACTIVITY = 'ContactManager';


describe('adb commands', function () {
  this.timeout(MOCHA_TIMEOUT);

  let adb;
  const androidInstallTimeout = 90000;
  before(async function () {
    adb = await ADB.createADB({ adbExecTimeout: 60000 });
  });
  it('getApiLevel should get correct api level', async function () {
    (await adb.getApiLevel()).should.equal(apiLevel);
  });
  it('getPlatformVersion should get correct platform version', async function () {
    const actualPlatformVersion = await adb.getPlatformVersion();
    parseFloat(platformVersion).should.equal(parseFloat(actualPlatformVersion));
  });
  it('availableIMEs should get list of available IMEs', async function () {
    (await adb.availableIMEs()).should.have.length.above(0);
  });
  it('enabledIMEs should get list of enabled IMEs', async function () {
    (await adb.enabledIMEs()).should.have.length.above(0);
  });
  it('defaultIME should get default IME', async function () {
    const defaultIME = await adb.defaultIME();
    if (defaultIME) {
      DEFAULT_IMES.should.include(defaultIME);
    }
  });
  it('enableIME and disableIME should enable and disable IME', async function () {
    const imes = await adb.availableIMEs();
    if (imes.length < 2) {
      return this.skip();
    }

    const ime = _.last(imes);
    await adb.disableIME(ime);
    (await adb.enabledIMEs()).should.not.include(ime);
    await adb.enableIME(ime);
    (await adb.enabledIMEs()).should.include(ime);
  });
  it('processExists should be able to find ui process', async function () {
    if (process.env.TRAVIS) {
      // This test is unstable on Travis
      return this.skip();
    }
    (await adb.processExists('com.android.systemui')).should.be.true;
  });
  it('ping should return true', async function () {
    (await adb.ping()).should.be.true;
  });
  it('getPIDsByName should return pids', async function () {
    (await adb.getPIDsByName('com.android.phone')).should.have.length.above(0);
  });
  it('killProcessesByName should kill process', async function () {
    await adb.install(CONTACT_MANAGER_PATH, {timeout: androidInstallTimeout});
    await adb.startApp({pkg: CONTACT_MANAGER_PKG, activity: CONTACT_MANAGER_ACTIVITY});
    await adb.killProcessesByName(CONTACT_MANAGER_PKG);
    await waitForCondition(async () => (await adb.getPIDsByName(CONTACT_MANAGER_PKG)).length === 0, {
      waitMs: 5000,
      intervalMs: 500,
    });
  });
  it('killProcessByPID should kill process', async function () {
    await adb.install(CONTACT_MANAGER_PATH, {timeout: androidInstallTimeout});
    await adb.startApp({pkg: CONTACT_MANAGER_PKG, activity: CONTACT_MANAGER_ACTIVITY});
    let pids = await adb.getPIDsByName(CONTACT_MANAGER_PKG);
    pids.should.have.length.above(0);
    await adb.killProcessByPID(pids[0]);
    await waitForCondition(async () => (await adb.getPIDsByName(CONTACT_MANAGER_PKG)).length === 0, {
      waitMs: 5000,
      intervalMs: 500,
    });
  });
  it('should get device language and country', async function () {
    if (parseInt(apiLevel, 10) >= 23) return this.skip(); // eslint-disable-line curly
    if (process.env.TRAVIS || process.env.CI) return this.skip(); // eslint-disable-line curly

    ['en', 'fr'].should.contain(await adb.getDeviceSysLanguage());
    ['US', 'EN_US', 'EN', 'FR'].should.contain(await adb.getDeviceSysCountry());
  });
  it('should get device locale', async function () {
    if (parseInt(apiLevel, 10) < 23) return this.skip(); // eslint-disable-line curly

    await adb.setDeviceSysLocaleViaSettingApp('en', 'US');
    ['us', 'en', 'ca_en', 'en-US'].should.contain(await adb.getDeviceLocale());
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
  it('should reverse forward the port', async function () {
    await adb.reversePort(4724, 4724);
  });
  it('should remove reverse forwarded port', async function () {
    await adb.reversePort(6790, 8200);
    (await adb.adbExec([`reverse`, `--list`])).should.contain('tcp:6790');
    await adb.removePortReverse(6790);
    (await adb.adbExec([`reverse`, `--list`])).should.not.contain('tcp:6790');

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
    await adb.grantPermission('io.appium.settings', 'android.permission.SET_ANIMATION_SCALE');

    await adb.setAnimationState(false);
    (await adb.isAnimationOn()).should.be.false;
  });
  it('should be able to turn on animation @skip-ci', async function () {
    await adb.grantPermission('io.appium.settings', 'android.permission.SET_ANIMATION_SCALE');

    await adb.setAnimationState(true);
    (await adb.isAnimationOn()).should.be.true;
  });
  it('should be able to set device locale via setting app @skip-ci', async function () {
    // Operation not allowed: java.lang.SecurityException: Package io.appium.settings has not requested permission android.permission.CHANGE_CONFIGURATION
    // is shown if the setting apk is not updated.
    await adb.grantPermission('io.appium.settings', 'android.permission.CHANGE_CONFIGURATION');

    await adb.setDeviceSysLocaleViaSettingApp('fr', 'fr');
    (await adb.getDeviceSysLocale()).should.equal('fr-FR');

    await adb.setDeviceSysLocaleViaSettingApp('zh', 'CN', 'Hans');
    (await adb.getDeviceSysLocale()).should.equal('zh-Hans-CN');

    await adb.setDeviceSysLocaleViaSettingApp('en', 'us');
    (await adb.getDeviceSysLocale()).should.equal('en-US');
  });
  describe('app permissions', function () {
    before(async function () {
      let deviceApiLevel = await adb.getApiLevel();
      if (deviceApiLevel < 23) {
        //test should skip if the device API < 23
        return this.skip();
      }
      let isInstalled = await adb.isAppInstalled('io.appium.android.apis');
      if (isInstalled) {
        await adb.uninstallApk('io.appium.android.apis');
      }
    });
    it('should install and grant all permission', async function () {
      let apiDemos = path.resolve(rootDir, 'test',
          'fixtures', 'ApiDemos-debug.apk');
      await adb.install(apiDemos, {timeout: androidInstallTimeout});
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
      await adb.push(localFile, '/foo/bar/remote.txt').should.be.rejectedWith(/\/foo/);
    });
  });

  describe('bugreport', function () {
    it('should return the report as a raw string', async function () {
      if (process.env.TRAVIS) {
        // skip the test on CI, since it takes a lot of time
        return this.skip;
      }
      const BUG_REPORT_TIMEOUT = 2 * 60 * 1000; // 2 minutes
      this.timeout(BUG_REPORT_TIMEOUT);
      (await adb.bugreport()).should.be.a('string');
    });
  });

  describe('features', function () {
    it('should return the features as a list', async function () {
      _.isArray(await adb.listFeatures()).should.be.true;
    });
  });

  describe('isStreamedInstallSupported', function () {
    it('should return boolean value', async function () {
      _.isBoolean(await adb.isStreamedInstallSupported()).should.be.true;
    });
  });

  describe('isIncrementalInstallSupported', function () {
    it('should return boolean value', async function () {
      _.isBoolean(await adb.isIncrementalInstallSupported()).should.be.true;
    });
  });

  describe('addToDeviceIdleWhitelist', function () {
    it('should add package to the whitelist', async function () {
      await adb.install(CONTACT_MANAGER_PATH, {timeout: androidInstallTimeout});
      if (await adb.addToDeviceIdleWhitelist(CONTACT_MANAGER_PKG)) {
        const pkgList = await adb.getDeviceIdleWhitelist();
        pkgList.some((item) => item.includes(CONTACT_MANAGER_PKG)).should.be.true;
      }
    });
  });
});
