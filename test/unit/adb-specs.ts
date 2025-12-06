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
      it('should not have -a option', function () {
        const original = new ADB({
          executable: {path: 'adb', defaultArgs: []}
        });
        const clone = original.clone({
          remoteAdbHost: 'example.com',
        });

        expect(original.executable.defaultArgs).to.deep.equal(['-P', String(DEFAULT_ADB_PORT)]);
        expect(original.listenAllNetwork).to.be.false;

        expect(clone.executable.path).to.equal(original.executable.path);
        expect(clone.executable.defaultArgs).to.deep.equal(['-H', 'example.com', '-P', String(DEFAULT_ADB_PORT)]);
        expect(clone.remoteAdbHost).to.equal('example.com');
        expect(clone.listenAllNetwork).to.be.false;
      });

      it('should add -a option', function () {
        const original = new ADB({
          executable: {path: 'adb', defaultArgs: []}, listenAllNetwork: true
        });
        const clone = original.clone({
          remoteAdbHost: 'example.com',
        });

        expect(original.executable.defaultArgs).to.deep.equal(['-a', '-P', String(DEFAULT_ADB_PORT)]);
        expect(original.listenAllNetwork).to.be.true;

        expect(clone.executable.path).to.equal(original.executable.path);
        expect(clone.executable.defaultArgs).to.deep.equal(['-a', '-H', 'example.com', '-P', String(DEFAULT_ADB_PORT)]);
        expect(clone.remoteAdbHost).to.equal('example.com');
        expect(clone.listenAllNetwork).to.be.true;
      });

      it('should add -a option only for clone', function () {
        const original = new ADB({
          executable: {path: 'adb', defaultArgs: []}
        });
        const clone = original.clone({
          remoteAdbHost: 'example.com',
          listenAllNetwork: true
        });

        expect(original.executable.defaultArgs).to.deep.equal(['-P', String(DEFAULT_ADB_PORT)]);
        expect(original.listenAllNetwork).to.be.false;

        expect(clone.executable.path).to.equal(original.executable.path);
        expect(clone.executable.defaultArgs).to.deep.equal(['-a', '-H', 'example.com', '-P', String(DEFAULT_ADB_PORT)]);
        expect(clone.remoteAdbHost).to.equal('example.com');
        expect(clone.listenAllNetwork).to.be.true;
      });

      it('should not repeat -a option', function () {
        const original = new ADB({
          executable: {path: 'adb', defaultArgs: ['-a']}
        });
        const clone = original.clone({
          remoteAdbHost: 'example.com',
          listenAllNetwork: true,
        });

        expect(original.executable.defaultArgs).to.deep.equal(['-a', '-P', String(DEFAULT_ADB_PORT)]);
        expect(original.listenAllNetwork).to.be.true;

        expect(clone.executable.path).to.equal(original.executable.path);
        expect(clone.executable.defaultArgs).to.deep.equal(['-a', '-H', 'example.com', '-P', String(DEFAULT_ADB_PORT)]);
        expect(clone.remoteAdbHost).to.equal('example.com');
        expect(clone.listenAllNetwork).to.be.true;
      });

      it('should not add -a option if it was already in the defaultArgs with listenAllNetwork: true', function () {
        const original = new ADB({
          executable: {path: 'adb', defaultArgs: ['-a']}, listenAllNetwork: true
        });
        const clone = original.clone({
          remoteAdbHost: 'example.com',
        });

        expect(original.executable.defaultArgs).to.deep.equal(['-a', '-P', String(DEFAULT_ADB_PORT)]);
        expect(original.listenAllNetwork).to.be.true;

        expect(clone.executable.path).to.equal(original.executable.path);
        expect(clone.executable.defaultArgs).to.deep.equal(['-a', '-H', 'example.com', '-P', String(DEFAULT_ADB_PORT)]);
        expect(clone.remoteAdbHost).to.equal('example.com');
        expect(clone.listenAllNetwork).to.be.true;
      });

      it('should listenAllNetwork be true if the given defaultArgs included -a', function () {
        const original = new ADB({
          executable: {path: 'adb', defaultArgs: ['-a']}, listenAllNetwork: false
        });
        const clone = original.clone({
          remoteAdbHost: 'example.com',
        });
        expect(original.executable.defaultArgs).to.deep.equal(['-a', '-P', String(DEFAULT_ADB_PORT)]);
        expect(original.listenAllNetwork).to.be.true;

        expect(clone.executable.path).to.equal(original.executable.path);
        expect(clone.executable.defaultArgs).to.deep.equal(['-a', '-H', 'example.com', '-P', String(DEFAULT_ADB_PORT)]);
        expect(clone.remoteAdbHost).to.equal('example.com');
        expect(clone.listenAllNetwork).to.be.true;
      });
    });
  });
});
