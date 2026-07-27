import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {ADB, DEFAULT_ADB_PORT} from '../../lib/adb.js';

describe('ADB', function () {
  describe('clone', function () {
    it('should copy all options', function () {
      const original = new ADB({
        executable: {path: 'var/adb', defaultArgs: ['-a']},
      });
      const clone = original.clone();

      assert.strictEqual(clone.executable.path, original.executable.path);
      assert.deepStrictEqual(clone.executable.defaultArgs, original.executable.defaultArgs);
    });

    it('should replace specified options', function () {
      const original = new ADB({
        executable: {path: 'adb', defaultArgs: ['-a']},
      });
      const clone = original.clone({
        remoteAdbHost: 'example.com',
      });

      assert.strictEqual(clone.executable.path, original.executable.path);
      assert.deepStrictEqual(clone.executable.defaultArgs, ['-a', '-H', 'example.com', '-P', String(DEFAULT_ADB_PORT)]);
      assert.strictEqual(clone.remoteAdbHost, 'example.com');
      assert.notStrictEqual(clone.adbHost, original.adbHost);
    });

    describe('-a option', function () {
      const portArg = String(DEFAULT_ADB_PORT);
      const REMOTE_HOST = 'example.com';
      const scenarios = [
        {
          name: 'should not have -a option by default',
          originalOptions: {executable: {path: 'adb', defaultArgs: []}},
          cloneOptions: {remoteAdbHost: REMOTE_HOST},
          expectedOriginalArgs: ['-P', portArg],
          expectedCloneArgs: ['-H', REMOTE_HOST, '-P', portArg],
          expectedOriginalListen: false,
          expectedCloneListen: false,
        },
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
          originalOptions: {
            executable: {path: 'adb', defaultArgs: ['-a']},
            listenAllNetwork: false,
          },
          cloneOptions: {remoteAdbHost: REMOTE_HOST},
          expectedOriginalArgs: ['-a', '-P', portArg],
          expectedCloneArgs: ['-a', '-H', REMOTE_HOST, '-P', portArg],
          expectedOriginalListen: true,
          expectedCloneListen: true,
        },
      ];

      scenarios.forEach(
        ({
          name,
          originalOptions,
          cloneOptions,
          expectedOriginalArgs,
          expectedCloneArgs,
          expectedOriginalListen,
          expectedCloneListen,
        }) => {
          it(name, function () {
            const original = new ADB(originalOptions);
            const clone = original.clone(cloneOptions);

            assert.deepStrictEqual(original.executable.defaultArgs, expectedOriginalArgs);
            assert.strictEqual(original.listenAllNetwork, expectedOriginalListen);

            assert.strictEqual(clone.executable.path, original.executable.path);
            assert.deepStrictEqual(clone.executable.defaultArgs, expectedCloneArgs);
            assert.strictEqual(clone.remoteAdbHost, cloneOptions.remoteAdbHost);
            assert.strictEqual(clone.listenAllNetwork, expectedCloneListen);
          });
        },
      );
    });
  });
});
