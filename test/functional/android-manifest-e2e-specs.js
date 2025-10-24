import {ADB} from '../../lib/adb';
import path from 'path';
import { fs } from '@appium/support';
import { CONTACT_MANAGER_PKG, CONTACT_MANAGER_PATH } from './setup';
import {
  requireSdkRoot,
  readPackageManifest,
} from '../../lib/helpers.js';
import { getAndroidPlatformAndPath } from '../../lib/tools/android-manifest';


// All paths below assume tests run under /build/test/ so paths are relative from
// that directory.
const contactMangerSelendroidPath = path.resolve(__dirname, '..', 'fixtures', 'ContactManager-selendroid.apk');
const tmpDir = path.resolve(__dirname, '..', 'temp');
const srcManifest = path.resolve(__dirname, '..', 'fixtures', 'selendroid', 'AndroidManifest.xml');
const serverPath = path.resolve(__dirname, '..', 'fixtures', 'selendroid', 'selendroid.apk');

describe('Android-manifest', function () {
  let adb;
  let chai;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.should();
    chai.use(chaiAsPromised.default);

    adb = await ADB.createADB();
  });
  it('packageAndLaunchActivityFromManifest should parse package and Activity', async function () {
    let {apkPackage, apkActivity} = await adb.packageAndLaunchActivityFromManifest(CONTACT_MANAGER_PATH);
    apkPackage.should.equal(CONTACT_MANAGER_PKG);
    apkActivity.endsWith('.ContactManager').should.be.true;
  });
  it('hasInternetPermissionFromManifest should be true', async function () {
    let flag = await adb.hasInternetPermissionFromManifest(contactMangerSelendroidPath);
    flag.should.be.true;
  });
  it('hasInternetPermissionFromManifest should be false', async function () {
    let flag = await adb.hasInternetPermissionFromManifest(CONTACT_MANAGER_PATH);
    flag.should.be.false;
  });
  // TODO fix this test
  it.skip('should compile and insert manifest', async function () {
    let appPackage = CONTACT_MANAGER_PKG,
        newServerPath = path.resolve(tmpDir, `selendroid.${appPackage}.apk`),
        newPackage = 'com.example.android.contactmanager.selendroid',
        dstDir = path.resolve(tmpDir, appPackage),
        dstManifest = path.resolve(dstDir, 'AndroidManifest.xml');
    // deleting temp directory if present
    try {
      await fs.rimraf(tmpDir);
    } catch (e) {
      console.log(`Unable to delete temp directory. It might not be present. ${e.message}`); // eslint-disable-line no-console
    }
    await fs.mkdir(tmpDir);
    await fs.mkdir(dstDir);
    await fs.writeFile(dstManifest, await fs.readFile(srcManifest, 'utf8'), 'utf8');
    await adb.compileManifest(dstManifest, newPackage, appPackage);
    (await fs.fileExists(dstManifest)).should.be.true;
    await adb.insertManifest(dstManifest, serverPath, newServerPath);
    (await fs.fileExists(newServerPath)).should.be.true;
    // deleting temp directory
    try {
      await fs.rimraf(tmpDir);
    } catch (e) {
      console.log(`Unable to delete temp directory. It might not be present. ${e.message}`); // eslint-disable-line no-console
    }
  });

  it('getAndroidPlatformAndPath should return platform and path for android', async function () {
    const sdkRoot = await requireSdkRoot();
    const {platform, platformPath} = await getAndroidPlatformAndPath(sdkRoot);
    platform.should.exist;
    platformPath.should.exist;
  });

  it('should read package manifest', async function () {
    const expected = {
      name: 'io.appium.android.apis',
      versionCode: 24,
      minSdkVersion: 17,
      compileSdkVersion: 31,
      usesPermissions: [
        'android.permission.READ_CONTACTS',
        'android.permission.WRITE_CONTACTS',
        'android.permission.VIBRATE',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.INTERNET',
        'android.permission.SET_WALLPAPER',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.SEND_SMS',
        'android.permission.RECEIVE_SMS',
        'android.permission.NFC',
        'android.permission.RECORD_AUDIO',
        'android.permission.CAMERA',
        'android.permission.READ_EXTERNAL_STORAGE'
      ],
      launchableActivity: {
        'name': 'io.appium.android.apis.ApiDemos',
      },
      architectures: [],
      locales: [
        '--_--',
        'af',
        'am',
        'ar',
        'as',
        'az',
        'be',
        'bg',
        'bn',
        'bs',
        'ca',
        'cs',
        'da',
        'de',
        'el',
        'en-AU',
        'en-CA',
        'en-GB',
        'en-IN',
        'en-XC',
        'es',
        'es-US',
        'et',
        'eu',
        'fa',
        'fi',
        'fr',
        'fr-CA',
        'gl',
        'gu',
        'hi',
        'hr',
        'hu',
        'hy',
        'in',
        'is',
        'it',
        'iw',
        'ja',
        'ka',
        'kk',
        'km',
        'kn',
        'ko',
        'ky',
        'lo',
        'lt',
        'lv',
        'mk',
        'ml',
        'mn',
        'mr',
        'ms',
        'my',
        'nb',
        'ne',
        'nl',
        'or',
        'pa',
        'pl',
        'pt',
        'pt-BR',
        'pt-PT',
        'ro',
        'ru',
        'si',
        'sk',
        'sl',
        'sq',
        'sr',
        'sr-Latn',
        'sv',
        'sw',
        'ta',
        'te',
        'th',
        'tl',
        'tr',
        'uk',
        'ur',
        'uz',
        'vi',
        'zh-CN',
        'zh-HK',
        'zh-TW',
        'zu'
      ],
      densities: [
        120,
        160,
        240,
        320,
        480,
        640,
        65535
      ],
      versionName: '4.1.1',
      platformBuildVersionName: '12',
      platformBuildVersionCode: 31,
      compileSdkVersionCodename: '12',
      targetSdkVersion: 31,
    };

    const adb = await ADB.createADB();
    const apiDemosPath = path.resolve(__dirname, '..', 'fixtures', 'ApiDemos-debug.apk');
    const manifest = await readPackageManifest.bind(adb)(apiDemosPath);
    expected.should.eql(manifest);
  });
});
