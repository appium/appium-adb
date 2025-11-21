import {ADB} from '../../lib/adb';
import * as teen_process from 'teen_process';
import { withMocks } from '@appium/test-support';
import B from 'bluebird';

const adb = new ADB();
adb.executable.path = 'adb_path';
const avdName = 'AVD_NAME';

describe('system calls', withMocks({teen_process}, function (mocks) {
  let chai;
  let expect;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    expect = chai.expect;
    chai.use(chaiAsPromised.default);
  });

  afterEach(function () {
    (mocks as any).verify();
  });

  describe('getConnectedDevices', function () {
    it('should get all connected devices', async function () {
      (mocks as any).teen_process.expects('exec')
        .once().withExactArgs(adb.executable.path, ['-P', '5037', 'devices'])
        .returns({stdout: 'List of devices attached \n emulator-5554	device'});
      const devices = await adb.getConnectedDevices();
      expect(devices).to.have.length.above(0);
      expect(devices).to.deep.equal([{udid: 'emulator-5554', state: 'device'}]);
    });
    it('should get all connected devices which have valid udid', async function () {
      const stdoutValue = 'List of devices attached \n' +
                        "adb server version (32) doesn't match this client (36); killing...\n" +
                        '* daemon started successfully *\n' +
                        'emulator-5554	device';
      (mocks as any).teen_process.expects('exec')
        .once().withExactArgs(adb.executable.path, ['-P', '5037', 'devices'])
        .returns({stdout: stdoutValue});

      const devices = await adb.getConnectedDevices();
      expect(devices).to.have.length.above(0);
    });
    it('should fail when adb devices returns unexpected output', async function () {
      (mocks as any).teen_process.expects('exec')
        .once().withExactArgs(adb.executable.path, ['-P', '5037', 'devices'])
        .returns({stdout: 'foobar'});
      await expect(adb.getConnectedDevices()).to.eventually.be
                                     .rejectedWith('Unexpected output while trying to get devices');
    });
    it('should get all connected devices with verbose output', async function () {
      (mocks as any).teen_process.expects('exec')
        .once().withExactArgs(adb.executable.path, ['-P', '5037', 'devices', '-l'])
        .returns({stdout: 'List of devices attached \nemulator-5556 device product:sdk_google_phone_x86_64 model:Android_SDK_built_for_x86_64 device:generic_x86_64\n0a388e93      device usb:1-1 product:razor model:Nexus_7 device:flo'});
      const devices = await adb.getConnectedDevices({verbose: true});
      expect(devices).to.have.length.above(0);
      expect(devices).to.deep.equal([
        {udid: 'emulator-5556', state: 'device', product: 'sdk_google_phone_x86_64', model: 'Android_SDK_built_for_x86_64', device: 'generic_x86_64'},
        {udid: '0a388e93', state: 'device', usb: '1-1', product: 'razor', model: 'Nexus_7', device: 'flo'},
      ]);
    });
  });
  describe('getDevicesWithRetry', function () {
    it('should fail when there are no connected devices', async function () {
      this.timeout(20000);
      (mocks as any).teen_process.expects('exec')
        .atLeast(2).withExactArgs(adb.executable.path, ['-P', '5037', 'devices'])
        .returns({stdout: 'List of devices attached'});
      (mocks as any).teen_process.expects('exec')
        .atLeast(2).withExactArgs(adb.executable.path, ['-P', '5037', 'kill-server']);
      await expect(adb.getDevicesWithRetry(1000)).to.eventually.be.rejectedWith(/Could not find a connected Android device/);
    });
    it('should fail when adb devices returns unexpected output', async function () {
      (mocks as any).teen_process.expects('exec')
        .atLeast(2).withExactArgs(adb.executable.path, ['-P', '5037', 'devices'])
        .returns({stdout: 'foobar'});
      (mocks as any).teen_process.expects('exec')
        .atLeast(2).withExactArgs(adb.executable.path, ['-P', '5037', 'kill-server']);
      await expect(adb.getDevicesWithRetry(1000)).to.eventually.be.rejectedWith(/Could not find a connected Android device/);
    });
    it('should get all connected devices', async function () {
      (mocks as any).teen_process.expects('exec')
        .once().withExactArgs(adb.executable.path, ['-P', '5037', 'devices'])
        .returns({stdout: 'List of devices attached \n emulator-5554	device'});
      const devices = await adb.getDevicesWithRetry(1000);
      expect(devices).to.have.length.above(0);
    });
    it('should get all connected devices second time', async function () {
      (mocks as any).teen_process.expects('exec')
        .onCall(0)
        .returns({stdout: 'Foobar'});
      (mocks as any).teen_process.expects('exec')
        .withExactArgs(adb.executable.path, ['-P', '5037', 'devices'])
        .returns({stdout: 'List of devices attached \n emulator-5554	device'});
      (mocks as any).teen_process.expects('exec')
        .once().withExactArgs(adb.executable.path, ['-P', '5037', 'kill-server']);
      const devices = await adb.getDevicesWithRetry(2000);
      expect(devices).to.have.length.above(0);
    });
    it('should fail when exec throws an error', async function () {
      (mocks as any).teen_process.expects('exec')
        .atLeast(2)
        .throws('Error foobar');
      await expect(adb.getDevicesWithRetry(1000)).to.eventually.be.rejectedWith(/Could not find a connected Android device/);
    });
  });
  describe('setDeviceId', function () {
    it('should set the device id', function () {
      adb.setDeviceId('foobar');
      expect(adb.curDeviceId).to.equal('foobar');
      expect(adb.executable.defaultArgs).to.include('foobar');
    });
    it('should set the device id and emu port from obj', function () {
      adb.setDevice({udid: 'emulator-1234'} as any);
      expect(adb.curDeviceId).to.equal('emulator-1234');
      expect(adb.executable.defaultArgs).to.include('emulator-1234');
      expect(adb.emulatorPort).to.equal(1234);
    });
  });
  describe('setEmulatorPort', function () {
    it('should change emulator port', function () {
      adb.setEmulatorPort(5554);
      expect(adb.emulatorPort).to.equal(5554);
    });
  });
  describe('createSubProcess', function () {
    it('should return an instance of SubProcess', function () {
      expect(adb.createSubProcess([])).to.be.an.instanceof(teen_process.SubProcess);
    });
  });
}));

describe('System calls 2', withMocks({adb, B, teen_process}, function (mocks) {
  let chai;
  let expect;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    expect = chai.expect;
    chai.use(chaiAsPromised.default);
  });

  afterEach(function () {
    (mocks as any).verify();
  });

  it('fileExists should return true if file/dir exists', async function () {
    (mocks as any).adb.expects('shell')
      .once().withExactArgs([`[ -e 'foo' ] && echo __PASS__`])
      .returns('__PASS__');
    await expect(adb.fileExists('foo')).to.eventually.equal(true);
  });
  it('ls should return list', async function () {
    (mocks as any).adb.expects('shell')
      .once().withExactArgs(['ls', 'foo'])
      .returns('bar');
    const list = await adb.ls('foo');
    expect(list).to.deep.equal(['bar']);
  });
  it('fileSize should return the file size when digit is after permissions', async function () {
    const remotePath = '/sdcard/test.mp4';
    (mocks as any).adb.expects('shell')
      .once().withExactArgs(['ls', '-la', remotePath])
      .returns(`-rw-rw---- 1 root sdcard_rw 39571 2017-06-23 07:33 ${remotePath}`);
    const size = await adb.fileSize(remotePath);
    expect(size).to.eql(39571);
  });
  it('fileSize should return the file size when digit is not after permissions', async function () {
    const remotePath = '/sdcard/test.mp4';
    (mocks as any).adb.expects('shell')
      .once().withExactArgs(['ls', '-la', remotePath])
      .returns(`-rw-rw---- root sdcard_rw 39571 2017-06-23 07:33 ${remotePath}`);
    const size = await adb.fileSize(remotePath);
    expect(size).to.eql(39571);
  });
  describe('shell outputFormat option', function () {
    beforeEach(function () {
      (mocks as any).teen_process.expects('exec')
      .once()
      .returns({stdout: 'a value', stderr: 'an error', code: 0});
    });
    it('should default to stdout', async function () {
      const output = await adb.shell(['command']);
      expect(output).to.equal('a value');
    });
    it('should output only stdout when set', async function () {
      const output = await adb.shell(['command'], {outputFormat: adb.EXEC_OUTPUT_FORMAT.STDOUT});
      expect(output).to.equal('a value');
    });
    it('should return full output when set', async function () {
      const output = await adb.shell(['command'], {outputFormat: adb.EXEC_OUTPUT_FORMAT.FULL});
      expect(output).to.deep.equal({stdout: 'a value', stderr: 'an error'});
    });
  });
  describe('reboot', function () {
    it('should call stop and start using shell', async function () {
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['stop']);
      (mocks as any).adb.expects('setDeviceProperty')
        .once().withExactArgs('sys.boot_completed', 0);
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['start']);
      (mocks as any).adb.expects('getDeviceProperty')
        .once().withExactArgs('sys.boot_completed')
        .returns('1');
      (mocks as any).B.expects('delay')
        .once().withExactArgs(2000);
      await expect(adb.reboot()).to.eventually.not.be.rejected;
    });
    it('should restart adbd as root if necessary', async function () {
      (mocks as any).teen_process.expects('exec')
        .once().withExactArgs(adb.executable.path, ['root'])
        .returns(false);
      (mocks as any).adb.expects('shell')
        .twice().withExactArgs(['stop'])
        .onFirstCall()
          .throws(new Error(`Error executing adbExec. Original error: 'Command 'adb shell stop' exited with code 1'; Stderr: 'stop: must be root'; Code: '1'`))
        .onSecondCall().returns();
      (mocks as any).adb.expects('setDeviceProperty')
        .once().withExactArgs('sys.boot_completed', 0);
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['start']);
      (mocks as any).adb.expects('getDeviceProperty')
        .once().withExactArgs('sys.boot_completed')
        .returns('1');
      (mocks as any).B.expects('delay')
        .once().withExactArgs(2000);
      await expect(adb.reboot()).to.eventually.not.be.rejected;
    });
    it('should error with helpful message if cause of error is no root access', async function () {
      (mocks as any).adb.expects('isRoot').once().returns(false);
      (mocks as any).adb.expects('root').once().returns({wasAlreadyRooted: false});
      (mocks as any).adb.expects('shell')
        .once().throws(new Error('something something ==must be root== something something'));
      await expect(adb.reboot()).to.eventually.be.rejectedWith(/requires root access/);
    });
    it('should throw original error if cause of error is something other than no root access', async function () {
      const originalError = 'some original error';
      (mocks as any).adb.expects('shell')
        .once().throws(new Error(originalError));
      await expect(adb.reboot()).to.eventually.be.rejectedWith(originalError);
    });
  });
  describe('getRunningAVD', function () {
    it('should get connected avd', async function () {
      const udid = 'emulator-5554';
      const port = 5554;
      const emulator = {udid, port};
      (mocks as any).adb.expects('getConnectedEmulators')
        .once().withExactArgs()
        .returns([emulator]);
      (mocks as any).adb.expects('setEmulatorPort')
        .once().withExactArgs(port);
      (mocks as any).adb.expects('execEmuConsoleCommand')
        .once()
        .returns(avdName);
      (mocks as any).adb.expects('setDeviceId')
        .once().withExactArgs(udid);
      expect(await adb.getRunningAVD(avdName)).to.equal(emulator);
    });
    it('should return null when expected avd is not connected', async function () {
      const udid = 'emulator-5554';
      const port = 5554;
      const emulator = {udid, port};
      (mocks as any).adb.expects('getConnectedEmulators')
        .once().withExactArgs()
        .returns([emulator]);
      (mocks as any).adb.expects('setEmulatorPort')
        .once().withExactArgs(port);
      (mocks as any).adb.expects('execEmuConsoleCommand')
        .once()
        .returns('OTHER_AVD');
      chai.expect(await adb.getRunningAVD(avdName)).to.be.null;
    });
    it('should return null when no avd is connected', async function () {
      (mocks as any).adb.expects('getConnectedEmulators')
        .once().withExactArgs()
        .returns([]);
      chai.expect(await adb.getRunningAVD(avdName)).to.be.null;
    });
  });

  describe('root', function () {
    it('should restart adb if root throws err and stderr contains "closed" in message', async function () {
      (mocks as any).adb.expects('isRoot').once().returns(false);
      (mocks as any).adb.expects('adbExec')
        .once()
        .withExactArgs(['root'])
        .throws({
          stdout: '',
          stderr: 'adb: unable to connect for root: closed\n',
          code: 1
        });
      (mocks as any).adb.expects('reconnect').once();
      await expect(adb.root()).to.eventually.eql({isSuccessful: false, wasAlreadyRooted: false});
    });
    it('should not restart adb if root throws err but stderr does not contain "closed" in message', async function () {
      (mocks as any).adb.expects('isRoot').once().returns(false);
      (mocks as any).adb.expects('adbExec')
        .once()
        .withExactArgs(['root'])
        .throws({
          stdout: '',
          stderr: 'some error that does not close device',
          code: 1
        });
      (mocks as any).adb.expects('reconnect').never();
      await expect(adb.root()).to.eventually.eql({isSuccessful: false, wasAlreadyRooted: false});
    });
    it('should call "unroot" on shell if call .unroot', async function () {
      (mocks as any).adb.expects('isRoot').once().returns(false);
      (mocks as any).adb.expects('adbExec')
        .once()
        .withExactArgs(['unroot'])
        .returns({stdout: 'Hello World'});
      await expect(adb.unroot()).to.eventually.eql({isSuccessful: true, wasAlreadyRooted: false});
    });
    it('should tell us if "wasAlreadyRooted"', async function () {
      (mocks as any).adb.expects('isRoot').once().returns(false);
      (mocks as any).adb.expects('adbExec')
        .once()
        .withExactArgs(['root'])
        .returns({stdout: 'Something something already running as root something something'});
      await expect(adb.root()).to.eventually.eql({isSuccessful: true, wasAlreadyRooted: true});
    });
    it('should not call root if isRoot returns true', async function () {
      (mocks as any).adb.expects('isRoot').once().returns(true);
      (mocks as any).adb.expects('adbExec').never();
      await expect(adb.root()).to.eventually.eql({isSuccessful: true, wasAlreadyRooted: true});
    });
    it('should not call unroot if isRoot returns false', async function () {
      (mocks as any).adb.expects('isRoot').once().returns(false);
      (mocks as any).adb.expects('adbExec').never();
      await expect(adb.unroot()).to.eventually.eql({isSuccessful: true, wasAlreadyRooted: false});
    });
    it('should return unsuccessful if "adbd cannot run as root" in stdout', async function () {
      (mocks as any).adb.expects('isRoot').once().returns(false);
      (mocks as any).adb.expects('adbExec').once()
        .returns({stdout: 'something something adbd cannot run as root something smoething'});
      await expect(adb.root()).to.eventually.eql({isSuccessful: false, wasAlreadyRooted: false});
    });
  });
}));
