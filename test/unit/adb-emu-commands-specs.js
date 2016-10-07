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
const fingerprint = 1111;

describe('adb emulator commands', () => {
  let adb = new ADB();
  describe("emu", () => {
    describe("isEmulatorConnected", withMocks({adb}, (mocks) => {
      it("should check emulator is connected", async () => {
        mocks.adb.expects("getConnectedEmulators")
          .atLeast(1).withExactArgs()
          .returns(emulators);
        (await adb.isEmulatorConnected("emulator-5554")).should.equal(true);
        (await adb.isEmulatorConnected("emulator-5556")).should.equal(true);
        (await adb.isEmulatorConnected("emulator-5558")).should.equal(false);
        mocks.adb.verify();
      });
    }));
    describe("fingerprint", withMocks({adb}, (mocks) => {
      it("should emit fingerprint without error", async () => {
        mocks.adb.expects("getConnectedEmulators")
          .atLeast(1).withExactArgs()
          .returns(emulators);
        mocks.adb.expects("getApiLevel")
          .atLeast(1).withExactArgs()
          .returns("23");
        mocks.adb.expects("setDeviceId")
          .once().withExactArgs("emulator-5554")
          .returns();
        mocks.adb.expects("setDeviceId")
          .once().withExactArgs("emulator-5556")
          .returns();
        mocks.adb.expects("adbExec")
          .atLeast(1)
          .withExactArgs(["emu", "finger", "touch", fingerprint])
          .returns("");
        await adb.fingerprint(fingerprint);
        await adb.fingerprint(fingerprint, "emulator-5554");
        await adb.fingerprint(fingerprint, "emulator-5556");
        mocks.adb.verify();
      });
      it("should throw an error on fingerprint argument undefined", async () => {
        await adb.fingerprint().should.eventually.be.rejected;
        mocks.adb.verify();
      });
      it("should throw an error on emulator not connected", async () => {
        mocks.adb.expects("getApiLevel")
          .atLeast(1).withExactArgs()
          .returns("23");
        mocks.adb.expects("getConnectedEmulators")
          .once().withExactArgs()
          .returns(emulators);
        await adb.fingerprint(1111, "emulator-5558").should.eventually.be.rejected;
        mocks.adb.verify();
      });
      it("should throw an error on no emulators connected", async () => {
        mocks.adb.expects("getApiLevel")
          .atLeast(1).withExactArgs()
          .returns("23");
        mocks.adb.expects("getConnectedEmulators")
          .atLeast(1).withExactArgs()
          .returns([]);
        await adb.fingerprint(1111).should.eventually.be.rejected;
        mocks.adb.verify();
      });
      it("should throw an error on emulator Api Level < 23", async () => {
        mocks.adb.expects("getApiLevel")
          .once().withExactArgs()
          .returns("22");
        await adb.fingerprint(1111).should.eventually.be.rejected;
        mocks.adb.verify();
      });
    }));
  });
});
