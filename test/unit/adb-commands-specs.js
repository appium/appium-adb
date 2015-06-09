import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import ADB from '../../lib/adb.js';
import sinon from 'sinon';
import net from 'net';
import events from 'events';

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
  describe('shell', () => {
    let withAdbMock = (fn) => {
      return () => {
        let mocks = {};
        beforeEach(() => { mocks.adb = sinon.mock(adb); });
        afterEach(() => { mocks.adb.restore(); });
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
    describe('keyevent', withAdbMock((mocks) => {
      it('should call shell with correct args', async () => {
        let keycode = '29';
        let code = parseInt(keycode, 10);
        mocks.adb.expects("shell")
          .once().withExactArgs(['input', 'keyevent', code])
          .returns("");
        await adb.keyevent(keycode);
        mocks.adb.verify();
      });
    }));
    describe('lock', withAdbMock((mocks) => {
      it('should call keyevent with correct args', async () => {
        mocks.adb.expects("keyevent")
          .once().withExactArgs(26)
          .returns("");
        await adb.lock();
        mocks.adb.verify();
      });
    }));
    describe('back', withAdbMock((mocks) => {
      it('should call keyevent with correct args', async () => {
        mocks.adb.expects("keyevent")
          .once().withExactArgs(4)
          .returns("");
        await adb.back();
        mocks.adb.verify();
      });
    }));
    describe('goToHome', withAdbMock((mocks) => {
      it('should call keyevent with correct args', async () => {
        mocks.adb.expects("keyevent")
          .once().withExactArgs(3)
          .returns("");
        await adb.goToHome();
        mocks.adb.verify();
      });
    }));
    describe.skip('isScreenLocked', withAdbMock((mocks) => {
      it('should call keyevent with correct args', async () => {
        mocks.adb.expects("keyevent")
          .once().withExactArgs(3)
          .returns("");
        await adb.goToHome();
        mocks.adb.verify();
      });
    }));
    describe('isSoftKeyboardPresent', withAdbMock((mocks) => {
      it('should call shell with correct args and should return false', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['dumpsys', 'input_method'])
          .returns("mInputShown=false");
        let {isKeyboardShown, canCloseKeyboard} = await adb.isSoftKeyboardPresent();
        canCloseKeyboard.should.be.false;
        isKeyboardShown.should.be.false;
        mocks.adb.verify();
      });
      it('should call shell with correct args and should return true', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['dumpsys', 'input_method'])
          .returns("mInputShown=true mIsInputViewShown=true");
        let {isKeyboardShown, canCloseKeyboard} = await adb.isSoftKeyboardPresent();
        isKeyboardShown.should.be.true;
        canCloseKeyboard.should.be.true;
        mocks.adb.verify();
      });
    }));
    describe('isAirplaneModeOn', withAdbMock((mocks) => {
      it('should call shell with correct args and should be true', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['settings', 'get', 'global', 'airplane_mode_on'])
          .returns("1");
        (await adb.isAirplaneModeOn()).should.be.true;
        mocks.adb.verify();
      });
      it('should call shell with correct args and should be false', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['settings', 'get', 'global', 'airplane_mode_on'])
          .returns("0");
        (await adb.isAirplaneModeOn()).should.be.false;
        mocks.adb.verify();
      });
    }));
    describe('setAirplaneMode', withAdbMock((mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['settings', 'put', 'global', 'airplane_mode_on', 1])
          .returns("");
        await adb.setAirplaneMode(1);
        mocks.adb.verify();
      });
    }));
    describe('broadcastAirplaneMode', withAdbMock((mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE',
                                 '--ez', 'state', 'true'])
          .returns("");
        await adb.broadcastAirplaneMode(true);
        mocks.adb.verify();
      });
    }));
    describe('isWifiOn', withAdbMock((mocks) => {
      it('should call shell with correct args and should be true', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['settings', 'get', 'global', 'wifi_on'])
          .returns("1");
        (await adb.isWifiOn()).should.be.true;
        mocks.adb.verify();
      });
      it('should call shell with correct args and should be false', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['settings', 'get', 'global', 'wifi_on'])
          .returns("0");
        (await adb.isWifiOn()).should.be.false;
        mocks.adb.verify();
      });
    }));
    describe('setWifiState', withAdbMock((mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['am', 'start', '-n', 'io.appium.settings/.Settings', '-e',
                                 'wifi', 'on'])
          .returns("");
        await adb.setWifiState(true);
        mocks.adb.verify();
      });
    }));
    describe('isDataOn', withAdbMock((mocks) => {
      it('should call shell with correct args and should be true', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['settings', 'get', 'global', 'mobile_data'])
          .returns("1");
        (await adb.isDataOn()).should.be.true;
        mocks.adb.verify();
      });
      it('should call shell with correct args and should be false', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['settings', 'get', 'global', 'mobile_data'])
          .returns("0");
        (await adb.isDataOn()).should.be.false;
        mocks.adb.verify();
      });
    }));
    describe('setDataState', withAdbMock((mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['am', 'start', '-n', 'io.appium.settings/.Settings', '-e',
                                 'data', 'on'])
          .returns("");
        await adb.setDataState(true);
        mocks.adb.verify();
      });
    }));
    describe('setWifiAndData', withAdbMock((mocks) => {
      it('should call shell with correct args when only wifi', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['am', 'start', '-n', 'io.appium.settings/.Settings',
                                  '-e', 'wifi', 'on'])
          .returns("");
        await adb.setWifiAndData({wifi:true});
        mocks.adb.verify();
      });
      it('should call shell with correct args when only data', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['am', 'start', '-n', 'io.appium.settings/.Settings',
                                  '-e', 'data', 'on'])
          .returns("");
        await adb.setWifiAndData({data:true});
        mocks.adb.verify();
      });
      it('should call shell with correct args when wifi and data', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['am', 'start', '-n', 'io.appium.settings/.Settings',
                                  '-e', 'wifi', 'on', '-e', 'data', 'on'])
          .returns("");
        await adb.setWifiAndData({wifi:true, data:true});
        mocks.adb.verify();
      });
    }));
  });
  describe('sendTelnetCommand', async () => {
    let mocks = {};
    before(() => {
      mocks.adb = sinon.mock(adb);
      mocks.net = sinon.mock(net);
    });
    after(() => {
      mocks.adb.restore();
      mocks.net.restore();
    });
    it('should call shell with correct args', async () => {
      const port = 54321;
      let conn = new events.EventEmitter();
      let commands = [];
      conn.write = function (command) {
        commands.push(command);
      };
      mocks.adb.expects("getEmulatorPort")
        .once().withExactArgs()
        .returns(port);
      mocks.net.expects("createConnection")
        .once().withExactArgs(port, 'localhost')
        .returns(conn);
      let p = adb.sendTelnetCommand('avd name');
      setTimeout(function () {
        conn.emit('connect');
        conn.emit('data','OK');
        conn.emit('data','OK');
        conn.emit('close');
      }, 0);
      await p;
      commands[0].should.equal("avd name\n");
      commands[1].should.equal("quit\n");
      mocks.adb.verify();
      mocks.net.verify();
    });
  });

  it('isValidClass should correctly validate class names', () => {
    adb.isValidClass('some.package/some.package.Activity').index.should.equal(0);
    should.not.exist(adb.isValidClass('illegalPackage#/adsasd'));
  });
});
