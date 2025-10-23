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

describe('app commands', withMocks({adb, logcat, teen_process, net}, function (mocks) {
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

  describe('isAppRunning', function () {
    it('should call listAppProcessIds and return true when app is running', async function () {
      mocks.adb.expects('listAppProcessIds')
        .once().withExactArgs(contactManagerPackage)
        .returns([123, 456]);
      (await adb.isAppRunning(contactManagerPackage)).should.be.true;
    });
    it('should call listAppProcessIds and return false when app is not running', async function () {
      mocks.adb.expects('listAppProcessIds')
        .once().withExactArgs(contactManagerPackage)
        .returns([]);
      (await adb.isAppRunning(contactManagerPackage)).should.be.false;
    });
  });

  describe('listAppProcessIds', function () {
    it('should call shell with correct args and parse process IDs', async function () {
      const mockOutput = `ProcessRecord{abc123 123:com.saucelabs.ContactManager/u0a123}
ProcessRecord{def456 456:com.saucelabs.ContactManager/u0a123}`;
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'activity', 'processes'])
        .returns(mockOutput);
      (await adb.listAppProcessIds(contactManagerPackage)).should.eql([123, 456]);
    });
    it('should return empty array when no processes found', async function () {
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'activity', 'processes'])
        .returns('No processes found');
      (await adb.listAppProcessIds(contactManagerPackage)).should.eql([]);
    });
  });

  describe('killPackage', function () {
    it('should call shell with correct args', async function () {
      mocks.adb.expects('shell')
        .once().withExactArgs(['am', 'kill', contactManagerPackage])
        .returns('');
      await adb.killPackage(contactManagerPackage);
    });
  });

  describe('forceStop', function () {
    it('should call shell with correct args', async function () {
      mocks.adb.expects('shell')
        .once().withExactArgs(['am', 'force-stop', contactManagerPackage])
        .returns('');
      await adb.forceStop(contactManagerPackage);
    });
  });

  describe('clear', function () {
    it('should call shell with correct args', async function () {
      mocks.adb.expects('shell')
        .once().withExactArgs(['pm', 'clear', contactManagerPackage])
        .returns('');
      await adb.clear(contactManagerPackage);
    });
  });

  describe('stopAndClear', function () {
    it('should call forceStop and clear', async function () {
      mocks.adb.expects('forceStop')
        .once().withExactArgs(contactManagerPackage)
        .returns('');
      mocks.adb.expects('clear')
        .once().withExactArgs(contactManagerPackage)
        .returns('');
      await adb.stopAndClear(contactManagerPackage);
    });
  });


  describe('startUri', function () {
    it('should call shell with correct args', async function () {
      const uri = 'https://example.com';
      mocks.adb.expects('shell')
        .once().withExactArgs(['am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', uri])
        .returns('');
      await adb.startUri(uri);
    });
    it('should call shell with package when provided', async function () {
      const uri = 'https://example.com';
      mocks.adb.expects('shell')
        .once().withExactArgs(['am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', uri, contactManagerPackage])
        .returns('');
      await adb.startUri(uri, contactManagerPackage);
    });
  });

  describe('dumpWindows', function () {
    it('should call shell with correct args', async function () {
      mocks.adb.expects('getApiLevel')
        .once().returns(25);
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns('Window information');
      const result = await adb.dumpWindows();
      result.should.equal('Window information');
    });
  });

  describe('getFocusedPackageAndActivity', function () {
    it('should parse focused package and activity', async function () {
      const mockOutput = 'mFocusedApp=AppWindowToken{abc123 token=Token{def456 ActivityRecord{ghi789 com.saucelabs.ContactManager/.MainActivity}}}';
      mocks.adb.expects('getApiLevel')
        .once().returns(25);
      mocks.adb.expects('shell')
        .once().withExactArgs(['dumpsys', 'window', 'windows'])
        .returns(mockOutput);
      const result = await adb.getFocusedPackageAndActivity();
      result.appPackage.should.equal('com.saucelabs.ContactManager');
      result.appActivity.should.equal('.MainActivity');
    });
  });

  describe('waitForActivity', function () {
    it('should wait for activity to appear', async function () {
      mocks.adb.expects('getFocusedPackageAndActivity')
        .exactly(2)
        .onCall(0).returns({appPackage: 'other.package', appActivity: '.Other'})
        .onCall(1).returns({appPackage: contactManagerPackage, appActivity: '.MainActivity'});
      await adb.waitForActivity(contactManagerPackage, '.MainActivity', 1000);
    });
  });

  describe('waitForNotActivity', function () {
    it('should wait for activity to disappear', async function () {
      mocks.adb.expects('getFocusedPackageAndActivity')
        .exactly(2)
        .onCall(0).returns({appPackage: contactManagerPackage, appActivity: '.MainActivity'})
        .onCall(1).returns({appPackage: 'other.package', appActivity: '.Other'});
      await adb.waitForNotActivity(contactManagerPackage, '.MainActivity', 1000);
    });
  });

  describe('waitForActivityOrNot', function () {
    it('should wait for activity to appear when waitForStop is false', async function () {
      mocks.adb.expects('getFocusedPackageAndActivity')
        .exactly(2)
        .onCall(0).returns({appPackage: 'other.package', appActivity: '.Other'})
        .onCall(1).returns({appPackage: contactManagerPackage, appActivity: '.MainActivity'});
      await adb.waitForActivityOrNot(contactManagerPackage, '.MainActivity', false, 1000);
    });
    it('should wait for activity to disappear when waitForStop is true', async function () {
      mocks.adb.expects('getFocusedPackageAndActivity')
        .exactly(2)
        .onCall(0).returns({appPackage: contactManagerPackage, appActivity: '.MainActivity'})
        .onCall(1).returns({appPackage: 'other.package', appActivity: '.Other'});
      await adb.waitForActivityOrNot(contactManagerPackage, '.MainActivity', true, 1000);
    });
  });
}));
