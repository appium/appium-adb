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

describe('adb emu commands', () => {
  let adb;
  before(async function () {
    adb = await ADB.createADB();

    // the test here only works if we have API level 23 or above
    // it will also fail on emulators
    if (await adb.getApiLevel() < 23 || !process.env.REAL_DEVICE) {
      this.skip();
    }
  });
  it('fingerprint should open the secret activity on emitted valid finger touch event', async () => {
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
});
