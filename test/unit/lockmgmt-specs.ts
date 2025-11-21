import { isShowingLockscreen, isScreenStateOff } from '../../lib/tools/lockmgmt';
import { withMocks } from '@appium/test-support';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

describe('lock management', withMocks({}, function (mocks) {

  afterEach(function () {
    mocks.verify();
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
      expect(isScreenStateOff(dumpsys)).to.be.true;
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
      expect(isScreenStateOff(dumpsys)).to.be.false;
    });
  });

  describe('isShowingLockscreen', function () {
    it('should return true if mShowingLockscreen is true', async function () {
      const dumpsys = 'mShowingLockscreen=true mShowingDream=false mDreamingLockscreen=false mTopIsFullscreen=false';
      expect(await isShowingLockscreen(dumpsys)).to.be.true;
    });
    it('should return true if mDreamingLockscreen is true', async function () {
      const dumpsys = 'mShowingLockscreen=false mShowingDream=false mDreamingLockscreen=true mTopIsFullscreen=false';
      expect(await isShowingLockscreen(dumpsys)).to.be.true;
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
      expect(await isShowingLockscreen(dumpsys)).to.be.false;
    });
    it('should return false if mShowingLockscreen and mDreamingLockscreen are false', async function () {
      const dumpsys = 'mShowingLockscreen=false mShowingDream=false mDreamingLockscreen=false mTopIsFullscreen=false';
      expect(await isShowingLockscreen(dumpsys)).to.be.false;
    });
    it('should assume that screen is unlocked if can not determine lock state', async function () {
      const dumpsys = 'mShowingDream=false mTopIsFullscreen=false';
      expect(await isShowingLockscreen(dumpsys)).to.be.false;
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
      expect(await isShowingLockscreen(dumpsys)).to.be.true;
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
      expect(await isShowingLockscreen(dumpsys)).to.be.false;
    });
  });
}));
