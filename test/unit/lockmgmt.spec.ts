import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {describe, it, beforeEach, afterEach} from 'node:test';
import {promisify} from 'node:util';

import sinon from 'sinon';

import {ADB} from '../../lib/adb.js';
import {isShowingLockscreen, isScreenStateOff} from '../../lib/tools/lockmgmt.js';

describe('lock management', function () {
  let sandbox: sinon.SinonSandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.verify();
    sandbox.restore();
  });

  describe('isLockManagementSupported', function () {
    for (const apiLevel of [26, 27, 36]) {
      it(`checks the minimum API level even if locksettings help exits successfully (API ${apiLevel})`, async function () {
        const adb = new ADB();
        sandbox.stub(adb, 'getApiLevel').resolves(apiLevel);
        const shell = sandbox.stub(adb, 'shell').resolves('__PASS__');
        assert.strictEqual(await adb.isLockManagementSupported(), apiLevel >= 27);
        assert.strictEqual(await adb.isLockManagementSupported(), apiLevel >= 27);
        sinon.assert.calledOnce(shell);
      });
    }

    it('returns false without querying the API level when locksettings fails', async function () {
      const adb = new ADB();
      const getApiLevel = sandbox.stub(adb, 'getApiLevel').rejects(new Error('device unavailable'));
      sandbox.stub(adb, 'shell').rejects(new Error('locksettings unavailable'));
      assert.strictEqual(await adb.isLockManagementSupported(), false);
      sinon.assert.notCalled(getApiLevel);
    });
  });

  describe('credential arguments', {skip: process.platform === 'win32'}, function () {
    const credentials = ['1234', "pass'word", 'two words', 'a"b', '$APPIUM_QUOTE_TEST', 'a;b', 'a\nb', '*'];

    it('preserves old credentials when verifying and clearing a lock', async function () {
      const adb = new ADB();
      const shell = sandbox.stub(adb, 'shell');
      for (const credential of credentials) {
        shell.resolves({stdout: 'verified successfully', stderr: ''} as any);
        assert.equal(await adb.verifyLockCredential(credential), true);
        assert.deepEqual(await parseDeviceCommand(shell.lastCall.args[0] as string[]), [
          'locksettings',
          'verify',
          '--old',
          credential,
        ]);
        shell.resolves({stdout: 'Lock credential cleared', stderr: ''} as any);
        await adb.clearLockCredential(credential);
        assert.deepEqual(await parseDeviceCommand(shell.lastCall.args[0] as string[]), [
          'locksettings',
          'clear',
          '--old',
          credential,
        ]);
      }
    });

    it('preserves new and old credentials when setting a lock', async function () {
      const adb = new ADB();
      const shell = sandbox.stub(adb, 'shell').resolves({stdout: 'Password set to value', stderr: ''} as any);
      for (const credential of credentials) {
        await adb.setLockCredential('password', credential, "old' password");
        assert.deepEqual(await parseDeviceCommand(shell.lastCall.args[0] as string[]), [
          'locksettings',
          'set-password',
          '--old',
          "old' password",
          credential,
        ]);
      }
      await adb.setLockCredential('pin', '1234');
      assert.deepEqual(await parseDeviceCommand(shell.lastCall.args[0] as string[]), [
        'locksettings',
        'set-pin',
        '1234',
      ]);
    });
  });

  describe('isScreenStateOff', function () {
    it('should return true if isScreenStateOff is off', async function () {
      const dumpsys = `
    KeyguardServiceDelegate
      showing=false
      showingAndNotOccluded=true
      inputRestricted=false
      occluded=false
      secure=false
      dreaming=false
      systemIsReady=true
      deviceHasKeyguard=true
      enabled=true
      offReason=OFF_BECAUSE_OF_USER
      currentUser=-10000
      bootCompleted=true
      screenState=SCREEN_STATE_OFF
      interactiveState=INTERACTIVE_STATE_SLEEP
      KeyguardStateMonitor
        mIsShowing=false
        mSimSecure=false
        mInputRestricted=false
        mTrusted=false
        mCurrentUserId=0
        ...
      `;
      assert.strictEqual(isScreenStateOff(dumpsys), true);
    });
    it('should return true if isScreenStateOff is on', async function () {
      const dumpsys = `
    KeyguardServiceDelegate
      showing=false
      showingAndNotOccluded=true
      inputRestricted=false
      occluded=false
      secure=false
      dreaming=false
      systemIsReady=true
      deviceHasKeyguard=true
      enabled=true
      offReason=OFF_BECAUSE_OF_USER
      currentUser=-10000
      bootCompleted=true
      screenState=SCREEN_STATE_ON
      interactiveState=INTERACTIVE_STATE_AWAKE
      KeyguardStateMonitor
        mIsShowing=false
        mSimSecure=false
        mInputRestricted=false
        mTrusted=false
        mCurrentUserId=0
        ...
      `;
      assert.strictEqual(isScreenStateOff(dumpsys), false);
    });
  });

  describe('isShowingLockscreen', function () {
    it('should return true if mShowingLockscreen is true', async function () {
      const dumpsys = 'mShowingLockscreen=true mShowingDream=false mDreamingLockscreen=false mTopIsFullscreen=false';
      assert.strictEqual(await isShowingLockscreen(dumpsys), true);
    });
    it('should return true if mDreamingLockscreen is true', async function () {
      const dumpsys = 'mShowingLockscreen=false mShowingDream=false mDreamingLockscreen=true mTopIsFullscreen=false';
      assert.strictEqual(await isShowingLockscreen(dumpsys), true);
    });
    it('should assume that screen is unlocked if keyguard is shown, but mInputRestricted is false', async function () {
      const dumpsys = `
      KeyguardServiceDelegate
      ....
        KeyguardStateMonitor
          mIsShowing=true
          mSimSecure=false
          mInputRestricted=false
          mCurrentUserId=0
          ...
      `;
      assert.strictEqual(await isShowingLockscreen(dumpsys), false);
    });
    it('should return false if mShowingLockscreen and mDreamingLockscreen are false', async function () {
      const dumpsys = 'mShowingLockscreen=false mShowingDream=false mDreamingLockscreen=false mTopIsFullscreen=false';
      assert.strictEqual(await isShowingLockscreen(dumpsys), false);
    });
    it('should assume that screen is unlocked if can not determine lock state', async function () {
      const dumpsys = 'mShowingDream=false mTopIsFullscreen=false';
      assert.strictEqual(await isShowingLockscreen(dumpsys), false);
    });
    it('should assume that screen is locked if mInputRestricted and mIsShowing were true', async function () {
      const dumpsys = `
      KeyguardServiceDelegate
      ....
        KeyguardStateMonitor
          mIsShowing=true
          mSimSecure=false
          mInputRestricted=true
          mCurrentUserId=0
          ...
      `;
      assert.strictEqual(await isShowingLockscreen(dumpsys), true);
    });
    it('should assume that screen is unlocked if mIsShowing was false', async function () {
      const dumpsys = `
      KeyguardServiceDelegate
      ....
        KeyguardStateMonitor
          mIsShowing=false
          mSimSecure=false
          mInputRestricted=false
          mCurrentUserId=0
          ...
      `;
      assert.strictEqual(await isShowingLockscreen(dumpsys), false);
    });
  });
});

// Model remote POSIX shell parsing independently of the quoting helper.
async function parseDeviceCommand(command: string | string[]): Promise<string[]> {
  const {stdout} = await promisify(execFile)(
    '/bin/sh',
    ['-c', `set -- ${Array.isArray(command) ? command.join(' ') : command}; printf '%s\\0' "$@"`],
    {
      env: {...process.env, APPIUM_QUOTE_TEST: 'unexpected-expansion'},
    },
  );
  return stdout.toString().split('\0').slice(0, -1);
}
