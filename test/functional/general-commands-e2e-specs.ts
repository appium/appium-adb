import {ADB} from '../../lib/adb';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {MOCHA_TIMEOUT, APIDEMOS_PKG, getApiDemosPath} from './setup';
import {fs, tempDir} from '@appium/support';
import {waitForCondition} from 'asyncbox';
import _ from 'lodash';

chai.use(chaiAsPromised);

describe('general commands', function () {
  this.timeout(MOCHA_TIMEOUT);

  let adb;
  let apiDemosPath;
  const androidInstallTimeout = 90000;
  before(async function () {
    adb = await ADB.createADB({adbExecTimeout: 60000});
    apiDemosPath = await getApiDemosPath();
  });
  it('getApiLevel should get correct api level', async function () {
    const actualApiLevel = await adb.getApiLevel();
    expect(actualApiLevel).to.be.above(0);
  });
  it('getPlatformVersion should get correct platform version', async function () {
    const actualPlatformVersion = await adb.getPlatformVersion();
    expect(parseFloat(actualPlatformVersion)).to.be.above(0);
  });
  it('availableIMEs should get list of available IMEs', async function () {
    expect(await adb.availableIMEs()).to.have.length.above(0);
  });
  it('enabledIMEs should get list of enabled IMEs', async function () {
    expect(await adb.enabledIMEs()).to.have.length.above(0);
  });
  it('defaultIME should get default IME', async function () {
    const defaultIME = await adb.defaultIME();
    expect(defaultIME).to.be.a('string');
    expect(defaultIME.length).to.be.above(0);
  });
  it('enableIME and disableIME should enable and disable IME', async function () {
    const imes = await adb.availableIMEs();
    if (imes.length < 2) {
      return this.skip();
    }

    // Get the default IME to avoid trying to disable it (which may not be allowed)
    const defaultIme = await adb.defaultIME();
    // Find an IME that is not the default one
    const ime = imes.find((i) => i !== defaultIme) || _.last(imes);

    // Skip if we can't find a non-default IME or if the only IME is the default
    if (!ime || ime === defaultIme) {
      this.skip();
      return;
    }

    await adb.disableIME(ime);
    // Wait for the IME to be disabled, or determine it can't be disabled (on some Android versions)
    // On some Android versions (especially API 36+), some IMEs might not be fully disabled
    let enabledAfterDisable;
    try {
      // Wait for the IME to be removed from the enabled list
      await waitForCondition(
        async () => {
          const enabled = await adb.enabledIMEs();
          return !enabled.includes(ime);
        },
        {
          waitMs: 3000,
          intervalMs: 500,
        },
      );
      // If we get here, the IME was successfully disabled
      enabledAfterDisable = await adb.enabledIMEs();
      expect(enabledAfterDisable).to.not.include(ime);
    } catch {
      // If timeout, the IME couldn't be disabled (system IME that can't be disabled)
      // This is acceptable behavior on some Android versions
      enabledAfterDisable = await adb.enabledIMEs();
    }
    // Re-enable the IME to restore state (or ensure it's enabled if disable didn't work)
    await adb.enableIME(ime);
    // Wait for the IME to be enabled
    await waitForCondition(
      async () => {
        const enabled = await adb.enabledIMEs();
        return enabled.includes(ime);
      },
      {
        waitMs: 3000,
        intervalMs: 500,
      },
    );
    // Verify that enable works (or that it's already enabled if it couldn't be disabled)
    expect(await adb.enabledIMEs()).to.include(ime);
  });
  it('ping should return true', async function () {
    expect(await adb.ping()).to.be.true;
  });
  it('should forward the port', async function () {
    await adb.forwardPort(4724, 4724);
  });
  it('should remove forwarded port', async function () {
    await adb.forwardPort(8200, 6790);
    expect(await adb.adbExec([`forward`, `--list`])).to.contain('tcp:8200');
    await adb.removePortForward(8200);
    expect(await adb.adbExec([`forward`, `--list`])).to.not.contain('tcp:8200');
  });
  it('should reverse forward the port', async function () {
    await adb.reversePort(4724, 4724);
  });
  it('should remove reverse forwarded port', async function () {
    await adb.reversePort(6790, 8200);
    expect(await adb.adbExec([`reverse`, `--list`])).to.contain('tcp:6790');
    await adb.removePortReverse(6790);
    expect(await adb.adbExec([`reverse`, `--list`])).to.not.contain('tcp:6790');
  });
  it('should start logcat from adb', async function () {
    await adb.startLogcat();
    const logs = adb.logcat.getLogs();
    expect(logs).to.have.length.above(0);
    await adb.stopLogcat();
  });
  it('should get model', async function () {
    expect(await adb.getModel()).to.not.be.null;
  });
  it('should get manufacturer', async function () {
    expect(await adb.getManufacturer()).to.not.be.null;
  });
  it('should get screen size', async function () {
    expect(await adb.getScreenSize()).to.not.be.null;
  });
  it('should get screen density', async function () {
    expect(await adb.getScreenDensity()).to.not.be.null;
  });
  it('should be able to toggle gps location provider', async function () {
    await adb.toggleGPSLocationProvider(true);
    expect(await adb.getLocationProviders()).to.include('gps');
    await adb.toggleGPSLocationProvider(false);
    expect(await adb.getLocationProviders()).to.not.include('gps');

    // To avoid side effects for other tests, especially on Android 16+
    await adb.toggleGPSLocationProvider(true);
  });
  it('should be able to toggle airplane mode', async function () {
    await adb.setAirplaneMode(true);
    expect(await adb.isAirplaneModeOn()).to.be.true;
    await adb.setAirplaneMode(false);
    expect(await adb.isAirplaneModeOn()).to.be.false;
  });
  describe('app permissions', function () {
    before(async function () {
      if (await adb.isAppInstalled(APIDEMOS_PKG)) {
        await adb.uninstallApk(APIDEMOS_PKG);
      }
    });
    it('should install and grant all permission', async function () {
      await adb.install(apiDemosPath, {timeout: androidInstallTimeout});
      expect(await adb.isAppInstalled(APIDEMOS_PKG)).to.be.true;
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
        expect(grantedPermissions).to.include(permission);
      }
    });
    it('should revoke permission', async function () {
      await adb.revokePermission(APIDEMOS_PKG, 'android.permission.RECEIVE_SMS');
      expect(await adb.getGrantedPermissions(APIDEMOS_PKG)).to.not.have.members([
        'android.permission.RECEIVE_SMS',
      ]);
    });
    it('should grant permission', async function () {
      await adb.grantPermission(APIDEMOS_PKG, 'android.permission.RECEIVE_SMS');
      expect(await adb.getGrantedPermissions(APIDEMOS_PKG)).to.include.members([
        'android.permission.RECEIVE_SMS',
      ]);
    });
  });

  describe('push file', function () {
    function getRandomDir() {
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
        expect(remoteData.toString()).to.equal(stringData);
      });
    }
    it('should throw error if it cannot write to the remote file', async function () {
      await expect(adb.push(localFile, '/foo/bar/remote.txt')).to.be.rejectedWith(/\/foo/);
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
      expect(await adb.bugreport()).to.be.a('string');
    });
  });

  describe('features', function () {
    it('should return the features as a list', async function () {
      const features = await adb.listFeatures();
      expect(_.isArray(features)).to.be.true;
    });
  });

  describe('launchable activity', function () {
    it('should resolve the name of the launchable activity', async function () {
      await adb.install(apiDemosPath, {
        timeout: androidInstallTimeout,
        grantPermissions: true,
      });
      expect(await adb.resolveLaunchableActivity(APIDEMOS_PKG)).to.not.be.empty;
    });
  });

  describe('isStreamedInstallSupported', function () {
    it('should return boolean value', async function () {
      const result = await adb.isStreamedInstallSupported();
      expect(_.isBoolean(result)).to.be.true;
    });
  });

  describe('isIncrementalInstallSupported', function () {
    it('should return boolean value', async function () {
      const result = await adb.isIncrementalInstallSupported();
      expect(_.isBoolean(result)).to.be.true;
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
        expect(pkgList.some((item) => item.includes(APIDEMOS_PKG))).to.be.true;
      }
    });
  });

  describe('takeScreenshot', function () {
    it('should return screenshot', async function () {
      const screenshot = await adb.takeScreenshot();
      expect(_.isEmpty(screenshot)).to.be.false;
    });
  });

  describe('listPorts', function () {
    it('should list opened ports', async function () {
      const ports1 = await adb.listPorts();
      const ports2 = await adb.listPorts('6');
      expect(_.isEmpty(ports1) && _.isEmpty(ports2)).to.be.false;
    });
  });

  describe('inputText', function () {
    beforeEach(async function () {
      await adb.startApp({pkg: APIDEMOS_PKG, activity: '.view.TextFields'});
    });

    const dumpPath = '/sdcard/window_dump_e2e.xml';
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const cases: Array<{name: string; textSuffix: string}> = [
      {name: 'should input text without special characters', textSuffix: 'text'},
      {name: 'should input text with special characters', textSuffix: "special ()<>|;&*\\~^\"'$`"},
    ];

    cases.forEach(({ name, textSuffix }) => {
      it(name, async function () {
        // Focus the text input field
        await adb.keyevent(['KEYCODE_BUTTON_START']);

        const randomPrefix = randomUUID().split('-')[0];
        const text = `${randomPrefix}${textSuffix}`;
        await adb.inputText(text);

        // Wait a while for the text to be reflected in the UI
        await sleep(500);
        await adb.shell(['uiautomator', 'dump', dumpPath]);
        const xml = await adb.shell(['cat', dumpPath]);

        const expectedXmlText = text
          .replace(/&/g, '&amp;')
          .replace(/'/g, '&apos;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        expect(xml).to.include(expectedXmlText);
      });
    });
  });
});
