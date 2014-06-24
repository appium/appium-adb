var ADB = require('../../lib/main'),
    Q = require('q'),
    exec = Q.denodeify(require('child_process').exec),
    chai = require('chai')
    _ = require('underscore')
    format = require('util').format;

chai.should();

describe('proc', function() {
  this.timeout(30000);

  function countLogcatProcesses() {
    return exec('ps', ['-el'])
      .then(function(res) {
        var stdout = res[0]; 
        var count = _(stdout.split('\n')).filter(function(line) {
          return line.match(/adb logcat/);
        }).length;
        console.log(format('Found %s logcat processes.', count));
        return count;
      });
  }

  describe('logcat', function() {
    it('should start and kill the logcat process', function() {
      var adb = new ADB();
      var processCountBefore;
      return countLogcatProcesses()
        .then(function(processCount) { processCountBefore = processCount; })
        .then(function() { return Q.ninvoke(adb, "startLogcat"); })        
        .then(countLogcatProcesses)
        .then(function(c) { c.should.equal(processCountBefore + 1); })
        .then(function() { return Q.ninvoke(adb, "stopLogcat"); })
        .then(countLogcatProcesses)
        .then(function(c) { c.should.equal(processCountBefore); });
    });
  });
});
