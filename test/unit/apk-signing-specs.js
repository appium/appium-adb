import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import * as helpers from '../../lib/helpers.js';
import path from 'path';
import * as teen_process from 'teen_process';
import * as appiumSupport from 'appium-support';
import { withMocks } from 'appium-test-support';


chai.use(chaiAsPromised);

const selendroidTestApp = path.resolve(helpers.rootDir, 'test', 'fixtures', 'selendroid-test-app.apk'),
      keystorePath = path.resolve(helpers.rootDir, 'test', 'fixtures', 'appiumtest.keystore'),
      defaultKeyPath = path.resolve(helpers.rootDir, 'keys', 'testkey.pk8'),
      defaultCertPath = path.resolve(helpers.rootDir, 'keys', 'testkey.x509.pem'),
      keyAlias = 'appiumtest',
      password = 'android',
      selendroidTestAppPackage = 'io.selendroid.testapp',
      javaDummyPath = 'java_dummy_path',
      javaHome = 'java_home',
      apksignerDummyPath = '/path/to/apksigner',
      tempDir = appiumSupport.tempDir,
      fs = appiumSupport.fs;

const adb = new ADB();
adb.keystorePath = keystorePath;
adb.keyAlias = keyAlias;
adb.keystorePassword = password;
adb.keyPassword = password;

describe('signing', withMocks({teen_process, helpers, adb, appiumSupport, fs, tempDir}, function (mocks) {
  afterEach(function () {
    mocks.verify();
  });

  describe('signWithDefaultCert', function () {
    it('should call exec with correct args', async function () {
      mocks.helpers.expects('getApksignerForOs')
        .returns(apksignerDummyPath);
      mocks.adb.expects('executeApksigner')
        .once().withExactArgs(['sign',
          '--key', defaultKeyPath,
          '--cert', defaultCertPath,
          selendroidTestApp
        ]).returns('');
      await adb.signWithDefaultCert(selendroidTestApp);
    });

    it('should fail if apksigner fails', async function () {
      mocks.helpers.expects('getApksignerForOs')
        .returns(apksignerDummyPath);
      mocks.adb.expects('executeApksigner')
        .once().withExactArgs(['sign',
          '--key', defaultKeyPath,
          '--cert', defaultCertPath,
          selendroidTestApp
        ]).throws();
      mocks.helpers.expects('getJavaForOs')
        .once().returns(javaDummyPath);
      await adb.signWithDefaultCert(selendroidTestApp).should.eventually.be.rejected;
    });

    it('should throw error for invalid file path', async function () {
      let dummyPath = 'dummyPath';
      await adb.signWithDefaultCert(dummyPath).should.eventually.be.rejected;
    });
  });

  describe('signWithCustomCert', function () {
    it('should call exec with correct args', async function () {
      adb.useKeystore = true;

      mocks.helpers.expects('getApksignerForOs')
        .returns(apksignerDummyPath);
      mocks.adb.expects('executeApksigner')
        .withExactArgs(['sign',
          '--ks', keystorePath,
          '--ks-key-alias', keyAlias,
          '--ks-pass', `pass:${password}`,
          '--key-pass', `pass:${password}`,
          selendroidTestApp
        ]).returns('');
      await adb.signWithCustomCert(selendroidTestApp);
    });

    it('should fallback to jarsigner if apksigner fails', async function () {
      let jarsigner = path.resolve(javaHome, 'bin', 'jarsigner');
      if (appiumSupport.system.isWindows()) {
        jarsigner = jarsigner + '.exe';
      }
      adb.useKeystore = true;

      mocks.helpers.expects('getApksignerForOs')
        .returns(apksignerDummyPath);
      mocks.adb.expects('executeApksigner')
        .once().withExactArgs(['sign',
          '--ks', keystorePath,
          '--ks-key-alias', keyAlias,
          '--ks-pass', `pass:${password}`,
          '--key-pass', `pass:${password}`,
          selendroidTestApp
        ]).throws();
      mocks.teen_process.expects('exec')
        .once().withExactArgs(jarsigner, [
          '-sigalg', 'MD5withRSA',
          '-digestalg', 'SHA1',
          '-keystore', keystorePath,
          '-storepass', password,
          '-keypass', password,
          selendroidTestApp, keyAlias])
        .returns({});
      mocks.helpers.expects('getJavaHome')
        .returns(javaHome);
      mocks.helpers.expects('unsignApk')
        .withExactArgs(selendroidTestApp)
        .returns(true);
      await adb.signWithCustomCert(selendroidTestApp);
    });
  });

  // Skipping as unable to mock mkdirp, this case is covered in e2e tests for now.
  // TODO: find ways to mock mkdirp
  describe.skip('zipAlignApk', function () {
    it('should call exec with correct args', async function () {
      let alignedApk = 'dummy_path';
      mocks.tempDir.expects('path')
        .once().withExactArgs({prefix: 'appium', suffix: '.tmp'})
        .returns(alignedApk);
      mocks.adb.expects('initZipAlign')
        .once().withExactArgs()
        .returns('');
      mocks.appiumSupport.expects('mkdirp')
        .once().withExactArgs(path.dirname(alignedApk))
        .returns({});
      mocks.teen_process.expects('exec')
        .once().withExactArgs(adb.binaries.zipalign, ['-f', '4', selendroidTestApp, alignedApk]);
      mocks.fs.expects('mv')
        .once().withExactArgs(alignedApk, selendroidTestApp, { mkdirp: true })
        .returns('');
      await adb.zipAlignApk(selendroidTestApp);
    });
  });

  describe('checkApkCert', function () {
    it('should return false for apk not present', async function () {
      (await adb.checkApkCert('dummyPath', 'dummyPackage')).should.be.false;
    });

    it('should check default signature when not using keystore', async function () {
      adb.useKeystore = false;

      mocks.helpers.expects('getApksignerForOs')
        .once().returns(apksignerDummyPath);
      mocks.adb.expects('executeApksigner')
        .once().withExactArgs(['verify', '--print-certs', selendroidTestApp])
        .returns(`
          Signer #1 certificate DN: EMAILADDRESS=android@android.com, CN=Android, OU=Android, O=Android, L=Mountain View, ST=California, C=US
          Signer #1 certificate SHA-256 digest: a40da80a59d170caa950cf15c18c454d47a39b26989d8b640ecd745ba71bf5dc
          Signer #1 certificate SHA-1 digest: 61ed377e85d386a8dfee6b864bd85b0bfaa5af81
          Signer #1 certificate MD5 digest: e89b158e4bcf988ebd09eb83f5378e87`);
      (await adb.checkApkCert(selendroidTestApp, selendroidTestAppPackage)).should.be.true;
    });

    it('should check non default signature when not using keystore', async function () {
      adb.useKeystore = false;

      mocks.helpers.expects('getApksignerForOs')
        .once().returns(apksignerDummyPath);
      mocks.adb.expects('executeApksigner')
        .once().withExactArgs(['verify', '--print-certs', selendroidTestApp])
        .returns(`
          Signer #1 certificate DN: EMAILADDRESS=android@android.com, CN=Android, OU=Android, O=Android, L=Mountain View, ST=California, C=US
          Signer #1 certificate SHA-256 digest: a40da80a59d170caa950cf15cccccc4d47a39b26989d8b640ecd745ba71bf5dc
          Signer #1 certificate SHA-1 digest: 61ed377e85d386a8dfee6b864bdcccccfaa5af81
          Signer #1 certificate MD5 digest: e89b158e4bcf988ebd09eb83f53ccccc`);
      (await adb.checkApkCert(selendroidTestApp, selendroidTestAppPackage, {
        requireDefaultCert: false,
      })).should.be.true;
    });

    it('should fail if apksigner is not found', async function () {
      adb.useKeystore = false;

      mocks.helpers.expects('getApksignerForOs')
        .throws();
      mocks.helpers.expects('getJavaForOs')
        .returns(javaDummyPath);
      await adb.checkApkCert(selendroidTestApp, selendroidTestAppPackage)
        .should.eventually.be.rejected;
    });

    it('should call getKeystoreHash when using keystore', async function () {
      adb.useKeystore = true;

      mocks.adb.expects('getKeystoreHash')
        .once().returns({
          'md5': 'e89b158e4bcf988ebd09eb83f53ccccc',
          'sha1': '61ed377e85d386a8dfee6b864bdcccccfaa5af81',
          'sha256': 'a40da80a59d170caa950cf15cccccc4d47a39b26989d8b640ecd745ba71bf5dc',
        });
      mocks.helpers.expects('getApksignerForOs')
        .once().returns(apksignerDummyPath);
      mocks.adb.expects('executeApksigner')
        .once().withExactArgs(['verify', '--print-certs', selendroidTestApp])
        .returns(`
          Signer #1 certificate DN: EMAILADDRESS=android@android.com, CN=Android, OU=Android, O=Android, L=Mountain View, ST=California, C=US
          Signer #1 certificate SHA-256 digest: a40da80a59d170caa950cf15cccccc4d47a39b26989d8b640ecd745ba71bf5dc
          Signer #1 certificate SHA-1 digest: 61ed377e85d386a8dfee6b864bdcccccfaa5af81
          Signer #1 certificate MD5 digest: e89b158e4bcf988ebd09eb83f53ccccc`);
      await adb.checkApkCert(selendroidTestApp, selendroidTestAppPackage).should.eventually.be.true;
    });
  });
}));
