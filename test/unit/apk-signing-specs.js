import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import ADB from '../../lib/adb.js';
import sinon from 'sinon';
import { getJavaForOs } from '../../lib/helpers.js';
import path from 'path';
import * as teen_process from 'teen_process';
import * as utils from '../../lib/utils.js';
import { tempDir } from 'appium-support';

chai.use(chaiAsPromised);

const selendroidTestApp = path.resolve(__dirname, '..', '..', '..', 'test',
                                       'selendroid-test-app.apk'),
      java = getJavaForOs(),
      helperJarPath = path.resolve(__dirname, '..', '..', '..', 'jars'),
      keystorePath = path.resolve(__dirname, '..', '..', '..', 'test', 'appiumtest.keystore'),
      keyAlias = 'appiumtest',
      password = 'android',
      selendroidTestAppPackage = 'io.selendroid.testapp';

describe('signing', async () => {
  let adb = new ADB(),
      withExecMock = (fn) => {
        return () => {
          let mocks = {};
          before(async () => {
            await adb.createADB();
            adb.keystorePath = keystorePath;
            adb.keyAlias = keyAlias;
            adb.keystorePassword = password;
            adb.keyPassword = password;
            mocks.teen_process = sinon.mock(teen_process);
            mocks.adb = sinon.mock(adb);
            mocks.utils = sinon.mock(utils);
            mocks.tempDir = sinon.mock(tempDir);
          });
          after(() => {
            mocks.teen_process.restore();
            mocks.adb.restore();
            mocks.utils.restore();
            mocks.tempDir.restore();
          });
          fn(mocks);
        };
      };
  describe('signWithDefaultCert', withExecMock((mocks) => {
    it('should call exec with correct args', async () => {
      let signPath = path.resolve(helperJarPath, 'sign.jar');
      mocks.teen_process.expects("exec")
        .once().withExactArgs(java, ['-jar', signPath, selendroidTestApp, '--override'])
        .returns("");
      (await adb.signWithDefaultCert(selendroidTestApp));
      mocks.teen_process.verify();
    });
    it('should throw error for invalid file path', async () => {
      let dummyPath = "dummyPath";
      await adb.signWithDefaultCert(dummyPath).should.eventually.be.rejected;
      mocks.teen_process.verify();
    });
  }));
  describe('signWithCustomCert', withExecMock((mocks) => {
    it('should call exec with correct args', async () => {
      let jarsigner = path.resolve(process.env.JAVA_HOME, 'bin', 'jarsigner');
      adb.useKeystore = true;
      mocks.teen_process.expects("exec")
        .withExactArgs(java, ['-jar', path.resolve(helperJarPath, 'unsign.jar'), selendroidTestApp])
        .returns("");
      mocks.teen_process.expects("exec")
        .withExactArgs(jarsigner, ['-sigalg', 'MD5withRSA', '-digestalg', 'SHA1',
                                   '-keystore', keystorePath, '-storepass', password,
                                   '-keypass', password, selendroidTestApp, keyAlias])
        .returns("");
      (await adb.signWithCustomCert(selendroidTestApp));
      mocks.teen_process.verify();
    });
  }));
  describe('getKeystoreMd5', withExecMock((mocks) => {
    it('should call exec with correct args', async () => {
      let h = "a-fA-F0-9";
      let keytool = path.resolve(process.env.JAVA_HOME, 'bin', 'keytool');
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

  describe('zipAlignApk', withExecMock((mocks) => {
    it('should call exec with correct args', async () => {
      let alignedApk = "dummy_path";
      mocks.tempDir.expects('path')
        .once().withExactArgs({prefix: 'appium', suffix: '.tmp'})
        .returns(alignedApk);
      mocks.adb.expects('initZipAlign')
        .once().withExactArgs()
        .returns("");
      mocks.utils.expects('mkdirp')
        .once().withExactArgs(path.dirname(alignedApk))
        .returns("");
      mocks.teen_process.expects("exec")
        .once().withExactArgs(adb.binaries.zipalign, ['-f', '4', selendroidTestApp,
                                                      alignedApk]);
      mocks.utils.expects("mv")
        .once().withExactArgs(alignedApk, selendroidTestApp, { mkdirp: true })
        .returns("");
      await adb.zipAlignApk(selendroidTestApp);
      mocks.adb.verify();
      mocks.utils.verify();
      mocks.teen_process.verify();
    });
  }));
  describe('checkApkCert', withExecMock((mocks) => {
    it('should return false for apk not present', async () => {
      (await adb.checkApkCert('dummyPath', 'dummyPackage')).should.be.false;
    });
    it('should call exec and zipAlign when not using keystore', async () => {
      mocks.teen_process.expects("exec")
           .once().withExactArgs(java, ['-jar', path.resolve(helperJarPath, 'verify.jar'),
                                        selendroidTestApp])
           .returns("");
      mocks.adb.expects('zipAlignApk')
           .once().withExactArgs(selendroidTestApp)
           .returns("");
      adb.useKeystore = false;
      await adb.checkApkCert(selendroidTestApp, selendroidTestAppPackage);
      mocks.adb.verify();
      mocks.teen_process.verify();
    });
    it('should call checkCustomApkCert when using keystore', async () => {
      mocks.adb.expects('checkCustomApkCert')
           .once().withExactArgs(selendroidTestApp, selendroidTestAppPackage)
           .returns("");
      adb.useKeystore = true;
      await adb.checkApkCert(selendroidTestApp, selendroidTestAppPackage);
      mocks.adb.verify();
    });
  }));
});
