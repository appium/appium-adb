import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';

chai.use(chaiAsPromised);
chai.should();

describe('adb emu commands', function () {
  let adb;
  before(async function () {
    if (process.env.REAL_DEVICE) {
      return this.skip();
    }

    adb = await ADB.createADB();
    const devices = await adb.getConnectedEmulators();
    adb.setDevice(devices[0]);
  });

  describe('execEmuConsoleCommand', function () {
    it('should print name', async function () {
      const name = await adb.execEmuConsoleCommand(['avd', 'name']);
      name.should.not.be.empty;
    });

    it('should fail if the command is unknown', async function () {
      await adb.execEmuConsoleCommand(['avd', 'namer']).should.eventually
        .be.rejected;
    });
  });

  describe('getEmuVersionInfo', function () {
    it('should get version info', async function () {
      const {revision, buildId} = await adb.getEmuVersionInfo();
      revision.should.not.be.empty;
      (buildId > 0).should.be.true;
    });
  });

  describe('getEmuImageProperties', function () {
    it('should get emulator image properties', async function () {
      const name = await adb.execEmuConsoleCommand(['avd', 'name']);
      const {target} = await adb.getEmuImageProperties(name);
      const apiMatch = /\d+/.exec(target);
      (parseInt(apiMatch[0], 10) > 0).should.be.true;
    });
  });
});
