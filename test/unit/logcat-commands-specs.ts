import * as teen_process from 'teen_process';
import events from 'events';
import {Logcat} from '../../lib/logcat';
import sinon from 'sinon';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

describe('logcat commands', function () {
  let sandbox: sinon.SinonSandbox;
  const adb = {path: 'dummyPath', defaultArgs: []};
  const logcat = new Logcat({adb, debug: false, debugTrace: false});

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.verify();
    sandbox.restore();
  });

  describe('startCapture', function () {
    it('should correctly call subprocess and should resolve promise', async function () {
      const conn = new events.EventEmitter();
      (conn as any).start = () => {};
      sandbox.stub(teen_process, 'SubProcess').get(() =>
        sandbox.stub().withArgs('dummyPath', ['logcat', '-v', 'brief', 'yolo2:d', '*:v']).onFirstCall().returns(conn)
      );
      setTimeout(function () {
        conn.emit('line-stdout', '- beginning of system\r');
      }, 0);
      await logcat.startCapture({
        format: 'brief',
        filterSpecs: ['yolo2:d', ':k', '-asd:e'],
      });
      const logs = logcat.getLogs();
      expect(logs).to.have.length.above(0);
    });
    it('should correctly call subprocess and should reject promise', async function () {
      const conn = new events.EventEmitter();
      (conn as any).start = () => {};
      sandbox.stub(teen_process, 'SubProcess').get(() =>
        sandbox.stub().withArgs('dummyPath', ['logcat', '-v', 'threadtime']).onFirstCall().returns(conn)
      );
      setTimeout(function () {
        conn.emit('line-stderr', 'execvp()');
      }, 0);
      await expect(logcat.startCapture()).to.eventually.be.rejectedWith('Logcat');
    });
    it('should correctly call subprocess and should resolve promise if it fails on startup', async function () {
      const conn = new events.EventEmitter();
      (conn as any).start = () => {};
      sandbox.stub(teen_process, 'SubProcess').get(() =>
        sandbox.stub().withArgs('dummyPath', ['logcat', '-v', 'threadtime']).onFirstCall().returns(conn)
      );
      setTimeout(function () {
        conn.emit('line-stderr', 'something');
      }, 0);
      await expect(logcat.startCapture()).to.eventually.not.be.rejectedWith('Logcat');
    });
  });

  describe('clear', function () {
    it('should call logcat clear', async function () {
      sandbox.stub(teen_process, 'exec').get(() =>
        sandbox.stub().withArgs(adb.path, [...adb.defaultArgs, 'logcat', '-c']).onFirstCall()
      );
      await logcat.clear();
    });
    it('should not fail if logcat clear fails', async function () {
      sandbox.stub(teen_process, 'exec').get(() =>
        sandbox.stub().withArgs(adb.path, [...adb.defaultArgs, 'logcat', '-c']).onFirstCall().throws('Failed to clear')
      );
      await expect(logcat.clear()).to.eventually.not.be.rejected;
    });
  });
});
