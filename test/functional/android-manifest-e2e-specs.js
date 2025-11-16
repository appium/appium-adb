import {ADB} from '../../lib/adb';
import path from 'path';
import { fs, tempDir } from '@appium/support';
import { CONTACT_MANAGER_PKG, CONTACT_MANAGER_PATH, getApiDemosPath } from './setup';
import {
  requireSdkRoot,
  readPackageManifest,
} from '../../lib/helpers.js';
import { getAndroidPlatformAndPath } from '../../lib/tools/android-manifest';

describe('Android-manifest', function () {
  let adb;
  let expect;
  let apiDemosPath;

  before(async function () {
    const chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.use(chaiAsPromised.default);
    expect = chai.expect;

    adb = await ADB.createADB();
    apiDemosPath = await getApiDemosPath();
  });
  it('packageAndLaunchActivityFromManifest should parse package and Activity', async function () {
    const {apkPackage, apkActivity} = await adb.packageAndLaunchActivityFromManifest(CONTACT_MANAGER_PATH);
    expect(apkPackage).to.equal(CONTACT_MANAGER_PKG);
    expect(apkActivity.endsWith('.ContactManager')).to.be.true;
  });
  it('hasInternetPermissionFromManifest should be true', async function () {
    expect(await adb.hasInternetPermissionFromManifest(apiDemosPath)).to.be.true;
  });
  it('hasInternetPermissionFromManifest should be false', async function () {
    expect(await adb.hasInternetPermissionFromManifest(CONTACT_MANAGER_PATH)).to.be.false;
  });

  it('should compile and insert manifest', async function () {
    const tmpDir = await tempDir.openDir();
    try {
      const appPackage = CONTACT_MANAGER_PKG;
      const newPackage = `${appPackage}.test`;
      const dstDir = path.resolve(tmpDir, appPackage);
      const dstManifest = path.resolve(dstDir, 'AndroidManifest.xml');
      const newServerPath = path.resolve(tmpDir, `test.${appPackage}.apk`);

      // Create a temporary copy of the source APK to avoid modifying the original fixture
      const srcApkCopy = path.resolve(tmpDir, path.basename(CONTACT_MANAGER_PATH));
      await fs.copyFile(CONTACT_MANAGER_PATH, srcApkCopy);

      // Create a simple AndroidManifest.xml template
      const manifestContent = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    android:versionCode="1"
    android:versionName="1.0"
    package="${newPackage}">
    <uses-sdk android:minSdkVersion="17" />
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:label="TestApp">
        <activity android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;

      await fs.mkdir(dstDir);
      await fs.writeFile(dstManifest, manifestContent, 'utf8');

      // Compile the manifest
      await adb.compileManifest(dstManifest, newPackage, appPackage);
      expect(await fs.exists(dstManifest)).to.be.true;
      expect(await fs.exists(`${dstManifest}.apk`)).to.be.true;

      // Insert the compiled manifest into the temporary copy of the source APK
      await adb.insertManifest(dstManifest, srcApkCopy, newServerPath);
      expect(await fs.exists(newServerPath)).to.be.true;

      // Verify the new APK has the updated manifest
      const {name: packageName} = await readPackageManifest.bind(adb)(newServerPath);
      expect(packageName).to.equal(newPackage);
    } finally {
      await fs.rimraf(tmpDir);
    }
  });

  it('getAndroidPlatformAndPath should return platform and path for android', async function () {
    const sdkRoot = await requireSdkRoot();
    const {platform, platformPath} = await getAndroidPlatformAndPath(sdkRoot);
    expect(platform).to.exist;
    expect(platformPath).to.exist;
  });

  it('should read package manifest', async function () {
    const expected = {
      name: 'io.appium.android.apis',
      versionCode: 26,
      minSdkVersion: 26,
      compileSdkVersion: 33,
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
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.RECORD_AUDIO',
        'android.permission.CAMERA',
        'io.appium.android.apis.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
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
      versionName: '6.0.0',
      platformBuildVersionName: '13',
      platformBuildVersionCode: 33,
      compileSdkVersionCodename: '13',
      targetSdkVersion: 33,
    };

    const adb = await ADB.createADB();
    const manifest = await readPackageManifest.bind(adb)(apiDemosPath);
    expect(manifest).to.eql(expected);
  });
});
