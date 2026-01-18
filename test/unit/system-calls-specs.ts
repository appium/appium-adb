import {ADB} from '../../lib/adb';
import * as teen_process from 'teen_process';
import sinon from 'sinon';
import B from 'bluebird';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import * as asyncbox from 'asyncbox';

chai.use(chaiAsPromised);

const adb = new ADB();
adb.executable.path = 'adb_path';
const avdName = 'AVD_NAME';

describe('system calls', function () {
  let sandbox: sinon.SinonSandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.verify();
    sandbox.restore();
  });

  describe('getConnectedDevices', function () {
    it('should get all connected devices', async function () {
      sandbox.stub(teen_process, 'exec').get(() =>
        sandbox.stub()
          .withArgs(adb.executable.path, ['-P', '5037', 'devices'])
          .onFirstCall()
          .returns({stdout: 'List of devices attached \n emulator-5554	device'})
      );
      const devices = await adb.getConnectedDevices();
      expect(devices).to.have.length.above(0);
      expect(devices).to.deep.equal([{udid: 'emulator-5554', state: 'device'}]);
    });
    it('should get all connected devices which have valid udid', async function () {
      const stdoutValue =
        'List of devices attached \n' +
        "adb server version (32) doesn't match this client (36); killing...\n" +
        '* daemon started successfully *\n' +
        'emulator-5554	device';
      sandbox.stub(teen_process, 'exec').get(() =>
        sandbox.stub()
          .withArgs(adb.executable.path, ['-P', '5037', 'devices'])
          .onFirstCall()
          .returns({stdout: stdoutValue})
      );
      const devices = await adb.getConnectedDevices();
      expect(devices).to.have.length.above(0);
    });
    it('should fail when adb devices returns unexpected output', async function () {
      sandbox.stub(teen_process, 'exec').get(() =>
        sandbox.stub()
          .withArgs(adb.executable.path, ['-P', '5037', 'devices'])
          .onFirstCall()
          .returns({stdout: 'foobar'})
      );
      await expect(adb.getConnectedDevices()).to.eventually.be.rejectedWith(
        'Unexpected output while trying to get devices',
      );
    });
    it('should get all connected devices with verbose output', async function () {
      sandbox.stub(teen_process, 'exec').get(() =>
        sandbox.stub()
          .withArgs(adb.executable.path, ['-P', '5037', 'devices', '-l'])
          .onFirstCall()
          .returns({
            stdout:
              'List of devices attached \nemulator-5556 device product:sdk_google_phone_x86_64 model:Android_SDK_built_for_x86_64 device:generic_x86_64\n0a388e93      device usb:1-1 product:razor model:Nexus_7 device:flo',
          })
      );
      const devices = await adb.getConnectedDevices({verbose: true});
      expect(devices).to.have.length.above(0);
      expect(devices).to.deep.equal([
        {
          udid: 'emulator-5556',
          state: 'device',
          product: 'sdk_google_phone_x86_64',
          model: 'Android_SDK_built_for_x86_64',
          device: 'generic_x86_64',
        },
        {
          udid: '0a388e93',
          state: 'device',
          usb: '1-1',
          product: 'razor',
          model: 'Nexus_7',
          device: 'flo',
        },
      ]);
    });
  });
  describe('getDevicesWithRetry', function () {
    it('should fail when there are no connected devices', async function () {
      this.timeout(20000);
      let stubCurrent = 0;
      // Here wants to test out the exact call count for each, so here doesn't use stub chain.
      const execStub = sandbox.stub();
      const innerStubOne = execStub
        .withArgs(adb.executable.path, ['-P', '5037', 'devices'])
        .resolves({stdout: 'List of devices attached', stderr: '', code: 0});
      const innerStubTwo = execStub
        .withArgs(adb.executable.path, ['-P', '5037', 'reconnect', 'offline'], sinon.match.object)
        .resolves();
      const innerStubThree = execStub
        .withArgs(adb.executable.path, ['-P', '5037', 'kill-server'], sinon.match.object)
        .resolves();
      sandbox.stub(teen_process, 'exec').get(() => {
        if (stubCurrent === 0) {
          stubCurrent++;
          return innerStubOne;
        } else if (stubCurrent === 1) {
          stubCurrent++;
          return innerStubTwo;
        }
        stubCurrent = 0;
        return innerStubThree;
      });
      await expect(adb.getDevicesWithRetry(1000)).to.eventually.be.rejectedWith(
        /Could not find a connected Android device/,
      );
      expect(innerStubOne.callCount).to.be.at.least(2);
      expect(innerStubTwo.callCount).to.be.at.least(2);
      expect(innerStubThree.callCount).to.be.at.least(2);
    });
    it('should fail when adb devices returns unexpected output', async function () {
      let stubCurrent = 0;
      // Here wants to test out the exact call count for each, so here doesn't use stub chain.
      const execStub = sandbox.stub();
      const innerStubOne = execStub
        .withArgs(adb.executable.path, ['-P', '5037', 'devices'])
        .resolves({stdout: 'foobar', stderr: '', code: 0});
      const innerStubTwo = execStub
        .withArgs(adb.executable.path, ['-P', '5037', 'reconnect', 'offline'], sinon.match.object)
        .resolves();
      const innerStubThree = execStub
        .withArgs(adb.executable.path, ['-P', '5037', 'kill-server'], sinon.match.object)
        .resolves();
      sandbox.stub(teen_process, 'exec').get(() => {
        if (stubCurrent === 0) {
          stubCurrent++;
          return innerStubOne;
        } else if (stubCurrent === 1) {
          stubCurrent++;
          return innerStubTwo;
        }
        stubCurrent = 0;
        return innerStubThree;
      });
      await expect(adb.getDevicesWithRetry(1000)).to.eventually.be.rejectedWith(
        /Could not find a connected Android device/,
      );
      expect(innerStubOne.callCount).to.be.at.least(2);
      expect(innerStubTwo.callCount).to.be.at.least(2);
      expect(innerStubThree.callCount).to.be.at.least(2);
    });
    it('should get all connected devices', async function () {
      sandbox.stub(teen_process, 'exec').get(() =>
        sandbox.stub()
          .withArgs(adb.executable.path, ['-P', '5037', 'devices'])
          .onFirstCall()
          .returns({stdout: 'List of devices attached \n emulator-5554	device'})
      );
      const devices = await adb.getDevicesWithRetry(1000);
      expect(devices).to.have.length.above(0);
    });
    it('should get all connected devices second time', async function () {
      let stubCurrent = 0;
      const execStub = sandbox.stub();
      const innerStubOne = execStub
        .withArgs(adb.executable.path, ['-P', '5037', 'devices'])
        .onFirstCall()
        .resolves({stdout: 'Foobar', stderr: '', code: 0});
      const innerStubTwo = execStub
        .withArgs(adb.executable.path, ['-P', '5037', 'reconnect', 'offline'], sinon.match.object)
        .onFirstCall()
        .throws(new Error('reconnect failed'));
      const innerStubThree = execStub
        .withArgs(adb.executable.path, ['-P', '5037', 'kill-server'], sinon.match.object)
        .onFirstCall()
        .resolves();
      const innerStubFour = execStub
        .withArgs(adb.executable.path, ['-P', '5037', 'devices'])
        .resolves({stdout: 'List of devices attached \n emulator-5554	device', stderr: '', code: 0});
      sandbox.stub(teen_process, 'exec').get(() => {
        if (stubCurrent === 0) {
          stubCurrent++;
          return innerStubOne;
        } else if (stubCurrent === 1) {
          stubCurrent++;
          return innerStubTwo;
        } else if (stubCurrent === 2) {
          stubCurrent++;
          return innerStubThree;
        }
        stubCurrent = 3;
        return innerStubFour;
      });
      const devices = await adb.getDevicesWithRetry(2000);
      expect(devices).to.have.length.above(0);
      // '.withArgs(adb.executable.path, ['-P', '5037', 'devices'])' was called twice in total
      expect(innerStubOne.callCount).to.eql(2);
      expect(innerStubFour.callCount).to.eql(2);
      expect(innerStubTwo.callCount).to.eql(1);
      expect(innerStubThree.callCount).to.eql(1);
    });
    it('should fail when exec throws an error', async function () {
      const innerStub = sandbox.stub().throws(new Error('Error foobar'));
      sandbox.stub(teen_process, 'exec').get(() => innerStub);

      await expect(adb.getDevicesWithRetry(1000)).to.eventually.be.rejectedWith(
        /Could not find a connected Android device/,
      );

      expect(innerStub.callCount).to.be.at.least(2);
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
});

describe('System calls 2', function () {
  let sandbox: sinon.SinonSandbox;
  let mocks: {adb: any; B: any; teen_process: any};

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    sandbox.stub(asyncbox, 'retryInterval').callsFake(async (retries, interval, fn) => fn());
    mocks = {
      adb: sandbox.mock(adb),
      B: sandbox.mock(B),
      teen_process: sandbox.mock(teen_process),
    };
  });

  afterEach(function () {
    sandbox.verify();
    sandbox.restore();
  });

    it('fileExists should return true if file/dir exists', async function () {
      mocks.adb
        .expects('shell')
        .once()
        .withExactArgs([`[ -e 'foo' ] && echo __PASS__`])
        .returns('__PASS__');
      await expect(adb.fileExists('foo')).to.eventually.equal(true);
    });
    it('ls should return list', async function () {
      mocks.adb.expects('shell').once().withExactArgs(['ls', 'foo']).returns('bar');
      const list = await adb.ls('foo');
      expect(list).to.deep.equal(['bar']);
    });
    it('fileSize should return the file size when digit is after permissions', async function () {
      const remotePath = '/sdcard/test.mp4';
      mocks.adb
        .expects('shell')
        .once()
        .withExactArgs(['ls', '-la', remotePath])
        .returns(`-rw-rw---- 1 root sdcard_rw 39571 2017-06-23 07:33 ${remotePath}`);
      const size = await adb.fileSize(remotePath);
      expect(size).to.eql(39571);
    });
    it('fileSize should return the file size when digit is not after permissions', async function () {
      const remotePath = '/sdcard/test.mp4';
      mocks.adb
        .expects('shell')
        .once()
        .withExactArgs(['ls', '-la', remotePath])
        .returns(`-rw-rw---- root sdcard_rw 39571 2017-06-23 07:33 ${remotePath}`);
      const size = await adb.fileSize(remotePath);
      expect(size).to.eql(39571);
    });
    describe('shell outputFormat option', function () {
      beforeEach(function () {
        sandbox.stub(teen_process, 'exec').get(() =>
          sandbox.stub()
            .onFirstCall()
            .returns({stdout: 'a value', stderr: 'an error', code: 0})
        );
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
        mocks.adb.expects('isRoot').once().returns(true);
        mocks.adb.expects('shell').once().withExactArgs(['stop']);
        mocks.adb
          .expects('setDeviceProperty')
          .once()
          .withExactArgs('sys.boot_completed', '0', {privileged: false});
        mocks.adb.expects('shell').once().withExactArgs(['start']);
        mocks.adb
          .expects('getDeviceProperty')
          .atLeast(1)
          .withExactArgs('sys.boot_completed')
          .returns('1');
        mocks.B.expects('delay').once().withExactArgs(2000);
        await expect(adb.reboot()).to.eventually.not.be.rejected;
      });
      it('should restart adbd as root if necessary', async function () {
        mocks.adb.expects('isRoot').once().returns(false);
        mocks.adb
          .expects('adbExec')
          .once()
          .withExactArgs(['root'])
          .returns({stdout: ''});
        mocks.adb
          .expects('shell')
          .once()
          .withExactArgs(['stop'])
          .returns();
        mocks.B.expects('delay').once().withExactArgs(2000);
        mocks.adb
          .expects('setDeviceProperty')
          .once()
          .withExactArgs('sys.boot_completed', '0', sinon.match.object)
          .returns();
        mocks.adb.expects('shell').once().withExactArgs(['start']).returns();
        mocks.adb
          .expects('getDeviceProperty')
          .once()
          .withExactArgs('sys.boot_completed')
          .returns('1');
        mocks.adb.expects('unroot').once().returns({isSuccessful: true, wasAlreadyRooted: false});
        await expect(adb.reboot()).to.eventually.not.be.rejected;
      });
      it('should error with helpful message if cause of error is no root access', async function () {
        mocks.adb.expects('isRoot').once().returns(false);
        mocks.adb.expects('root').once().returns({wasAlreadyRooted: false});
        mocks.adb
          .expects('shell')
          .once()
          .throws(new Error('something something ==must be root== something something'));
        await expect(adb.reboot()).to.eventually.be.rejectedWith(/requires root access/);
      });
      it('should throw original error if cause of error is something other than no root access', async function () {
        const originalError = 'some original error';
        mocks.adb.expects('shell').once().throws(new Error(originalError));
        await expect(adb.reboot()).to.eventually.be.rejectedWith(originalError);
      });
    });
    describe('getRunningAVD', function () {
      it('should get connected avd', async function () {
        const udid = 'emulator-5554';
        const port = 5554;
        const emulator = {udid, port};
        mocks.adb
          .expects('getConnectedEmulators')
          .once()
          .withExactArgs()
          .returns([emulator]);
        mocks.adb.expects('setEmulatorPort').once().withExactArgs(port);
        mocks.adb.expects('execEmuConsoleCommand').once().returns(avdName);
        mocks.adb.expects('setDeviceId').once().withExactArgs(udid);
        expect(await adb.getRunningAVD(avdName)).to.equal(emulator);
      });
      it('should return null when expected avd is not connected', async function () {
        const udid = 'emulator-5554';
        const port = 5554;
        const emulator = {udid, port};
        mocks.adb
          .expects('getConnectedEmulators')
          .once()
          .withExactArgs()
          .returns([emulator]);
        mocks.adb.expects('setEmulatorPort').once().withExactArgs(port);
        mocks.adb.expects('execEmuConsoleCommand').once().returns('OTHER_AVD');
        expect(await adb.getRunningAVD(avdName)).to.be.null;
      });
      it('should return null when no avd is connected', async function () {
        mocks.adb.expects('getConnectedEmulators').once().withExactArgs().returns([]);
        expect(await adb.getRunningAVD(avdName)).to.be.null;
      });
    });

    describe('root', function () {
      it('should restart adb if root throws err and stderr contains "closed" in message', async function () {
        mocks.adb.expects('isRoot').once().returns(false);
        mocks.adb
          .expects('adbExec')
          .withExactArgs(['root'])
          .onFirstCall()
          .throws({
            stdout: '',
            stderr: 'adb: unable to connect for root: closed\n',
            code: 1,
          });
        mocks.adb.expects('reconnect').once();
        mocks.adb
          .expects('adbExec')
          .withExactArgs(['root'])
          .onSecondCall()
          .throws({
            stdout: '',
            stderr: 'some other error',
            code: 1,
          });
        await expect(adb.root()).to.eventually.eql({isSuccessful: false, wasAlreadyRooted: false});
      });
      it('should not restart adb if root throws err but stderr does not contain "closed" in message', async function () {
        mocks.adb.expects('isRoot').once().returns(false);
        mocks.adb.expects('adbExec').once().withExactArgs(['root']).throws({
          stdout: '',
          stderr: 'some error that does not close device',
          code: 1,
        });
        mocks.adb.expects('reconnect').never();
        await expect(adb.root()).to.eventually.eql({isSuccessful: false, wasAlreadyRooted: false});
      });
      it('should call "unroot" on shell if call .unroot', async function () {
        mocks.adb.expects('isRoot').once().returns(true);
        mocks.adb
          .expects('adbExec')
          .once()
          .withExactArgs(['unroot'])
          .returns({stdout: 'Hello World'});
        await expect(adb.unroot()).to.eventually.eql({isSuccessful: true, wasAlreadyRooted: true});
      });
      it('should tell us if "wasAlreadyRooted"', async function () {
        mocks.adb.expects('isRoot').once().returns(false);
        mocks.adb
          .expects('adbExec')
          .once()
          .withExactArgs(['root'])
          .returns({stdout: 'Something something already running as root something something'});
        await expect(adb.root()).to.eventually.eql({isSuccessful: true, wasAlreadyRooted: true});
      });
      it('should not call root if isRoot returns true', async function () {
        mocks.adb.expects('isRoot').once().returns(true);
        mocks.adb.expects('adbExec').never();
        await expect(adb.root()).to.eventually.eql({isSuccessful: true, wasAlreadyRooted: true});
      });
      it('should not call unroot if isRoot returns false', async function () {
        mocks.adb.expects('isRoot').once().returns(false);
        mocks.adb.expects('adbExec').never();
        await expect(adb.unroot()).to.eventually.eql({isSuccessful: true, wasAlreadyRooted: false});
      });
      it('should return unsuccessful if "adbd cannot run as root" in stdout', async function () {
        mocks.adb.expects('isRoot').once().returns(false);
        mocks.adb
          .expects('adbExec')
          .once()
          .returns({stdout: 'something something adbd cannot run as root something smoething'});
        await expect(adb.root()).to.eventually.eql({isSuccessful: false, wasAlreadyRooted: false});
      });
    });
  });
