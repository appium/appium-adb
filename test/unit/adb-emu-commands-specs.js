import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import { withMocks } from 'appium-test-support';


chai.use(chaiAsPromised);
chai.should();

const emulators = [
  { udid: 'emulator-5554', state: 'device', port: 5554 },
  { udid: 'emulator-5556', state: 'device', port: 5556 },
];
const fingerprintId = 1111;

describe('adb emulator commands', () => {
  let adb = new ADB();
  describe("emu", () => {
    describe("getEmulators", withMocks({adb}, (mocks) => {
      it("should cache emulators list", async () => {
        mocks.adb.expects("getConnectedEmulators")
          .once().withExactArgs()
          .returns(emulators);
        (await adb.isEmulatorConnected("emulator-5554")).should.equal(true);
        (await adb.isEmulatorConnected("emulator-5554")).should.equal(true);
        adb.emulators.should.equal(emulators);
        mocks.adb.verify();
      });
    }));
    describe("isEmulatorConnected", withMocks({adb}, (mocks) => {
      it("should verify emulators state", async () => {
        (await adb.isEmulatorConnected("emulator-5554")).should.equal(true);
        (await adb.isEmulatorConnected("emulator-5556")).should.equal(true);
        (await adb.isEmulatorConnected("emulator-5558")).should.equal(false);
        mocks.adb.verify();
      });
    }));
    describe("checkEmulatorConnected", withMocks({adb}, (mocks) => {
      it("should throw exception no emulators connected", async () => {
        delete adb.emulators;
        mocks.adb.expects("getConnectedEmulators")
          .once().withExactArgs()
          .returns([]);
        await adb.checkEmulatorConnected().should.eventually.be.rejected;
        await adb.checkEmulatorConnected("emulator-5554").should.eventually.be.rejected;
        mocks.adb.verify();
      });
      it("should setDeviceId on emulator connected", async () => {
        mocks.adb.expects("isEmulatorConnected")
          .once().withExactArgs("emulator-5554")
          .returns(true);
        mocks.adb.expects("setDeviceId")
          .once().withExactArgs("emulator-5554")
          .returns(emulators);
        await adb.checkEmulatorConnected("emulator-5554");
        mocks.adb.verify();
      });
    }));
    describe("fingerprint", withMocks({adb}, (mocks) => {
      it("should throw exception on undefined fingerprintId", async () => {
        await adb.fingerprint().should.eventually.be.rejected;
        mocks.adb.verify();
      });
      it("should throw exception on apiLevel lower than 23", async () => {
        mocks.adb.expects("getApiLevel")
          .once().withExactArgs()
          .returns(21);
        await adb.fingerprint(fingerprintId).should.eventually.be.rejected;
        mocks.adb.verify();
      });
      it("should call adbExec with the correct args", async () => {
        mocks.adb.expects("getApiLevel")
          .once().withExactArgs()
          .returns(23);
        mocks.adb.expects("getConnectedEmulators")
          .once().withExactArgs()
          .returns(emulators);
        mocks.adb.expects("resetTelnetAuthToken")
          .once().withExactArgs()
          .returns();
        mocks.adb.expects("adbExec")
          .once().withExactArgs(["emu", "finger", "touch", fingerprintId])
          .returns();
        await adb.fingerprint(fingerprintId);
        mocks.adb.verify();
      });
    }));
    describe("rotate", withMocks({adb}, (mocks) => {
      it("should call adbExec with the correct args", async () => {
        delete adb.emulators;
        mocks.adb.expects("getConnectedEmulators")
          .once().withExactArgs()
          .returns(emulators);
        mocks.adb.expects("resetTelnetAuthToken")
          .once().withExactArgs()
          .returns();
        mocks.adb.expects("adbExec")
          .once().withExactArgs(["emu", "rotate"])
          .returns();
        await adb.rotate();
        mocks.adb.verify();
      });
    }));
  });
});
