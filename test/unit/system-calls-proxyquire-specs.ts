import sinon from 'sinon';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import proxyquire from 'proxyquire';

chai.use(chaiAsPromised);

const proxy = proxyquire.noCallThru();

function makeAdbWithTeenMock(sandbox: sinon.SinonSandbox) {
  class FakeSubProcess {
    public cmd: string;
    public args: string[];
    constructor(cmd: string, args: string[]) {
      this.cmd = cmd;
      this.args = args;
    }
    start() {
      return Promise.resolve();
    }
    stop() {
      return Promise.resolve();
    }
  }

  const teen = {
    exec: sandbox.stub(),
    SubProcess: FakeSubProcess,
  };

  // Proxyquire the nested system-calls module to inject teen_process there,
  // then load ADB while stubbing its dependency to our mocked module.
  const mockedSystemCalls = proxy('../../build/lib/tools/system-calls.js', {
    'teen_process': teen,
  });
  const {ADB} = proxy('../../build/lib/adb.js', {
    './tools/system-calls': mockedSystemCalls,
  });

  const adb = new ADB();
  // Use a sentinel path; teen_process.exec is stubbed so no real exec occurs
  adb.executable.path = 'adb_path';

  return {adb, teen};
}

describe('system calls (proxyquire)', function () {
  let sandbox: sinon.SinonSandbox;
  let adb: any;
  let teen: {exec: sinon.SinonStub; SubProcess: any};

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    ({adb, teen} = makeAdbWithTeenMock(sandbox));
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('getConnectedDevices returns devices using teen_process.exec stub', async function () {
    teen.exec
      .withArgs('adb_path', ['-P', '5037', 'devices'])
      .returns({stdout: 'List of devices attached \n emulator-5554\tdevice'});

    const devices = await adb.getConnectedDevices();
    expect(devices).to.deep.equal([{udid: 'emulator-5554', state: 'device'}]);
  });

  it('createSubProcess uses injected FakeSubProcess', function () {
    const sp = adb.createSubProcess(['shell', 'echo', 'hi']);
    expect(sp).to.be.instanceof(teen.SubProcess);
  });

  it('shell outputFormat FULL via teen_process.exec', async function () {
    teen.exec
      .withArgs('adb_path', sinon.match.array)
      .returns({stdout: 'a value', stderr: 'an error', code: 0});

    const out = await adb.shell(['command'], {outputFormat: adb.EXEC_OUTPUT_FORMAT.FULL});
    expect(out).to.deep.equal({stdout: 'a value', stderr: 'an error'});
  });
});
