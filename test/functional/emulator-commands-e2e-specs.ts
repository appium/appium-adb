import {ADB} from '../../lib/adb';

describe('emulator commands', function () {
  let adb;
  let chai;
  let expect;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    expect = chai.expect;
    chai.use(chaiAsPromised.default);

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
      expect(name).to.not.be.empty;
    });

    it('should fail if the command is unknown', async function () {
      await adb.execEmuConsoleCommandexpect(['avd', 'namer']).to.eventually
        .be.rejected;
    });
  });

  describe('getEmuVersionInfo', function () {
    it('should get version info', async function () {
      const {revision, buildId} = await adb.getEmuVersionInfo();
      expect(revision).to.not.be.empty;
      expect(buildId > 0).to.be.true;
    });
  });

  describe('getEmuImageProperties', function () {
    it('should get emulator image properties', async function () {
      if (process.env.CI) {
        return this.skip();
      }

      const name = await adb.execEmuConsoleCommand(['avd', 'name']);
      const {target} = await adb.getEmuImageProperties(name);
      const apiMatch = /\d+/.exec(target);
      expect(apiMatch && parseInt(apiMatch[0], 10) > 0).to.be.true;
    });
  });
});
