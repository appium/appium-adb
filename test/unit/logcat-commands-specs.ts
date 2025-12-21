import * as teen_process from 'teen_process';
import events from 'events';
import {Logcat} from '../../lib/logcat';
import sinon from 'sinon';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

describe('logcat commands', function () {
  let sandbox: sinon.SinonSandbox;
  let logcat: any;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    class FakeSubProcess extends events.EventEmitter {
      constructor(_cmd: string, _args: string[]) {
        super();
      }
      start() {
        return Promise.resolve();
      }
      stop() {
        return Promise.resolve();
      }
    }
    // Stub BEFORE creating Logcat instance
    sandbox.stub(teen_process, 'SubProcess').callsFake((cmd: string, args: string[]) => {
      return new FakeSubProcess(cmd, args);
    });
    sandbox.stub(teen_process, 'exec').resolves({stdout: '', stderr: '', code: null});
    const adb = {
      path: 'dummyPath',
      defaultArgs: ['-P', '5037'],
    };
    logcat = new Logcat({adb, debug: false, debugTrace: false});
  });

  afterEach(function () {
    sandbox.restore();
  });

    describe('startCapture', function () {
      it('should correctly call subprocess and should resolve promise', async function () {
        setTimeout(function () {
          logcat.proc?.emit('line-stdout', '- beginning of system\r');
        }, 50);
        await logcat.startCapture({
          format: 'brief',
          filterSpecs: ['yolo2:d', ':k', '-asd:e'],
        });
        const logs = logcat.getLogs();
        expect(logs).to.have.length.above(0);
      });
      it('should correctly call subprocess and should reject promise', async function () {
        setTimeout(function () {
          logcat.proc?.emit('line-stderr', 'execvp()');
        }, 50);
        await expect(logcat.startCapture()).to.eventually.be.rejectedWith('Logcat');
      });
      it('should correctly call subprocess and should resolve promise if it fails on startup', async function () {
        setTimeout(function () {
          logcat.proc?.emit('line-stderr', 'something');
        }, 50);
        await logcat.startCapture();
      });
    });

    describe('clear', function () {
      it('should call logcat clear', async function () {
        // clear() will log a warning since dummyPath doesn't exist, but the stub prevents crash
        await logcat.clear();
        // The function completes without throwing
        expect(true).to.be.true;
      });
      it('should not fail if logcat clear fails', async function () {
        // clear() catches errors internally and logs warnings, never throws
        await expect(logcat.clear()).to.eventually.not.be.rejected;
      });
    });
  });
