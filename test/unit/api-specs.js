/* global describe:true, it:true */
"use strict";

var ADB = require('../../lib/main'),
    sinon = require('sinon'),
    chai = require('chai');

chai.should();

describe('adb api', function () {

  describe('isAppInstalled', function () {
    var mockAdbShell = function (adb, stdout) {
      sinon.stub(adb, "shell", function (cmd, cb) {
        cb(null, "package:" + stdout);
      });
    };
    it('should match a normal package name', function (done) {
      var adb = new ADB();
      var pkg = "com.test.myapp";
      mockAdbShell(adb, pkg);
      adb.isAppInstalled(pkg, function (err, installed) {
        installed.should.eql(true);
        done();
      });
    });

    it('should match a package name with numerals', function (done) {
      var adb = new ADB();
      var pkg = "com.test1.myapp35";
      mockAdbShell(adb, pkg);
      adb.isAppInstalled(pkg, function (err, installed) {
        installed.should.eql(true);
        done();
      });
    });

    it('should say a package is not installed', function (done) {
      var adb = new ADB();
      var pkg = "com.test.myapp";
      mockAdbShell(adb, "some other garbage");
      adb.isAppInstalled(pkg, function (err, installed) {
        installed.should.eql(false);
        done();
      });
    });
  });
});

