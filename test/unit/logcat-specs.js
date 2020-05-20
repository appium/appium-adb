import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import events from 'events';
import Logcat from '../../lib/logcat';


chai.use(chaiAsPromised);

describe('logcat', function () {
  const adb = {path: 'dummyPath', defaultArgs: []};
  const logcat = new Logcat({adb, debug: false, debugTrace: false});

  describe('startCapture', function () {
    it('should correctly call subprocess and should resolve promise', async function () {
      let conn = new events.EventEmitter();
      conn.start = () => { };
      adb.createSubProcess = (args) => {
        args.should.eql(['logcat', '-v', 'brief', 'yolo2:d', '*:v']);
        return conn;
      };
      setTimeout(function () {
        conn.emit('lines-stdout', ['- beginning of system\r']);
      }, 0);
      await logcat.startCapture({
        format: 'brief',
        filterSpecs: ['yolo2:d', ':k', '-asd:e'],
      });
      let logs = logcat.getLogs();
      logs.should.have.length.above(0);
    });
    it('should correctly call subprocess and should reject promise', async function () {
      let conn = new events.EventEmitter();
      conn.start = () => { };
      adb.createSubProcess = (args) => {
        args.should.eql(['logcat', '-v', 'threadtime']);
        return conn;
      };
      setTimeout(function () {
        conn.emit('lines-stderr', ['execvp()']);
      }, 0);
      await logcat.startCapture().should.eventually.be.rejectedWith('Logcat');
    });
    it('should correctly call subprocess and should resolve promise if it fails on startup', async function () {
      let conn = new events.EventEmitter();
      conn.start = () => { };
      adb.createSubProcess = (args) => {
        args.should.eql(['logcat', '-v', 'threadtime']);
        return conn;
      };
      setTimeout(function () {
        conn.emit('lines-stderr', ['something']);
      }, 0);
      await logcat.startCapture().should.eventually.not.be.rejectedWith('Logcat');
    });
  });

  describe('clear', function () {
    it('should call logcat clear', async function () {
      adb.adbExec = (args) => {
        args.should.eql(['logcat', '-c']);
      };
      await logcat.clear();
    });
    it('should not fail if logcat clear fails', async function () {
      adb.adbExec = () => {
        throw new Error('Failed to clear');
      };
      await logcat.clear().should.eventually.not.be.rejected;
    });
  });
});
