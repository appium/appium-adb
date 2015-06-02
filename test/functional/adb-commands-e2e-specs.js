import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'mochawait';
import ADB from '../../lib/adb.js';

chai.use(chaiAsPromised);
// change according to CI
const apiLevel = '21',
      IME = 'com.example.android.softkeyboard/.SoftKeyboard',
      defaultIME = 'com.android.inputmethod.latin/.LatinIME';

describe('adb commands', () => {
  let adb = new ADB();
  before(async () => {
    await adb.createADB();
  });
  it('getApiLevel should get correct api level', async () => {
    (await adb.getApiLevel()).should.equal(apiLevel);
  });
  it('availableIMEs should get list of available IMEs', async () => {
    (await adb.availableIMEs()).should.have.length.above(0);
  });
  it('enabledIMEs should get list of enabled IMEs', async () => {
    (await adb.enabledIMEs()).should.have.length.above(0);
  });
  it('defaultIME should get default IME', async () => {
    (await adb.defaultIME()).should.equal(defaultIME);
  });
  it('enableIME and disableIME should enable and disble IME', async () => {
    await adb.disableIME(IME);
    (await adb.enabledIMEs()).should.not.include(IME);
    await adb.enableIME(IME);
    (await adb.enabledIMEs()).should.include(IME);
    await adb.enabledIMEs();
  });
});
