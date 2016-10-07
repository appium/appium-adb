import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import * as teen_process from 'teen_process';
import events from 'events';
import Logcat from '../../lib/logcat';
import { withMocks } from 'appium-test-support';


chai.use(chaiAsPromised);

describe('logcat', async () => {
  let adb = {path: 'dummyPath', defaultArgs: []};
  let logcat = new Logcat({adb, debug: false, debugTrace: false});
  describe('startCapture', withMocks({teen_process}, (mocks) => {
    it('should correctly call subprocess and should resolve promise', async () => {
      let conn = new events.EventEmitter();
      conn.start = () => { };
      mocks.teen_process.expects("SubProcess")
        .once().withExactArgs('dummyPath', ['logcat', '-v', 'threadtime'])
        .returns(conn);
      setTimeout(function () {
        conn.emit('lines-stdout', ['- beginning of system\r']);
      }, 0);
      await logcat.startCapture();
      let logs = logcat.getLogs();
      logs.should.have.length.above(0);
      mocks.teen_process.verify();
    });
    it('should correctly call subprocess and should reject promise', async () => {
      let conn = new events.EventEmitter();
      conn.start = () => { };
      mocks.teen_process.expects("SubProcess")
        .once().withExactArgs('dummyPath', ['logcat', '-v', 'threadtime'])
        .returns(conn);
      setTimeout(function () {
        conn.emit('lines-stderr', ['execvp()']);
      }, 0);
      await logcat.startCapture().should.eventually.be.rejectedWith('Logcat');
      mocks.teen_process.verify();
    });
  }));
});
