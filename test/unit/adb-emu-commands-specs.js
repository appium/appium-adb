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
    describe("isEmulatorConnected", withMocks({adb}, (mocks) => {
      it("should verify emulators state", async () => {
        mocks.adb.expects("getConnectedEmulators")
          .atLeast(3)
          .returns(emulators);
        adb.curDeviceId = "emulator-5554";
        (await adb.isEmulatorConnected()).should.equal(true);
        adb.curDeviceId = "emulator-5556";
        (await adb.isEmulatorConnected()).should.equal(true);
        adb.curDeviceId = "emulator-5558";
        (await adb.isEmulatorConnected()).should.equal(false);
        mocks.adb.verify();
      });
    }));
    describe("checkEmulatorConnected", withMocks({adb}, (mocks) => {
      it("should throw an exception on emulator not connected", async () => {
        adb.curDeviceId = "emulator-5558";
        mocks.adb.expects("isEmulatorConnected")
          .once()
          .returns(false);
        await adb.checkEmulatorConnected().should.eventually.be.rejected;
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
        mocks.adb.expects("isEmulatorConnected")
          .once().withExactArgs()
          .returns(true);
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
        mocks.adb.expects("isEmulatorConnected")
          .once().withExactArgs()
          .returns(true);
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
