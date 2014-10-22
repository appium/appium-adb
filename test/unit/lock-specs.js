/* global describe:true, it:true */
"use strict";

var ADB = require('../../lib/main'),
    sinon = require('sinon');

require('should');

describe('lock', function () {

  function mockAdbShell(adb, stdout) {
    sinon.stub(adb, "shell", function (cmd, cb) {
      cb(null, stdout);
    });
  }

  function test(opts) {
    it(opts.desc, function (done) {
      var adb = new ADB();
      mockAdbShell(adb, opts.stdout);
      adb.isScreenLocked(function (err, isScreenLocked) {
        isScreenLocked.should.equal(opts.expected);
        done();
      });
    });
  }

  test({
    desc: 'sample 1 should not be locked',
    stdout: '',
     expected: false
  });

  test({
    desc: 'sample 2 should be locked',
    stdout:
      '  mShowingLockscreen=false mShowingDream=false mDreamingLockscreen=false\n' +
      '  mCurrentFocus=Window{b337cd90 u0 io.appium.android.apis/io.appium.android.apis.ApiDemos}\n' +
      '  mScreenOnEarly=false mScreenOnFully=false mOrientationSensorEnabled=false\n',
     expected: true
  });

  test({
    desc: 'sample 3 should not be locked',
    stdout:
      '  mShowingLockscreen=false mShowingDream=false mDreamingLockscreen=false\n' +
      '  mCurrentFocus=Window{b33ef0a8 u0 io.appium.android.apis/io.appium.android.apis.ApiDemos}\n' +
      '  mScreenOnEarly=true mScreenOnFully=true mOrientationSensorEnabled=true\n',
     expected: false
  });

});

