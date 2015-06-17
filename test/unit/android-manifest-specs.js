import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import ADB from '../../lib/adb.js';
import sinon from 'sinon';
import * as teen_process from 'teen_process';

chai.use(chaiAsPromised);

describe('android-manifest', async () => {
  let adb = new ADB();
  let withExecMock = (fn) => {
    return () => {
      let mocks = {};
      before(async () => {
        mocks.teen_process = sinon.mock(teen_process);
        mocks.adb = sinon.mock(adb);
      });
      after(() => {
        mocks.teen_process.restore();
        mocks.adb.restore();
      });
      fn(mocks);
    };
  };
  describe('processFromManifest', withExecMock((mocks) => {
    it('should correctly parse process from manifest', async () => {
      adb.binaries.aapt = 'dummy_aapt';
      const localApk = 'dummyAPK',
            dummyProcess = 'dummyProcess';
      mocks.adb.expects("initAapt")
        .once().withExactArgs()
              .returns('');
      mocks.teen_process.expects("exec")
        .once().withExactArgs('dummy_aapt', ['dump', 'xmltree', localApk,
                              'AndroidManifest.xml'])
        .returns({stdout: ` E: application (line=234)
                          A: android:process(0x01010011)="${dummyProcess}"`});
      (await adb.processFromManifest(localApk)).should.equal(dummyProcess);
      mocks.adb.verify();
    });
  }));
  describe('packageAndLaunchActivityFromManifest', withExecMock((mocks) => {
    it('should correctly parse package and activity from manifest', async () => {
      adb.binaries.aapt = 'dummy_aapt';
      const localApk = 'dummyAPK',
            dummyPackageName = 'package',
            dummyActivityName = 'activity';
      mocks.adb.expects("initAapt")
        .once().withExactArgs()
              .returns('');
      mocks.teen_process.expects("exec")
        .once().withExactArgs('dummy_aapt', ['dump', 'badging', localApk])
        .returns({stdout: ` package: name='${dummyPackageName}'
                            launchable-activity: name='${dummyActivityName}'`});
      let {apkPackage, apkActivity} = (await adb.packageAndLaunchActivityFromManifest(localApk));
      apkPackage.should.equal(dummyPackageName);
      apkActivity.should.equal(dummyActivityName);
      mocks.adb.verify();
    });
  }));
  describe('hasInternetPermissionFromManifest', withExecMock((mocks) => {
    it('should correctly parse internet permission from manifest', async () => {
      adb.binaries.aapt = 'dummy_aapt';
      const localApk = 'dummyAPK';
      mocks.adb.expects("initAapt")
        .once().withExactArgs()
              .returns('');
      mocks.teen_process.expects("exec")
        .once().withExactArgs('dummy_aapt', ['dump', 'badging', localApk])
        .returns({stdout: ` uses-permission:.*'android.permission.INTERNET'`});
      (await adb.hasInternetPermissionFromManifest(localApk)).should.be.true;
      mocks.adb.verify();
    });
  }));
});
