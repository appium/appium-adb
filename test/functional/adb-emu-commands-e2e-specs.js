import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import path from 'path';
import { rootDir } from '../../lib/helpers.js';
import { sleep } from 'asyncbox';

chai.use(chaiAsPromised);
chai.should();
const fingerprintPath = path.resolve(rootDir, 'test', 'fixtures', 'Fingerprint.apk'),
  pkg = 'com.example.fingerprint',
  activity = '.MainActivity',
  secretActivity = '.SecretActivity';
  
describe('adb emu commands', () => {
  let adb;
  before(async () => {
    adb = await ADB.createADB();
  });
  it('fingerprint should open the secret activity on emitted valid finger touch event', async () => {
    if(await adb.isAppInstalled(pkg)) {
      await adb.forceStop(pkg);
      await adb.uninstallApk(pkg);
    }
    await adb.install(fingerprintPath);
    await adb.startApp({pkg, activity});
    await sleep(500);
    let app = await adb.getFocusedPackageAndActivity();
    app.appActivity.should.equal(activity);
    await adb.fingerprint(1111);
    await sleep(1500);
    app = await adb.getFocusedPackageAndActivity();
    app.appActivity.should.equal(secretActivity);
  });
});