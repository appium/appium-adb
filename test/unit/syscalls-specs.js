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

describe('System calls', withMocks({teen_process}, function (mocks) {
  afterEach(function () {
    mocks.verify();
  });

  describe('getConnectedDevices', function () {
    it('should get all connected devices', async function () {
      mocks.teen_process.expects('exec')
        .once().withExactArgs(adb.executable.path, ['-P', 5037, 'devices'])
        .returns({stdout: 'List of devices attached \n emulator-5554	device'});
      let devices = await adb.getConnectedDevices();
      devices.should.have.length.above(0);
    });
    it('should get all connected devices which have valid udid', async function () {
      let stdoutValue = 'List of devices attached \n' +
                        "adb server version (32) doesn't match this client (36); killing...\n" +
                        '* daemon started successfully *\n' +
                        'emulator-5554	device';
      mocks.teen_process.expects('exec')
        .once().withExactArgs(adb.executable.path, ['-P', 5037, 'devices'])
        .returns({stdout: stdoutValue});

      let devices = await adb.getConnectedDevices();
      devices.should.have.length.above(0);
    });
    it('should fail when adb devices returns unexpected output', async function () {
      mocks.teen_process.expects('exec')
        .once().withExactArgs(adb.executable.path, ['-P', 5037, 'devices'])
        .returns({stdout: 'foobar'});
      await adb.getConnectedDevices().should.eventually.be
                                     .rejectedWith('Unexpected output while trying to get devices');
    });
  });
  describe('getDevicesWithRetry', function () {
    it('should fail when there are no connected devices', async function () {
      this.timeout(20000);
      mocks.teen_process.expects('exec')
        .atLeast(2).withExactArgs(adb.executable.path, ['-P', 5037, 'devices'])
        .returns({stdout: 'List of devices attached'});
      mocks.teen_process.expects('exec')
        .atLeast(2).withExactArgs(adb.executable.path, ['-P', 5037, 'kill-server']);
      await adb.getDevicesWithRetry(1000)
        .should.eventually.be.rejectedWith(/Could not find a connected Android device/);
    });
    it('should fail when adb devices returns unexpected output', async function () {
      mocks.teen_process.expects('exec')
        .atLeast(2).withExactArgs(adb.executable.path, ['-P', 5037, 'devices'])
        .returns({stdout: 'foobar'});
      mocks.teen_process.expects('exec')
        .atLeast(2).withExactArgs(adb.executable.path, ['-P', 5037, 'kill-server']);
      await adb.getDevicesWithRetry(1000)
        .should.eventually.be.rejectedWith(/Could not find a connected Android device/);
    });
    it('should get all connected devices', async function () {
      mocks.teen_process.expects('exec')
        .once().withExactArgs(adb.executable.path, ['-P', 5037, 'devices'])
        .returns({stdout: 'List of devices attached \n emulator-5554	device'});
      const devices = await adb.getDevicesWithRetry(1000);
      devices.should.have.length.above(0);
    });
    it('should get all connected devices second time', async function () {
      mocks.teen_process.expects('exec')
        .onCall(0)
        .returns({stdout: 'Foobar'});
      mocks.teen_process.expects('exec')
        .withExactArgs(adb.executable.path, ['-P', 5037, 'devices'])
        .returns({stdout: 'List of devices attached \n emulator-5554	device'});
      mocks.teen_process.expects('exec')
        .once().withExactArgs(adb.executable.path, ['-P', 5037, 'kill-server']);
      const devices = await adb.getDevicesWithRetry(2000);
      devices.should.have.length.above(0);
    });
    it('should fail when exec throws an error', async function () {
      mocks.teen_process.expects('exec')
        .atLeast(2)
        .throws('Error foobar');
      await adb.getDevicesWithRetry(1000)
        .should.eventually.be.rejectedWith(/Could not find a connected Android device/);
    });
  });
  describe('setDeviceId', function () {
    it('should set the device id', function () {
      adb.setDeviceId('foobar');
      adb.curDeviceId.should.equal('foobar');
      adb.executable.defaultArgs.should.include('foobar');
    });
    it('should set the device id and emu port from obj', function () {
      adb.setDevice({udid: 'emulator-1234'});
      adb.curDeviceId.should.equal('emulator-1234');
      adb.executable.defaultArgs.should.include('emulator-1234');
      adb.emulatorPort.should.equal(1234);
    });
  });
  describe('setEmulatorPort', function () {
    it('should change emulator port', function () {
      adb.setEmulatorPort(5554);
      adb.emulatorPort.should.equal(5554);
    });
  });
  describe('createSubProcess', function () {
    it('should return an instance of SubProcess', function () {
      adb.createSubProcess([]).should.be.an.instanceof(teen_process.SubProcess);
    });
  });
}));

describe('System calls', withMocks({adb, B, teen_process}, function (mocks) {
  afterEach(function () {
    mocks.verify();
  });

  it('should return adb version', async function () {
    mocks.adb.expects('adbExec')
      .once()
      .withExactArgs('version')
      .returns('Android Debug Bridge version 1.0.39\nRevision 5943271ace17-android');
    let adbVersion = await adb.getAdbVersion();
    adbVersion.versionString.should.equal('1.0.39');
    adbVersion.versionFloat.should.be.within(1.0, 1.0);
    adbVersion.major.should.equal(1);
    adbVersion.minor.should.equal(0);
    adbVersion.patch.should.equal(39);
  });
  it('should cache adb results', async function () {
    adb.getAdbVersion.cache = new _.memoize.Cache();
    mocks.adb.expects('adbExec')
      .once()
      .withExactArgs('version')
      .returns('Android Debug Bridge version 1.0.39\nRevision 5943271ace17-android');
    await adb.getAdbVersion();
    await adb.getAdbVersion();
  });
  it('fileExists should return true for if ls returns', async function () {
    mocks.adb.expects('ls')
      .once().withExactArgs('foo')
      .returns(['bar']);
    await adb.fileExists('foo').should.eventually.equal(true);
  });
  it('ls should return list', async function () {
    mocks.adb.expects('shell')
      .once().withExactArgs(['ls', 'foo'])
      .returns('bar');
    let list = await adb.ls('foo');
    list.should.deep.equal(['bar']);
  });
  it('fileSize should return the file size when digit is after permissions', async function () {
    let remotePath = '/sdcard/test.mp4';
    mocks.adb.expects('shell')
      .once().withExactArgs(['ls', '-la', remotePath])
      .returns(`-rw-rw---- 1 root sdcard_rw 39571 2017-06-23 07:33 ${remotePath}`);
    let size = await adb.fileSize(remotePath);
    size.should.eql(39571);
  });
  it('fileSize should return the file size when digit is not after permissions', async function () {
    let remotePath = '/sdcard/test.mp4';
    mocks.adb.expects('shell')
      .once().withExactArgs(['ls', '-la', remotePath])
      .returns(`-rw-rw---- root sdcard_rw 39571 2017-06-23 07:33 ${remotePath}`);
    let size = await adb.fileSize(remotePath);
    size.should.eql(39571);
  });
  describe('reboot', function () {
    it('should call stop and start using shell', async function () {
      mocks.adb.expects('shell')
        .once().withExactArgs(['stop']);
      mocks.adb.expects('setDeviceProperty')
        .once().withExactArgs('sys.boot_completed', 0);
      mocks.adb.expects('shell')
        .once().withExactArgs(['start']);
      mocks.adb.expects('getDeviceProperty')
        .once().withExactArgs('sys.boot_completed')
        .returns('1');
      mocks.B.expects('delay')
        .once().withExactArgs(2000);
      await adb.reboot().should.eventually.not.be.rejected;
    });
    it('should restart adbd as root if necessary', async function () {
      mocks.teen_process.expects('exec')
        .once().withExactArgs(adb.executable.path, ['root'])
        .returns(false);
      mocks.adb.expects('shell')
        .twice().withExactArgs(['stop'])
        .onFirstCall()
          .throws(new Error(`Error executing adbExec. Original error: 'Command 'adb shell stop' exited with code 1'; Stderr: 'stop: must be root'; Code: '1'`))
        .onSecondCall().returns();
      mocks.adb.expects('setDeviceProperty')
        .once().withExactArgs('sys.boot_completed', 0);
      mocks.adb.expects('shell')
        .once().withExactArgs(['start']);
      mocks.adb.expects('getDeviceProperty')
        .once().withExactArgs('sys.boot_completed')
        .returns('1');
      mocks.B.expects('delay')
        .once().withExactArgs(2000);
      await adb.reboot().should.eventually.not.be.rejected;
    });
    it('should error with helpful message if cause of error is no root access', async function () {
      mocks.adb.expects('isRoot').once().returns(false);
      mocks.adb.expects('root').once().returns({wasAlreadyRooted: false});
      mocks.adb.expects('shell')
        .once().throws(new Error('something something ==must be root== something something'));
      await adb.reboot().should.eventually.be.rejectedWith(/requires root access/);
    });
    it('should throw original error if cause of error is something other than no root access', async function () {
      const originalError = 'some original error';
      mocks.adb.expects('shell')
        .once().throws(new Error(originalError));
      await adb.reboot().should.eventually.be.rejectedWith(originalError);
    });
  });
  describe('getRunningAVD', function () {
    it('should get connected avd', async function () {
      let udid = 'emulator-5554';
      let port = 5554;
      let emulator = {udid, port};
      mocks.adb.expects('getConnectedEmulators')
        .once().withExactArgs()
        .returns([emulator]);
      mocks.adb.expects('setEmulatorPort')
        .once().withExactArgs(port);
      mocks.adb.expects('sendTelnetCommand')
        .once().withExactArgs('avd name')
        .returns(avdName);
      mocks.adb.expects('setDeviceId')
        .once().withExactArgs(udid);
      (await adb.getRunningAVD(avdName)).should.equal(emulator);
    });
    it('should return null when expected avd is not connected', async function () {
      let udid = 'emulator-5554';
      let port = 5554;
      let emulator = {udid, port};
      mocks.adb.expects('getConnectedEmulators')
        .once().withExactArgs()
        .returns([emulator]);
      mocks.adb.expects('setEmulatorPort')
        .once().withExactArgs(port);
      mocks.adb.expects('sendTelnetCommand')
        .once().withExactArgs('avd name')
        .returns('OTHER_AVD');
      chai.expect(await adb.getRunningAVD(avdName)).to.be.null;
    });
    it('should return null when no avd is connected', async function () {
      mocks.adb.expects('getConnectedEmulators')
        .once().withExactArgs()
        .returns([]);
      chai.expect(await adb.getRunningAVD(avdName)).to.be.null;
    });
  });

  describe('root', function () {
    it('should restart adb if root throws err and stderr contains "closed" in message', async function () {
      mocks.adb.expects('isRoot').once().returns(false);
      mocks.adb.expects('adbExec')
        .once()
        .withExactArgs(['root'])
        .throws({
          stdout: '',
          stderr: 'adb: unable to connect for root: closed\n',
          code: 1
        });
      mocks.adb.expects('restartAdb').once();
      await adb.root().should.eventually.eql({isSuccessful: false, wasAlreadyRooted: false});
    });
    it('should not restart adb if root throws err but stderr does not contain "closed" in message', async function () {
      mocks.adb.expects('isRoot').once().returns(false);
      mocks.adb.expects('adbExec')
        .once()
        .withExactArgs(['root'])
        .throws({
          stdout: '',
          stderr: 'some error that does not close device',
          code: 1
        });
      mocks.adb.expects('restartAdb').never();
      await adb.root().should.eventually.eql({isSuccessful: false, wasAlreadyRooted: false});
    });
    it('should call "unroot" on shell if call .unroot', async function () {
      mocks.adb.expects('isRoot').once().returns(false);
      mocks.adb.expects('adbExec')
        .once()
        .withExactArgs(['unroot'])
        .returns({stdout: 'Hello World'});
      await adb.unroot().should.eventually.eql({isSuccessful: true, wasAlreadyRooted: false});
    });
    it('should tell us if "wasAlreadyRooted"', async function () {
      mocks.adb.expects('isRoot').once().returns(false);
      mocks.adb.expects('adbExec')
        .once()
        .withExactArgs(['root'])
        .returns({stdout: 'Something something already running as root something something'});
      await adb.root().should.eventually.eql({isSuccessful: true, wasAlreadyRooted: true});
    });
    it('should not call root if isRoot returns true', async function () {
      mocks.adb.expects('isRoot').once().returns(true);
      mocks.adb.expects('adbExec').never();
      await adb.root().should.eventually.eql({isSuccessful: true, wasAlreadyRooted: true});
    });
    it('should not call unroot if isRoot returns false', async function () {
      mocks.adb.expects('isRoot').once().returns(false);
      mocks.adb.expects('adbExec').never();
      await adb.unroot().should.eventually.eql({isSuccessful: true, wasAlreadyRooted: false});
    });
    it('should return unsuccessful if "adbd cannot run as root" in stdout', async function () {
      mocks.adb.expects('isRoot').once().returns(false);
      mocks.adb.expects('adbExec').once()
        .returns({stdout: 'something something adbd cannot run as root something smoething'});
      await adb.root().should.eventually.eql({isSuccessful: false, wasAlreadyRooted: false});
    });
  });
}));
