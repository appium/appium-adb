/* global describe:true, it:true */
"use strict";

var ADB = require('../../lib/main'),
    wrapForExec = require('../../lib/helpers').wrapForExec,
    prettyExec = require('../../lib/helpers').prettyExec,
    chai = require('chai'),
    path = require('path'),
    _ = require('underscore');

chai.should();

describe('binary path', function () {

  describe('checkSdkBinaryPresent', function () {
    it('should always return unquoted binary', function (done) {
      var adb = new ADB();
      adb.checkSdkBinaryPresent('adb', function (err, binary) {
        binary.should.match(/^\/.*adb(\.bat)?$/);
        done();
      });
    });
  });

  describe('wrapForExec', function () {
    it('should preserve quote if already there', function () {
      wrapForExec('"/abc/def/hij"').should.equal('"/abc/def/hij"');
      wrapForExec('\'/abc/def/hij\'').should.equal('\'/abc/def/hij\'');
    });

    it('should add double quote when needed', function () {
      wrapForExec('/a bc/d ef/hij').should.equal('"/a bc/d ef/hij"');
    });

    it('should not add double quote when not needed', function () {
      wrapForExec('/abc/def/hij').should.equal('/abc/def/hij');
    });

    it('should escape double quote', function () {
      wrapForExec('abcd"efg').should.equal('"abcd\\"efg"');
    });

    it('should work for complex cases', function () {
      wrapForExec('ab  c d"efg').should.equal('"ab  c d\\"efg"');
    });


  });

  describe('prettyExec', function() {
    var echoCmds = {
      regular: path.resolve(__dirname, 'fixtures/echo'),
      'with space': path.resolve(__dirname, 'fixtures/dir with spaces/echo')
    };

    _(echoCmds).each(function(echoCmd, desc) {
      describe(desc, function() {
        it('should work without args', function (done) {
          prettyExec(echoCmd, function(err, stdout) {
            stdout.trim().should.equal('');
            done(err);
          });
        });

        it('should work with args', function (done) {
          prettyExec(echoCmd, [1, "abc", 'def'], function(err, stdout) {
            stdout.trim().should.equal('1 abc def');
            done(err);
          });
        });

        it('should work with args and opts', function (done) {
          prettyExec(echoCmd, [1, "abc", 'def'], {timeout: 100} , function(err, stdout) {
            stdout.trim().should.equal('1 abc def');
            done(err);
          });
        });

        it('should work with args containing spaces', function (done) {
          prettyExec(echoCmd, [1, "a   bc", 'def'], {timeout: 100} , function(err, stdout) {
            stdout.trim().should.equal('1 a   bc def');
            done(err);
          });
        });

        it('should work with complex arguments', function (done) {
          prettyExec(echoCmd, [1, "a   bc", 'd "e"f'], {timeout: 100} , function(err, stdout) {
            stdout.trim().should.equal('1 a   bc d \"e\"f');
            done(err);
          });
        });

        it('should not wrap arguments', function (done) {
          prettyExec(echoCmd, [1, "a   bc", 'd "e"f'], {wrapArgs: false} , function(err, stdout) {
            stdout.trim().should.equal('1 a bc d ef');
            done(err);
          });
        });
        });
    });
  });
});

