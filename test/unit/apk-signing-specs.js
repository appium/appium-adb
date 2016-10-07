import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import * as helpers from '../../lib/helpers.js';
import path from 'path';
import * as teen_process from 'teen_process';
import * as appiumSupport from 'appium-support';
import { withMocks } from 'appium-test-support';


chai.use(chaiAsPromised);

const selendroidTestApp = path.resolve(helpers.rootDir, 'test', 'fixtures',
                                       'selendroid-test-app.apk'),
      helperJarPath = path.resolve(helpers.rootDir, 'jars'),
      keystorePath = path.resolve(helpers.rootDir, 'test', 'fixtures',
                                  'appiumtest.keystore'),
      keyAlias = 'appiumtest',
      password = 'android',
      selendroidTestAppPackage = 'io.selendroid.testapp',
      java_dummy_path = 'java_dummy_path',
      java_home = 'java_home',
      tempDir = appiumSupport.tempDir,
      fs = appiumSupport.fs;

describe('signing', () => {
  let adb = new ADB();
  adb.keystorePath = keystorePath;
  adb.keyAlias = keyAlias;
  adb.keystorePassword = password;
  adb.keyPassword = password;

  describe('signWithDefaultCert', withMocks({teen_process, helpers}, (mocks) => {
    it('should call exec with correct args', async () => {
      let signPath = path.resolve(helperJarPath, 'sign.jar');
      mocks.helpers.expects("getJavaForOs")
        .returns(java_dummy_path);
      mocks.teen_process.expects("exec")
        .once().withExactArgs(java_dummy_path, ['-jar', signPath, selendroidTestApp, '--override'])
        .returns("");
      (await adb.signWithDefaultCert(selendroidTestApp));
      mocks.teen_process.verify();
    });
    it('should throw error for invalid file path', async () => {
      let dummyPath = "dummyPath";
      await adb.signWithDefaultCert(dummyPath).should.eventually.be.rejected;
      mocks.teen_process.verify();
      mocks.helpers.verify();
    });
  }));
  describe('signWithCustomCert', withMocks({teen_process, helpers}, (mocks) => {
    it('should call exec with correct args', async () => {
      let jarsigner = path.resolve(java_home, 'bin', 'jarsigner');
      if (appiumSupport.system.isWindows()) {
        jarsigner = jarsigner + '.exe';
      }
      adb.useKeystore = true;
      mocks.helpers.expects("getJavaHome")
        .returns(java_home);
      mocks.helpers.expects("getJavaForOs")
        .returns(java_dummy_path);
      mocks.teen_process.expects("exec")
        .withExactArgs(java_dummy_path, ['-jar', path.resolve(helperJarPath, 'unsign.jar'), selendroidTestApp])
        .returns("");
      mocks.teen_process.expects("exec")
        .withExactArgs(jarsigner, ['-sigalg', 'MD5withRSA', '-digestalg', 'SHA1',
                                   '-keystore', keystorePath, '-storepass', password,
                                   '-keypass', password, selendroidTestApp, keyAlias])
        .returns("");
      (await adb.signWithCustomCert(selendroidTestApp));
      mocks.teen_process.verify();
      mocks.helpers.verify();
    });
  }));
  describe('getKeystoreMd5', withMocks({teen_process}, (mocks) => {
    it('should call exec with correct args', async () => {
      let h = "a-fA-F0-9";
      let keytool = path.resolve(java_home, 'bin', 'keytool');
      let md5Str = ['.*MD5.*((?:[', h, ']{2}:){15}[', h, ']{2})'].join('');
      let md5 = new RegExp(md5Str, 'mi');
      adb.useKeystore = true;
      mocks.teen_process.expects("exec")
        .once().withExactArgs(keytool, ['-v', '-list', '-alias', keyAlias,
                                        '-keystore', keystorePath, '-storepass',
                                        password])
        .returns("");
      (await adb.getKeystoreMd5(keytool, md5));
      mocks.teen_process.verify();
    });
  }));
  // Skipping as unable to mock mkdirp, this case is covered in e2e tests for now.
  // TODO: find ways to mock mkdirp
  describe.skip('zipAlignApk', withMocks({teen_process, adb, appiumSupport, fs, tempDir}, (mocks) => {
    it('should call exec with correct args', async () => {
      let alignedApk = "dummy_path";
      mocks.tempDir.expects('path')
        .once().withExactArgs({prefix: 'appium', suffix: '.tmp'})
        .returns(alignedApk);
      mocks.adb.expects('initZipAlign')
        .once().withExactArgs()
        .returns("");
      mocks.appiumSupport.expects('mkdirp')
        .once().withExactArgs(path.dirname(alignedApk))
        .returns("");
      mocks.teen_process.expects("exec")
        .once().withExactArgs(adb.binaries.zipalign, ['-f', '4', selendroidTestApp,
                                                      alignedApk]);
      mocks.fs.expects("mv")
        .once().withExactArgs(alignedApk, selendroidTestApp, { mkdirp: true })
        .returns("");
      await adb.zipAlignApk(selendroidTestApp);
      mocks.adb.verify();
      mocks.appiumSupport.verify();
      mocks.teen_process.verify();
      mocks.tempDir.verify();
      mocks.fs.verify();
    });
  }));
  describe('checkApkCert', withMocks({teen_process, helpers, adb}, (mocks) => {
    it('should return false for apk not present', async () => {
      mocks.helpers.expects("getJavaForOs")
        .returns(java_dummy_path);
      (await adb.checkApkCert('dummyPath', 'dummyPackage')).should.be.false;
      mocks.helpers.verify();
    });
    it('should call exec and zipAlign when not using keystore', async () => {
      mocks.helpers.expects("getJavaForOs")
           .returns(java_dummy_path);
      mocks.teen_process.expects("exec")
           .once().withExactArgs(java_dummy_path, ['-jar', path.resolve(helperJarPath, 'verify.jar'),
                                        selendroidTestApp])
           .returns("");
      mocks.adb.expects('zipAlignApk')
           .once().withExactArgs(selendroidTestApp)
           .returns("");
      adb.useKeystore = false;
      await adb.checkApkCert(selendroidTestApp, selendroidTestAppPackage);
      mocks.adb.verify();
      mocks.teen_process.verify();
      mocks.helpers.verify();
    });
    it('should call checkCustomApkCert when using keystore', async () => {
      mocks.helpers.expects("getJavaForOs")
           .returns(java_dummy_path);
      mocks.adb.expects('checkCustomApkCert')
           .once().withExactArgs(selendroidTestApp, selendroidTestAppPackage)
           .returns("");
      adb.useKeystore = true;
      await adb.checkApkCert(selendroidTestApp, selendroidTestAppPackage);
      mocks.adb.verify();
      mocks.helpers.verify();
    });
  }));
});
