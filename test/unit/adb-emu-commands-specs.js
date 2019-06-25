import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import { withMocks } from 'appium-test-support';
import _ from 'lodash';

chai.use(chaiAsPromised);
chai.should();

const emulators = [
  { udid: 'emulator-5554', state: 'device', port: 5554 },
  { udid: 'emulator-5556', state: 'device', port: 5556 },
];
const fingerprintId = 1111;

const adb = new ADB();

describe('adb emulator commands', withMocks({adb}, function (mocks) {
  afterEach(function () {
    mocks.verify();
  });

  describe('emu', function () {
    describe('isEmulatorConnected', function () {
      it('should verify emulators state', async function () {
        mocks.adb.expects('getConnectedEmulators')
          .atLeast(3)
          .returns(emulators);
        adb.curDeviceId = 'emulator-5554';
        (await adb.isEmulatorConnected()).should.equal(true);
        adb.curDeviceId = 'emulator-5556';
        (await adb.isEmulatorConnected()).should.equal(true);
        adb.curDeviceId = 'emulator-5558';
        (await adb.isEmulatorConnected()).should.equal(false);
      });
    });
    describe('verifyEmulatorConnected', function () {
      it('should throw an exception on emulator not connected', async function () {
        adb.curDeviceId = 'emulator-5558';
        mocks.adb.expects('isEmulatorConnected')
          .once()
          .returns(false);
        await adb.verifyEmulatorConnected().should.eventually.be.rejected;
      });
    });
    describe('fingerprint', function () {
      it('should throw exception on undefined fingerprintId', async function () {
        await adb.fingerprint().should.eventually.be.rejected;
      });
      it('should throw exception on apiLevel lower than 23', async function () {
        mocks.adb.expects('getApiLevel')
          .once().withExactArgs()
          .returns(21);
        await adb.fingerprint(fingerprintId).should.eventually.be.rejected;
      });
      it('should call adbExec with the correct args', async function () {
        mocks.adb.expects('getApiLevel')
          .once().withExactArgs()
          .returns(23);
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'finger', 'touch', fingerprintId])
          .returns();
        await adb.fingerprint(fingerprintId);
      });
    });
    describe('rotate', function () {
      it('should call adbExec with the correct args', async function () {
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'rotate'])
          .returns();
        await adb.rotate();
      });
    });
    describe('power methods', function () {
      it('should throw exception on invalid power ac state', async function () {
        await adb.powerAC('dead').should.eventually.be.rejectedWith('Wrong power AC state');
      });
      it('should set the power ac off', async function () {
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'power', 'ac', adb.POWER_AC_STATES.POWER_AC_OFF])
          .returns();
        await adb.powerAC('off');
      });
      it('should set the power ac on', async function () {
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'power', 'ac', adb.POWER_AC_STATES.POWER_AC_ON])
          .returns();
        await adb.powerAC('on');
      });
      it('should throw exception on invalid power battery percent', async function () {
        await adb.powerCapacity(-1).should.eventually.be.rejectedWith('should be valid integer between 0 and 100');
        await adb.powerCapacity('a').should.eventually.be.rejectedWith('should be valid integer between 0 and 100');
        await adb.powerCapacity(500).should.eventually.be.rejectedWith('should be valid integer between 0 and 100');
      });
      it('should set the power capacity', async function () {
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'power', 'capacity', 0])
          .returns();
        await adb.powerCapacity(0);
      });
      it('should call methods to power off the emulator', async function () {
        mocks.adb.expects('powerAC')
          .once().withExactArgs('off')
          .returns();
        mocks.adb.expects('powerCapacity')
          .once().withExactArgs(0)
          .returns();
        await adb.powerOFF();
      });
    });
    describe('sendSMS', function () {
      it('should throw exception on invalid message', async function () {
        await adb.sendSMS('+549341312345678').should.eventually.be.rejectedWith('Sending an SMS requires a message');
      });
      it('should throw exception on invalid phoneNumber', async function () {
        await adb.sendSMS('00549341a312345678', 'Hello Appium').should.eventually.be.rejectedWith('Invalid sendSMS phoneNumber');
      });
      it('should call adbExec with the correct args', async function () {
        let phoneNumber = 4509;
        let message = ' Hello Appium ';
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'sms', 'send', '4509', 'Hello Appium'])
          .returns();
        await adb.sendSMS(phoneNumber, message);
      });
    });
    describe('gsm signal method', function () {
      it('should throw exception on invalid strength', async function () {
        await adb.gsmSignal(5).should.eventually.be.rejectedWith('Invalid signal strength');
      });
      it('should call adbExecEmu with the correct args', async function () {
        let signalStrength = 0;
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'gsm', 'signal-profile', signalStrength])
          .returns();
        await adb.gsmSignal(signalStrength);
      });
    });
    describe('gsm call methods', function () {
      it('should throw exception on invalid action', async function () {
        await adb.gsmCall('+549341312345678').should.eventually.be.rejectedWith('Invalid gsm action');
      });
      it('should throw exception on invalid phoneNumber', async function () {
        await adb.gsmCall('+5493413a12345678', 'call').should.eventually.be.rejectedWith('Invalid gsmCall phoneNumber');
      });
      it('should set the correct method for making gsm call', async function () {
        let phoneNumber = 4509;
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'gsm', adb.GSM_CALL_ACTIONS.GSM_CALL, '4509'])
          .returns();
        await adb.gsmCall(phoneNumber, 'call');
      });
      it('should set the correct method for accepting gsm call', async function () {
        let phoneNumber = 4509;
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'gsm', adb.GSM_CALL_ACTIONS.GSM_ACCEPT, '4509'])
          .returns();
        await adb.gsmCall(phoneNumber, 'accept');
      });
      it('should set the correct method for refusing gsm call', async function () {
        let phoneNumber = 4509;
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'gsm', adb.GSM_CALL_ACTIONS.GSM_CANCEL, '4509'])
          .returns();
        await adb.gsmCall(phoneNumber, 'cancel');
      });
      it('should set the correct method for holding gsm call', async function () {
        let phoneNumber = 4509;
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'gsm', adb.GSM_CALL_ACTIONS.GSM_HOLD, '4509'])
          .returns();
        await adb.gsmCall(phoneNumber, 'hold');
      });
    });
    describe('network speed method', function () {
      it('should throw exception on invalid speed', async function () {
        await adb.networkSpeed('light').should.eventually.be.rejectedWith('Invalid network speed');
      });
      for (let [key, value] of _.toPairs(adb.NETWORK_SPEED)) {
        it(`should set network speed(${key}) correctly`, async function () {
          mocks.adb.expects('isEmulatorConnected')
            .once().withExactArgs()
            .returns(true);
          mocks.adb.expects('resetTelnetAuthToken')
            .once().withExactArgs()
            .returns();
          mocks.adb.expects('adbExec')
            .once().withExactArgs(['emu', 'network', 'speed', value])
            .returns();
          await adb.networkSpeed(value);
        });
      }
    });
    describe('gsm voice method', function () {
      it('should throw exception on invalid strength', async function () {
        await adb.gsmVoice('weird').should.eventually.be.rejectedWith('Invalid gsm voice state');
      });
      it('should set gsm voice to unregistered', async function () {
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'gsm', 'voice', adb.GSM_VOICE_STATES.GSM_VOICE_UNREGISTERED])
          .returns();
        await adb.gsmVoice('unregistered');
      });
      it('should set gsm voice to home', async function () {
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'gsm', 'voice', adb.GSM_VOICE_STATES.GSM_VOICE_HOME])
          .returns();
        await adb.gsmVoice('home');
      });
      it('should set gsm voice to roaming', async function () {
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'gsm', 'voice', adb.GSM_VOICE_STATES.GSM_VOICE_ROAMING])
          .returns();
        await adb.gsmVoice('roaming');
      });
      it('should set gsm voice to searching', async function () {
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'gsm', 'voice', adb.GSM_VOICE_STATES.GSM_VOICE_SEARCHING])
          .returns();
        await adb.gsmVoice('searching');
      });
      it('should set gsm voice to denied', async function () {
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'gsm', 'voice', adb.GSM_VOICE_STATES.GSM_VOICE_DENIED])
          .returns();
        await adb.gsmVoice('denied');
      });
      it('should set gsm voice to off', async function () {
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'gsm', 'voice', adb.GSM_VOICE_STATES.GSM_VOICE_OFF])
          .returns();
        await adb.gsmVoice('off');
      });
      it('should set gsm voice to on', async function () {
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'gsm', 'voice', adb.GSM_VOICE_STATES.GSM_VOICE_ON])
          .returns();
        await adb.gsmVoice('on');
      });
    });
    describe('sensorSet method', function () {
      it('should throw exception on missing sensor name', async function () {
        await adb.sensorSet('sensor').should.eventually.be.rejectedWith('Unsupported sensor sent');
      });
      it('should throw exception on missing sensor name', async function () {
        await adb.sensorSet('light').should.eventually.be.rejectedWith('Missing sensor value argument');
      });
      it('should call adb emu sensor set with the correct values', async function () {
        mocks.adb.expects('isEmulatorConnected')
          .once().withExactArgs()
          .returns(true);
        mocks.adb.expects('resetTelnetAuthToken')
          .once().withExactArgs()
          .returns();
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'sensor', 'set', 'humidity', 100])
          .returns();
        await adb.sensorSet('humidity', 100);
      });
    });
  });
}));
