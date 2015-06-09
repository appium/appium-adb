import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import ADB from '../../lib/adb.js';
import sinon from 'sinon';
import * as teen_process from 'teen_process';

chai.use(chaiAsPromised);

describe('System calls', () => {
  const adb = new ADB();
  let execStub, getConnectedDevicesSpy;
  beforeEach(() => {
    getConnectedDevicesSpy = sinon.spy(adb, "getConnectedDevices");
    execStub = sinon.stub(teen_process, "exec");
  });
  afterEach(() => {
    teen_process.exec.restore();
    adb.getConnectedDevices.restore();
  });

  it('getConnectedDevices should get all connected devices', async () => {
    execStub.returns({stdout:"List of devices attached \n emulator-5554	device"});
    let devices = await adb.getConnectedDevices();
    devices.should.have.length.above(0);
  });
  it('getConnectedDevices should fail when adb devices returns unexpected output', async () => {
    execStub.returns({stdout:"foobar"});
    await adb.getConnectedDevices().should.eventually.be
                                   .rejectedWith("Unexpected output while trying to get devices");
  });
  it('getDevicesWithRetry should fail when there are no connected devices', async () => {
    execStub.returns({stdout:"List of devices attached"});
    await adb.getDevicesWithRetry(1000).should.eventually.be
                                       .rejectedWith("Could not find a connected Android device.");
    getConnectedDevicesSpy.callCount.should.be.at.least(2);
  });
  it('getDevicesWithRetry should fail when adb devices returns unexpected output', async () => {
    execStub.returns({stdout:"foobar"});
    await adb.getDevicesWithRetry(1000).should.eventually.be
                                       .rejectedWith("Could not find a connected Android device.");
    getConnectedDevicesSpy.callCount.should.be.at.least(2);
  });
  it('getDevicesWithRetry should get all connected devices', async () => {
    execStub.returns({stdout:"List of devices attached \n emulator-5554	device"});
    let devices = await adb.getDevicesWithRetry(1000);
    devices.should.have.length.above(0);
    getConnectedDevicesSpy.calledOnce.should.be.true;
  });
  it('getDevicesWithRetry should get all connected devices second time', async () => {
    execStub.onCall(0).returns({stdout:"Foobar"});
    execStub.returns({stdout:"List of devices attached \n emulator-5554	device"});
    let devices = await adb.getDevicesWithRetry(2000);
    devices.should.have.length.above(0);
    getConnectedDevicesSpy.calledTwice.should.be.true;
  });
  it('getDevicesWithRetry should fail when exec throws an error', async () => {
    execStub.throws("Error foobar");
    await adb.getDevicesWithRetry(1000).should.eventually.be
                                       .rejectedWith("Could not find a connected Android device.");
    getConnectedDevicesSpy.callCount.should.be.at.least(2);
  });
});
