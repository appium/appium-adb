import {ADB} from '../../lib/adb';
import net from 'net';
import { Logcat } from '../../lib/logcat.js';
import * as teen_process from 'teen_process';
import { withMocks } from '@appium/test-support';

const contactManagerPackage = 'com.saucelabs.ContactManager';

const adb = new ADB({ adbExecTimeout: 60000 });
const logcat = new Logcat({
  adb: adb.executable,
  debug: false,
  debugTrace: false
});

describe('process commands', withMocks({adb, logcat, teen_process, net}, function (mocks) {
  let chai;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.should();
    chai.use(chaiAsPromised.default);
  });

  afterEach(function () {
    mocks.verify();
  });

  describe('processExists', function () {
    it('should call shell with correct args and should find process', async function () {
      mocks.adb.expects('getProcessIdsByName')
        .once().withExactArgs(contactManagerPackage)
        .returns([123]);
      (await adb.processExists(contactManagerPackage)).should.be.true;
    });
    it('should call shell with correct args and should not find process', async function () {
      mocks.adb.expects('getProcessIdsByName')
        .once().withExactArgs(contactManagerPackage)
        .returns([]);
      (await adb.processExists(contactManagerPackage)).should.be.false;
    });
  });

  describe('getProcessNameById', function () {
    it('should get package name from valid ps output', async function () {
      mocks.adb.expects('listProcessStatus')
        .once().returns(`
        USER     PID   PPID  VSIZE  RSS     WCHAN    PC        NAME
        radio     929   69    1228184 40844 ffffffff b6db0920 S com.android.phone
        radio     930   69    1228184 40844 ffffffff b6db0920 S com.android.phone
        u0_a7     951   69    1256464 72208 ffffffff b6db0920 S com.android.launcher
        u0_a30    1119  69    1220004 33596 ffffffff b6db0920 S com.android.inputmethod.latin
        u0_a12    1156  69    1246756 58588 ffffffff b6db0920 S com.android.systemui
        root      1347  2     0      0     c002f068 00000000 S kworker/0:1
        u0_a1     1349  69    1206724 26164 ffffffff b6db0920 S com.android.providers.calendar
        u0_a17    1431  69    1217460 26616 ffffffff b6db0920 S com.android.calendar
        u0_a21    1454  69    1203712 26244 ffffffff b6db0920 S com.android.deskclock
        u0_a27    1490  69    1206480 24748 ffffffff b6db0920 S com.android.exchange
        u0_a4     1574  69    1205460 22984 ffffffff b6db0920 S com.android.dialer
        u0_a2     1590  69    1207456 29340 ffffffff b6db0920 S android.process.acore
        u0_a11    1608  69    1199320 22448 ffffffff b6db0920 S com.android.sharedstoragebackup
        u0_a15    1627  69    1206440 30480 ffffffff b6db0920 S com.android.browser
        u0_a5     1646  69    1202716 27004 ffffffff b6db0920 S android.process.media
        root      1676  2     0      0     c00d0d8c 00000000 S flush-31:1
        root      1680  2     0      0     c00d0d8c 00000000 S flush-31:2
        root      1681  60    10672  996   00000000 b6f33508 R ps
        `);
      (await adb.getProcessNameById('1627')).should.eql('com.android.browser');
    });
    it('should fail if no PID could be found in the name', async function () {
      await adb.getProcessNameById('bla').should.eventually.be.rejectedWith(/valid number/);
    });
    it('should fail if no PID could be found in ps output', async function () {
      mocks.adb.expects('listProcessStatus')
        .once().returns(`
        USER     PID   PPID  VSIZE  RSS     WCHAN    PC        NAME
        u0_a12    1156  69    1246756 58588 ffffffff b6db0920 S com.android.systemui
        `);
      await adb.getProcessNameById(115).should.eventually.be.rejectedWith(/process name/);
    });
  });

  describe('getProcessIdsByName', function () {
    it('should properly parse ps output to find process IDs by name', async function () {
      mocks.adb.expects('listProcessStatus')
        .once().returns(`USER     PID   PPID  VSIZE  RSS     WCHAN    PC   S    NAME
radio     929   69    1228184 40844 ffffffff b6db0920 S com.android.phone
radio     930   69    1228184 40844 ffffffff b6db0920 S com.android.phone
u0_a7     951   69    1256464 72208 ffffffff b6db0920 S com.android.launcher
u0_a12    1156  69    1246756 58588 ffffffff b6db0920 S com.android.systemui
u0_a15    1627  69    1206440 30480 ffffffff b6db0920 S com.android.browser
u0_a15    1628  69    1206440 30480 ffffffff b6db0920 S com.android.browser`);
      (await adb.getProcessIdsByName('com.android.browser')).should.eql([1627, 1628]);
    });
    it('should return empty array when no matching processes found', async function () {
      mocks.adb.expects('listProcessStatus')
        .once().returns(`
        USER     PID   PPID  VSIZE  RSS     WCHAN    PC        NAME
        radio     929   69    1228184 40844 ffffffff b6db0920 S com.android.phone
        u0_a12    1156  69    1246756 58588 ffffffff b6db0920 S com.android.systemui
        `);
      (await adb.getProcessIdsByName('com.nonexistent.app')).should.eql([]);
    });
    it('should fail if ps output cannot be parsed', async function () {
      mocks.adb.expects('listProcessStatus')
        .once().returns('Invalid output without proper headers');
      await adb.getProcessIdsByName('com.android.phone').should.eventually.be.rejectedWith(/Could not parse process list/);
    });
  });

  describe('killProcessesByName', function () {
    it('should call getProcessIdsByName and kill process correctly', async function () {
      mocks.adb.expects('getProcessIdsByName')
        .once().withExactArgs(contactManagerPackage)
        .returns([5078]);
      mocks.adb.expects('killProcessByPID')
        .once().withExactArgs(5078, 'SIGTERM')
        .returns('');
      await adb.killProcessesByName(contactManagerPackage);
    });
    it('should handle case when no processes found', async function () {
      mocks.adb.expects('getProcessIdsByName')
        .once().withExactArgs(contactManagerPackage)
        .returns([]);
      await adb.killProcessesByName(contactManagerPackage);
    });
    it('should handle errors from getProcessIdsByName', async function () {
      mocks.adb.expects('getProcessIdsByName')
        .once().withExactArgs(contactManagerPackage)
        .throws(new Error('Process lookup failed'));
      await adb.killProcessesByName(contactManagerPackage).should.eventually.be.rejectedWith(/Unable to kill/);
    });
  });

  describe('killProcessByPID', function () {
    const pid = 5078;

    it('should call kill process correctly', async function () {
      mocks.adb.expects('shell')
        .once().withExactArgs(['kill', '-SIGTERM', `${pid}`])
        .returns('');
      await adb.killProcessByPID(pid);
    });
    it('should handle "No such process" error gracefully', async function () {
      const error = new Error('kill failed');
      error.stderr = 'No such process';
      mocks.adb.expects('shell')
        .once().withExactArgs(['kill', '-SIGTERM', `${pid}`])
        .throws(error);
      await adb.killProcessByPID(pid);
    });
    it('should retry with root privileges on permission error', async function () {
      const error = new Error('kill failed');
      error.stderr = 'Operation not permitted';
      mocks.adb.expects('shell')
        .once().withExactArgs(['kill', '-SIGTERM', `${pid}`])
        .throws(error);
      mocks.adb.expects('shell')
        .once().withExactArgs(['kill', `${pid}`], {privileged: true})
        .returns('');
      await adb.killProcessByPID(pid);
    });
    it('should handle "No such process" error on retry', async function () {
      const error = new Error('kill failed');
      error.stderr = 'Operation not permitted';
      const retryError = new Error('kill failed');
      retryError.stderr = 'No such process';
      mocks.adb.expects('shell')
        .once().withExactArgs(['kill', '-SIGTERM', `${pid}`])
        .throws(error);
      mocks.adb.expects('shell')
        .once().withExactArgs(['kill', `${pid}`], {privileged: true})
        .throws(retryError);
      await adb.killProcessByPID(pid);
    });
    it('should throw error if kill fails for other reasons', async function () {
      const error = new Error('kill failed');
      error.stderr = 'Some other error';
      mocks.adb.expects('shell')
        .once().withExactArgs(['kill', '-SIGTERM', `${pid}`])
        .throws(error);
      await adb.killProcessByPID(pid).should.eventually.be.rejectedWith('kill failed');
    });
  });
}));
