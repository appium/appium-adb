import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import ADB from '../../lib/adb.js';
import sinon from 'sinon';

chai.use(chaiAsPromised);
const should = chai.should();
const apiLevel = '21',
      IME = 'com.android.inputmethod.latin/.LatinIME',
     imeList = `com.android.inputmethod.latin/.LatinIME:
  mId=com.android.inputmethod.latin/.LatinIME mSettingsActivityName=com.android
  mIsDefaultResId=0x7f070000
  Service:
    priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false
    ServiceInfo:
      name=com.android.inputmethod.latin.LatinIME
      packageName=com.android.inputmethod.latin
      labelRes=0x7f0a0037 nonLocalizedLabel=null icon=0x0 banner=0x0
      enabled=true exported=true processName=com.android.inputmethod.latin
      permission=android.permission.BIND_INPUT_METHOD
      flags=0x0`;

describe('adb commands', () => {
  let adb = new ADB();
  before(async () => {
    await adb.createADB();
  });
  describe('shell', () => {
    let withAdbMock = (fn) => {
      return () => {
        let mocks = {};
        before(() => { mocks.adb = sinon.mock(adb); });
        after(() => { mocks.adb.restore(); });
        fn(mocks);
      };
    };
    describe('getApiLevel', withAdbMock((mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['getprop', 'ro.build.version.sdk'])
          .returns(apiLevel);
        (await adb.getApiLevel()).should.equal(apiLevel);
        mocks.adb.verify();
      });
    }));
    describe('availableIMEs', withAdbMock((mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['ime', 'list', '-a'])
          .returns(imeList);
        (await adb.availableIMEs()).should.have.length.above(0);
        mocks.adb.verify();
      });
    }));
    describe('enabledIMEs', withAdbMock((mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['ime', 'list'])
          .returns(imeList);
        (await adb.enabledIMEs()).should.have.length.above(0);
        mocks.adb.verify();
      });
    }));
    describe('defaultIME', withAdbMock((mocks) => {
      let defaultIME = 'com.android.inputmethod.latin/.LatinIME';
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['settings', 'get', 'secure', 'default_input_method'])
          .returns(defaultIME);
        (await adb.defaultIME()).should.equal(defaultIME);
        mocks.adb.verify();
      });
    }));
    describe('disableIME', withAdbMock((mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['ime', 'disable', IME])
          .returns("");
        await adb.disableIME(IME);
        mocks.adb.verify();
      });
    }));
    describe('enableIME', withAdbMock((mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['ime', 'enable', IME])
          .returns("");
        await adb.enableIME(IME);
        mocks.adb.verify();
      });
    }));
  });
  it('isValidClass should correctly validate class names', () => {
    adb.isValidClass('some.package/some.package.Activity').index.should.equal(0);
    should.not.exist(adb.isValidClass('illegalPackage#/adsasd'));
  });
});
