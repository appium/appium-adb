import {ADB} from '../../lib/adb';
import net from 'net';
import { Logcat } from '../../lib/logcat.js';
import * as teen_process from 'teen_process';
import { withMocks } from '@appium/test-support';
import { EOL } from 'os';

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
  let chai;
  let should;
  let expect;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    should = chai.should();
    expect = chai.expect;
    chai.use(chaiAsPromised.default);
  });

  afterEach(function () {
    mocks.verify();
  });

  describe('shell', function () {
    describe('getApiLevel', function () {
      it('should call shell with correct args', async function () {
        mocks.adb.expects('getDeviceProperty')
          .once().withExactArgs('ro.build.version.sdk')
          .returns(`${apiLevel}`);
        (await adb.getApiLevel()).should.equal(apiLevel);
      });
      it('should call shell with correct args with Q preview device', async function () {
        adb._apiLevel = null;
        mocks.adb.expects('getDeviceProperty')
          .once().withExactArgs('ro.build.version.sdk')
          .returns('28');
        mocks.adb.expects('getDeviceProperty')
          .once().withExactArgs('ro.build.version.release')
          .returns('q');
        (await adb.getApiLevel()).should.equal(29);
      });
      it('should call shell with correct args with R preview device', async function () {
        adb._apiLevel = null;
        mocks.adb.expects('getDeviceProperty')
          .once().withExactArgs('ro.build.version.sdk')
          .returns('29');
        mocks.adb.expects('getDeviceProperty')
          .once().withExactArgs('ro.build.version.release')
          .returns('R');
        (await adb.getApiLevel()).should.equal(30);
      });
    });
    describe('getPlatformVersion', function () {
      it('should call shell with correct args', async function () {
        mocks.adb.expects('getDeviceProperty')
          .once().withExactArgs('ro.build.version.release')
          .returns(platformVersion);
        (await adb.getPlatformVersion()).should.equal(platformVersion);
      });
    });
    describe('getDeviceSysLanguage', function () {
      it('should call shell with correct args', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['getprop', 'persist.sys.language'])
          .returns(language);
        (await adb.getDeviceSysLanguage()).should.equal(language);
      });
    });
    describe('getDeviceSysCountry', function () {
      it('should call shell with correct args', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['getprop', 'persist.sys.country'])
          .returns(country);
        (await adb.getDeviceSysCountry()).should.equal(country);
      });
    });
    describe('getLocationProviders', function () {
      it('should call shell with correct args and return empty location_providers_allowed', async function () {
        mocks.adb.expects('getApiLevel').once().returns(27);
        mocks.adb.expects('getSetting')
          .once().withExactArgs('secure', 'location_providers_allowed')
          .returns('');
        let providers = await adb.getLocationProviders();
        providers.should.be.an('array');
        providers.length.should.equal(0);
      });
      it('should return one location_providers_allowed', async function () {
        mocks.adb.expects('getApiLevel').once().returns(27);
        mocks.adb.expects('getSetting')
          .once().withExactArgs('secure', 'location_providers_allowed')
          .returns('gps');
        let providers = await adb.getLocationProviders();
        providers.should.be.an('array');
        providers.length.should.equal(1);
        providers.should.include('gps');
      });
      it('should return both location_providers_allowed', async function () {
        mocks.adb.expects('getApiLevel').once().returns(27);
        mocks.adb.expects('getSetting')
          .once().withExactArgs('secure', 'location_providers_allowed')
          .returns('gps ,wifi');
        let providers = await adb.getLocationProviders();
        providers.should.be.an('array');
        providers.length.should.equal(2);
        providers.should.include('gps');
        providers.should.include('wifi');
      });
    });
    describe('toggleGPSLocationProvider', function () {
      it('should call shell with correct args on gps enabled on API below 31', async function () {
        mocks.adb.expects('getApiLevel').atLeast(1).returns(27);
        mocks.adb.expects('setSetting')
          .withExactArgs('secure', 'location_providers_allowed', '+gps');
        mocks.adb.expects('setSetting')
          .withExactArgs('secure', 'location_providers_allowed', '-gps');
        await adb.toggleGPSLocationProvider(true);
        await adb.toggleGPSLocationProvider(false);
      });
      it('should call shell with correct args on gps enabled on API above 30', async function () {
        mocks.adb.expects('getApiLevel').atLeast(1).returns(31);
        mocks.adb.expects('shell')
          .withExactArgs(['cmd', 'location', 'set-location-enabled', 'true']);
        mocks.adb.expects('shell')
          .withExactArgs(['cmd', 'location', 'set-location-enabled', 'false']);
        await adb.toggleGPSLocationProvider(true);
        await adb.toggleGPSLocationProvider(false);
      });
    });
    describe('getDeviceSysLocale', function () {
      it('should call shell with correct args', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['getprop', 'persist.sys.locale'])
          .returns(locale);
        (await adb.getDeviceSysLocale()).should.equal(locale);
      });
    });
    describe('getDeviceProductLanguage', function () {
      it('should call shell with correct args', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['getprop', 'ro.product.locale.language'])
          .returns(language);
        (await adb.getDeviceProductLanguage()).should.equal(language);
      });
    });
    describe('getDeviceProductCountry', function () {
      it('should call shell with correct args', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['getprop', 'ro.product.locale.region'])
          .returns(country);
        (await adb.getDeviceProductCountry()).should.equal(country);
      });
    });
    describe('getDeviceProductLocale', function () {
      it('should call shell with correct args', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['getprop', 'ro.product.locale'])
          .returns(locale);
        (await adb.getDeviceProductLocale()).should.equal(locale);
      });
    });
    describe('setDeviceProperty', function () {
      it('should call setprop with correct args', async function () {
        mocks.adb.expects('shell')
          .withExactArgs(['setprop', 'persist.sys.locale', locale], {
            privileged: true
          })
          .returns('');
        await adb.setDeviceProperty('persist.sys.locale', locale);
      });
    });
    describe('availableIMEs', function () {
      it('should call shell with correct args', async function () {
        mocks.adb.expects('shell')
          .once().withArgs(['ime', 'list', '-a'])
          .returns(imeList);
        (await adb.availableIMEs()).should.have.length.above(0);
      });
    });
    describe('enabledIMEs', function () {
      it('should call shell with correct args', async function () {
        mocks.adb.expects('shell')
          .once().withArgs(['ime', 'list'])
          .returns(imeList);
        (await adb.enabledIMEs()).should.have.length.above(0);
      });
    });
    describe('defaultIME', function () {
      let defaultIME = 'com.android.inputmethod.latin/.LatinIME';
      it('should call shell with correct args', async function () {
        mocks.adb.expects('getSetting')
          .once().withExactArgs('secure', 'default_input_method')
          .returns(defaultIME);
        (await adb.defaultIME()).should.equal(defaultIME);
      });
    });
    describe('disableIME', function () {
      it('should call shell with correct args', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['ime', 'disable', IME])
          .returns('');
        await adb.disableIME(IME);
      });
    });
    describe('enableIME', function () {
      it('should call shell with correct args', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['ime', 'enable', IME])
          .returns('');
        await adb.enableIME(IME);
      });
    });
    describe('keyevent', function () {
      it('should call shell with correct args', async function () {
        let keycode = '29';
        mocks.adb.expects('shell')
          .once().withExactArgs(['input', 'keyevent', keycode])
          .returns('');
        await adb.keyevent(keycode);
      });
    });
    describe('inputText', function () {
      it('should call shell with correct args if spaces are present in the text', async function () {
        const text = 'some text  with spaces';
        const expectedText = '"some%stext%s%swith%sspaces"';
        mocks.adb.expects('shell')
          .once().withExactArgs([`input text ${expectedText}`])
          .returns('');
        await adb.inputText(text);
      });
      it('should call shell with correct args if special chars are not present in the text', async function () {
        const text = 'something';
        const expectedText = `something`;
        mocks.adb.expects('shell')
          .once().withExactArgs(['input', 'text', expectedText])
          .returns('');
        await adb.inputText(text);
      });
      it('should call shell with correct args if special chars are present but spaces are not in the text', async function () {
        const text = '&something';
        const expectedText = `"&something"`;
        mocks.adb.expects('shell')
          .once().withExactArgs([`input text ${expectedText}`])
          .returns('');
        await adb.inputText(text);
      });
      it('should call shell with correct args and select appropriate quotes', async function () {
        const text = 'some text & with quote$"';
        const expectedText = `'some%stext%s&%swith%squote\\$"'`;
        mocks.adb.expects('shell')
          .once().withExactArgs([`input text ${expectedText}`])
          .returns('');
        await adb.inputText(text);
      });
    });
    describe('clearTextField', function () {
      it('should call shell with correct args', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['input', 'keyevent', '67', '112', '67', '112', '67', '112', '67', '112'])
          .returns('');
        await adb.clearTextField(4);
      });
    });
    describe('lock', function () {
      it('should call isScreenLocked, keyevent', async function () {
        mocks.adb.expects('isScreenLocked')
          .exactly(3)
          .onCall(0).returns(false)
          .onCall(1).returns(false)
          .onCall(2).returns(true);
        mocks.adb.expects('keyevent')
          .once().withExactArgs(26)
          .returns('');
        await adb.lock();
      });
    });
    describe('back', function () {
      it('should call keyevent with correct args', async function () {
        mocks.adb.expects('keyevent')
          .once().withExactArgs(4)
          .returns('');
        await adb.back();
      });
    });
    describe('goToHome', function () {
      it('should call keyevent with correct args', async function () {
        mocks.adb.expects('keyevent')
          .once().withExactArgs(3)
          .returns('');
        await adb.goToHome();
      });
    });
    describe.skip('isScreenLocked', function () {
      it('should call keyevent with correct args', async function () {
        mocks.adb.expects('keyevent')
          .once().withExactArgs(3)
          .returns('');
        await adb.goToHome();
      });
    });
    describe('isSoftKeyboardPresent', function () {
      it('should call shell with correct args and should return false', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['dumpsys', 'input_method'])
          .returns('mInputShown=false');
        let {isKeyboardShown, canCloseKeyboard} = await adb.isSoftKeyboardPresent();
        canCloseKeyboard.should.be.false;
        isKeyboardShown.should.be.false;
      });
      it('should call shell with correct args and should return true', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['dumpsys', 'input_method'])
          .returns('mInputShown=true mIsInputViewShown=true');
        let {isKeyboardShown, canCloseKeyboard} = await adb.isSoftKeyboardPresent();
        isKeyboardShown.should.be.true;
        canCloseKeyboard.should.be.true;
      });
    });
    describe('isAirplaneModeOn', function () {
      it('should call shell with correct args and should be true', async function () {
        mocks.adb.expects('getSetting')
          .once().withExactArgs('global', 'airplane_mode_on')
          .returns('1');
        (await adb.isAirplaneModeOn()).should.be.true;
      });
      it('should call shell with correct args and should be false', async function () {
        mocks.adb.expects('getSetting')
          .once().withExactArgs('global', 'airplane_mode_on')
          .returns('0');
        (await adb.isAirplaneModeOn()).should.be.false;
      });
    });
    describe('setAirplaneMode', function () {
      it('should call shell with correct args API 29', async function () {
        mocks.adb.expects('getApiLevel').once().returns(29);
        mocks.adb.expects('setSetting')
          .once().withExactArgs('global', 'airplane_mode_on', 1)
          .returns('');
        await adb.setAirplaneMode(1);
      });
      it('should call shell with correct args API 30', async function () {
        mocks.adb.expects('getApiLevel').once().returns(30);
        mocks.adb.expects('shell')
          .once().withExactArgs(['cmd', 'connectivity', 'airplane-mode', 'enable'])
          .returns('');
        await adb.setAirplaneMode(1);
      });
    });
    describe('broadcastAirplaneMode', function () {
      it('should call shell with correct args', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE', '--ez', 'state', 'true'])
          .returns('');
        await adb.broadcastAirplaneMode(true);
      });
    });
    describe('isWifiOn', function () {
      it('should call shell with correct args and should be true', async function () {
        mocks.adb.expects('getSetting')
          .once().withExactArgs('global', 'wifi_on')
          .returns('1');
        (await adb.isWifiOn()).should.be.true;
      });
      it('should call shell with correct args and should be false', async function () {
        mocks.adb.expects('getSetting')
          .once().withExactArgs('global', 'wifi_on')
          .returns('0');
        (await adb.isWifiOn()).should.be.false;
      });
    });
    describe('setWifiState', function () {
      it('should call shell with correct args for real device', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['cmd', '-w', 'wifi', 'set-wifi-enabled', 'enabled'])
          .returns('');
        await adb.setWifiState(true);
      });
      it('should call shell with correct args for emulator', async function () {
        mocks.adb.expects('getApiLevel')
          .once().returns(25);
        mocks.adb.expects('shell')
          .once().withExactArgs(['svc', 'wifi', 'disable'], {
            privileged: true
          })
          .returns('');
        await adb.setWifiState(false, true);
      });
    });
    describe('isDataOn', function () {
      it('should call shell with correct args and should be true', async function () {
        mocks.adb.expects('getSetting')
          .once().withExactArgs('global', 'mobile_data')
          .returns('1');
        (await adb.isDataOn()).should.be.true;
      });
      it('should call shell with correct args and should be false', async function () {
        mocks.adb.expects('getSetting')
          .once().withExactArgs('global', 'mobile_data')
          .returns('0');
        (await adb.isDataOn()).should.be.false;
      });
    });
    describe('setDataState', function () {
      it('should call shell with correct args for real device', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['cmd', 'phone', 'data', 'disable'])
          .returns('');
        await adb.setDataState(false);
      });
      it('should call shell with correct args for emulator', async function () {
        mocks.adb.expects('getApiLevel')
          .once().returns(26);
        mocks.adb.expects('shell')
          .once().withExactArgs(['svc', 'data', 'enable'], {
            privileged: false
          })
          .returns('');
        await adb.setDataState(true, true);
      });
    });
    describe('isAnimationOn', function () {
      const mockSetting = function (duration_scale, transition_scale, window_scale) {
        mocks.adb.expects('getSetting').once().withExactArgs('global', 'animator_duration_scale')
          .returns(duration_scale);
        mocks.adb.expects('getSetting').once().withExactArgs('global', 'transition_animation_scale')
          .returns(transition_scale);
        mocks.adb.expects('getSetting').once().withExactArgs('global', 'window_animation_scale')
          .returns(window_scale);
      };
      it('should return false if all animation settings are equal to zero', async function () {
        mockSetting('0.0', '0.0', '0.0');
        (await adb.isAnimationOn()).should.be.false;
      });
      it('should return true if animator_duration_scale setting is NOT equal to zero', async function () {
        mockSetting('0.5', '0.0', '0.0');
        (await adb.isAnimationOn()).should.be.true;
      });
      it('should return true if transition_animation_scale setting is NOT equal to zero', async function () {
        mockSetting('0.0', '0.5', '0.0');
        (await adb.isAnimationOn()).should.be.true;
      });
      it('should return true if window_animation_scale setting is NOT equal to zero', async function () {
        mockSetting('0.0', '0.0', '0.5');
        (await adb.isAnimationOn()).should.be.true;
      });
    });
    describe('setAnimation', function () {
      it('should set 1/5 for 11/5', async function () {
        mocks.adb.expects('setSetting').once().withExactArgs('global', 'animator_duration_scale', 1.5);
        mocks.adb.expects('setSetting').once().withExactArgs('global', 'transition_animation_scale', 1.5);
        mocks.adb.expects('setSetting').once().withExactArgs('global', 'window_animation_scale', 1.5);
        expect(await adb.setAnimationScale(1.5)).not.throws;
      });
      it('should set 1 for 1', async function () {
        mocks.adb.expects('setSetting').once().withExactArgs('global', 'animator_duration_scale', 1);
        mocks.adb.expects('setSetting').once().withExactArgs('global', 'transition_animation_scale', 1);
        mocks.adb.expects('setSetting').once().withExactArgs('global', 'window_animation_scale', 1);
        expect(await adb.setAnimationScale(1)).not.throws;
      });
      it('should set 0 for 0', async function () {
        mocks.adb.expects('setSetting').once().withExactArgs('global', 'animator_duration_scale', 0);
        mocks.adb.expects('setSetting').once().withExactArgs('global', 'transition_animation_scale', 0);
        mocks.adb.expects('setSetting').once().withExactArgs('global', 'window_animation_scale', 0);
        expect(await adb.setAnimationScale(0)).not.throws;
      });
      it('should set 0 for negative values', async function () {
        mocks.adb.expects('setSetting').once().withExactArgs('global', 'animator_duration_scale', -1);
        mocks.adb.expects('setSetting').once().withExactArgs('global', 'transition_animation_scale', -1);
        mocks.adb.expects('setSetting').once().withExactArgs('global', 'window_animation_scale', -1);
        expect(await adb.setAnimationScale(-1)).not.throws;
      });
    });
    describe('forwardPort', function () {
      const sysPort = 12345,
            devicePort = 54321;
      it('forwardPort should call shell with correct args', async function () {
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['forward', `tcp:${sysPort}`, `tcp:${devicePort}`])
          .returns('');
        await adb.forwardPort(sysPort, devicePort);
      });
      it('forwardAbstractPort should call shell with correct args', async function () {
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['forward', `tcp:${sysPort}`, `localabstract:${devicePort}`])
          .returns('');
        await adb.forwardAbstractPort(sysPort, devicePort);
      });
      it('removePortForward should call shell with correct args', async function () {
        mocks.adb.expects('adbExec')
            .once().withExactArgs(['forward', `--remove`, `tcp:${sysPort}`])
            .returns('');
        await adb.removePortForward(sysPort);
      });
    });
    describe('reversePort', function () {
      const sysPort = 12345,
            devicePort = 54321;
      it('reversePort should call shell with correct args', async function () {
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['reverse', `tcp:${devicePort}`, `tcp:${sysPort}`])
          .returns('');
        await adb.reversePort(devicePort, sysPort);
      });
      it('removePortReverse should call shell with correct args', async function () {
        mocks.adb.expects('adbExec')
            .once().withExactArgs(['reverse', `--remove`, `tcp:${devicePort}`])
            .returns('');
        await adb.removePortReverse(devicePort);
      });
    });
    describe('ping', function () {
      it('should call shell with correct args and should return true', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['echo', 'ping'])
          .returns('ping');
        (await adb.ping()).should.be.true;
      });
    });
    describe('restart', function () {
      it('should call adb in correct order', async function () {
        mocks.adb.expects('stopLogcat').once().returns('');
        mocks.adb.expects('restartAdb').once().returns('');
        mocks.adb.expects('waitForDevice').once().returns('');
        mocks.adb.expects('startLogcat').once().returns('');
        await adb.restart();
      });
    });
    describe('stopLogcat', function () {
      it('should call stopCapture', async function () {
        adb.logcat = logcat;
        mocks.logcat.expects('stopCapture').once().returns('');
        await adb.stopLogcat();
      });
    });
    describe('getLogcatLogs', function () {
      it('should call getLogs', async function () {
        adb.logcat = logcat;
        mocks.logcat.expects('getLogs').once().returns('');
        await adb.getLogcatLogs();
      });
    });
    describe('broadcast', function () {
      it('should broadcast intent correctly', async function () {
        mocks.adb.expects('isValidClass')
          .once().withExactArgs('com.test.intent')
          .returns(true);
        mocks.adb.expects('shell')
          .once().withExactArgs(['am', 'broadcast', '-a', 'com.test.intent'])
          .returns('');
        await adb.broadcast('com.test.intent');
      });
      it('should throw error for invalid intent', async function () {
        mocks.adb.expects('isValidClass')
          .once().withExactArgs('invalid-intent')
          .returns(false);
        await adb.broadcast('invalid-intent').should.eventually.be.rejectedWith(/Invalid intent/);
      });
    });
  });
  describe('device info', function () {
    it('should get device model', async function () {
      mocks.adb.expects('shell')
          .once().withExactArgs(['getprop', 'ro.product.model'])
          .returns(model);
      await adb.getModel();
    });
    it('should get device manufacturer', async function () {
      mocks.adb.expects('shell')
          .once().withExactArgs(['getprop', 'ro.product.manufacturer'])
          .returns(manufacturer);
      await adb.getManufacturer();
    });
    it('should get device screen size', async function () {
      mocks.adb.expects('shell')
          .once().withExactArgs(['wm', 'size'])
          .returns(screenSize);
      await adb.getScreenSize();
    });
    it('should get device screen density', async function () {
      mocks.adb.expects('shell')
          .once().withExactArgs(['wm', 'density'])
          .returns('Physical density: 420');
      let density = await adb.getScreenDensity();
      density.should.equal(420);
    });
    it('should return null for invalid screen density', async function () {
      mocks.adb.expects('shell')
          .once().withExactArgs(['wm', 'density'])
          .returns('Physical density: unknown');
      let density = await adb.getScreenDensity();
      should.equal(density, null);
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
      mocks.adb.expects('shell')
          .once().withArgs(['pm', 'grant', 'io.appium.android.apis', 'android.permission.READ_EXTERNAL_STORAGE']);
      await adb.grantPermission('io.appium.android.apis', 'android.permission.READ_EXTERNAL_STORAGE');
    });
    it('should revoke requested permission', async function () {
      mocks.adb.expects('shell')
          .once().withArgs(['pm', 'revoke', 'io.appium.android.apis', 'android.permission.READ_EXTERNAL_STORAGE']);
      await adb.revokePermission('io.appium.android.apis', 'android.permission.READ_EXTERNAL_STORAGE');
    });
    it('should properly list requested permissions', async function () {
      mocks.adb.expects('shell').once().returns(dumpedOutput);
      const result = await adb.getReqPermissions('io.appium.android');
      for (let perm of [
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
        result.should.include(perm);
      }
    });
    it('should properly list requested permissions for output without install permissions', async function () {
      mocks.adb.expects('shell').once().returns(dumpedLimitedOutput);
      const result = await adb.getReqPermissions('io.appium.android');
      for (let perm of [
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
        result.should.include(perm);
      }
    });
    it('should properly list granted permissions', async function () {
      mocks.adb.expects('shell').once().returns(dumpedOutput);
      const result = await adb.getGrantedPermissions('io.appium.android');
      for (let perm of [
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
        result.should.include(perm);
      }
      for (let perm of [
        'android.permission.READ_CONTACTS',
        'android.permission.CAMERA',
      ]) {
        result.should.not.include(perm);
      }
    });
    it('should properly list granted permissions for output without install permissions', async function () {
      mocks.adb.expects('shell').once().returns(dumpedLimitedOutput);
      const result = await adb.getGrantedPermissions('io.appium.android');
      for (let perm of [
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.READ_PHONE_STATE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.RECORD_AUDIO'
      ]) {
        result.should.include(perm);
      }
      for (let perm of [
        'android.permission.READ_CONTACTS',
        'android.permission.CAMERA'
      ]) {
        result.should.not.include(perm);
      }
    });
    it('should properly list denied permissions', async function () {
      mocks.adb.expects('shell').once().returns(dumpedOutput);
      const result = await adb.getDeniedPermissions('io.appium.android');
      for (let perm of [
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
        result.should.not.include(perm);
      }
      for (let perm of [
        'android.permission.READ_CONTACTS',
        'android.permission.CAMERA',
      ]) {
        result.should.include(perm);
      }
    });
    it('should properly list denied permissions for output without install permissions', async function () {
      mocks.adb.expects('shell').once().returns(dumpedLimitedOutput);
      const result = await adb.getDeniedPermissions('io.appium.android');
      for (let perm of [
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.READ_PHONE_STATE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.RECORD_AUDIO'
      ]) {
        result.should.not.include(perm);
      }
      for (let perm of [
        'android.permission.READ_CONTACTS',
        'android.permission.CAMERA'
      ]) {
        result.should.include(perm);
      }
    });
  });
  it('isValidClass should correctly validate class names', function () {
    adb.isValidClass('some.package/some.package.Activity').should.be.true;
    adb.isValidClass('illegalPackage#/adsasd').should.be.false;
  });
  it('getAdbPath should correctly return adbPath', function () {
    adb.getAdbPath().should.equal(adb.executable.path);
  });
  describe('setHttpProxy', function () {
    it('should throw an error on undefined proxy_host', async function () {
      await adb.setHttpProxy().should.eventually.be.rejected;
    });
    it('should throw an error on undefined proxy_port', async function () {
      await adb.setHttpProxy('http://localhost').should.eventually.be.rejected;
    });
    it('should call setSetting method with correct args', async function () {
      let proxyHost = 'http://localhost';
      let proxyPort = 4723;
      mocks.adb.expects('setSetting').once().withExactArgs('global', 'http_proxy', `${proxyHost}:${proxyPort}`);
      mocks.adb.expects('setSetting').once().withExactArgs('global', 'global_http_proxy_host', proxyHost);
      mocks.adb.expects('setSetting').once().withExactArgs('global', 'global_http_proxy_port', `${proxyPort}`);
      await adb.setHttpProxy(proxyHost, proxyPort);
    });
  });
  describe('deleteHttpProxy', function () {
    it('should call setSetting method with correct args', async function () {
      mocks.adb.expects('shell').once().withExactArgs(['settings', 'delete', 'global', 'http_proxy']);
      mocks.adb.expects('shell').once().withExactArgs(['settings', 'delete', 'global', 'global_http_proxy_host']);
      mocks.adb.expects('shell').once().withExactArgs(['settings', 'delete', 'global', 'global_http_proxy_port']);
      mocks.adb.expects('shell').once().withExactArgs(['settings', 'delete', 'global', 'global_http_proxy_exclusion_list']);
      await adb.deleteHttpProxy();
    });
  });
  describe('setSetting', function () {
    it('should call shell settings put', async function () {
      mocks.adb.expects('shell').once()
        .withExactArgs(['settings', 'put', 'namespace', 'setting', 'value']);
      await adb.setSetting('namespace', 'setting', 'value');
    });
  });
  describe('getSetting', function () {
    it('should call shell settings get', async function () {
      mocks.adb.expects('shell').once()
        .withArgs(['settings', 'get', 'namespace', 'setting'])
        .returns('value');
      (await adb.getSetting('namespace', 'setting')).should.be.equal('value');
    });
  });
  describe('getCurrentTimeZone', function () {
    it('should call shell with correct args', async function () {
      mocks.adb.expects('shell')
        .once().withExactArgs(['getprop', 'persist.sys.timezone'])
        .returns(`Asia/Tokyo${EOL}`);
      (await adb.getTimeZone()).should.equal('Asia/Tokyo');
    });
    it('should raise an error', async function () {
      mocks.adb.expects('shell').throws();
      await adb.getTimeZone().should.eventually.be.rejected;
    });
  });
  describe('setHiddenApiPolicy', function () {
    it('should call setSetting method with correct args for set hidden api policy', async function () {
      mocks.adb.expects('shell').once().withExactArgs(
        'settings put global hidden_api_policy_pre_p_apps 1;' +
        'settings put global hidden_api_policy_p_apps 1;' +
        'settings put global hidden_api_policy 1');
      await adb.setHiddenApiPolicy(1);
    });
  });
  describe('setDefaultHiddenApiPolicy', function () {
    it('should call setSetting method with correct args for set hidden api policy', async function () {
      mocks.adb.expects('shell').once().withExactArgs(
        'settings delete global hidden_api_policy_pre_p_apps;' +
        'settings delete global hidden_api_policy_p_apps;' +
        'settings delete global hidden_api_policy');
      await adb.setDefaultHiddenApiPolicy();
    });
  });
}));
