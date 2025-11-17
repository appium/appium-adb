import {ADB} from '../../lib/adb';
import path from 'path';
import {
  MOCHA_TIMEOUT,
  APIDEMOS_PKG,
  getApiDemosPath,
} from './setup';
import { fs, tempDir } from '@appium/support';
import _ from 'lodash';

describe('general commands', function () {
  this.timeout(MOCHA_TIMEOUT);

  let adb;
  let chai;
  let expect;
  let apiDemosPath;
  const androidInstallTimeout = 90000;
  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.should();
    chai.use(chaiAsPromised.default);
    expect = chai.expect;

    adb = await ADB.createADB({ adbExecTimeout: 60000 });
    apiDemosPath = await getApiDemosPath();
  });
  it('getApiLevel should get correct api level', async function () {
    const actualApiLevel = await adb.getApiLevel();
    actualApiLevel.should.be.above(0);
  });
  it('getPlatformVersion should get correct platform version', async function () {
    const actualPlatformVersion = await adb.getPlatformVersion();
    parseFloat(actualPlatformVersion).should.be.above(0);
  });
  it('availableIMEs should get list of available IMEs', async function () {
    (await adb.availableIMEs()).should.have.length.above(0);
  });
  it('enabledIMEs should get list of enabled IMEs', async function () {
    (await adb.enabledIMEs()).should.have.length.above(0);
  });
  it('defaultIME should get default IME', async function () {
    const defaultIME = await adb.defaultIME();
    defaultIME.should.be.a('string');
    defaultIME.length.should.be.above(0);
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
  it('ping should return true', async function () {
    (await adb.ping()).should.be.true;
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

    // To avoid side effects for other tests, especially on Android 16+
    await adb.toggleGPSLocationProvider(true);
  });
  it('should be able to toggle airplane mode', async function () {
    await adb.setAirplaneMode(true);
    (await adb.isAirplaneModeOn()).should.be.true;
    await adb.setAirplaneMode(false);
    (await adb.isAirplaneModeOn()).should.be.false;
  });
  describe('app permissions', function () {
    before(async function () {
      if (await adb.isAppInstalled(APIDEMOS_PKG)) {
        await adb.uninstallApk(APIDEMOS_PKG);
      }
    });
    it('should install and grant all permission', async function () {
      await adb.install(apiDemosPath, {timeout: androidInstallTimeout});
      (await adb.isAppInstalled(APIDEMOS_PKG)).should.be.true;
      await adb.grantAllPermissions(APIDEMOS_PKG);
      const requestedPermissions = await adb.getReqPermissions(APIDEMOS_PKG);
      const grantedPermissions = await adb.getGrantedPermissions(APIDEMOS_PKG);
      const deviceApiLevel = await adb.getApiLevel();

      // Check that all requested permissions are granted
      // Some permissions may not be grantable via adb on certain API levels:
      // - POST_NOTIFICATIONS requires API 33+ (Android 13+)
      // - Custom permissions may not be grantable
      for (const permission of requestedPermissions) {
        // Skip POST_NOTIFICATIONS on API levels < 33
        if (permission === 'android.permission.POST_NOTIFICATIONS' && deviceApiLevel < 33) {
          continue;
        }
        // Skip custom permissions that may not be grantable via adb
        if (permission.startsWith(`${APIDEMOS_PKG}.`)) {
          continue;
        }
        grantedPermissions.should.include(permission);
      }
    });
    it('should revoke permission', async function () {
      await adb.revokePermission(APIDEMOS_PKG, 'android.permission.RECEIVE_SMS');
      expect(await adb.getGrantedPermissions(APIDEMOS_PKG)).to.not.have.members(['android.permission.RECEIVE_SMS']);
    });
    it('should grant permission', async function () {
      await adb.grantPermission(APIDEMOS_PKG, 'android.permission.RECEIVE_SMS');
      expect(await adb.getGrantedPermissions(APIDEMOS_PKG)).to.include.members(['android.permission.RECEIVE_SMS']);
    });
  });

  describe('push file', function () {
    function getRandomDir () {
      return `/data/local/tmp/test${Math.random()}`;
    }

    let localFile;
    let tempFile;
    let tempRoot;
    const stringData = `random string data ${Math.random()}`;
    before(async function () {
      tempRoot = await tempDir.openDir();
      localFile = path.join(tempRoot, 'local.tmp');
      tempFile = path.join(tempRoot, 'temp.tmp');

      await fs.writeFile(localFile, stringData);
    });
    after(async function () {
      if (tempRoot) {
        await fs.rimraf(tempRoot);
      }
    });
    afterEach(async function () {
      if (await fs.exists(tempFile)) {
        await fs.unlink(tempFile);
      }
    });
    for (const remotePath of [
      `${getRandomDir()}/remote.txt`,
      '/data/local/tmp/one two/remote file.txt',
    ]) {
      it(`should push file to a valid location ${remotePath}`, async function () {
        await adb.push(localFile, remotePath);

        // get the file and its contents, to check
        await adb.pull(remotePath, tempFile);
        const remoteData = await fs.readFile(tempFile);
        remoteData.toString().should.equal(stringData);
      });
    }
    it('should throw error if it cannot write to the remote file', async function () {
      await adb.push(localFile, '/foo/bar/remote.txt').should.be.rejectedWith(/\/foo/);
    });
  });

  describe('bugreport', function () {
    it('should return the report as a raw string', async function () {
      if (process.env.CI) {
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

  describe('launchable activity', function () {
    it('should resolve the name of the launchable activity', async function () {
      await adb.install(apiDemosPath, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      (await adb.resolveLaunchableActivity(APIDEMOS_PKG)).should.not.be.empty;
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
      await adb.install(apiDemosPath, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      if (await adb.addToDeviceIdleWhitelist(APIDEMOS_PKG)) {
        const pkgList = await adb.getDeviceIdleWhitelist();
        pkgList.some((item) => item.includes(APIDEMOS_PKG)).should.be.true;
      }
    });
  });

  describe('takeScreenshot', function () {
    it('should return screenshot', async function () {
      _.isEmpty(await adb.takeScreenshot()).should.be.false;
    });
  });

  describe('listPorts', function () {
    it('should list opened ports', async function () {
      (_.isEmpty(await adb.listPorts()) && _.isEmpty(await adb.listPorts('6'))).should.be.false;
    });
  });
});
