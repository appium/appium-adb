import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import path from 'path';
import { rootDir } from '../../lib/helpers.js';
import { sleep } from 'asyncbox';


chai.use(chaiAsPromised);
chai.should();

const fingerprintPath = path.resolve(rootDir, 'test', 'fixtures', 'Fingerprint.apk');
const pkg = 'com.example.fingerprint';
const activity = '.MainActivity';
const secretActivity = '.SecretActivity';

describe('adb emu commands', function () {
  let adb;
  before(async function () {
    adb = await ADB.createADB();

    // the test here only works if we have API level 23 or above
    // it will also fail on emulators
    if (await adb.getApiLevel() < 23 || !process.env.REAL_DEVICE) {
      return this.skip();
    }
  });
  it('fingerprint should open the secret activity on emitted valid finger touch event', async function () {
    if (await adb.isAppInstalled(pkg)) {
      await adb.forceStop(pkg);
      await adb.uninstallApk(pkg);
    }
    await adb.install(fingerprintPath);
    await adb.startApp({pkg, activity});
    await sleep(500);

    let app = await adb.getFocusedPackageAndActivity();
    app.appActivity.should.equal(activity);
    await adb.fingerprint(1111);
    await sleep(2500);

    app = await adb.getFocusedPackageAndActivity();
    app.appActivity.should.equal(secretActivity);
  });

  describe('execEmuConsoleCommand', function () {
    it('should print name', async function () {
      const name = await adb.execEmuConsoleCommand(['avd', 'name']);
      name.should.not.be.empty;
    });

    it('should fail if the command is unknown', async function () {
      await adb.execEmuConsoleCommand(['avd', 'namer']).should.eventually
        .be.rejected;
    });
  });

  describe('getEmuVersionInfo', function () {
    it('should get version info', async function () {
      const {revision, buildId} = await adb.getEmuVersionInfo();
      revision.should.not.be.empty;
      (buildId > 0).should.be.true;
    });
  });

  describe('getEmuImageProperties', function () {
    it('should get emulator image properties', async function () {
      const name = await adb.execEmuConsoleCommand(['avd', 'name']);
      const {target} = await adb.getEmuImageProperties(name);
      const apiMatch = /\d+/.exec(target);
      (parseInt(apiMatch[0], 10) > 0).should.be.true;
    });
  });
});
