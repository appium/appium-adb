import { isShowingLockscreen, isScreenStateOff } from '../../lib/tools/lockmgmt';
import { withMocks } from '@appium/test-support';

describe('lock management', withMocks({}, function (mocks) {
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

  describe('isScreenStateOff', function () {
    it('should return true if isScreenStateOff is off', async function () {
      let dumpsys = `
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
      isScreenStateOff(dumpsys).should.be.true;
    });
    it('should return true if isScreenStateOff is on', async function () {
      let dumpsys = `
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
      isScreenStateOff(dumpsys).should.be.false;
    });
  });

  describe('isShowingLockscreen', function () {
    it('should return true if mShowingLockscreen is true', async function () {
      let dumpsys = 'mShowingLockscreen=true mShowingDream=false mDreamingLockscreen=false mTopIsFullscreen=false';
      (await isShowingLockscreen(dumpsys)).should.be.true;
    });
    it('should return true if mDreamingLockscreen is true', async function () {
      let dumpsys = 'mShowingLockscreen=false mShowingDream=false mDreamingLockscreen=true mTopIsFullscreen=false';
      (await isShowingLockscreen(dumpsys)).should.be.true;
    });
    it('should assume that screen is unlocked if keyguard is shown, but mInputRestricted is false', async function () {
      let dumpsys = `
      KeyguardServiceDelegate
      ....
        KeyguardStateMonitor
          mIsShowing=true
          mSimSecure=false
          mInputRestricted=false
          mCurrentUserId=0
          ...
      `;
      (await isShowingLockscreen(dumpsys)).should.be.false;
    });
    it('should return false if mShowingLockscreen and mDreamingLockscreen are false', async function () {
      let dumpsys = 'mShowingLockscreen=false mShowingDream=false mDreamingLockscreen=false mTopIsFullscreen=false';
      (await isShowingLockscreen(dumpsys)).should.be.false;
    });
    it('should assume that screen is unlocked if can not determine lock state', async function () {
      let dumpsys = 'mShowingDream=false mTopIsFullscreen=false';
      (await isShowingLockscreen(dumpsys)).should.be.false;
    });
    it('should assume that screen is locked if mInputRestricted and mIsShowing were true', async function () {
      let dumpsys = `
      KeyguardServiceDelegate
      ....
        KeyguardStateMonitor
          mIsShowing=true
          mSimSecure=false
          mInputRestricted=true
          mCurrentUserId=0
          ...
      `;
      (await isShowingLockscreen(dumpsys)).should.be.true;
    });
    it('should assume that screen is unlocked if mIsShowing was false', async function () {
      let dumpsys = `
      KeyguardServiceDelegate
      ....
        KeyguardStateMonitor
          mIsShowing=false
          mSimSecure=false
          mInputRestricted=false
          mCurrentUserId=0
          ...
      `;
      (await isShowingLockscreen(dumpsys)).should.be.false;
    });
  });
}));
