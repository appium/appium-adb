import path from 'path';
import * as appiumSupport from '@appium/support';
import {zip} from '@appium/support';
import sinon from 'sinon';
import {APIDEMOS_PKG} from '../constants';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import proxyquire from 'proxyquire';
import * as helpers from '../../lib/helpers.js';

chai.use(chaiAsPromised);

const proxy = proxyquire.noCallThru();

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
const apiDemosPath = path.resolve(__dirname, '..', 'fixtures', 'ApiDemos-debug.apk');

describe('signing', function () {
  let sandbox: sinon.SinonSandbox;
  let adb: any;
  let teen: any;
  let mocks: {
    helpers: any;
    adb: any;
    appiumSupport: any;
    fs: any;
    tempDir: any;
  };

  function makeAdbWithTeenMock(sandbox: sinon.SinonSandbox) {
    const teen_stub = {
      exec: sandbox.stub(),
    };

    // Proxyquire the nested apk-signing module to inject teen_process,
    // then load ADB while stubbing its dependency.
    const mockedApkSigning = proxy('../../build/lib/tools/apk-signing.js', {
      'teen_process': teen_stub,
    });
    const {ADB} = proxy('../../build/lib/adb.js', {
      './tools/apk-signing': mockedApkSigning,
    });

    const adb_inst = new ADB();
    adb_inst.keystorePath = keystorePath;
    adb_inst.keyAlias = keyAlias;
    adb_inst.keystorePassword = password;
    adb_inst.keyPassword = password;

    return {adb: adb_inst, teen: teen_stub};
  }

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    const result = makeAdbWithTeenMock(sandbox);
    adb = result.adb;
    teen = result.teen;

    // Setup mocks using the real imported helpers module
    mocks = {
      helpers: sandbox.mock(helpers),
      adb: sandbox.mock(adb),
      appiumSupport: sandbox.mock(appiumSupport),
      fs: sandbox.mock(fs),
      tempDir: sandbox.mock(tempDir),
    };
  });

  afterEach(function () {
    sandbox.verify();
    sandbox.restore();
  });

  describe('signWithDefaultCert', function () {
    it('should call exec with correct args', async function () {
      mocks.fs.expects('exists').once().withExactArgs(apiDemosPath).returns(true);
      mocks.helpers
        .expects('getResourcePath')
        .once()
        .withExactArgs(path.join('keys', 'testkey.pk8'))
        .returns(defaultKeyPath);
      mocks.helpers
        .expects('getResourcePath')
        .once()
        .withExactArgs(path.join('keys', 'testkey.x509.pem'))
        .returns(defaultCertPath);
      mocks.adb.expects('getBinaryFromSdkRoot').once().withExactArgs('apksigner.jar').returns(apksignerDummyPath);
      mocks.helpers.expects('getJavaForOs').once().returns(javaDummyPath);
      teen.exec
        .withArgs(javaDummyPath, sinon.match.array, sinon.match.object)
        .resolves({stdout: '', stderr: ''});
      await adb.signWithDefaultCert(apiDemosPath);
    });

    it('should fail if apksigner fails', async function () {
      mocks.fs.expects('exists').once().withExactArgs(apiDemosPath).returns(true);
      mocks.helpers
        .expects('getResourcePath')
        .once()
        .withExactArgs(path.join('keys', 'testkey.pk8'))
        .returns(defaultKeyPath);
      mocks.helpers
        .expects('getResourcePath')
        .once()
        .withExactArgs(path.join('keys', 'testkey.x509.pem'))
        .returns(defaultCertPath);
      mocks.adb.expects('getBinaryFromSdkRoot').once().withExactArgs('apksigner.jar').returns(apksignerDummyPath);
      mocks.helpers.expects('getJavaForOs').once().returns(javaDummyPath);
      teen.exec
        .withArgs(javaDummyPath, sinon.match.array, sinon.match.object)
        .rejects(new Error('apksigner failed'));
      await expect(adb.signWithDefaultCert(apiDemosPath)).to.eventually.be.rejected;
    });

    it('should throw error for invalid file path', async function () {
      const dummyPath = 'dummyPath';
      await expect(adb.signWithDefaultCert(dummyPath)).to.eventually.be.rejected;
    });
  });

  describe('signWithCustomCert', function () {
    it('should call exec with correct args', async function () {
      adb.useKeystore = true;

      mocks.fs.expects('exists').once().withExactArgs(keystorePath).returns(true);
      mocks.fs.expects('exists').once().withExactArgs(apiDemosPath).returns(true);
      mocks.adb.expects('getBinaryFromSdkRoot').once().withExactArgs('apksigner.jar').returns(apksignerDummyPath);
      mocks.helpers.expects('getJavaForOs').once().returns(javaDummyPath);
      teen.exec
        .withArgs(javaDummyPath, sinon.match.array, sinon.match.object)
        .resolves({stdout: '', stderr: ''});
      await adb.signWithCustomCert(apiDemosPath);
    });

    it('should fallback to jarsigner if apksigner fails', async function () {
      let jarsigner = path.resolve(javaHome, 'bin', 'jarsigner');
      if (appiumSupport.system.isWindows()) {
        jarsigner = jarsigner + '.exe';
      }
      adb.useKeystore = true;

      mocks.fs.expects('exists').once().withExactArgs(keystorePath).returns(true);
      mocks.fs.expects('exists').once().withExactArgs(apiDemosPath).returns(true);
      mocks.adb.expects('getBinaryFromSdkRoot').once().withExactArgs('apksigner.jar').returns(apksignerDummyPath);
      mocks.helpers.expects('getJavaForOs').once().returns(javaDummyPath);
      // First call to exec (apksigner) fails
      teen.exec
        .withArgs(javaDummyPath, sinon.match.array, sinon.match.object)
        .rejects(new Error('apksigner failed'));
      // Second call to exec (jarsigner) succeeds
      teen.exec
        .withArgs(jarsigner, sinon.match.array, sinon.match.object)
        .resolves({});
      mocks.helpers.expects('getJavaHome').returns(javaHome);
      // Mock unsignApk's dependencies: tempDir and zip operations
      mocks.tempDir.expects('openDir').returns('/tmp/dummy');
      // Mock zip.readEntries to indicate no META-INF (so unsignApk returns false)
      // We need to stub the actual zip object since it's imported as a named import
      const originalReadEntries = zip.readEntries;
      // eslint-disable-next-line import/namespace, promise/prefer-await-to-callbacks
      zip.readEntries = async (apkPath, callback) => {
        // Call callback with a non-META-INF entry so hasMetaInf stays false
        // eslint-disable-next-line promise/prefer-await-to-callbacks
        callback({entry: {fileName: 'AndroidManifest.xml'}});
      };
      try {
        await adb.signWithCustomCert(apiDemosPath);
      } finally {
        // Restore original function
        // eslint-disable-next-line import/namespace
        zip.readEntries = originalReadEntries;
      }
    });
  });

  // Skipping as unable to mock mkdirp, this case is covered in e2e tests for now.
  // TODO: find ways to mock mkdirp
  describe.skip('zipAlignApk', function () {
    it('should call exec with correct args', async function () {
      const alignedApk = 'dummy_path';
      mocks.tempDir
        .expects('path')
        .once()
        .withExactArgs({prefix: 'appium', suffix: '.tmp'})
        .returns(alignedApk);
      mocks.adb.expects('initZipAlign').once().withExactArgs().returns('');
      mocks.appiumSupport
        .expects('mkdirp')
        .once()
        .withExactArgs(path.dirname(alignedApk))
        .returns({});
      teen.exec
        .withArgs(adb.binaries!.zipalign, ['-f', '4', apiDemosPath, alignedApk])
        .resolves({});
      mocks.fs
        .expects('mv')
        .once()
        .withExactArgs(alignedApk, apiDemosPath, {mkdirp: true})
        .returns('');
      await adb.zipAlignApk(apiDemosPath);
    });
  });

  describe('checkApkCert', function () {
    it('should return false for apk not present', async function () {
      mocks.fs.expects('exists').once().withExactArgs('dummyPath').returns(false);
      expect(await adb.checkApkCert('dummyPath', 'dummyPackage')).to.be.false;
    });

    it('should check default signature when not using keystore', async function () {
      adb.useKeystore = false;

      mocks.fs.expects('exists').once().withExactArgs(apiDemosPath).returns(true);
      mocks.fs.expects('hash').once().withExactArgs(apiDemosPath).returns(Math.random().toString(36));
      mocks.adb
        .expects('getBinaryFromSdkRoot')
        .twice()
        .withExactArgs('apksigner.jar')
        .returns(apksignerDummyPath);
      mocks.helpers.expects('getJavaForOs').once().returns(javaDummyPath);
      teen.exec
        .withArgs(javaDummyPath, sinon.match.array, sinon.match.object)
        .resolves({stdout: `
      Signer #1 certificate DN: EMAILADDRESS=android@android.com, CN=Android, OU=Android, O=Android, L=Mountain View, ST=California, C=US
      Signer #1 certificate SHA-256 digest: a40da80a59d170caa950cf15c18c454d47a39b26989d8b640ecd745ba71bf5dc
      Signer #1 certificate SHA-1 digest: 61ed377e85d386a8dfee6b864bd85b0bfaa5af81
      Signer #1 certificate MD5 digest: e89b158e4bcf988ebd09eb83f5378e87`, stderr: ''});
      expect(await adb.checkApkCert(apiDemosPath, apiDemosPackage)).to.be.true;
    });

    it('should check non default signature when not using keystore', async function () {
      adb.useKeystore = false;

      mocks.fs.expects('exists').once().withExactArgs(apiDemosPath).returns(true);
      mocks.fs.expects('hash').once().withExactArgs(apiDemosPath).returns(Math.random().toString(36));
      mocks.adb
        .expects('getBinaryFromSdkRoot')
        .twice()
        .withExactArgs('apksigner.jar')
        .returns(apksignerDummyPath);
      mocks.helpers.expects('getJavaForOs').once().returns(javaDummyPath);
      teen.exec
        .withArgs(javaDummyPath, sinon.match.array, sinon.match.object)
        .resolves({stdout: `
      Signer #1 certificate DN: EMAILADDRESS=android@android.com, CN=Android, OU=Android, O=Android, L=Mountain View, ST=California, C=US
      Signer #1 certificate SHA-256 digest: a40da80a59d170caa950cf15cccccc4d47a39b26989d8b640ecd745ba71bf5dc
      Signer #1 certificate SHA-1 digest: 61ed377e85d386a8dfee6b864bdcccccfaa5af81
      Signer #1 certificate MD5 digest: e89b158e4bcf988ebd09eb83f53ccccc`, stderr: ''});
      const result = await adb.checkApkCert(apiDemosPath, apiDemosPackage, {
        requireDefaultCert: false,
      });
      expect(result).to.be.true;
    });

    it('should fail if apksigner is not found', async function () {
      adb.useKeystore = false;

      mocks.fs.expects('exists').once().withExactArgs(apiDemosPath).returns(true);
      mocks.fs.expects('hash').once().withExactArgs(apiDemosPath).returns(Math.random().toString(36));
      mocks.adb.expects('getBinaryFromSdkRoot').once().withExactArgs('apksigner.jar').throws(new Error('apksigner not found'));
      await expect(adb.checkApkCert(apiDemosPath, apiDemosPackage)).to.eventually.be.rejected;
    });

    it('should call getKeystoreHash when using keystore', async function () {
      adb.useKeystore = true;

      mocks.fs.expects('exists').once().withExactArgs(apiDemosPath).returns(true);
      mocks.fs.expects('hash').once().withExactArgs(apiDemosPath).returns(Math.random().toString(36));
      mocks.adb.expects('getKeystoreHash').once().returns({
        md5: 'e89b158e4bcf988ebd09eb83f53ccccc',
        sha1: '61ed377e85d386a8dfee6b864bdcccccfaa5af81',
        sha256: 'a40da80a59d170caa950cf15cccccc4d47a39b26989d8b640ecd745ba71bf5dc',
      });
      mocks.adb
        .expects('getBinaryFromSdkRoot')
        .twice()
        .withExactArgs('apksigner.jar')
        .returns(apksignerDummyPath);
      mocks.helpers.expects('getJavaForOs').once().returns(javaDummyPath);
      teen.exec
        .withArgs(javaDummyPath, sinon.match.array, sinon.match.object)
        .resolves({stdout: `
      Signer #1 certificate DN: EMAILADDRESS=android@android.com, CN=Android, OU=Android, O=Android, L=Mountain View, ST=California, C=US
      Signer #1 certificate SHA-256 digest: a40da80a59d170caa950cf15cccccc4d47a39b26989d8b640ecd745ba71bf5dc
      Signer #1 certificate SHA-1 digest: 61ed377e85d386a8dfee6b864bdcccccfaa5af81
      Signer #1 certificate MD5 digest: e89b158e4bcf988ebd09eb83f53ccccc`, stderr: ''});
      await expect(adb.checkApkCert(apiDemosPath, apiDemosPackage)).to.eventually.be.true;
    });
  });
});
