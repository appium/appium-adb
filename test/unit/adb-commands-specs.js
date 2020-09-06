import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ADB from '../..';
import net from 'net';
import events from 'events';
import Logcat from '../../lib/logcat.js';
import * as teen_process from 'teen_process';
import { withMocks } from 'appium-test-support';
import _ from 'lodash';
import { EOL } from 'os';


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
      contactManagerPackage = 'com.example.android.contactmanager',
      model = `Android SDK built for X86_64`,
      manufacturer = `unknown`,
      screenSize = `768x1280`;

const adb = new ADB({ adbExecTimeout: 60000 });
const logcat = new Logcat({
  adb: adb.executable,
  debug: false,
  debugTrace: false
});

describe('adb commands', withMocks({adb, logcat, teen_process, net}, function (mocks) {
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
        mocks.adb.expects('getSetting')
          .once().withExactArgs('secure', 'location_providers_allowed')
          .returns('');
        let providers = await adb.getLocationProviders();
        providers.should.be.an('array');
        providers.length.should.equal(0);
      });
      it('should return one location_providers_allowed', async function () {
        mocks.adb.expects('getSetting')
          .once().withExactArgs('secure', 'location_providers_allowed')
          .returns('gps');
        let providers = await adb.getLocationProviders();
        providers.should.be.an('array');
        providers.length.should.equal(1);
        providers.should.include('gps');
      });
      it('should return both location_providers_allowed', async function () {
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
      it('should call shell with correct args on gps enabled', async function () {
        mocks.adb.expects('setSetting')
          .withExactArgs('secure', 'location_providers_allowed', '+gps');
        mocks.adb.expects('setSetting')
          .withExactArgs('secure', 'location_providers_allowed', '-gps');
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
        let code = parseInt(keycode, 10);
        mocks.adb.expects('shell')
          .once().withExactArgs(['input', 'keyevent', code])
          .returns('');
        await adb.keyevent(keycode);
      });
    });
    describe('inputText', function () {
      it('should call shell with correct args', async function () {
        let text = 'some text with spaces';
        let expectedText = 'some%stext%swith%sspaces';
        mocks.adb.expects('shell')
          .once().withExactArgs(['input', 'text', expectedText])
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
      it('should call shell with correct args', async function () {
        mocks.adb.expects('setSetting')
          .once().withExactArgs('global', 'airplane_mode_on', 1)
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
          .once().withExactArgs(['am', 'broadcast', '-a', 'io.appium.settings.wifi',
            '-n', 'io.appium.settings/.receivers.WiFiConnectionSettingReceiver',
            '--es', 'setstatus', 'enable'])
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
          .once().withExactArgs(['am', 'broadcast', '-a', 'io.appium.settings.data_connection',
            '-n', 'io.appium.settings/.receivers.DataConnectionSettingReceiver',
            '--es', 'setstatus', 'disable'])
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
    describe('setWifiAndData', function () {
      it('should call shell with correct args when turning only wifi on for real device', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['am', 'broadcast', '-a', 'io.appium.settings.wifi',
            '-n', 'io.appium.settings/.receivers.WiFiConnectionSettingReceiver',
            '--es', 'setstatus', 'enable'])
          .returns('');
        await adb.setWifiAndData({wifi: true});
      });
      it('should call shell with correct args when turning only wifi off for emulator', async function () {
        mocks.adb.expects('getApiLevel')
          .once().returns(25);
        mocks.adb.expects('shell')
          .once().withExactArgs(['svc', 'wifi', 'disable'], {
            privileged: true
          })
          .returns('');
        await adb.setWifiAndData({wifi: false}, true);
      });
      it('should call shell with correct args when turning only data on for emulator', async function () {
        mocks.adb.expects('getApiLevel')
          .once().returns(25);
        mocks.adb.expects('shell')
          .once().withExactArgs(['svc', 'data', 'enable'], {
            privileged: true
          })
          .returns('');
        await adb.setWifiAndData({data: true}, true);
      });
      it('should call shell with correct args when turning only data off for real device', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['am', 'broadcast', '-a', 'io.appium.settings.data_connection',
            '-n', 'io.appium.settings/.receivers.DataConnectionSettingReceiver',
            '--es', 'setstatus', 'disable'])
          .returns('');
        await adb.setWifiAndData({data: false});
      });
      it('should call shell with correct args when turning both wifi and data on for real device', async function () {
        mocks.adb.expects('shell').twice().returns('');
        await adb.setWifiAndData({wifi: true, data: true});
      });
      it('should call shell with correct args when turning both wifi and data off for emulator', async function () {
        mocks.adb.expects('getApiLevel')
          .atLeast(1).returns(25);
        mocks.adb.expects('shell').twice().returns('');
        await adb.setWifiAndData({wifi: false, data: false}, true);
      });
    });
    describe('setAnimationState', function () {
      const adbArgs = [
        'am', 'broadcast', '-a', 'io.appium.settings.animation',
        '-n', 'io.appium.settings/.receivers.AnimationSettingReceiver',
        '--es', 'setstatus'
      ];
      it('should call shell with correct args to enable animation', async function () {
        mocks.adb.expects('shell').once().withExactArgs(adbArgs.concat('enable'));
        await adb.setAnimationState(true);
      });
      it('should call shell with correct args to disable animation', async function () {
        mocks.adb.expects('shell').once().withExactArgs(adbArgs.concat('disable'));
        await adb.setAnimationState(false);
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
    describe('setDeviceSysLocaleViaSettingApp', function () {
      it('should call shell with locale settings without script', async function () {
        const adbArgs = ['am', 'broadcast', '-a', 'io.appium.settings.locale',
          '-n', 'io.appium.settings/.receivers.LocaleSettingReceiver',
          '--es', 'lang', 'en', '--es', 'country', 'US'];

        mocks.adb.expects('shell').once().withExactArgs(adbArgs);
        await adb.setDeviceSysLocaleViaSettingApp('en', 'US');
      });

      it('should call shell with locale settings with script', async function () {
        const adbArgs = ['am', 'broadcast', '-a', 'io.appium.settings.locale',
          '-n', 'io.appium.settings/.receivers.LocaleSettingReceiver',
          '--es', 'lang', 'zh', '--es', 'country', 'CN', '--es', 'script', 'Hans'];
        mocks.adb.expects('shell').once().withExactArgs(adbArgs);
        await adb.setDeviceSysLocaleViaSettingApp('zh', 'CN', 'Hans');
      });
    });
    describe('setGeoLocation', function () {
      const location = {
        longitude: '50.5',
        latitude: '50.1'
      };
      it('should call shell with correct args for real device', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs([
            'am', 'startservice',
            '-e', 'longitude', location.longitude,
            '-e', 'latitude', location.latitude,
            `io.appium.settings/.LocationService`
          ])
          .returns('');
        await adb.setGeoLocation(location);
      });
      it('should call adb with correct args for emulator', async function () {
        mocks.adb.expects('resetTelnetAuthToken')
          .once().returns(true);
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'geo', 'fix', location.longitude, location.latitude])
          .returns('');
        // A workaround for https://code.google.com/p/android/issues/detail?id=206180
        mocks.adb.expects('adbExec')
          .once().withExactArgs(['emu', 'geo', 'fix', location.longitude.replace('.', ','), location.latitude.replace('.', ',')])
          .returns('');
        await adb.setGeoLocation(location, true);
      });
    });
    describe('processExists', function () {
      it('should call shell with correct args and should find process', async function () {
        mocks.adb.expects('getPIDsByName')
          .once().withExactArgs(contactManagerPackage)
          .returns([123]);
        (await adb.processExists(contactManagerPackage)).should.be.true;
      });
      it('should call shell with correct args and should not find process', async function () {
        mocks.adb.expects('getPIDsByName')
          .once().withExactArgs(contactManagerPackage)
          .returns([]);
        (await adb.processExists(contactManagerPackage)).should.be.false;
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
    describe('getNameByPid', function () {
      it('should get package name from valid ps output', async function () {
        mocks.adb.expects('listProcessStatus')
          .once().returns(`
          USER     PID   PPID  VSIZE  RSS     WCHAN    PC        NAME
          radio     929   69    1228184 40844 ffffffff b6db0920 S com.android.phone
          radio     930   69    1228184 40844 ffffffff b6db0920 S com.android.phone
          u0_a7     951   69    1256464 72208 ffffffff b6db0920 S com.android.launcher
          u0_a30    1119  69    1220004 33596 ffffffff b6db0920 S com.android.inputmethod.latin
          u0_a12    1156  69    1246756 58588 ffffffff b6db0920 S com.android.systemui
          root      1347  2     0      0     c002f068 00000000 S kworker/0:1
          u0_a1     1349  69    1206724 26164 ffffffff b6db0920 S com.android.providers.calendar
          u0_a17    1431  69    1217460 26616 ffffffff b6db0920 S com.android.calendar
          u0_a21    1454  69    1203712 26244 ffffffff b6db0920 S com.android.deskclock
          u0_a27    1490  69    1206480 24748 ffffffff b6db0920 S com.android.exchange
          u0_a4     1574  69    1205460 22984 ffffffff b6db0920 S com.android.dialer
          u0_a2     1590  69    1207456 29340 ffffffff b6db0920 S android.process.acore
          u0_a11    1608  69    1199320 22448 ffffffff b6db0920 S com.android.sharedstoragebackup
          u0_a15    1627  69    1206440 30480 ffffffff b6db0920 S com.android.browser
          u0_a5     1646  69    1202716 27004 ffffffff b6db0920 S android.process.media
          root      1676  2     0      0     c00d0d8c 00000000 S flush-31:1
          root      1680  2     0      0     c00d0d8c 00000000 S flush-31:2
          root      1681  60    10672  996   00000000 b6f33508 R ps
          `);
        (await adb.getNameByPid('1627')).should.eql('com.android.browser');
      });
      it('should fail if no PID could be found in the name', async function () {
        await adb.getNameByPid('bla').should.eventually.be.rejectedWith(/valid number/);
      });
      it('should fail if no PID could be found in ps output', async function () {
        mocks.adb.expects('listProcessStatus')
          .once().returns(`
          USER     PID   PPID  VSIZE  RSS     WCHAN    PC        NAME
          u0_a12    1156  69    1246756 58588 ffffffff b6db0920 S com.android.systemui
          `);
        await adb.getNameByPid(115).should.eventually.be.rejectedWith(/process name/);
      });
    });
    describe('getPIDsByName', function () {
      beforeEach(function () {
        mocks.adb.expects('getApiLevel').once().returns(23);
      });
      afterEach(function () {
        adb._isPidofAvailable = undefined;
        adb._isPgrepAvailable = undefined;
      });
      it('should call shell and parse pids with pidof correctly', async function () {
        adb._isPidofAvailable = true;
        adb._isPgrepAvailable = false;
        mocks.adb.expects('shell')
          .once().withExactArgs(['pidof', contactManagerPackage])
          .returns('5078 5079\n');
        (await adb.getPIDsByName(contactManagerPackage)).should.eql([5078, 5079]);
      });
      it('should call shell and parse pids with pgrep correctly', async function () {
        adb._isPidofAvailable = false;
        adb._isPgrepAvailable = true;
        mocks.adb.expects('shell')
          .once()
          .withExactArgs([`pgrep ^${_.escapeRegExp(contactManagerPackage.slice(-15))}$ || pgrep ^${_.escapeRegExp(contactManagerPackage.slice(0, 15))}$`])
          .returns('5078\n5079\n');
        (await adb.getPIDsByName(contactManagerPackage)).should.eql([5078, 5079]);
      });
      it('should call shell and return an empty list if no processes are running', async function () {
        adb._isPidofAvailable = true;
        adb._isPgrepAvailable = false;
        const err = new Error();
        err.code = 1;
        mocks.adb.expects('shell')
          .once().withExactArgs(['pidof', contactManagerPackage])
          .throws(err);
        (await adb.getPIDsByName(contactManagerPackage)).length.should.eql(0);
      });
      it('should fall back to ps if pidof is not available', async function () {
        adb._isPidofAvailable = false;
        adb._isPgrepAvailable = false;
        mocks.adb.expects('listProcessStatus')
          .once().returns(`
          USER     PID   PPID  VSIZE  RSS     WCHAN    PC        NAME
          radio     929   69    1228184 40844 ffffffff b6db0920 S com.android.phone
          radio     930   69    1228184 40844 ffffffff b6db0920 S com.android.phone
          u0_a7     951   69    1256464 72208 ffffffff b6db0920 S com.android.launcher
          u0_a30    1119  69    1220004 33596 ffffffff b6db0920 S com.android.inputmethod.latin
          u0_a12    1156  69    1246756 58588 ffffffff b6db0920 S com.android.systemui
          root      1347  2     0      0     c002f068 00000000 S kworker/0:1
          u0_a1     1349  69    1206724 26164 ffffffff b6db0920 S com.android.providers.calendar
          u0_a17    1431  69    1217460 26616 ffffffff b6db0920 S com.android.calendar
          u0_a21    1454  69    1203712 26244 ffffffff b6db0920 S com.android.deskclock
          u0_a27    1490  69    1206480 24748 ffffffff b6db0920 S com.android.exchange
          u0_a4     1574  69    1205460 22984 ffffffff b6db0920 S com.android.dialer
          u0_a2     1590  69    1207456 29340 ffffffff b6db0920 S android.process.acore
          u0_a11    1608  69    1199320 22448 ffffffff b6db0920 S com.android.sharedstoragebackup
          u0_a15    1627  69    1206440 30480 ffffffff b6db0920 S com.android.browser
          u0_a5     1646  69    1202716 27004 ffffffff b6db0920 S android.process.media
          root      1676  2     0      0     c00d0d8c 00000000 S flush-31:1
          root      1680  2     0      0     c00d0d8c 00000000 S flush-31:2
          root      1681  60    10672  996   00000000 b6f33508 R ps
          `);
        (await adb.getPIDsByName('com.android.phone')).should.eql([929, 930]);
      });
      it('should fall back to ps and return empty list if no processes were found', async function () {
        adb._isPidofAvailable = false;
        adb._isPgrepAvailable = false;
        mocks.adb.expects('listProcessStatus')
          .once().returns(`
          USER     PID   PPID  VSIZE  RSS     WCHAN    PC        NAME
          radio     929   69    1228184 40844 ffffffff b6db0920 S com.android.phone
          radio     930   69    1228184 40844 ffffffff b6db0920 S com.android.phone
          u0_a7     951   69    1256464 72208 ffffffff b6db0920 S com.android.launcher
          u0_a30    1119  69    1220004 33596 ffffffff b6db0920 S com.android.inputmethod.latin
          u0_a12    1156  69    1246756 58588 ffffffff b6db0920 S com.android.systemui
          root      1347  2     0      0     c002f068 00000000 S kworker/0:1
          `);
        (await adb.getPIDsByName('com.android.phoner')).length.should.eql(0);
      });
      it('should properly parse different ps output formats', async function () {
        adb._isPidofAvailable = false;
        adb._isPgrepAvailable = false;
        mocks.adb.expects('listProcessStatus')
          .once().returns(`
          USER           PID  PPID     VSZ    RSS WCHAN            ADDR S NAME
          shell        21989 32761    4952   2532 sigsuspend   b2f1d778 S sh
          shell        21992 21989    5568   3016 0            b4396448 R ps
          `);
        (await adb.getPIDsByName('sh')).should.eql([21989]);
      });
    });
    describe('killProcessesByName', function () {
      it('should call getPIDsByName and kill process correctly', async function () {
        mocks.adb.expects('getPIDsByName')
          .once().withExactArgs(contactManagerPackage)
          .returns([5078]);
        mocks.adb.expects('killProcessByPID')
          .once().withExactArgs(5078)
          .returns('');
        await adb.killProcessesByName(contactManagerPackage);
      });
    });
    describe('killProcessByPID', function () {
      const pid = 5078;

      it('should call kill process correctly', async function () {
        mocks.adb.expects('shell')
          .once().withExactArgs(['kill', pid])
          .returns('');
        await adb.killProcessByPID(pid);
      });
    });
    describe('broadcastProcessEnd', function () {
      it('should broadcast process end', async function () {
        let intent = 'intent',
            processName = 'processName';
        mocks.adb.expects('shell')
          .once().withExactArgs(['am', 'broadcast', '-a', intent])
          .returns('');
        mocks.adb.expects('processExists')
          .once().withExactArgs(processName)
          .returns(false);
        await adb.broadcastProcessEnd(intent, processName);
      });
    });
    describe('broadcast', function () {
      it('should broadcast intent', async function () {
        let intent = 'intent';
        mocks.adb.expects('shell')
          .once().withExactArgs(['am', 'broadcast', '-a', intent])
          .returns('');
        await adb.broadcast(intent);
      });
    });
    describe('instrument', function () {
      it('should call shell with correct arguments', async function () {
        let intent = 'intent';
        mocks.adb.expects('shell')
          .once().withExactArgs(['am', 'broadcast', '-a', intent])
          .returns('');
        await adb.broadcast(intent);
      });
    });
    describe('androidCoverage', function () {
      it('should call shell with correct arguments', async function () {
        adb.executable.defaultArgs = [];
        adb.executable.path = 'dummy_adb_path';
        let conn = new events.EventEmitter();
        conn.start = () => { }; // do nothing
        const instrumentClass = 'instrumentClass',
              waitPkg = 'waitPkg',
              waitActivity = 'waitActivity';
        let args = adb.executable.defaultArgs
          .concat(['shell', 'am', 'instrument', '-e', 'coverage', 'true', '-w'])
          .concat([instrumentClass]);
        mocks.teen_process.expects('SubProcess')
          .withArgs('dummy_adb_path', args)
          .onFirstCall()
          .returns(conn);
        mocks.adb.expects('waitForActivity')
          .once().withExactArgs(waitPkg, waitActivity)
          .returns('');
        await adb.androidCoverage(instrumentClass, waitPkg, waitActivity);
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
    adb.isValidClass('some.package/some.package.Activity').index.should.equal(0);
    should.not.exist(adb.isValidClass('illegalPackage#/adsasd'));
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
      mocks.adb.expects('setSetting').once().withExactArgs('global', 'global_http_proxy_port', proxyPort);
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
