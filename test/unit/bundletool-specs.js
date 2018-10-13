import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { withMocks } from 'appium-test-support';
import * as teen_process from 'teen_process';
import * as helpers from "../../lib/helpers";
import path from 'path';
import ADB from "../../";

chai.use(chaiAsPromised);
// const bundletoolDummyPath = '/path/to/bundletool.jar',
const helperJarPath = path.resolve(helpers.rootDir, 'jars'),
      javaDummyPath = 'java_dummy_path';

const adb = new ADB();
describe('bundletool', withMocks({teen_process, helpers, adb}, function (mocks) {
  afterEach(function () {
    mocks.verify();
  });

  describe('version', function () {
    it('can get version', async function () {
      mocks.teen_process.expects('exec')
        .once().withExactArgs(javaDummyPath, ['-jar', path.resolve(helperJarPath, 'bundletool.jar'), 'version'])
        .returns('BundleTool 0.6.0');
      mocks.helpers.expects('getJavaForOs')
        .returns(javaDummyPath);
      (await adb.version()).should.eq('BundleTool 0.6.0');
    });

    it('can not get version with raising an error', async function () {
      mocks.teen_process.expects('exec')
        .once().withExactArgs(javaDummyPath, ['-jar', path.resolve(helperJarPath, 'bundletool.jar'), 'version'])
          .throws();
      mocks.helpers.expects('getJavaForOs')
        .returns(javaDummyPath);
      await adb.version().should.eventually.be.rejected;
    });
  });

  describe('installApks', function () {
    it('can install apks', async function () {
      mocks.teen_process.expects('exec')
          .once().withExactArgs(javaDummyPath,
            ['-jar', path.resolve(helperJarPath, 'bundletool.jar'), 'install-apks', '--apks', 'path/to/apks.apks', '--device-id', 'dummy'])
          .returns('');
      mocks.helpers.expects('getJavaForOs')
          .returns(javaDummyPath);
      await adb.installApks('path/to/apks.apks', 'dummy');
    });

    it('can install apks with modules', async function () {
      mocks.teen_process.expects('exec')
          .once().withExactArgs(javaDummyPath,
          ['-jar', path.resolve(helperJarPath, 'bundletool.jar'), 'install-apks', '--apks', 'path/to/apks.apks', '--device-id', 'dummy', '--modules', 'm1,m2'])
          .returns('');
      mocks.helpers.expects('getJavaForOs')
          .returns(javaDummyPath);
      await adb.installApks('path/to/apks.apks', 'dummy', ['m1', 'm2']);
    });

    it('can not install apks with raising an error', async function () {
      mocks.teen_process.expects('exec')
        .once().withExactArgs(javaDummyPath,
        ['-jar', path.resolve(helperJarPath, 'bundletool.jar'), 'install-apks', '--apks', 'path/to/apks.apks', '--device-id', 'dummy'])
        .throws();
      mocks.helpers.expects('getJavaForOs')
        .returns(javaDummyPath);
      await adb.installApks('path/to/apks.apks', 'dummy').should.eventually.be.rejected;
    });
  });

  describe('buildApks', function () {
    it('build apks with mandatory parameters', async function () {
      mocks.teen_process.expects('exec')
        .once().withExactArgs(javaDummyPath,
        [
          '-jar', path.resolve(helperJarPath, 'bundletool.jar'), 'build-apks',
          '--bundle', 'path/to/apks.apks',
          '--output', 'path/to/output',
          '--connected-device', '--device-id', 'dummySerialNumber'
        ])
        .returns('');
      mocks.helpers.expects('getJavaForOs')
        .returns(javaDummyPath);
      const result = await adb.buildApks('path/to/apks.apks', 'dummySerialNumber', `path/to/output`);
      result.should.eq('path/to/output');
    });

    it('build apks with keystore without pass', async function () {
      mocks.teen_process.expects('exec')
        .once().withExactArgs(javaDummyPath,
        [
          '-jar', path.resolve(helperJarPath, 'bundletool.jar'), 'build-apks',
          '--bundle', 'path/to/apks.apks',
          '--output', 'path/to/output',
          '--connected-device', '--device-id', 'dummySerialNumber',
          '--ks', 'keystore', '--ks-key-alias', 'keyAlias'
        ])
        .returns('');
      mocks.helpers.expects('getJavaForOs')
        .returns(javaDummyPath);
      await adb.buildApks('path/to/apks.apks', 'dummySerialNumber', `path/to/output`,
        {ks: 'keystore', ksKeyAlias: 'keyAlias'});
    });

    it('build apks with keystore with pass', async function () {
      mocks.teen_process.expects('exec')
        .once().withExactArgs(javaDummyPath,
        [
          '-jar', path.resolve(helperJarPath, 'bundletool.jar'), 'build-apks',
          '--bundle', 'path/to/apks.apks',
          '--output', 'path/to/output',
          '--connected-device', '--device-id', 'dummySerialNumber',
          '--ks', 'keystore', '--ks-key-alias', 'keyAlias', '--ks-pass', 'pass:text'
        ])
        .returns('');
      mocks.helpers.expects('getJavaForOs')
        .returns(javaDummyPath);
      await adb.buildApks('path/to/apks.apks', 'dummySerialNumber', `path/to/output`,
        {ks: 'keystore', ksKeyAlias: 'keyAlias', ksPass: 'pass:text'});
    });

    it('build apks with other arbitrary parameters', async function () {
      mocks.teen_process.expects('exec')
        .once().withExactArgs(javaDummyPath,
        [
          '-jar', path.resolve(helperJarPath, 'bundletool.jar'), 'build-apks',
          '--bundle', 'path/to/apks.apks',
          '--output', 'path/to/output',
          '--connected-device', '--device-id', 'dummySerialNumber',
          '--overwrite', '--max-threads 4'
        ])
        .returns('');
      mocks.helpers.expects('getJavaForOs')
        .returns(javaDummyPath);
      await adb.buildApks('path/to/apks.apks', 'dummySerialNumber', `path/to/output`,
        {otherOptions: '--max-threads 4', overwrite: true});
    });

    it('can not build apks with raising an error', async function () {
      mocks.teen_process.expects('exec')
        .once().withExactArgs(javaDummyPath,
        [
          '-jar', path.resolve(helperJarPath, 'bundletool.jar'), 'build-apks',
          '--bundle', 'path/to/apks.apks',
          '--output', 'path/to/output',
          '--connected-device', '--device-id', 'dummySerialNumber',
          '--ks', 'keystore', '--ks-key-alias', 'keyAlias'
        ])
        .throws();
      mocks.helpers.expects('getJavaForOs')
        .returns(javaDummyPath);
      await adb.buildApks('path/to/apks.apks', 'dummySerialNumber', `path/to/output`).should.eventually.be.rejected;
    });
  });
}));
