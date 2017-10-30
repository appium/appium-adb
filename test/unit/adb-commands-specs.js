import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import net from 'net';
import events from 'events';
import Logcat from '../../lib/logcat.js';
import log from '../../lib/logger.js';
import * as teen_process from 'teen_process';
import { withMocks } from 'appium-test-support';


chai.use(chaiAsPromised);
const should = chai.should();
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
      psOutput = `USER     PID   PPID  VSIZE  RSS     WCHAN    PC   NAME
u0_a101   5078  3129  487404 37044 ffffffff b76ce565 S com.example.android.contactmanager`,
      contactManagerPackage = 'com.example.android.contactmanager',
      model = `Android SDK built for X86_64`,
      manufacturer = `unknown`,
      screenSize = `768x1280`;

describe('adb commands', () => {
  let adb = new ADB();
  let logcat = new Logcat({
    adb,
    debug: false,
    debugTrace: false
  });
  describe('shell', () => {
    describe('getApiLevel', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("getDeviceProperty")
          .once().withExactArgs('ro.build.version.sdk')
          .returns(`${apiLevel}`);
        (await adb.getApiLevel()).should.equal(apiLevel);
        mocks.adb.verify();
      });
    }));
    describe('getPlatformVersion', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("getDeviceProperty")
          .once().withExactArgs('ro.build.version.release')
          .returns(platformVersion);
        (await adb.getPlatformVersion()).should.equal(platformVersion);
        mocks.adb.verify();
      });
    }));
    describe('getDeviceSysLanguage', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['getprop', 'persist.sys.language'])
          .returns(language);
        (await adb.getDeviceSysLanguage()).should.equal(language);
        mocks.adb.verify();
      });
    }));
    describe('setDeviceSysLanguage', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['setprop', 'persist.sys.language', language])
          .returns("");
        await adb.setDeviceSysLanguage(language);
        mocks.adb.verify();
      });
    }));
    describe('getDeviceSysCountry', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['getprop', 'persist.sys.country'])
          .returns(country);
        (await adb.getDeviceSysCountry()).should.equal(country);
        mocks.adb.verify();
      });
    }));
    describe('getLocationProviders', withMocks({adb}, (mocks) => {
      it('should call shell with correct args and return empty location_providers_allowed', async () => {
        mocks.adb.expects("getSetting")
          .once().withExactArgs('secure', 'location_providers_allowed')
          .returns('');
        let providers = await adb.getLocationProviders();
        providers.should.be.an('array');
        providers.length.should.equal(0);
        mocks.adb.verify();
      });
      it('should return one location_providers_allowed', async () => {
        mocks.adb.expects("getSetting")
          .once().withExactArgs('secure', 'location_providers_allowed')
          .returns('gps');
        let providers = await adb.getLocationProviders();
        providers.should.be.an('array');
        providers.length.should.equal(1);
        providers.should.include('gps');
        mocks.adb.verify();
      });
      it('should return both location_providers_allowed', async () => {
        mocks.adb.expects("getSetting")
          .once().withExactArgs('secure', 'location_providers_allowed')
          .returns('gps ,wifi');
        let providers = await adb.getLocationProviders();
        providers.should.be.an('array');
        providers.length.should.equal(2);
        providers.should.include('gps');
        providers.should.include('wifi');
        mocks.adb.verify();
      });
    }));
    describe('toggleGPSLocationProvider', withMocks({adb}, (mocks) => {
      it('should call shell with correct args on gps enabled', async () => {
        mocks.adb.expects("setSetting")
          .withExactArgs('secure', 'location_providers_allowed', '+gps');
        mocks.adb.expects("setSetting")
          .withExactArgs('secure', 'location_providers_allowed', '-gps');
        await adb.toggleGPSLocationProvider(true);
        await adb.toggleGPSLocationProvider(false);
        mocks.adb.verify();
      });
    }));
    describe('setDeviceSysCountry', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['setprop', 'persist.sys.country', country])
          .returns("");
        await adb.setDeviceSysCountry(country);
        mocks.adb.verify();
      });
    }));
    describe('getDeviceSysLocale', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['getprop', 'persist.sys.locale'])
          .returns(locale);
        (await adb.getDeviceSysLocale()).should.equal(locale);
        mocks.adb.verify();
      });
    }));
    describe('setDeviceSysLocale', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['setprop', 'persist.sys.locale', locale])
          .returns("");
        await adb.setDeviceSysLocale(locale);
        mocks.adb.verify();
      });
    }));
    describe('getDeviceProductLanguage', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['getprop', 'ro.product.locale.language'])
          .returns(language);
        (await adb.getDeviceProductLanguage()).should.equal(language);
        mocks.adb.verify();
      });
    }));
    describe('getDeviceProductCountry', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['getprop', 'ro.product.locale.region'])
          .returns(country);
        (await adb.getDeviceProductCountry()).should.equal(country);
        mocks.adb.verify();
      });
    }));
    describe('getDeviceProductLocale', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['getprop', 'ro.product.locale'])
          .returns(locale);
        (await adb.getDeviceProductLocale()).should.equal(locale);
        mocks.adb.verify();
      });
    }));
    describe('setDeviceProperty', withMocks({adb}, (mocks) => {
      it('should call setprop with correct args without root', async () => {
        mocks.adb.expects("getApiLevel")
          .once().returns(21);
        mocks.adb.expects("shell")
          .withExactArgs(['setprop', 'persist.sys.locale', locale])
          .returns("");
        await adb.setDeviceProperty('persist.sys.locale', locale);
        mocks.adb.verify();
      });
      it('should call setprop with correct args with root', async () => {
        mocks.adb.expects("getApiLevel")
          .once().returns(26);
        mocks.adb.expects("root")
          .once().returns("");
        mocks.adb.expects("shell")
          .withExactArgs(['setprop', 'persist.sys.locale', locale])
          .returns("");
        mocks.adb.expects("unroot")
          .once().returns("");
        await adb.setDeviceProperty('persist.sys.locale', locale);
        mocks.adb.verify();
      });
    }));
    describe('availableIMEs', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['ime', 'list', '-a'])
          .returns(imeList);
        (await adb.availableIMEs()).should.have.length.above(0);
        mocks.adb.verify();
      });
    }));
    describe('enabledIMEs', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['ime', 'list'])
          .returns(imeList);
        (await adb.enabledIMEs()).should.have.length.above(0);
        mocks.adb.verify();
      });
    }));
    describe('defaultIME', withMocks({adb}, (mocks) => {
      let defaultIME = 'com.android.inputmethod.latin/.LatinIME';
      it('should call shell with correct args', async () => {
        mocks.adb.expects("getSetting")
          .once().withExactArgs('secure', 'default_input_method')
          .returns(defaultIME);
        (await adb.defaultIME()).should.equal(defaultIME);
        mocks.adb.verify();
      });
    }));
    describe('disableIME', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['ime', 'disable', IME])
          .returns("");
        await adb.disableIME(IME);
        mocks.adb.verify();
      });
    }));
    describe('enableIME', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['ime', 'enable', IME])
          .returns("");
        await adb.enableIME(IME);
        mocks.adb.verify();
      });
    }));
    describe('keyevent', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        let keycode = '29';
        let code = parseInt(keycode, 10);
        mocks.adb.expects("shell")
          .once().withExactArgs(['input', 'keyevent', code])
          .returns("");
        await adb.keyevent(keycode);
        mocks.adb.verify();
      });
    }));
    describe('inputText', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        let text = 'some text with spaces';
        let expectedText = 'some%stext%swith%sspaces';
        mocks.adb.expects("shell")
          .once().withExactArgs(['input', 'text', expectedText])
          .returns("");
        await adb.inputText(text);
        mocks.adb.verify();
      });
    }));
    describe('clearTextField', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['input', 'keyevent', '67', '112', '67', '112', '67', '112', '67', '112'])
          .returns("");
        await adb.clearTextField(4);
        mocks.adb.verify();
      });
    }));
    describe('lock', withMocks({adb, log}, (mocks) => {
      it('should call isScreenLocked, keyevent and errorAndThrow', async () => {
        mocks.adb.expects("isScreenLocked")
          .atLeast(2).returns(false);
        mocks.adb.expects("keyevent")
          .once().withExactArgs(26)
          .returns("");
        mocks.log.expects("errorAndThrow")
          .once().returns("");
        await adb.lock();
        mocks.adb.verify();
      });
    }));
    describe('back', withMocks({adb}, (mocks) => {
      it('should call keyevent with correct args', async () => {
        mocks.adb.expects("keyevent")
          .once().withExactArgs(4)
          .returns("");
        await adb.back();
        mocks.adb.verify();
      });
    }));
    describe('goToHome', withMocks({adb}, (mocks) => {
      it('should call keyevent with correct args', async () => {
        mocks.adb.expects("keyevent")
          .once().withExactArgs(3)
          .returns("");
        await adb.goToHome();
        mocks.adb.verify();
      });
    }));
    describe.skip('isScreenLocked', withMocks({adb}, (mocks) => {
      it('should call keyevent with correct args', async () => {
        mocks.adb.expects("keyevent")
          .once().withExactArgs(3)
          .returns("");
        await adb.goToHome();
        mocks.adb.verify();
      });
    }));
    describe('isSoftKeyboardPresent', withMocks({adb}, (mocks) => {
      it('should call shell with correct args and should return false', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['dumpsys', 'input_method'])
          .returns("mInputShown=false");
        let {isKeyboardShown, canCloseKeyboard} = await adb.isSoftKeyboardPresent();
        canCloseKeyboard.should.be.false;
        isKeyboardShown.should.be.false;
        mocks.adb.verify();
      });
      it('should call shell with correct args and should return true', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['dumpsys', 'input_method'])
          .returns("mInputShown=true mIsInputViewShown=true");
        let {isKeyboardShown, canCloseKeyboard} = await adb.isSoftKeyboardPresent();
        isKeyboardShown.should.be.true;
        canCloseKeyboard.should.be.true;
        mocks.adb.verify();
      });
    }));
    describe('isAirplaneModeOn', withMocks({adb}, (mocks) => {
      it('should call shell with correct args and should be true', async () => {
        mocks.adb.expects("getSetting")
          .once().withExactArgs('global', 'airplane_mode_on')
          .returns("1");
        (await adb.isAirplaneModeOn()).should.be.true;
        mocks.adb.verify();
      });
      it('should call shell with correct args and should be false', async () => {
        mocks.adb.expects("getSetting")
          .once().withExactArgs('global', 'airplane_mode_on')
          .returns("0");
        (await adb.isAirplaneModeOn()).should.be.false;
        mocks.adb.verify();
      });
    }));
    describe('setAirplaneMode', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("setSetting")
          .once().withExactArgs('global', 'airplane_mode_on', 1)
          .returns("");
        await adb.setAirplaneMode(1);
        mocks.adb.verify();
      });
    }));
    describe('broadcastAirplaneMode', withMocks({adb}, (mocks) => {
      it('should call shell with correct args', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE', '--ez', 'state', 'true'])
          .returns("");
        await adb.broadcastAirplaneMode(true);
        mocks.adb.verify();
      });
    }));
    describe('isWifiOn', withMocks({adb}, (mocks) => {
      it('should call shell with correct args and should be true', async () => {
        mocks.adb.expects("getSetting")
          .once().withExactArgs('global', 'wifi_on')
          .returns("1");
        (await adb.isWifiOn()).should.be.true;
        mocks.adb.verify();
      });
      it('should call shell with correct args and should be false', async () => {
        mocks.adb.expects("getSetting")
          .once().withExactArgs('global', 'wifi_on')
          .returns("0");
        (await adb.isWifiOn()).should.be.false;
        mocks.adb.verify();
      });
    }));
    describe('setWifiState', withMocks({adb}, (mocks) => {
      it('should call shell with correct args for real device', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['am', 'broadcast', '-a', 'io.appium.settings.wifi',
            '-n', 'io.appium.settings/.receivers.WiFiConnectionSettingReceiver',
            '--es', 'setstatus', 'enable'])
          .returns("");
        await adb.setWifiState(true);
        mocks.adb.verify();
      });
      it('should call shell with correct args for emulator', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['svc', 'wifi', 'disable'])
          .returns("");
        await adb.setWifiState(false, true);
        mocks.adb.verify();
      });
    }));
    describe('isDataOn', withMocks({adb}, (mocks) => {
      it('should call shell with correct args and should be true', async () => {
        mocks.adb.expects("getSetting")
          .once().withExactArgs('global', 'mobile_data')
          .returns("1");
        (await adb.isDataOn()).should.be.true;
        mocks.adb.verify();
      });
      it('should call shell with correct args and should be false', async () => {
        mocks.adb.expects("getSetting")
          .once().withExactArgs('global', 'mobile_data')
          .returns("0");
        (await adb.isDataOn()).should.be.false;
        mocks.adb.verify();
      });
    }));
    describe('setDataState', withMocks({adb}, (mocks) => {
      it('should call shell with correct args for real device', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['am', 'broadcast', '-a', 'io.appium.settings.data_connection',
            '-n', 'io.appium.settings/.receivers.DataConnectionSettingReceiver',
            '--es', 'setstatus', 'disable'])
          .returns("");
        await adb.setDataState(false);
        mocks.adb.verify();
      });
      it('should call shell with correct args for emulator', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['svc', 'data', 'enable'])
          .returns("");
        await adb.setDataState(true, true);
        mocks.adb.verify();
      });
    }));
    describe('setWifiAndData', withMocks({adb}, (mocks) => {
      it('should call shell with correct args when turning only wifi on for real device', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['am', 'broadcast', '-a', 'io.appium.settings.wifi',
            '-n', 'io.appium.settings/.receivers.WiFiConnectionSettingReceiver',
            '--es', 'setstatus', 'enable'])
          .returns("");
        await adb.setWifiAndData({wifi: true});
        mocks.adb.verify();
      });
      it('should call shell with correct args when turning only wifi off for emulator', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['svc', 'wifi', 'disable'])
          .returns("");
        await adb.setWifiAndData({wifi: false}, true);
        mocks.adb.verify();
      });
      it('should call shell with correct args when turning only data on for emulator', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['svc', 'data', 'enable'])
          .returns("");
        await adb.setWifiAndData({data: true}, true);
        mocks.adb.verify();
      });
      it('should call shell with correct args when turning only data off for real device', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['am', 'broadcast', '-a', 'io.appium.settings.data_connection',
            '-n', 'io.appium.settings/.receivers.DataConnectionSettingReceiver',
            '--es', 'setstatus', 'disable'])
          .returns("");
        await adb.setWifiAndData({data: false});
        mocks.adb.verify();
      });
      it('should call shell with correct args when turning both wifi and data on for real device', async () => {
        mocks.adb.expects("shell").twice().returns("");
        await adb.setWifiAndData({wifi: true, data: true});
        mocks.adb.verify();
      });
      it('should call shell with correct args when turning both wifi and data off for emulator', async () => {
        mocks.adb.expects("shell").twice().returns("");
        await adb.setWifiAndData({wifi: false, data: false}, true);
        mocks.adb.verify();
      });
    }));
    describe('setAnimationState', withMocks({adb}, (mocks) => {
      const adbArgs = ['am', 'broadcast', '-a', 'io.appium.settings.animation',
                      '-n', 'io.appium.settings/.receivers.AnimationSettingReceiver',
                      '--es', 'setstatus'];
      it('should call shell with correct args to enable animation', async () => {
        mocks.adb.expects("shell").once().withExactArgs(adbArgs.concat('enable'));
        await adb.setAnimationState(true);
        mocks.adb.verify();
      });
      it('should call shell with correct args to disable animation', async () => {
        mocks.adb.expects("shell").once().withExactArgs(adbArgs.concat('disable'));
        await adb.setAnimationState(false);
        mocks.adb.verify();
      });
    }));
    describe('isAnimationOn', withMocks({adb}, (mocks) => {
      const mockSetting = async function (duration_scale, transition_scale, window_scale) {
        mocks.adb.expects("getSetting").once().withExactArgs('global', 'animator_duration_scale')
          .returns(duration_scale);
        mocks.adb.expects("getSetting").once().withExactArgs('global', 'transition_animation_scale')
          .returns(transition_scale);
        mocks.adb.expects("getSetting").once().withExactArgs('global', 'window_animation_scale')
          .returns(window_scale);
      };
      it('should return false if all animation settings are equal to zero', async () => {
        await mockSetting("0.0", "0.0", "0.0");
        (await adb.isAnimationOn()).should.be.false;
        mocks.adb.verify();
      });
      it('should return true if animator_duration_scale setting is NOT equal to zero', async () => {
        await mockSetting("0.5", "0.0", "0.0");
        (await adb.isAnimationOn()).should.be.true;
        mocks.adb.verify();
      });
      it('should return true if transition_animation_scale setting is NOT equal to zero', async () => {
        await mockSetting("0.0", "0.5", "0.0");
        (await adb.isAnimationOn()).should.be.true;
        mocks.adb.verify();
      });
      it('should return true if window_animation_scale setting is NOT equal to zero', async () => {
        await mockSetting("0.0", "0.0", "0.5");
        (await adb.isAnimationOn()).should.be.true;
        mocks.adb.verify();
      });
    }));
    describe('setGeoLocation', withMocks({adb}, (mocks) => {
      const location = {longitude: '50.5',
                        latitude: '50.1'};

      it('should call shell with correct args for real device', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['am', 'startservice', '-e', 'longitude', location.longitude,
                                 '-e', 'latitude', location.latitude, `io.appium.settings/.LocationService`])
          .returns("");
        await adb.setGeoLocation(location);
        mocks.adb.verify();
      });
      it('should call adb with correct args for emulator', async () => {
        mocks.adb.expects("resetTelnetAuthToken")
          .once().returns(true);
        mocks.adb.expects("adbExec")
          .once().withExactArgs(['emu', 'geo', 'fix', location.longitude, location.latitude])
          .returns("");
        // A workaround for https://code.google.com/p/android/issues/detail?id=206180
        mocks.adb.expects("adbExec")
          .once().withExactArgs(['emu', 'geo', 'fix', location.longitude.replace('.', ','), location.latitude.replace('.', ',')])
          .returns("");
        await adb.setGeoLocation(location, true);
        mocks.adb.verify();
      });
    }));
    describe('processExists', withMocks({adb}, (mocks) => {
      it('should call shell with correct args and should find process', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs("ps")
          .returns(psOutput);
        (await adb.processExists(contactManagerPackage)).should.be.true;
        mocks.adb.verify();
      });
      it('should call shell with correct args and should not find process', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs("ps")
          .returns("foo");
        (await adb.processExists(contactManagerPackage)).should.be.false;
        mocks.adb.verify();
      });
    }));
    describe('forwardPort', withMocks({adb}, (mocks) => {
      const sysPort = 12345,
            devicePort = 54321;
      it('forwardPort should call shell with correct args', async () => {
        mocks.adb.expects("adbExec")
          .once().withExactArgs(['forward', `tcp:${sysPort}`, `tcp:${devicePort}`])
          .returns("");
        await adb.forwardPort(sysPort, devicePort);
        mocks.adb.verify();
      });
      it('forwardAbstractPort should call shell with correct args', async () => {
        mocks.adb.expects("adbExec")
          .once().withExactArgs(['forward', `tcp:${sysPort}`, `localabstract:${devicePort}`])
          .returns("");
        await adb.forwardAbstractPort(sysPort, devicePort);
        mocks.adb.verify();
      });
      it('removePortForward should call shell with correct args', async () => {
        mocks.adb.expects("adbExec")
            .once().withExactArgs(['forward', `--remove`, `tcp:${sysPort}`])
            .returns("");
        await adb.removePortForward(sysPort, devicePort);
        mocks.adb.verify();
      });
    }));
    describe('ping', withMocks({adb}, (mocks) => {
      it('should call shell with correct args and should return true', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(["echo", "ping"])
          .returns("ping");
        (await adb.ping()).should.be.true;
        mocks.adb.verify();
      });
    }));
    describe('restart', withMocks({adb}, (mocks) => {
      it('should call adb in correct order', async () => {
        mocks.adb.expects("stopLogcat").once().returns("");
        mocks.adb.expects("restartAdb").once().returns("");
        mocks.adb.expects("waitForDevice").once().returns("");
        mocks.adb.expects("startLogcat").once().returns("");
        await adb.restart();
        mocks.adb.verify();
      });
    }));
    describe('stopLogcat', withMocks({logcat}, (mocks) => {
      it('should call stopCapture', async () => {
        adb.logcat = logcat;
        mocks.logcat.expects("stopCapture").once().returns("");
        await adb.stopLogcat();
        mocks.logcat.verify();
      });
    }));
    describe('getLogcatLogs', withMocks({logcat}, (mocks) => {
      it('should call getLogs', async () => {
        adb.logcat = logcat;
        mocks.logcat.expects("getLogs").once().returns("");
        await adb.getLogcatLogs();
        mocks.logcat.verify();
      });
    }));
    describe('getPIDsByName', withMocks({adb}, (mocks) => {
      it('should call shell and parse pids correctly', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['ps'])
          .returns(psOutput);
        (await adb.getPIDsByName(contactManagerPackage))[0].should.equal(5078);
        mocks.adb.verify();
      });
    }));
    describe('killProcessesByName', withMocks({adb}, (mocks) => {
      it('should call getPIDsByName and kill process correctly', async () => {
        mocks.adb.expects("getPIDsByName")
          .once().withExactArgs(contactManagerPackage)
          .returns([5078]);
        mocks.adb.expects("killProcessByPID")
          .once().withExactArgs(5078)
          .returns("");
        await adb.killProcessesByName(contactManagerPackage);
        mocks.adb.verify();
      });
    }));
    describe('killProcessByPID', withMocks({adb}, (mocks) => {
      const pid = 5078;

      it('should call kill process correctly', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['kill', '-0', pid])
          .returns('');
        mocks.adb.expects("shell")
          .withExactArgs(['kill', pid])
          .onCall(0)
          .returns('');
        mocks.adb.expects("shell")
          .withExactArgs(['kill', pid])
          .onCall(1)
          .throws();
        await adb.killProcessByPID(pid);
        mocks.adb.verify();
      });

      it('should force kill process if normal kill fails', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['kill', '-0', pid])
          .returns('');
        mocks.adb.expects("shell")
          .atLeast(2).withExactArgs(['kill', pid])
          .returns('');
        mocks.adb.expects("shell")
          .once().withExactArgs(['kill', '-9', pid])
          .returns('');
        await adb.killProcessByPID(pid);
        mocks.adb.verify();
      });

      it('should throw an error if a process with given ID does not exist', async () => {
        mocks.adb.expects("shell")
          .once().withExactArgs(['kill', '-0', pid])
          .throws();
        adb.killProcessByPID(pid).should.eventually.be.rejected;
        mocks.adb.verify();
      });
    }));
    describe('broadcastProcessEnd', withMocks({adb}, (mocks) => {
      it('should broadcast process end', async () => {
        let intent = 'intent',
            processName = 'processName';
        mocks.adb.expects("shell")
          .once().withExactArgs(['am', 'broadcast', '-a', intent])
          .returns("");
        mocks.adb.expects("processExists")
          .once().withExactArgs(processName)
          .returns(false);
        await adb.broadcastProcessEnd(intent, processName);
        mocks.adb.verify();
      });
    }));
    describe('broadcast', withMocks({adb}, (mocks) => {
      it('should broadcast intent', async () => {
        let intent = 'intent';
        mocks.adb.expects("shell")
          .once().withExactArgs(['am', 'broadcast', '-a', intent])
          .returns("");
        await adb.broadcast(intent);
        mocks.adb.verify();
      });
    }));
    describe('instrument', withMocks({adb}, (mocks) => {
      it('should call shell with correct arguments', async () => {
        let intent = 'intent';
        mocks.adb.expects("shell")
          .once().withExactArgs(['am', 'broadcast', '-a', intent])
          .returns("");
        await adb.broadcast(intent);
        mocks.adb.verify();
      });
    }));
    describe('androidCoverage', withMocks({adb, teen_process}, (mocks) => {
      it('should call shell with correct arguments', async () => {
        adb.executable.defaultArgs = [];
        adb.executable.path = "dummy_adb_path";
        let conn = new events.EventEmitter();
        conn.start = () => { }; // do nothing
        const instrumentClass = 'instrumentClass',
              waitPkg = 'waitPkg',
              waitActivity = 'waitActivity';
        let args = adb.executable.defaultArgs
          .concat(['shell', 'am', 'instrument', '-e', 'coverage', 'true', '-w'])
          .concat([instrumentClass]);
        mocks.teen_process.expects("SubProcess")
          .once().withExactArgs('dummy_adb_path', args)
          .returns(conn);
        mocks.adb.expects("waitForActivity")
          .once().withExactArgs(waitPkg, waitActivity)
          .returns("");
        await adb.androidCoverage(instrumentClass, waitPkg, waitActivity);
        mocks.teen_process.verify();
        mocks.adb.verify();
      });
    }));
  });
  describe('device info', withMocks({adb}, (mocks) => {
    it('should get device model', async () => {
      mocks.adb.expects("shell")
          .once().withExactArgs(['getprop', 'ro.product.model'])
          .returns(model);
      await adb.getModel();
      mocks.adb.verify();
    });
    it('should get device manufacturer', async () => {
      mocks.adb.expects("shell")
          .once().withExactArgs(['getprop', 'ro.product.manufacturer'])
          .returns(manufacturer);
      await adb.getManufacturer();
      mocks.adb.verify();
    });
    it('should get device screen size', async () => {
      mocks.adb.expects("shell")
          .once().withExactArgs(['wm', 'size'])
          .returns(screenSize);
      await adb.getScreenSize();
      mocks.adb.verify();
    });
  }));
  describe('app permission', withMocks({adb}, (mocks) => {
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

    it('should grant requested permission', async () => {
      mocks.adb.expects("shell")
          .once().withArgs(['pm', 'grant', 'io.appium.android.apis', 'android.permission.READ_EXTERNAL_STORAGE']);
      await adb.grantPermission('io.appium.android.apis', 'android.permission.READ_EXTERNAL_STORAGE');
      mocks.adb.verify();
    });
    it('should revoke requested permission', async () => {
      mocks.adb.expects("shell")
          .once().withArgs(['pm', 'revoke', 'io.appium.android.apis', 'android.permission.READ_EXTERNAL_STORAGE']);
      await adb.revokePermission('io.appium.android.apis', 'android.permission.READ_EXTERNAL_STORAGE');
      mocks.adb.verify();
    });
    it('should properly list requested permissions', async () => {
      mocks.adb.expects("shell").once().returns(dumpedOutput);
      const result = await adb.getReqPermissions('io.appium.android');
      for (let perm of ['android.permission.ACCESS_NETWORK_STATE',
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
                        'android.permission.RECEIVE_BOOT_COMPLETED']) {
        result.should.include(perm);
      }
    });
    it('should properly list granted permissions', async () => {
      mocks.adb.expects("shell").once().returns(dumpedOutput);
      const result = await adb.getGrantedPermissions('io.appium.android');
      for (let perm of ['android.permission.MODIFY_AUDIO_SETTINGS',
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
                        'android.permission.RECORD_AUDIO']) {
        result.should.include(perm);
      }
      for (let perm of ['android.permission.READ_CONTACTS',
                        'android.permission.CAMERA']) {
        result.should.not.include(perm);
      }
    });
    it('should properly list denied permissions', async () => {
      mocks.adb.expects("shell").once().returns(dumpedOutput);
      const result = await adb.getDeniedPermissions('io.appium.android');
      for (let perm of ['android.permission.MODIFY_AUDIO_SETTINGS',
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
                        'android.permission.RECORD_AUDIO']) {
        result.should.not.include(perm);
      }
      for (let perm of ['android.permission.READ_CONTACTS',
                        'android.permission.CAMERA']) {
        result.should.include(perm);
      }
    });
  }));
  describe('sendTelnetCommand', withMocks({adb, net}, (mocks) => {
    it('should call shell with correct args', async () => {
      const port = 54321;
      let conn = new events.EventEmitter();
      let commands = [];
      conn.write = function (command) {
        commands.push(command);
      };
      mocks.adb.expects("getEmulatorPort")
        .once().withExactArgs()
        .returns(port);
      mocks.net.expects("createConnection")
        .once().withExactArgs(port, 'localhost')
        .returns(conn);
      let p = adb.sendTelnetCommand('avd name');
      setTimeout(function () {
        conn.emit('connect');
        conn.emit('data', 'OK');
        conn.emit('data', 'OK');
        conn.emit('close');
      }, 0);
      await p;
      commands[0].should.equal("avd name\n");
      commands[1].should.equal("quit\n");
      mocks.adb.verify();
      mocks.net.verify();
    });
    it('should return the last line of the output only', async () => {
      const port = 54321;
      let conn = new events.EventEmitter();
      let commands = [];
      let expected = "desired_command_output";
      conn.write = function (command) {
        commands.push(command);
      };
      mocks.adb.expects("getEmulatorPort")
        .once().withExactArgs()
        .returns(port);
      mocks.net.expects("createConnection")
        .once().withExactArgs(port, 'localhost')
        .returns(conn);
      let p = adb.sendTelnetCommand('avd name');
      setTimeout(function () {
        conn.emit('connect');
        conn.emit('data', 'OK');
        conn.emit('data', 'OK\nunwanted_echo_output\n' + expected);
        conn.emit('close');
      }, 0);
      let actual = await p;
      (actual).should.equal(expected);
    });
    it('should throw error if network connection errors', async () => {
      const port = 54321;
      let conn = new events.EventEmitter();
      let commands = [];
      let expected = "desired_command_output";
      conn.write = function (command) {
        commands.push(command);
      };
      mocks.adb.expects("getEmulatorPort")
        .once().withExactArgs()
        .returns(port);
      mocks.net.expects("createConnection")
        .once().withExactArgs(port, 'localhost')
        .returns(conn);
      let p = adb.sendTelnetCommand('avd name');
      setTimeout(function () {
        conn.emit('connect');
        conn.emit('data', 'OK');
        conn.emit('data', 'OK\nunwanted_echo_output\n' + expected);
        conn.emit('error', new Error('ouch!'));
      }, 0);
      await p.should.eventually.be.rejectedWith(/ouch/);
    });
  }));
  it('isValidClass should correctly validate class names', () => {
    adb.isValidClass('some.package/some.package.Activity').index.should.equal(0);
    should.not.exist(adb.isValidClass('illegalPackage#/adsasd'));
  });
  it('getAdbPath should correctly return adbPath', () => {
    adb.getAdbPath().should.equal(adb.executable.path);
  });
  describe('setHttpProxy', withMocks({adb}, (mocks) => {
    it('should throw an error on undefined proxy_host', async () => {
      await adb.setHttpProxy().should.eventually.be.rejected;
    });
    it('should throw an error on undefined proxy_port', async () => {
      await adb.setHttpProxy("http://localhost").should.eventually.be.rejected;
    });
    it('should call setSetting method with correct args', async () => {
      let proxyHost = "http://localhost";
      let proxyPort = 4723;
      mocks.adb.expects('setSetting').once().withExactArgs('global', 'http_proxy', `${proxyHost}:${proxyPort}`);
      mocks.adb.expects('setSetting').once().withExactArgs('secure', 'http_proxy', `${proxyHost}:${proxyPort}`);
      mocks.adb.expects('setSetting').once().withExactArgs('system', 'http_proxy', `${proxyHost}:${proxyPort}`);
      mocks.adb.expects('setSetting').once().withExactArgs('system', 'global_http_proxy_host', proxyHost);
      mocks.adb.expects('setSetting').once().withExactArgs('system', 'global_http_proxy_port', proxyPort);
      await adb.setHttpProxy(proxyHost, proxyPort);
      mocks.adb.verify();
    });
  }));
  describe('setSetting', withMocks({adb}, (mocks) => {
    it('should call shell settings put', async () => {
      mocks.adb.expects('shell').once()
        .withExactArgs(['settings', 'put', 'namespace', 'setting', 'value']);
      await adb.setSetting('namespace', 'setting', 'value');
      mocks.adb.verify();
    });
  }));
  describe('getSetting', withMocks({adb}, (mocks) => {
    it('should call shell settings get', async () => {
      mocks.adb.expects('shell').once()
        .withExactArgs(['settings', 'get', 'namespace', 'setting'])
        .returns('value');
      (await adb.getSetting('namespace', 'setting')).should.be.equal('value');
      mocks.adb.verify();
    });
  }));
});
