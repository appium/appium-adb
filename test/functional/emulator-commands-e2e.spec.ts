import {ADB} from '../../lib/adb';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {describe, it, before, type TestContext} from 'node:test';

chai.use(chaiAsPromised);

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
      expect(name).to.not.be.empty;
    });

    it('should fail if the command is unknown', async function () {
      await expect(adb.execEmuConsoleCommand(['avd', 'namer'])).to.eventually.be.rejected;
    });
  });

  describe('getEmuVersionInfo', function () {
    it('should get version info', async function () {
      const {revision, buildId} = await adb.getEmuVersionInfo();
      expect(revision).to.not.be.empty;
      expect(buildId).to.be.a('number');
      expect((buildId ?? 0) > 0).to.be.true;
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
      expect(apiMatch && parseInt(apiMatch[0], 10) > 0).to.be.true;
    });
  });
});
