import { getAndroidPlatformAndPath,
         buildStartCmd, isShowingLockscreen, getBuildToolsDirs } from '../../lib/helpers';
import { withMocks } from 'appium-test-support';
import { fs } from 'appium-support';
import path from 'path';
import _ from 'lodash';


describe('helpers', withMocks({fs}, function (mocks) {
  afterEach(function () {
    mocks.verify();
  });

  describe('getAndroidPlatformAndPath', function () {
    let oldAndroidHome;
    before(function () {
      oldAndroidHome = process.env.ANDROID_HOME;
    });
    after(function () {
      process.env.ANDROID_HOME = oldAndroidHome;
    });

    it('should get the latest available API', async function () {
      process.env.ANDROID_HOME = '/path/to/android/home';

      mocks.fs.expects('glob').returns([
        path.resolve(process.env.ANDROID_HOME, 'platforms', 'android-17', 'build.prop'),
        path.resolve(process.env.ANDROID_HOME, 'platforms', 'android-25', 'build.prop'),
        path.resolve(process.env.ANDROID_HOME, 'platforms', 'android-22', 'build.prop'),
      ]);
      mocks.fs.expects('readFile')
        .exactly(3)
        .onCall(0).returns(`
          ro.build.version.incremental=1425461
          ro.build.version.sdk=17
          ro.build.version.codename=REL
          ro.build.version.release=4.2.2`)
        .onCall(1).returns(`
          ro.build.version.incremental=1425461
          ro.build.version.sdk=25
          ro.build.version.codename=REL
          ro.build.version.release=7.0`)
        .onCall(2).returns(`
          ro.build.version.incremental=1425461
          ro.build.version.sdk=22
          ro.build.version.codename=REL
          ro.build.version.release=5.1`);
      let platformAndPath = await getAndroidPlatformAndPath();
      platformAndPath.platform.should.equal('android-25');
      platformAndPath.platformPath.should
        .equal(path.resolve(process.env.ANDROID_HOME, 'platforms', 'android-25'));
    });
  });

  describe('isShowingLockscreen', function () {
    it('should return true if mShowingLockscreen is true', async function () {
      let dumpsys = 'mShowingLockscreen=true mShowingDream=false mDreamingLockscreen=false mTopIsFullscreen=false';
      (await isShowingLockscreen(dumpsys)).should.be.true;
    });
    it('should return true if mDreamingLockscreen is true', async function () {
      let dumpsys = 'mShowingLockscreen=false mShowingDream=false mDreamingLockscreen=true mTopIsFullscreen=false';
      (await isShowingLockscreen(dumpsys)).should.be.true;
    });
    it('should return false if mShowingLockscreen and mDreamingLockscreen are false', async function () {
      let dumpsys = 'mShowingLockscreen=false mShowingDream=false mDreamingLockscreen=false mTopIsFullscreen=false';
      (await isShowingLockscreen(dumpsys)).should.be.false;
    });
    it('should assume that screen is unlocked if can not determine lock state', async function () {
      let dumpsys = 'mShowingDream=false mTopIsFullscreen=false';
      (await isShowingLockscreen(dumpsys)).should.be.false;
    });
  });

  describe('buildStartCmd', function () {
    let startOptions = {
      pkg: 'com.something',
      activity: '.SomeActivity'
    };

    it('should parse optionalIntentArguments with single key', function () {
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: '-d key'}, startOptions), 20);
      cmd[cmd.length-2].should.eql('-d');
      cmd[cmd.length-1].should.eql('key');
    });
    it('should parse optionalIntentArguments with single key/value pair', function () {
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: '-d key value'}, startOptions), 20);
      cmd[cmd.length-3].should.eql('-d');
      cmd[cmd.length-2].should.eql('key');
      cmd[cmd.length-1].should.eql('value');
    });
    it('should parse optionalIntentArguments with single key/value pair with spaces', function () {
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: '-d key value value2'}, startOptions), 20);
      cmd[cmd.length-3].should.eql('-d');
      cmd[cmd.length-2].should.eql('key');
      cmd[cmd.length-1].should.eql('value value2');
    });
    it('should parse optionalIntentArguments with multiple keys', function () {
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: '-d key1 -e key2'}, startOptions), 20);
      cmd[cmd.length-4].should.eql('-d');
      cmd[cmd.length-3].should.eql('key1');
      cmd[cmd.length-2].should.eql('-e');
      cmd[cmd.length-1].should.eql('key2');
    });
    it('should parse optionalIntentArguments with multiple key/value pairs', function () {
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: '-d key1 value1 -e key2 value2'}, startOptions), 20);
      cmd[cmd.length-6].should.eql('-d');
      cmd[cmd.length-5].should.eql('key1');
      cmd[cmd.length-4].should.eql('value1');
      cmd[cmd.length-3].should.eql('-e');
      cmd[cmd.length-2].should.eql('key2');
      cmd[cmd.length-1].should.eql('value2');
    });
    it('should parse optionalIntentArguments with hyphens', function () {
      let arg = 'http://some-url-with-hyphens.com/';
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: `-d ${arg}`}, startOptions), 20);
      cmd[cmd.length-2].should.eql('-d');
      cmd[cmd.length-1].should.eql(arg);
    });
    it('should parse optionalIntentArguments with multiple arguments with hyphens', function () {
      let arg1 = 'http://some-url-with-hyphens.com/';
      let arg2 = 'http://some-other-url-with-hyphens.com/';
      let cmd = buildStartCmd(_.defaults({
        optionalIntentArguments: `-d ${arg1} -e key ${arg2}`
      }, startOptions), 20);
      cmd[cmd.length-5].should.eql('-d');
      cmd[cmd.length-4].should.eql(arg1);
      cmd[cmd.length-3].should.eql('-e');
      cmd[cmd.length-2].should.eql('key');
      cmd[cmd.length-1].should.eql(arg2);
    });
    it('should have -S option when stopApp is set', async function () {
      let cmd = buildStartCmd(_.defaults({stopApp: true}, startOptions), 20);
      cmd[cmd.length-1].should.eql('-S');
    });
    it('should not have -S option when stopApp is not set', async function () {
      let cmd = buildStartCmd(_.defaults({stopApp: false}, startOptions), 20);
      cmd[cmd.length-1].should.not.eql('-S');
    });
  });

  describe('getBuildToolsDirs', function () {
    it('should sort build-tools folder names by semantic version', async function () {
      mocks.fs.expects('glob').once().returns([
        '/some/path/1.2.3',
        '/some/path/4.5.6',
        '/some/path/2.3.1',
      ]);
      (await getBuildToolsDirs('/dummy/path')).should.be.eql([
        '/some/path/4.5.6',
        '/some/path/2.3.1',
        '/some/path/1.2.3',
      ]);
    });
  });
}));
