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
  let adb = new ADB(), shell;
  before(async () => {
    await adb.createADB();
  });
  describe('shell', () => {
    const verifyShellArguments = function (cmd) {
      shell.withArgs(cmd);
    };
    const createStub = function (mockShellValue) {
      shell = sinon.stub(adb, "shell", async function () {
        return mockShellValue;
      });
    };
    const clearStub = function () {
      adb.shell.restore();
    };
    describe('getApiLevel', () => {
      before(() => {
        createStub('21');
      });
      it('should call shell with correct args', async () => {
        (await adb.getApiLevel()).should.be.equal(apiLevel);
        verifyShellArguments(['getprop', 'ro.build.version.sdk']);
      });
      after(async () => {
        clearStub();
      });
    });
    describe('availableIMEs', () => {
      before(() => {
        createStub(imeList);
      });
      it('should call shell with correct args', async () => {
        (await adb.availableIMEs()).should.have.length.above(0);
        verifyShellArguments(['ime', 'list', '-a']);
      });
      after(async () => {
        clearStub();
      });
    });
    describe('enabledIMEs', () => {
      before(() => {
        createStub(imeList);
      });
      it('should call shell with correct args', async () => {
        (await adb.enabledIMEs()).should.have.length.above(0);
        verifyShellArguments(['ime', 'list']);
      });
      after(async () => {
        clearStub();
      });
    });
    describe('defaultIME', () => {
      let defaultIME = 'com.android.inputmethod.latin/.LatinIME';
      before(() => {
        createStub(defaultIME);
      });
      it('should call shell with correct args', async () => {
        (await adb.defaultIME()).should.be.equal(defaultIME);
        verifyShellArguments(['settings', 'get', 'secure', 'default_input_method']);
      });
      after(async () => {
        clearStub();
      });
    });
    describe('disableIME', () => {
      before(() => {
        createStub('');
      });
      it('should call shell with correct args', async () => {
        await adb.disableIME(IME);
        (await adb.enabledIMEs()).should.not.include(IME);
        verifyShellArguments(['ime', 'disable', IME]);
      });
      after(async () => {
        clearStub();
      });
    });
    describe('enableIME', () => {
      before(() => {
        createStub(imeList);
      });
      it('should call shell with correct args', async () => {
        await adb.enableIME(IME);
        (await adb.enabledIMEs()).should.include(IME);
        verifyShellArguments(['ime', 'enable', IME]);
      });
      after(async () => {
        clearStub();
      });
    });
  });
  it('isValidClass should correctly validate class names', () => {
    adb.isValidClass('some.package/some.package.Activity').index.should.equal(0);
    should.not.exist(adb.isValidClass('illegalPackage#/adsasd'));
  });
});
