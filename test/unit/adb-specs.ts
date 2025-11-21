import { ADB, DEFAULT_ADB_PORT } from '../../lib/adb';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

describe('ADB', function () {

  describe('clone', function () {
    it('should copy all options', function () {
      const original = new ADB({
        executable: {path: 'var/adb', defaultArgs: ['-a']},
      });
      const clone = original.clone();

      expect(clone.executable.path).to.equal(original.executable.path);
      expect(clone.executable.defaultArgs).to.deep.equal(original.executable.defaultArgs);
    });

    it('should replace specified options', function () {
      const original = new ADB({
        executable: {path: 'adb', defaultArgs: ['-a']},
      });
      const clone = original.clone({
        remoteAdbHost: 'example.com',
      });

      expect(clone.executable.path).to.equal(original.executable.path);
      expect(clone.executable.defaultArgs).to.deep.equal(['-a', '-H', 'example.com', '-P', String(DEFAULT_ADB_PORT)]);
      expect(clone.remoteAdbHost).to.equal('example.com');
      expect(clone.adbHost).to.not.equal(original.adbHost);
    });
  });
});
