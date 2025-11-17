import {ADB} from '../../lib/adb';
import * as helpers from '../../lib/helpers.js';
import path from 'path';
import * as teen_process from 'teen_process';
import * as appiumSupport from '@appium/support';
import { withMocks } from '@appium/test-support';
import * as apkSigningHelpers from '../../lib/tools/apk-signing';
import { APIDEMOS_PATH, APIDEMOS_PKG } from '../constants.js';

const apiDemosPath = APIDEMOS_PATH;
const keystorePath = path.resolve(__dirname, '..', 'fixtures', 'appiumtest.keystore');
const defaultKeyPath = path.resolve(__dirname, '..', '..', 'keys', 'testkey.pk8');
const defaultCertPath = path.resolve(__dirname, '..', '..', 'keys', 'testkey.x509.pem');
const keyAlias = 'appiumtest';
const password = 'android';
const apiDemosPackage = APIDEMOS_PKG;
const javaDummyPath = 'java_dummy_path';
const javaHome = 'java_home';
const apksignerDummyPath = '/path/to/apksigner';
const tempDir = appiumSupport.tempDir;
const fs = appiumSupport.fs;

const adb = new ADB();
adb.keystorePath = keystorePath;
adb.keyAlias = keyAlias;
adb.keystorePassword = password;
adb.keyPassword = password;

describe('signing', withMocks({
  teen_process,
  helpers,
  adb,
  appiumSupport,
  fs,
  tempDir,
  apkSigningHelpers,
}, function (mocks) {
  let chai;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.should();
    chai.use(chaiAsPromised.default);
  });

  afterEach(function () {
    mocks.verify();
  });

  describe('signWithDefaultCert', function () {
    it('should call exec with correct args', async function () {
      mocks.fs.expects('exists')
        .once().withExactArgs(apiDemosPath)
        .returns(true);
      mocks.helpers.expects('getResourcePath')
        .once().withExactArgs(path.join('keys', 'testkey.pk8'))
        .returns(defaultKeyPath);
      mocks.helpers.expects('getResourcePath')
        .once().withExactArgs(path.join('keys', 'testkey.x509.pem'))
        .returns(defaultCertPath);
      mocks.apkSigningHelpers.expects('getApksignerForOs')
        .returns(apksignerDummyPath);
      mocks.adb.expects('executeApksigner')
        .once().withExactArgs(['sign',
          '--key', defaultKeyPath,
          '--cert', defaultCertPath,
          apiDemosPath
        ]).returns('');
      await adb.signWithDefaultCert(apiDemosPath);
    });

    it('should fail if apksigner fails', async function () {
      mocks.apkSigningHelpers.expects('getApksignerForOs')
        .returns(apksignerDummyPath);
      mocks.adb.expects('executeApksigner')
        .once().withExactArgs(['sign',
          '--key', defaultKeyPath,
          '--cert', defaultCertPath,
          apiDemosPath
        ]).throws();
      mocks.helpers.expects('getJavaForOs')
        .once().returns(javaDummyPath);
      await adb.signWithDefaultCert(apiDemosPath).should.eventually.be.rejected;
    });

    it('should throw error for invalid file path', async function () {
      let dummyPath = 'dummyPath';
      await adb.signWithDefaultCert(dummyPath).should.eventually.be.rejected;
    });
  });

  describe('signWithCustomCert', function () {
    it('should call exec with correct args', async function () {
      adb.useKeystore = true;

      mocks.fs.expects('exists')
        .once().withExactArgs(keystorePath)
        .returns(true);
      mocks.fs.expects('exists')
        .once().withExactArgs(apiDemosPath)
        .returns(true);
      mocks.apkSigningHelpers.expects('getApksignerForOs')
        .returns(apksignerDummyPath);
      mocks.adb.expects('executeApksigner')
        .withExactArgs(['sign',
          '--ks', keystorePath,
          '--ks-key-alias', keyAlias,
          '--ks-pass', `pass:${password}`,
          '--key-pass', `pass:${password}`,
          apiDemosPath
        ]).returns('');
      await adb.signWithCustomCert(apiDemosPath);
    });

    it('should fallback to jarsigner if apksigner fails', async function () {
      let jarsigner = path.resolve(javaHome, 'bin', 'jarsigner');
      if (appiumSupport.system.isWindows()) {
        jarsigner = jarsigner + '.exe';
      }
      adb.useKeystore = true;

      mocks.fs.expects('exists')
        .once().withExactArgs(keystorePath)
        .returns(true);
      mocks.fs.expects('exists')
        .once().withExactArgs(apiDemosPath)
        .returns(true);
      mocks.apkSigningHelpers.expects('getApksignerForOs')
        .returns(apksignerDummyPath);
      mocks.adb.expects('executeApksigner')
        .once().withExactArgs(['sign',
          '--ks', keystorePath,
          '--ks-key-alias', keyAlias,
          '--ks-pass', `pass:${password}`,
          '--key-pass', `pass:${password}`,
          apiDemosPath
        ]).throws();
      mocks.teen_process.expects('exec')
        .once().withExactArgs(jarsigner, [
          '-sigalg', 'MD5withRSA',
          '-digestalg', 'SHA1',
          '-keystore', keystorePath,
          '-storepass', password,
          '-keypass', password,
          apiDemosPath, keyAlias],
          { windowsVerbatimArguments: appiumSupport.system.isWindows() })
        .returns({});
      mocks.helpers.expects('getJavaHome')
        .returns(javaHome);
      // Mock unsignApk's dependencies: tempDir and zip operations
      mocks.tempDir.expects('openDir')
        .returns('/tmp/dummy');
      // Mock zip.readEntries to indicate no META-INF (so unsignApk returns false)
      const zipMock = {
        readEntries: async function (apkPath, callback) {
          // Call callback with a non-META-INF entry so hasMetaInf stays false
          callback({entry: {fileName: 'AndroidManifest.xml'}});
        }
      };
      // Replace zip in appiumSupport for this test
      const originalZip = appiumSupport.zip;
      appiumSupport.zip = zipMock;
      try {
        await adb.signWithCustomCert(apiDemosPath);
      } finally {
        appiumSupport.zip = originalZip;
      }
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
        .once().withExactArgs(adb.binaries.zipalign, ['-f', '4', apiDemosPath, alignedApk]);
      mocks.fs.expects('mv')
        .once().withExactArgs(alignedApk, apiDemosPath, { mkdirp: true })
        .returns('');
      await adb.zipAlignApk(apiDemosPath);
    });
  });

  describe('checkApkCert', function () {
    beforeEach(function () {
      mocks.fs.expects('hash')
        .returns(Math.random().toString(36));
    });

    it('should return false for apk not present', async function () {
      (await adb.checkApkCert('dummyPath', 'dummyPackage')).should.be.false;
    });

    it('should check default signature when not using keystore', async function () {
      adb.useKeystore = false;

      mocks.fs.expects('exists')
        .once().withExactArgs(apiDemosPath)
        .returns(true);
      mocks.fs.expects('exists')
        .once() // For apksigner.jar existence check in getBinaryFromSdkRoot
        .returns(true);
      mocks.adb.expects('getBinaryFromSdkRoot')
        .once().withExactArgs('apksigner.jar')
        .returns(apksignerDummyPath);
      mocks.adb.expects('executeApksigner')
        .once().withExactArgs(['verify', '--print-certs', apiDemosPath])
        .returns(`
          Signer #1 certificate DN: EMAILADDRESS=android@android.com, CN=Android, OU=Android, O=Android, L=Mountain View, ST=California, C=US
          Signer #1 certificate SHA-256 digest: a40da80a59d170caa950cf15c18c454d47a39b26989d8b640ecd745ba71bf5dc
          Signer #1 certificate SHA-1 digest: 61ed377e85d386a8dfee6b864bd85b0bfaa5af81
          Signer #1 certificate MD5 digest: e89b158e4bcf988ebd09eb83f5378e87`);
      (await adb.checkApkCert(apiDemosPath, apiDemosPackage)).should.be.true;
    });

    it('should check non default signature when not using keystore', async function () {
      adb.useKeystore = false;

      mocks.fs.expects('exists')
        .once().withExactArgs(apiDemosPath)
        .returns(true);
      mocks.fs.expects('exists')
        .once() // For apksigner.jar existence check in getBinaryFromSdkRoot
        .returns(true);
      mocks.adb.expects('getBinaryFromSdkRoot')
        .once().withExactArgs('apksigner.jar')
        .returns(apksignerDummyPath);
      mocks.adb.expects('executeApksigner')
        .once().withExactArgs(['verify', '--print-certs', apiDemosPath])
        .returns(`
          Signer #1 certificate DN: EMAILADDRESS=android@android.com, CN=Android, OU=Android, O=Android, L=Mountain View, ST=California, C=US
          Signer #1 certificate SHA-256 digest: a40da80a59d170caa950cf15cccccc4d47a39b26989d8b640ecd745ba71bf5dc
          Signer #1 certificate SHA-1 digest: 61ed377e85d386a8dfee6b864bdcccccfaa5af81
          Signer #1 certificate MD5 digest: e89b158e4bcf988ebd09eb83f53ccccc`);
      (await adb.checkApkCert(apiDemosPath, apiDemosPackage, {
        requireDefaultCert: false,
      })).should.be.true;
    });

    it('should fail if apksigner is not found', async function () {
      adb.useKeystore = false;

      mocks.fs.expects('exists')
        .once().withExactArgs(apiDemosPath)
        .returns(true);
      mocks.apkSigningHelpers.expects('getApksignerForOs')
        .throws();
      mocks.helpers.expects('getJavaForOs')
        .returns(javaDummyPath);
      await adb.checkApkCert(apiDemosPath, apiDemosPackage)
        .should.eventually.be.rejected;
    });

    it('should call getKeystoreHash when using keystore', async function () {
      adb.useKeystore = true;

      mocks.fs.expects('exists')
        .once().withExactArgs(apiDemosPath)
        .returns(true);
      mocks.fs.expects('exists')
        .once() // For apksigner.jar existence check in getBinaryFromSdkRoot
        .returns(true);
      mocks.adb.expects('getKeystoreHash')
        .once().returns({
          'md5': 'e89b158e4bcf988ebd09eb83f53ccccc',
          'sha1': '61ed377e85d386a8dfee6b864bdcccccfaa5af81',
          'sha256': 'a40da80a59d170caa950cf15cccccc4d47a39b26989d8b640ecd745ba71bf5dc',
        });
      mocks.adb.expects('getBinaryFromSdkRoot')
        .once().withExactArgs('apksigner.jar')
        .returns(apksignerDummyPath);
      mocks.adb.expects('executeApksigner')
        .once().withExactArgs(['verify', '--print-certs', apiDemosPath])
        .returns(`
          Signer #1 certificate DN: EMAILADDRESS=android@android.com, CN=Android, OU=Android, O=Android, L=Mountain View, ST=California, C=US
          Signer #1 certificate SHA-256 digest: a40da80a59d170caa950cf15cccccc4d47a39b26989d8b640ecd745ba71bf5dc
          Signer #1 certificate SHA-1 digest: 61ed377e85d386a8dfee6b864bdcccccfaa5af81
          Signer #1 certificate MD5 digest: e89b158e4bcf988ebd09eb83f53ccccc`);
      await adb.checkApkCert(apiDemosPath, apiDemosPackage).should.eventually.be.true;
    });
  });
}));
