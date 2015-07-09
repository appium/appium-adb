import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import ADB from '../../lib/adb.js';
import * as teen_process from 'teen_process';
import { withMocks } from '../helpers';

chai.use(chaiAsPromised);
const adb = new ADB();
adb.executable.path = 'adb_path';

describe('System calls', withMocks({teen_process}, (mocks) => {
  it('getConnectedDevices should get all connected devices', async () => {
    mocks.teen_process.expects("exec")
      .once().withExactArgs(adb.executable.path, ['devices'])
      .returns({stdout:"List of devices attached \n emulator-5554	device"});
    let devices = await adb.getConnectedDevices();
    devices.should.have.length.above(0);
    mocks.teen_process.verify();
  });
  it('getConnectedDevices should fail when adb devices returns unexpected output', async () => {
    mocks.teen_process.expects("exec")
      .once().withExactArgs(adb.executable.path, ['devices'])
      .returns({stdout:"foobar"});
    await adb.getConnectedDevices().should.eventually.be
                                   .rejectedWith("Unexpected output while trying to get devices");
    mocks.teen_process.verify();
  });
  it('getDevicesWithRetry should fail when there are no connected devices', async () => {
    mocks.teen_process.expects("exec")
      .atLeast(2).withExactArgs(adb.executable.path, ['devices'])
      .returns({stdout:"List of devices attached"});
    await adb.getDevicesWithRetry(1000).should.eventually.be
                                       .rejectedWith("Could not find a connected Android device.");
    mocks.teen_process.verify();
  });
  it('getDevicesWithRetry should fail when adb devices returns unexpected output', async () => {
    mocks.teen_process.expects("exec")
      .atLeast(2).withExactArgs(adb.executable.path, ['devices'])
      .returns({stdout:"foobar"});
    await adb.getDevicesWithRetry(1000).should.eventually.be
                                       .rejectedWith("Could not find a connected Android device.");
    mocks.teen_process.verify();
  });
  it('getDevicesWithRetry should get all connected devices', async () => {
    mocks.teen_process.expects("exec")
      .once().withExactArgs(adb.executable.path, ['devices'])
      .returns({stdout:"List of devices attached \n emulator-5554	device"});
    let devices = await adb.getDevicesWithRetry(1000);
    devices.should.have.length.above(0);
    mocks.teen_process.verify();
  });
  it('getDevicesWithRetry should get all connected devices second time', async () => {
    mocks.teen_process.expects("exec")
      .onCall(0)
      .returns({stdout:"Foobar"});
    mocks.teen_process.expects("exec")
      .withExactArgs(adb.executable.path, ['devices'])
      .returns({stdout:"List of devices attached \n emulator-5554	device"});
    let devices = await adb.getDevicesWithRetry(2000);
    devices.should.have.length.above(0);
    mocks.teen_process.verify();
  });
  it('getDevicesWithRetry should fail when exec throws an error', async () => {
    mocks.teen_process.expects("exec")
      .atLeast(2)
      .throws("Error foobar");
    await adb.getDevicesWithRetry(1000).should.eventually.be
                                       .rejectedWith("Could not find a connected Android device.");
    mocks.teen_process.verify();
  });
  it('setDeviceId should set the device id', () => {
    adb.setDeviceId('foobar');
    adb.curDeviceId.should.equal('foobar');
    adb.executable.defaultArgs.should.include('foobar');
  });
  it('setDevice should set the device id and emu port from obj', () => {
    adb.setDevice({udid: 'emulator-1234'});
    adb.curDeviceId.should.equal('emulator-1234');
    adb.executable.defaultArgs.should.include('emulator-1234');
    adb.emulatorPort.should.equal(1234);
  });
}));
