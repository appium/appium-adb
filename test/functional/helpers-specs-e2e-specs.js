import {
  getAndroidPlatformAndPath,
  requireSdkRoot,
  readPackageManifest,
} from '../../lib/helpers.js';
// eslint-disable-next-line import/no-unresolved
import {ADB} from '../../lib/adb';
import path from 'node:path';

describe('Helpers', function () {
  let chai;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.should();
    chai.use(chaiAsPromised.default);
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
      sdkVersion: 0,
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
