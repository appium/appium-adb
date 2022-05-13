import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';


chai.use(chaiAsPromised);

describe('ADB', function () {
  describe('clone', function () {
    it('should copy all options', function () {
      const original = new ADB({
        executable: {path: 'var/adb', defaultArgs: ['-a']},
      });
      const clone = original.clone();

      clone.executable.path.should.equal(original.executable.path);
      clone.executable.defaultArgs.should.deep.equal(original.executable.defaultArgs);
    });
  });
});
