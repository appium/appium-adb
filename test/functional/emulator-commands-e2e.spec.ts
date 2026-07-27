import assert from 'node:assert/strict';
import {describe, it, before, type TestContext} from 'node:test';

import {ADB} from '../../lib/adb.js';

describe('emulator commands', function () {
  let adb: ADB;

  before(async function () {
    adb = await ADB.createADB();
    const devices = await adb.getConnectedEmulators();
    adb.setDevice(devices[0]);
  });

  describe('execEmuConsoleCommand', function () {
    it('should print name', async function () {
      const name = await adb.execEmuConsoleCommand(['avd', 'name']);
      assert.ok(name.length > 0);
    });

    it('should fail if the command is unknown', async function () {
      await assert.rejects(adb.execEmuConsoleCommand(['avd', 'namer']));
    });
  });

  describe('getEmuVersionInfo', function () {
    it('should get version info', async function () {
      const {revision, buildId} = await adb.getEmuVersionInfo();
      assert.ok((revision ?? '').length > 0);
      assert.strictEqual(typeof buildId, 'number');
      assert.strictEqual((buildId ?? 0) > 0, true);
    });
  });

  describe('getEmuImageProperties', function () {
    it('should get emulator image properties', async function (ctx: TestContext) {
      if (process.env.CI) {
        return ctx.skip();
      }

      const name = await adb.execEmuConsoleCommand(['avd', 'name']);
      const {target} = await adb.getEmuImageProperties(name);
      const apiMatch = /\d+/.exec(target);
      assert.strictEqual(apiMatch && parseInt(apiMatch[0], 10) > 0, true);
    });
  });
});
