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

    describe('-a option', function() {
      const portArg = String(DEFAULT_ADB_PORT);
      const REMOTE_HOST = 'example.com';
      const scenarios = [
        {
          name: 'should add -a option',
          originalOptions: {executable: {path: 'adb', defaultArgs: []}, listenAllNetwork: true},
          cloneOptions: {remoteAdbHost: REMOTE_HOST},
          expectedOriginalArgs: ['-a', '-P', portArg],
          expectedCloneArgs: ['-a', '-H', REMOTE_HOST, '-P', portArg],
          expectedOriginalListen: true,
          expectedCloneListen: true,
        },
        {
          name: 'should add -a option only for clone',
          originalOptions: {executable: {path: 'adb', defaultArgs: []}},
          cloneOptions: {remoteAdbHost: REMOTE_HOST, listenAllNetwork: true},
          expectedOriginalArgs: ['-P', portArg],
          expectedCloneArgs: ['-a', '-H', REMOTE_HOST, '-P', portArg],
          expectedOriginalListen: false,
          expectedCloneListen: true,
        },
        {
          name: 'should not repeat -a option',
          originalOptions: {executable: {path: 'adb', defaultArgs: ['-a']}},
          cloneOptions: {remoteAdbHost: REMOTE_HOST, listenAllNetwork: true},
          expectedOriginalArgs: ['-a', '-P', portArg],
          expectedCloneArgs: ['-a', '-H', REMOTE_HOST, '-P', portArg],
          expectedOriginalListen: true,
          expectedCloneListen: true,
        },
        {
          name: 'should not add -a option if it was already in the defaultArgs with listenAllNetwork: true',
          originalOptions: {executable: {path: 'adb', defaultArgs: ['-a']}, listenAllNetwork: true},
          cloneOptions: {remoteAdbHost: REMOTE_HOST},
          expectedOriginalArgs: ['-a', '-P', portArg],
          expectedCloneArgs: ['-a', '-H', REMOTE_HOST, '-P', portArg],
          expectedOriginalListen: true,
          expectedCloneListen: true,
        },
        {
          name: 'should listenAllNetwork be true if the given defaultArgs included -a',
          originalOptions: {executable: {path: 'adb', defaultArgs: ['-a']}, listenAllNetwork: false},
          cloneOptions: {remoteAdbHost: REMOTE_HOST},
          expectedOriginalArgs: ['-a', '-P', portArg],
          expectedCloneArgs: ['-a', '-H', REMOTE_HOST, '-P', portArg],
          expectedOriginalListen: true,
          expectedCloneListen: true,
        },
      ];

      scenarios.forEach(({name, originalOptions, cloneOptions, expectedOriginalArgs, expectedCloneArgs, expectedOriginalListen, expectedCloneListen}) => {
        it(name, function () {
          const original = new ADB(originalOptions);
          const clone = original.clone(cloneOptions);

          expect(original.executable.defaultArgs).to.deep.equal(expectedOriginalArgs);
          expect(original.listenAllNetwork).to.equal(expectedOriginalListen);

          expect(clone.executable.path).to.equal(original.executable.path);
          expect(clone.executable.defaultArgs).to.deep.equal(expectedCloneArgs);
          expect(clone.remoteAdbHost).to.equal(cloneOptions.remoteAdbHost);
          expect(clone.listenAllNetwork).to.equal(expectedCloneListen);
        });
      });
    });
  });
});
