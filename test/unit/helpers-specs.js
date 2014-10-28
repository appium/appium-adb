/* global describe:true, it:true */
"use strict";

var helpers = require('../../lib/helpers');

require('should');

describe('helpers', function () {
  it('isShowingLockscreen should work', function () {
    var dumpsys = '   mShowingLockscreen=false mShowingDream=false mDreamingLockscreen=false';
    helpers.isShowingLockscreen(dumpsys).should.equal(false);

    dumpsys = '   mShowingLockscreen=true mShowingDream=false mDreamingLockscreen=false';
    helpers.isShowingLockscreen(dumpsys).should.equal(true);

    dumpsys = '   mShowingDream=false mDreamingLockscreen=false';
    helpers.isShowingLockscreen(dumpsys).should.equal(false);
  });

  it('isCurrentFocusOnKeyguard should work', function () {
    var dumpsys = 'mCurrentFocus=Keyguard{b33ef0a8 u0 io.appium.android.apis/io.appium.android.apis.ApiDemos}';
    helpers.isCurrentFocusOnKeyguard(dumpsys).should.equal(true);

    dumpsys = 'mCurrentFocus=HelloWorld{b33ef0a8 u0 io.appium.android.apis/io.appium.android.apis.ApiDemos}';
    helpers.isCurrentFocusOnKeyguard(dumpsys).should.equal(false);

    dumpsys = 'apis/io.appium.android.apis.ApiDemos}';
    helpers.isCurrentFocusOnKeyguard(dumpsys).should.equal(false);
   });

  it('isScreenOnFully should work', function () {
    var dumpsys = 'mScreenOnEarly=true mScreenOnFully=true mOrientationSensorEnabled=true';
    helpers.isScreenOnFully(dumpsys).should.equal(true);

    dumpsys = 'mScreenOnEarly=true mScreenOnFully=false mOrientationSensorEnabled=true';
    helpers.isShowingLockscreen(dumpsys).should.equal(false);

    // no info we assume screen is fully on
    dumpsys = 'mScreenOnEarly=true mOrientationSensorEnabled=true';
    helpers.isScreenOnFully(dumpsys).should.equal(true);
  });

  it('getActivityRelativeName should handle package and activity names with overlapping, but unmatching namespaces', function () {
    var pkg = "com.test.myapp";
    helpers.getActivityRelativeName(pkg, "com.test.myapp35.Activity").should.eql("com.test.myapp35.Activity");
    helpers.getActivityRelativeName(pkg, "com.test.myapp.Activity").should.eql(".Activity");
  });
});
