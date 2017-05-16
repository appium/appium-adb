import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import * as teen_process from 'teen_process';
import { withMocks } from 'appium-test-support';
import B from 'bluebird';
import _ from 'lodash';


chai.use(chaiAsPromised);
const adb = new ADB();
adb.executable.path = 'adb_path';
const avdName = 'AVD_NAME';

describe('System calls', withMocks({teen_process}, (mocks) => {
  it('getConnectedDevices should get all connected devices', async () => {
    mocks.teen_process.expects("exec")
      .once().withExactArgs(adb.executable.path, ['devices'])
      .returns({stdout:"List of devices attached \n emulator-5554	device"});
    let devices = await adb.getConnectedDevices();
    devices.should.have.length.above(0);
    mocks.teen_process.verify();
  });
  it('getConnectedDevices should get all connected devices which have valid udid', async () => {
    let stdoutValue = "List of devices attached \n" +
                      "adb server version (32) doesn't match this client (36); killing...\n" +
                      "* daemon started successfully *\n" +
                      "emulator-5554	device";
    mocks.teen_process.expects("exec")
      .once().withExactArgs(adb.executable.path, ['devices'])
      .returns({stdout:stdoutValue});

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
  it('setEmulatorPort should change emulator port', () => {
    adb.setEmulatorPort(5554);
    adb.emulatorPort.should.equal(5554);
  });
  describe('createSubProcess', () => {
    it('should return an instance of SubProcess', () => {
      adb.createSubProcess([]).should.be.an.instanceof(teen_process.SubProcess);
    });
  });
}));

describe('System calls',  withMocks({adb, B, teen_process}, (mocks) => {
  it('should return adb version', async () => {
    mocks.adb.expects("adbExec")
      .once()
      .withExactArgs('version')
      .returns("Android Debug Bridge version 1.0.39\nRevision 5943271ace17-android");
    let adbVersion = await adb.getAdbVersion();
    adbVersion.versionString.should.equal("1.0.39");
    adbVersion.versionFloat.should.be.within(1.0, 1.0);
    adbVersion.major.should.equal(1);
    adbVersion.minor.should.equal(0);
    adbVersion.patch.should.equal(39);
    mocks.adb.verify();
  });
  it('should cache adb results', async () => {
    adb.getAdbVersion.cache = new _.memoize.Cache();
    mocks.adb.expects("adbExec")
      .once()
      .withExactArgs('version')
      .returns("Android Debug Bridge version 1.0.39\nRevision 5943271ace17-android");
    await adb.getAdbVersion();
    await adb.getAdbVersion();
    mocks.adb.verify();
  });
  it('fileExists should return true for if ls returns', async () => {
    mocks.adb.expects("ls")
      .once().withExactArgs('foo')
      .returns(['bar']);
    await adb.fileExists("foo").should.eventually.equal(true);
    mocks.adb.verify();
  });
  it('ls should return list', async () => {
    mocks.adb.expects("shell")
      .once().withExactArgs(['ls', 'foo'])
      .returns('bar');
    let list = await adb.ls("foo");
    list.should.deep.equal(['bar']);
    mocks.adb.verify();
  });
  it('reboot should call stop and start using shell', async () => {
    mocks.adb.expects("shell")
      .once().withExactArgs(['stop']);
    mocks.adb.expects("setDeviceProperty")
      .once().withExactArgs('sys.boot_completed', 0);
    mocks.adb.expects("shell")
      .once().withExactArgs(['start']);
    mocks.adb.expects("getDeviceProperty")
      .once().withExactArgs('sys.boot_completed')
      .returns('1');
    mocks.B.expects("delay")
      .once().withExactArgs(2000);
    await adb.reboot().should.eventually.not.be.rejected;
    mocks.adb.verify();
    mocks.B.verify();
  });
  it('reboot should restart adbd as root if necessary', async () => {
    mocks.teen_process.expects("exec")
      .once().withExactArgs(adb.executable.path, ['root'])
      .returns(false);
    mocks.adb.expects("shell")
      .twice().withExactArgs(['stop'])
      .onFirstCall()
        .throws(new Error(`Error executing adbExec. Original error: 'Command 'adb shell stop' exited with code 1'; Stderr: 'stop: must be root'; Code: '1'`))
      .onSecondCall().returns();
    mocks.adb.expects("setDeviceProperty")
      .once().withExactArgs('sys.boot_completed', 0);
    mocks.adb.expects("shell")
      .once().withExactArgs(['start']);
    mocks.adb.expects("getDeviceProperty")
      .once().withExactArgs('sys.boot_completed')
      .returns('1');
    mocks.B.expects("delay")
      .once().withExactArgs(2000);
    await adb.reboot().should.eventually.not.be.rejected;
    mocks.adb.verify();
    mocks.B.verify();
  });
  it('getRunningAVD should get connected avd', async () => {
    let udid = 'emulator-5554';
    let port = 5554;
    let emulator = {udid, port};
    mocks.adb.expects("getConnectedEmulators")
      .once().withExactArgs()
      .returns([emulator]);
    mocks.adb.expects("setEmulatorPort")
      .once().withExactArgs(port);
    mocks.adb.expects("sendTelnetCommand")
      .once().withExactArgs("avd name")
      .returns(avdName);
    mocks.adb.expects("setDeviceId")
      .once().withExactArgs(udid);
    (await adb.getRunningAVD(avdName)).should.equal(emulator);
    mocks.adb.verify();
  });
  it('getRunningAVD should return null when expected avd is not connected', async () => {
    let udid = 'emulator-5554';
    let port = 5554;
    let emulator = {udid, port};
    mocks.adb.expects("getConnectedEmulators")
      .once().withExactArgs()
      .returns([emulator]);
    mocks.adb.expects("setEmulatorPort")
      .once().withExactArgs(port);
    mocks.adb.expects("sendTelnetCommand")
      .once().withExactArgs("avd name")
      .returns('OTHER_AVD');
    chai.expect(await adb.getRunningAVD(avdName)).to.be.null;
    mocks.adb.verify();
  });
  it('getRunningAVD should return null when no avd is connected', async () => {
    mocks.adb.expects("getConnectedEmulators")
      .once().withExactArgs()
      .returns([]);
    chai.expect(await adb.getRunningAVD(avdName)).to.be.null;
    mocks.adb.verify();
  });
}));
