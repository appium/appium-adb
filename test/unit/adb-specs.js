// eslint-disable-next-line import/no-unresolved
import { ADB, DEFAULT_ADB_PORT } from '../../lib/adb';


describe('ADB', function () {
  let chai;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.should();
    chai.use(chaiAsPromised.default);
  });

  describe('clone', function () {
    it('should copy all options', function () {
      const original = new ADB({
        executable: {path: 'var/adb', defaultArgs: ['-a']},
      });
      const clone = original.clone();

      clone.executable.path.should.equal(original.executable.path);
      clone.executable.defaultArgs.should.deep.equal(original.executable.defaultArgs);
    });

    it('should replace specified options', function () {
      const original = new ADB({
        executable: {path: 'adb', defaultArgs: ['-a']},
      });
      const clone = original.clone({
        remoteAdbHost: 'example.com',
      });

      clone.executable.path.should.equal(original.executable.path);
      clone.executable.defaultArgs.should.deep.equal(['-a', '-H', 'example.com', '-P', String(DEFAULT_ADB_PORT)]);
      clone.remoteAdbHost.should.equal('example.com');
      clone.adbHost.should.not.equal(original.adbHost);
    });
  });
});
