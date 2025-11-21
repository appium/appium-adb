import {ADB} from '../../lib/adb';
import net from 'net';
import { Logcat } from '../../lib/logcat.js';
import * as teen_process from 'teen_process';
import { withMocks } from '@appium/test-support';
import { EOL } from 'os';
import { APIDEMOS_PKG } from '../constants';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

const apiLevel = 21,
      platformVersion = '4.4.4',
      language = 'en',
      country = 'US',
      locale = 'en-US',
      IME = 'com.android.inputmethod.latin/.LatinIME',
      imeList = `com.android.inputmethod.latin/.LatinIME:
  mId=com.android.inputmethod.latin/.LatinIME mSettingsActivityName=com.android
  mIsDefaultResId=0x7f070000
  Service:
    priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false
    ServiceInfo:
      name=com.android.inputmethod.latin.LatinIME
      packageName=com.android.inputmethod.latin
      labelRes=0x7f0a0037 nonLocalizedLabel=null icon=0x0 banner=0x0
      enabled=true exported=true processName=com.android.inputmethod.latin
      permission=android.permission.BIND_INPUT_METHOD
      flags=0x0`,
      model = `Android SDK built for X86_64`,
      manufacturer = `unknown`,
      screenSize = `768x1280`;

const adb = new ADB({ adbExecTimeout: 60000 });
const logcat = new Logcat({
  adb: adb.executable,
  debug: false,
  debugTrace: false
});

describe('general commands', withMocks({adb, logcat, teen_process, net}, function (mocks) {

  afterEach(function () {
    mocks.verify();
  });

  describe('shell', function () {
    describe('getApiLevel', function () {
      it('should call shell with correct args', async function () {
        (mocks as any).adb.expects('getDeviceProperty')
          .once().withExactArgs('ro.build.version.sdk')
          .returns(`${apiLevel}`);
        expect(await adb.getApiLevel()).to.equal(apiLevel);
      });
      it('should call shell with correct args with Q preview device', async function () {
        adb._apiLevel = undefined;
        (mocks as any).adb.expects('getDeviceProperty')
          .once().withExactArgs('ro.build.version.sdk')
          .returns('28');
        (mocks as any).adb.expects('getDeviceProperty')
          .once().withExactArgs('ro.build.version.release')
          .returns('q');
        expect(await adb.getApiLevel()).to.equal(29);
      });
      it('should call shell with correct args with R preview device', async function () {
        adb._apiLevel = undefined;
        (mocks as any).adb.expects('getDeviceProperty')
          .once().withExactArgs('ro.build.version.sdk')
          .returns('29');
        (mocks as any).adb.expects('getDeviceProperty')
          .once().withExactArgs('ro.build.version.release')
          .returns('R');
        expect(await adb.getApiLevel()).to.equal(30);
      });
    });
    describe('getPlatformVersion', function () {
      it('should call shell with correct args', async function () {
        (mocks as any).adb.expects('getDeviceProperty')
          .once().withExactArgs('ro.build.version.release')
          .returns(platformVersion);
        expect(await adb.getPlatformVersion()).to.equal(platformVersion);
      });
    });
    describe('getDeviceSysLanguage', function () {
      it('should call shell with correct args', async function () {
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['getprop', 'persist.sys.language'])
          .returns(language);
        expect(await adb.getDeviceSysLanguage()).to.equal(language);
      });
    });
    describe('getDeviceSysCountry', function () {
      it('should call shell with correct args', async function () {
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['getprop', 'persist.sys.country'])
          .returns(country);
        expect(await adb.getDeviceSysCountry()).to.equal(country);
      });
    });
    describe('getLocationProviders', function () {
      it('should call shell with correct args and return empty location_providers_allowed', async function () {
        (mocks as any).adb.expects('getApiLevel').once().returns(27);
        (mocks as any).adb.expects('getSetting')
          .once().withExactArgs('secure', 'location_providers_allowed')
          .returns('');
        const providers = await adb.getLocationProviders();
        expect(providers).to.be.an('array');
        expect(providers.length).to.equal(0);
      });
      it('should return one location_providers_allowed', async function () {
        (mocks as any).adb.expects('getApiLevel').once().returns(27);
        (mocks as any).adb.expects('getSetting')
          .once().withExactArgs('secure', 'location_providers_allowed')
          .returns('gps');
        const providers = await adb.getLocationProviders();
        expect(providers).to.be.an('array');
        expect(providers.length).to.equal(1);
        expect(providers).to.include('gps');
      });
      it('should return both location_providers_allowed', async function () {
        (mocks as any).adb.expects('getApiLevel').once().returns(27);
        (mocks as any).adb.expects('getSetting')
          .once().withExactArgs('secure', 'location_providers_allowed')
          .returns('gps ,wifi');
        const providers = await adb.getLocationProviders();
        expect(providers).to.be.an('array');
        expect(providers.length).to.equal(2);
        expect(providers).to.include('gps');
        expect(providers).to.include('wifi');
      });
    });
    describe('toggleGPSLocationProvider', function () {
      it('should call shell with correct args on gps enabled on API below 31', async function () {
        (mocks as any).adb.expects('getApiLevel').atLeast(1).returns(27);
        (mocks as any).adb.expects('setSetting')
          .withExactArgs('secure', 'location_providers_allowed', '+gps');
        (mocks as any).adb.expects('setSetting')
          .withExactArgs('secure', 'location_providers_allowed', '-gps');
        await adb.toggleGPSLocationProvider(true);
        await adb.toggleGPSLocationProvider(false);
      });
      it('should call shell with correct args on gps enabled on API above 30', async function () {
        (mocks as any).adb.expects('getApiLevel').atLeast(1).returns(31);
        (mocks as any).adb.expects('shell')
          .withExactArgs(['cmd', 'location', 'set-location-enabled', 'true']);
        (mocks as any).adb.expects('shell')
          .withExactArgs(['cmd', 'location', 'set-location-enabled', 'false']);
        await adb.toggleGPSLocationProvider(true);
        await adb.toggleGPSLocationProvider(false);
      });
    });
    describe('getDeviceSysLocale', function () {
      it('should call shell with correct args', async function () {
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['getprop', 'persist.sys.locale'])
          .returns(locale);
        expect(await adb.getDeviceSysLocale()).to.equal(locale);
      });
    });
    describe('getDeviceProductLanguage', function () {
      it('should call shell with correct args', async function () {
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['getprop', 'ro.product.locale.language'])
          .returns(language);
        expect(await adb.getDeviceProductLanguage()).to.equal(language);
      });
    });
    describe('getDeviceProductCountry', function () {
      it('should call shell with correct args', async function () {
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['getprop', 'ro.product.locale.region'])
          .returns(country);
        expect(await adb.getDeviceProductCountry()).to.equal(country);
      });
    });
    describe('getDeviceProductLocale', function () {
      it('should call shell with correct args', async function () {
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['getprop', 'ro.product.locale'])
          .returns(locale);
        expect(await adb.getDeviceProductLocale()).to.equal(locale);
      });
    });
    describe('setDeviceProperty', function () {
      it('should call setprop with correct args', async function () {
        (mocks as any).adb.expects('shell')
          .withExactArgs(['setprop', 'persist.sys.locale', locale], {
            privileged: true
          })
          .returns('');
        await adb.setDeviceProperty('persist.sys.locale', locale);
      });
    });
    describe('availableIMEs', function () {
      it('should call shell with correct args', async function () {
        (mocks as any).adb.expects('shell')
          .once().withArgs(['ime', 'list', '-a'])
          .returns(imeList);
        expect(await adb.availableIMEs()).to.have.length.above(0);
      });
    });
    describe('enabledIMEs', function () {
      it('should call shell with correct args', async function () {
        (mocks as any).adb.expects('shell')
          .once().withArgs(['ime', 'list'])
          .returns(imeList);
        expect(await adb.enabledIMEs()).to.have.length.above(0);
      });
    });
    describe('defaultIME', function () {
      const defaultIME = 'com.android.inputmethod.latin/.LatinIME';
      it('should call shell with correct args', async function () {
        (mocks as any).adb.expects('getSetting')
          .once().withExactArgs('secure', 'default_input_method')
          .returns(defaultIME);
        expect(await adb.defaultIME()).to.equal(defaultIME);
      });
    });
    describe('disableIME', function () {
      it('should call shell with correct args', async function () {
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['ime', 'disable', IME])
          .returns('');
        await adb.disableIME(IME);
      });
    });
    describe('enableIME', function () {
      it('should call shell with correct args', async function () {
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['ime', 'enable', IME])
          .returns('');
        await adb.enableIME(IME);
      });
    });
    describe('keyevent', function () {
      it('should call shell with correct args', async function () {
        const keycode = '29';
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['input', 'keyevent', keycode])
          .returns('');
        await adb.keyevent(keycode);
      });
    });
    describe('inputText', function () {
      it('should call shell with correct args if spaces are present in the text', async function () {
        const text = 'some text  with spaces';
        const expectedText = '"some%stext%s%swith%sspaces"';
        (mocks as any).adb.expects('shell')
          .once().withExactArgs([`input text ${expectedText}`])
          .returns('');
        await adb.inputText(text);
      });
      it('should call shell with correct args if special chars are not present in the text', async function () {
        const text = 'something';
        const expectedText = `something`;
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['input', 'text', expectedText])
          .returns('');
        await adb.inputText(text);
      });
      it('should call shell with correct args if special chars are present but spaces are not in the text', async function () {
        const text = '&something';
        const expectedText = `"&something"`;
        (mocks as any).adb.expects('shell')
          .once().withExactArgs([`input text ${expectedText}`])
          .returns('');
        await adb.inputText(text);
      });
      it('should call shell with correct args and select appropriate quotes', async function () {
        const text = 'some text & with quote$"';
        const expectedText = `'some%stext%s&%swith%squote\\$"'`;
        (mocks as any).adb.expects('shell')
          .once().withExactArgs([`input text ${expectedText}`])
          .returns('');
        await adb.inputText(text);
      });
    });
    describe('clearTextField', function () {
      it('should call shell with correct args', async function () {
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['input', 'keyevent', '67', '112', '67', '112', '67', '112', '67', '112'])
          .returns('');
        await adb.clearTextField(4);
      });
    });
    describe('lock', function () {
      it('should call isScreenLocked, keyevent', async function () {
        (mocks as any).adb.expects('isScreenLocked')
          .exactly(3)
          .onCall(0).returns(false)
          .onCall(1).returns(false)
          .onCall(2).returns(true);
        (mocks as any).adb.expects('keyevent')
          .once().withExactArgs(26)
          .returns('');
        await adb.lock();
      });
    });
    describe('back', function () {
      it('should call keyevent with correct args', async function () {
        (mocks as any).adb.expects('keyevent')
          .once().withExactArgs(4)
          .returns('');
        await adb.back();
      });
    });
    describe('goToHome', function () {
      it('should call keyevent with correct args', async function () {
        (mocks as any).adb.expects('keyevent')
          .once().withExactArgs(3)
          .returns('');
        await adb.goToHome();
      });
    });
    describe.skip('isScreenLocked', function () {
      it('should call keyevent with correct args', async function () {
        (mocks as any).adb.expects('keyevent')
          .once().withExactArgs(3)
          .returns('');
        await adb.goToHome();
      });
    });
    describe('isSoftKeyboardPresent', function () {
      it('should call shell with correct args and should return false', async function () {
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['dumpsys', 'input_method'])
          .returns('mInputShown=false');
        const {isKeyboardShown, canCloseKeyboard} = await adb.isSoftKeyboardPresent();
        expect(canCloseKeyboard).to.be.false;
        expect(isKeyboardShown).to.be.false;
      });
      it('should call shell with correct args and should return true', async function () {
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['dumpsys', 'input_method'])
          .returns('mInputShown=true mIsInputViewShown=true');
        const {isKeyboardShown, canCloseKeyboard} = await adb.isSoftKeyboardPresent();
        expect(isKeyboardShown).to.be.true;
        expect(canCloseKeyboard).to.be.true;
      });
    });
    describe('isAirplaneModeOn', function () {
      it('should call shell with correct args and should be true', async function () {
        (mocks as any).adb.expects('getSetting')
          .once().withExactArgs('global', 'airplane_mode_on')
          .returns('1');
        expect(await adb.isAirplaneModeOn()).to.be.true;
      });
      it('should call shell with correct args and should be false', async function () {
        (mocks as any).adb.expects('getSetting')
          .once().withExactArgs('global', 'airplane_mode_on')
          .returns('0');
        expect(await adb.isAirplaneModeOn()).to.be.false;
      });
    });
    describe('setAirplaneMode', function () {
      it('should call shell with correct args API 29', async function () {
        (mocks as any).adb.expects('getApiLevel').once().returns(29);
        (mocks as any).adb.expects('setSetting')
          .once().withExactArgs('global', 'airplane_mode_on', 1)
          .returns('');
        await adb.setAirplaneMode(true);
      });
      it('should call shell with correct args API 30', async function () {
        (mocks as any).adb.expects('getApiLevel').once().returns(30);
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['cmd', 'connectivity', 'airplane-mode', 'enable'])
          .returns('');
        await adb.setAirplaneMode(true);
      });
    });
    describe('broadcastAirplaneMode', function () {
      it('should call shell with correct args', async function () {
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE', '--ez', 'state', 'true'])
          .returns('');
        await adb.broadcastAirplaneMode(true);
      });
    });
    describe('isWifiOn', function () {
      it('should call shell with correct args and should be true', async function () {
        (mocks as any).adb.expects('getSetting')
          .once().withExactArgs('global', 'wifi_on')
          .returns('1');
        expect(await adb.isWifiOn()).to.be.true;
      });
      it('should call shell with correct args and should be false', async function () {
        (mocks as any).adb.expects('getSetting')
          .once().withExactArgs('global', 'wifi_on')
          .returns('0');
        expect(await adb.isWifiOn()).to.be.false;
      });
    });
    describe('setWifiState', function () {
      it('should call shell with correct args for real device', async function () {
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['cmd', '-w', 'wifi', 'set-wifi-enabled', 'enabled'])
          .returns('');
        await adb.setWifiState(true);
      });
      it('should call shell with correct args for emulator', async function () {
        (mocks as any).adb.expects('getApiLevel')
          .once().returns(25);
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['svc', 'wifi', 'disable'], {
            privileged: true
          })
          .returns('');
        await adb.setWifiState(false, true);
      });
    });
    describe('isDataOn', function () {
      it('should call shell with correct args and should be true', async function () {
        (mocks as any).adb.expects('getSetting')
          .once().withExactArgs('global', 'mobile_data')
          .returns('1');
        expect(await adb.isDataOn()).to.be.true;
      });
      it('should call shell with correct args and should be false', async function () {
        (mocks as any).adb.expects('getSetting')
          .once().withExactArgs('global', 'mobile_data')
          .returns('0');
        expect(await adb.isDataOn()).to.be.false;
      });
    });
    describe('setDataState', function () {
      it('should call shell with correct args for real device', async function () {
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['cmd', 'phone', 'data', 'disable'])
          .returns('');
        await adb.setDataState(false);
      });
      it('should call shell with correct args for emulator', async function () {
        (mocks as any).adb.expects('getApiLevel')
          .once().returns(26);
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['svc', 'data', 'enable'], {
            privileged: false
          })
          .returns('');
        await adb.setDataState(true, true);
      });
    });
    describe('isAnimationOn', function () {
      const mockSetting = function (duration_scale, transition_scale, window_scale) {
        (mocks as any).adb.expects('getSetting').once().withExactArgs('global', 'animator_duration_scale')
          .returns(duration_scale);
        (mocks as any).adb.expects('getSetting').once().withExactArgs('global', 'transition_animation_scale')
          .returns(transition_scale);
        (mocks as any).adb.expects('getSetting').once().withExactArgs('global', 'window_animation_scale')
          .returns(window_scale);
      };
      it('should return false if all animation settings are equal to zero', async function () {
        mockSetting('0.0', '0.0', '0.0');
        expect(await adb.isAnimationOn()).to.be.false;
      });
      it('should return true if animator_duration_scale setting is NOT equal to zero', async function () {
        mockSetting('0.5', '0.0', '0.0');
        expect(await adb.isAnimationOn()).to.be.true;
      });
      it('should return true if transition_animation_scale setting is NOT equal to zero', async function () {
        mockSetting('0.0', '0.5', '0.0');
        expect(await adb.isAnimationOn()).to.be.true;
      });
      it('should return true if window_animation_scale setting is NOT equal to zero', async function () {
        mockSetting('0.0', '0.0', '0.5');
        expect(await adb.isAnimationOn()).to.be.true;
      });
    });
    describe('setAnimation', function () {
      it('should set 1/5 for 11/5', async function () {
        (mocks as any).adb.expects('setSetting').once().withExactArgs('global', 'animator_duration_scale', 1.5);
        (mocks as any).adb.expects('setSetting').once().withExactArgs('global', 'transition_animation_scale', 1.5);
        (mocks as any).adb.expects('setSetting').once().withExactArgs('global', 'window_animation_scale', 1.5);
        expect(await adb.setAnimationScale(1.5)).not.throws;
      });
      it('should set 1 for 1', async function () {
        (mocks as any).adb.expects('setSetting').once().withExactArgs('global', 'animator_duration_scale', 1);
        (mocks as any).adb.expects('setSetting').once().withExactArgs('global', 'transition_animation_scale', 1);
        (mocks as any).adb.expects('setSetting').once().withExactArgs('global', 'window_animation_scale', 1);
        expect(await adb.setAnimationScale(1)).not.throws;
      });
      it('should set 0 for 0', async function () {
        (mocks as any).adb.expects('setSetting').once().withExactArgs('global', 'animator_duration_scale', 0);
        (mocks as any).adb.expects('setSetting').once().withExactArgs('global', 'transition_animation_scale', 0);
        (mocks as any).adb.expects('setSetting').once().withExactArgs('global', 'window_animation_scale', 0);
        expect(await adb.setAnimationScale(0)).not.throws;
      });
      it('should set 0 for negative values', async function () {
        (mocks as any).adb.expects('setSetting').once().withExactArgs('global', 'animator_duration_scale', -1);
        (mocks as any).adb.expects('setSetting').once().withExactArgs('global', 'transition_animation_scale', -1);
        (mocks as any).adb.expects('setSetting').once().withExactArgs('global', 'window_animation_scale', -1);
        expect(await adb.setAnimationScale(-1)).not.throws;
      });
    });
    describe('forwardPort', function () {
      const sysPort = 12345,
            devicePort = 54321;
      it('forwardPort should call shell with correct args', async function () {
        (mocks as any).adb.expects('adbExec')
          .once().withExactArgs(['forward', `tcp:${sysPort}`, `tcp:${devicePort}`])
          .returns('');
        await adb.forwardPort(sysPort, devicePort);
      });
      it('forwardAbstractPort should call shell with correct args', async function () {
        (mocks as any).adb.expects('adbExec')
          .once().withExactArgs(['forward', `tcp:${sysPort}`, `localabstract:${devicePort}`])
          .returns('');
        await adb.forwardAbstractPort(sysPort, devicePort);
      });
      it('removePortForward should call shell with correct args', async function () {
        (mocks as any).adb.expects('adbExec')
            .once().withExactArgs(['forward', `--remove`, `tcp:${sysPort}`])
            .returns('');
        await adb.removePortForward(sysPort);
      });
    });
    describe('reversePort', function () {
      const sysPort = 12345,
            devicePort = 54321;
      it('reversePort should call shell with correct args', async function () {
        (mocks as any).adb.expects('adbExec')
          .once().withExactArgs(['reverse', `tcp:${devicePort}`, `tcp:${sysPort}`])
          .returns('');
        await adb.reversePort(devicePort, sysPort);
      });
      it('removePortReverse should call shell with correct args', async function () {
        (mocks as any).adb.expects('adbExec')
            .once().withExactArgs(['reverse', `--remove`, `tcp:${devicePort}`])
            .returns('');
        await adb.removePortReverse(devicePort);
      });
    });
    describe('ping', function () {
      it('should call shell with correct args and should return true', async function () {
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['echo', 'ping'])
          .returns('ping');
        expect(await adb.ping()).to.be.true;
      });
    });
    describe('restart', function () {
      it('should call adb in correct order', async function () {
        (mocks as any).adb.expects('stopLogcat').once().returns('');
        (mocks as any).adb.expects('restartAdb').once().returns('');
        (mocks as any).adb.expects('waitForDevice').once().returns('');
        (mocks as any).adb.expects('startLogcat').once().returns('');
        await adb.restart();
      });
    });
    describe('stopLogcat', function () {
      it('should call stopCapture', async function () {
        adb.logcat = logcat;
        (mocks as any).logcat.expects('stopCapture').once().returns('');
        await adb.stopLogcat();
      });
    });
    describe('getLogcatLogs', function () {
      it('should call getLogs', async function () {
        adb.logcat = logcat;
        (mocks as any).logcat.expects('getLogs').once().returns('');
        await adb.getLogcatLogs();
      });
    });
    describe('broadcast', function () {
      it('should broadcast intent correctly', async function () {
        (mocks as any).adb.expects('isValidClass')
          .once().withExactArgs('com.test.intent')
          .returns(true);
        (mocks as any).adb.expects('shell')
          .once().withExactArgs(['am', 'broadcast', '-a', 'com.test.intent'])
          .returns('');
        await adb.broadcast('com.test.intent');
      });
      it('should throw error for invalid intent', async function () {
        (mocks as any).adb.expects('isValidClass')
          .once().withExactArgs('invalid-intent')
          .returns(false);
        await expect(adb.broadcast('invalid-intent')).to.eventually.be.rejectedWith(/Invalid intent/);
      });
    });
  });
  describe('device info', function () {
    it('should get device model', async function () {
      (mocks as any).adb.expects('shell')
          .once().withExactArgs(['getprop', 'ro.product.model'])
          .returns(model);
      await adb.getModel();
    });
    it('should get device manufacturer', async function () {
      (mocks as any).adb.expects('shell')
          .once().withExactArgs(['getprop', 'ro.product.manufacturer'])
          .returns(manufacturer);
      await adb.getManufacturer();
    });
    it('should get device screen size', async function () {
      (mocks as any).adb.expects('shell')
          .once().withExactArgs(['wm', 'size'])
          .returns(screenSize);
      await adb.getScreenSize();
    });
    it('should get device screen density', async function () {
      (mocks as any).adb.expects('shell')
          .once().withExactArgs(['wm', 'density'])
          .returns('Physical density: 420');
      const density = await adb.getScreenDensity();
      expect(density).to.equal(420);
    });
    it('should return null for invalid screen density', async function () {
      (mocks as any).adb.expects('shell')
          .once().withExactArgs(['wm', 'density'])
          .returns('Physical density: unknown');
      const density = await adb.getScreenDensity();
      expect(density, null);
    });
  });
  describe('app permission', function () {
    const dumpedOutput = `
          declared permissions:
            com.xxx.permission.C2D_MESSAGE: prot=signature, INSTALLED
            com.xxx.permission.C2D_MESSAGE: prot=signature
          requested permissions:
            android.permission.ACCESS_NETWORK_STATE
            android.permission.WRITE_EXTERNAL_STORAGE
            android.permission.INTERNET
            android.permission.READ_CONTACTS
            android.permission.RECORD_AUDIO
            android.permission.VIBRATE
            android.permission.CAMERA
            android.permission.FLASHLIGHT
            android.permission.READ_PHONE_STATE
            android.permission.MODIFY_AUDIO_SETTINGS
            android.permission.BLUETOOTH
            android.permission.WAKE_LOCK
            com.google.android.c2dm.permission.RECEIVE
            com.xxx.permission.C2D_MESSAGE
            android.permission.ACCESS_FINE_LOCATION
            android.permission.READ_EXTERNAL_STORAGE
            android.permission.RECEIVE_BOOT_COMPLETED
            .permission.C2D_MESSAGE
          install permissions:
            com.google.android.c2dm.permission.RECEIVE: granted=true
            android.permission.MODIFY_AUDIO_SETTINGS: granted=true
            android.permission.RECEIVE_BOOT_COMPLETED: granted=true
            android.permission.BLUETOOTH: granted=true
            android.permission.INTERNET: granted=true
            com.xxx.permission.C2D_MESSAGE: granted=true
            android.permission.FLASHLIGHT: granted=true
            android.permission.ACCESS_NETWORK_STATE: granted=true
            android.permission.VIBRATE: granted=true
            android.permission.WAKE_LOCK: granted=true
          User 0: ceDataInode=1504712 installed=true hidden=false suspended=false stopped=false notLaunched=false enabled=0
            gids=[3002, 3003]
            runtime permissions:
              android.permission.ACCESS_FINE_LOCATION: granted=true
              android.permission.READ_EXTERNAL_STORAGE: granted=true
              android.permission.READ_PHONE_STATE: granted=true
              android.permission.CAMERA: granted=false, flags=[ USER_SET ]
              android.permission.WRITE_EXTERNAL_STORAGE: granted=true
              android.permission.RECORD_AUDIO: granted=true
              android.permission.READ_CONTACTS: granted=false, flags=[ USER_SET ]


      Dexopt state:
        [com.xxx]
          Instruction Set: arm
            path: /data/app/com.xxx-1/base.apk
            status: /data/app/com.xxxa-1/oat/arm/base.odex [compilation_filter=interpret-only, status=kOatUpToDate]


      Compiler stats:
        [com.xxx]
           base.apk - 8264

    DUMP OF SERVICE activity:
      ACTIVITY MANAGER PENDING INTENTS (dumpsys activity intents)
        (nothing)`;

    const dumpedLimitedOutput = `
          declared permissions:
            com.xxx.permission.C2D_MESSAGE: prot=signature, INSTALLED
            com.xxx.permission.C2D_MESSAGE: prot=signature
          requested permissions:
            android.permission.ACCESS_NETWORK_STATE
            android.permission.WRITE_EXTERNAL_STORAGE
            android.permission.INTERNET
            android.permission.READ_CONTACTS
            android.permission.RECORD_AUDIO
            android.permission.VIBRATE
            android.permission.CAMERA
            android.permission.FLASHLIGHT
            android.permission.READ_PHONE_STATE
            android.permission.MODIFY_AUDIO_SETTINGS
            android.permission.BLUETOOTH
            android.permission.WAKE_LOCK
            com.google.android.c2dm.permission.RECEIVE
            com.xxx.permission.C2D_MESSAGE
            android.permission.ACCESS_FINE_LOCATION
            android.permission.READ_EXTERNAL_STORAGE
            android.permission.RECEIVE_BOOT_COMPLETED
            .permission.C2D_MESSAGE
          User 0: ceDataInode=1504712 installed=true hidden=false suspended=false stopped=false notLaunched=false enabled=0
            gids=[3002, 3003]
            runtime permissions:
              android.permission.ACCESS_FINE_LOCATION: granted=true
              android.permission.READ_EXTERNAL_STORAGE: granted=true
              android.permission.READ_PHONE_STATE: granted=true
              android.permission.CAMERA: granted=false, flags=[ USER_SET ]
              android.permission.WRITE_EXTERNAL_STORAGE: granted=true
              android.permission.RECORD_AUDIO: granted=true
              android.permission.READ_CONTACTS: granted=false, flags=[ USER_SET ]


      Dexopt state:
        [com.xxx]
          Instruction Set: arm
            path: /data/app/com.xxx-1/base.apk
            status: /data/app/com.xxxa-1/oat/arm/base.odex [compilation_filter=interpret-only, status=kOatUpToDate]


      Compiler stats:
        [com.xxx]
           base.apk - 8264

    DUMP OF SERVICE activity:
      ACTIVITY MANAGER PENDING INTENTS (dumpsys activity intents)
        (nothing)`;

    it('should grant requested permission', async function () {
      (mocks as any).adb.expects('shell')
          .once().withArgs(['pm', 'grant', APIDEMOS_PKG, 'android.permission.READ_EXTERNAL_STORAGE']);
      await adb.grantPermission(APIDEMOS_PKG, 'android.permission.READ_EXTERNAL_STORAGE');
    });
    it('should revoke requested permission', async function () {
      (mocks as any).adb.expects('shell')
          .once().withArgs(['pm', 'revoke', APIDEMOS_PKG, 'android.permission.READ_EXTERNAL_STORAGE']);
      await adb.revokePermission(APIDEMOS_PKG, 'android.permission.READ_EXTERNAL_STORAGE');
    });
    it('should properly list requested permissions', async function () {
      (mocks as any).adb.expects('shell').once().returns(dumpedOutput);
      const result = await adb.getReqPermissions('io.appium.android');
      for (const perm of [
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.INTERNET',
        'android.permission.READ_CONTACTS',
        'android.permission.RECORD_AUDIO',
        'android.permission.VIBRATE',
        'android.permission.CAMERA',
        'android.permission.FLASHLIGHT',
        'android.permission.READ_PHONE_STATE',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.BLUETOOTH',
        'android.permission.WAKE_LOCK',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.RECEIVE_BOOT_COMPLETED'
      ]) {
        expect(result).to.include(perm);
      }
    });
    it('should properly list requested permissions for output without install permissions', async function () {
      (mocks as any).adb.expects('shell').once().returns(dumpedLimitedOutput);
      const result = await adb.getReqPermissions('io.appium.android');
      for (const perm of [
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.INTERNET',
        'android.permission.READ_CONTACTS',
        'android.permission.RECORD_AUDIO',
        'android.permission.VIBRATE',
        'android.permission.CAMERA',
        'android.permission.FLASHLIGHT',
        'android.permission.READ_PHONE_STATE',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.BLUETOOTH',
        'android.permission.WAKE_LOCK',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.RECEIVE_BOOT_COMPLETED'
      ]) {
        expect(result).to.include(perm);
      }
    });
    it('should properly list granted permissions', async function () {
      (mocks as any).adb.expects('shell').once().returns(dumpedOutput);
      const result = await adb.getGrantedPermissions('io.appium.android');
      for (const perm of [
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.RECEIVE_BOOT_COMPLETED',
        'android.permission.BLUETOOTH',
        'android.permission.INTERNET',
        'android.permission.FLASHLIGHT',
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.VIBRATE',
        'android.permission.WAKE_LOCK',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.READ_PHONE_STATE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.RECORD_AUDIO'
      ]) {
        expect(result).to.include(perm);
      }
      for (const perm of [
        'android.permission.READ_CONTACTS',
        'android.permission.CAMERA',
      ]) {
        expect(result).to.not.include(perm);
      }
    });
    it('should properly list granted permissions for output without install permissions', async function () {
      (mocks as any).adb.expects('shell').once().returns(dumpedLimitedOutput);
      const result = await adb.getGrantedPermissions('io.appium.android');
      for (const perm of [
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.READ_PHONE_STATE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.RECORD_AUDIO'
      ]) {
        expect(result).to.include(perm);
      }
      for (const perm of [
        'android.permission.READ_CONTACTS',
        'android.permission.CAMERA'
      ]) {
        expect(result).to.not.include(perm);
      }
    });
    it('should properly list denied permissions', async function () {
      (mocks as any).adb.expects('shell').once().returns(dumpedOutput);
      const result = await adb.getDeniedPermissions('io.appium.android');
      for (const perm of [
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.RECEIVE_BOOT_COMPLETED',
        'android.permission.BLUETOOTH',
        'android.permission.INTERNET',
        'android.permission.FLASHLIGHT',
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.VIBRATE',
        'android.permission.WAKE_LOCK',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.READ_PHONE_STATE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.RECORD_AUDIO',
      ]) {
        expect(result).to.not.include(perm);
      }
      for (const perm of [
        'android.permission.READ_CONTACTS',
        'android.permission.CAMERA',
      ]) {
        expect(result).to.include(perm);
      }
    });
    it('should properly list denied permissions for output without install permissions', async function () {
      (mocks as any).adb.expects('shell').once().returns(dumpedLimitedOutput);
      const result = await adb.getDeniedPermissions('io.appium.android');
      for (const perm of [
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.READ_PHONE_STATE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.RECORD_AUDIO'
      ]) {
        expect(result).to.not.include(perm);
      }
      for (const perm of [
        'android.permission.READ_CONTACTS',
        'android.permission.CAMERA'
      ]) {
        expect(result).to.include(perm);
      }
    });
  });
  it('isValidClass should correctly validate class names', function () {
    expect(adb.isValidClass('some.package/some.package.Activity')).to.be.true;
    expect(adb.isValidClass('illegalPackage#/adsasd')).to.be.false;
  });
  it('getAdbPath should correctly return adbPath', function () {
    expect(adb.getAdbPath()).to.equal(adb.executable.path);
  });
  describe('setHttpProxy', function () {
    it('should throw an error on undefined proxy_host', async function () {
      await expect(adb.setHttpProxy(undefined as any, undefined as any)).to.eventually.be.rejected;
    });
    it('should throw an error on undefined proxy_port', async function () {
      await expect(adb.setHttpProxy('http://localhost', undefined as any)).to.eventually.be.rejected;
    });
    it('should call setSetting method with correct args', async function () {
      const proxyHost = 'http://localhost';
      const proxyPort = 4723;
      (mocks as any).adb.expects('setSetting').once().withExactArgs('global', 'http_proxy', `${proxyHost}:${proxyPort}`);
      (mocks as any).adb.expects('setSetting').once().withExactArgs('global', 'global_http_proxy_host', proxyHost);
      (mocks as any).adb.expects('setSetting').once().withExactArgs('global', 'global_http_proxy_port', `${proxyPort}`);
      await adb.setHttpProxy(proxyHost, proxyPort);
    });
  });
  describe('deleteHttpProxy', function () {
    it('should call setSetting method with correct args', async function () {
      (mocks as any).adb.expects('shell').once().withExactArgs(['settings', 'delete', 'global', 'http_proxy']);
      (mocks as any).adb.expects('shell').once().withExactArgs(['settings', 'delete', 'global', 'global_http_proxy_host']);
      (mocks as any).adb.expects('shell').once().withExactArgs(['settings', 'delete', 'global', 'global_http_proxy_port']);
      (mocks as any).adb.expects('shell').once().withExactArgs(['settings', 'delete', 'global', 'global_http_proxy_exclusion_list']);
      await adb.deleteHttpProxy();
    });
  });
  describe('setSetting', function () {
    it('should call shell settings put', async function () {
      (mocks as any).adb.expects('shell').once()
        .withExactArgs(['settings', 'put', 'namespace', 'setting', 'value']);
      await adb.setSetting('namespace', 'setting', 'value');
    });
  });
  describe('getSetting', function () {
    it('should call shell settings get', async function () {
      (mocks as any).adb.expects('shell').once()
        .withArgs(['settings', 'get', 'namespace', 'setting'])
        .returns('value');
      expect(await adb.getSetting('namespace', 'setting')).to.be.equal('value');
    });
  });
  describe('getCurrentTimeZone', function () {
    it('should call shell with correct args', async function () {
      (mocks as any).adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.timezone'])
        .returns(`Asia/Tokyo${EOL}`);
      expect(await adb.getTimeZone()).to.equal('Asia/Tokyo');
    });
    it('should raise an error', async function () {
      (mocks as any).adb.expects('shell').throws();
      await expect(adb.getTimeZone()).to.eventually.be.rejected;
    });
  });
  describe('setHiddenApiPolicy', function () {
    it('should call setSetting method with correct args for set hidden api policy', async function () {
      (mocks as any).adb.expects('shell').once().withExactArgs(
        'settings put global hidden_api_policy_pre_p_apps 1;' +
        'settings put global hidden_api_policy_p_apps 1;' +
        'settings put global hidden_api_policy 1');
      await adb.setHiddenApiPolicy(1);
    });
  });
  describe('setDefaultHiddenApiPolicy', function () {
    it('should call setSetting method with correct args for set hidden api policy', async function () {
      (mocks as any).adb.expects('shell').once().withExactArgs(
        'settings delete global hidden_api_policy_pre_p_apps;' +
        'settings delete global hidden_api_policy_p_apps;' +
        'settings delete global hidden_api_policy');
      await adb.setDefaultHiddenApiPolicy();
    });
  });
}));
