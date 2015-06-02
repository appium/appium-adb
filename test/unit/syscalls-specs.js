import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import ADB from '../../lib/adb.js';
import sinon from 'sinon';
import * as teen_process from 'teen_process';

chai.use(chaiAsPromised);

describe('System calls', () => {
  const adb = new ADB();
  let execStub;
  before(async () => {
    await adb.createADB();
  });
  beforeEach(() => {
    execStub = sinon.stub(teen_process, "exec");
  });
  afterEach(() => {
    teen_process.exec.restore();
  });

  it('getConnectedDevices should get all connected devices', async () => {
    execStub.returns({stdout :"List of devices attached \n emulator-5554	device"});
    let devices = await adb.getConnectedDevices();
    devices.should.have.length.above(0);
  });
  it('getDevicesWithRetry should fail when there are no connected devices', async () => {
    execStub.returns({stdout :"List of devices attached"});
    await adb.getDevicesWithRetry(1000).should.eventually.be
                                       .rejectedWith("Could not find a connected Android device.");
  });
  it('getDevicesWithRetry should get all connected devices', async () => {
    execStub.returns({stdout :"List of devices attached \n emulator-5554	device"});
    let devices = await adb.getDevicesWithRetry(1000);
    devices.should.have.length.above(0);
  });
  it('getDevicesWithRetry should get all connected devices second time', async () => {
    let getConnectedDevicesSpy = sinon.spy(adb, "getConnectedDevices");
    execStub.onCall(0).returns({stdout :"List of devices attached"});
    execStub.returns({stdout :"List of devices attached \n emulator-5554	device"});
    let devices = await adb.getDevicesWithRetry(2000);
    devices.should.have.length.above(0);
    getConnectedDevicesSpy.calledTwice.should.be.true;
    adb.getConnectedDevices.restore();
  });
});
