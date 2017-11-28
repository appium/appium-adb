import { getDirectories, getAndroidPlatformAndPath,
         buildStartCmd, isShowingLockscreen } from '../../lib/helpers';
import { withMocks } from 'appium-test-support';
import { fs } from 'appium-support';
import path from 'path';
import _ from 'lodash';
import B from 'bluebird';


describe('helpers', () => {
  describe('getDirectories', withMocks({fs}, (mocks) => {
    it('should sort the directories', async () => {
      let rootPath = '/path/to/root';
      let directories = ['c', 'b', 'a', '1', '2'];
      mocks.fs.expects('readdir')
        .once().withExactArgs(rootPath)
        .returns(directories);
      mocks.fs.expects('lstat')
        .exactly(5)
        .returns(B.resolve({isDirectory: () => {return true;}}));
      (await getDirectories(rootPath)).should.eql(['1', '2', 'a', 'b', 'c']);
      mocks.fs.verify();
    });
  }));

  describe('getAndroidPlatformAndPath', withMocks({fs}, (mocks) => {
    let oldAndroidHome;
    let oldResolve;
    before(function () {
      oldAndroidHome = process.env.ANDROID_HOME;
    });
    after(function () {
      process.env.ANDROID_HOME = oldAndroidHome;
    });
    afterEach(function () {
      if (oldResolve) {
        path.resolve = oldResolve;
      }
    });

    it('should return null if no ANDROID_HOME is set', async function () {
      delete process.env.ANDROID_HOME;

      await getAndroidPlatformAndPath().should.eventually.be.rejectedWith(/ANDROID_HOME environment variable was not exported/);
    });
    it('should get the latest available API', async function () {
      process.env.ANDROID_HOME = '/path/to/android/home';

      mocks.fs.expects('exists')
        .exactly(2)
        .onCall(0).returns(false)
        .onCall(1).returns(true);
      // manually mock `path`, to allow system to work
      oldResolve = path.resolve;
      let count = 0;
      path.resolve = function (...args) {
        // ensure that underlying system calls still work
        if (args[1] !== 'platforms' && args[1].indexOf('android') !== 0) {
          return oldResolve(...args);
        }

        switch (count++) {
          case 0:
            return '/path/to';
          case 1:
            return '/path/to/apis1';
          case 2:
            return '/path/to/apis2';
          case 3:
            return '/error/getting/here';
        }
      };
      let platformAndPath = await getAndroidPlatformAndPath();
      platformAndPath.platform.should.equal('android-24');
      platformAndPath.platformPath.should.equal('/path/to/apis2');
      mocks.fs.verify();
      count.should.eql(3);
    });
  }));

  describe('isShowingLockscreen', () => {
    it('should return true if mShowingLockscreen is true', async () => {
      let dumpsys = 'mShowingLockscreen=true mShowingDream=false mDreamingLockscreen=false mTopIsFullscreen=false';
      (await isShowingLockscreen(dumpsys)).should.be.true;
    });
    it('should return true if mDreamingLockscreen is true', async () => {
      let dumpsys = 'mShowingLockscreen=false mShowingDream=false mDreamingLockscreen=true mTopIsFullscreen=false';
      (await isShowingLockscreen(dumpsys)).should.be.true;
    });
    it('should return false if mShowingLockscreen and mDreamingLockscreen are false', async () => {
      let dumpsys = 'mShowingLockscreen=false mShowingDream=false mDreamingLockscreen=false mTopIsFullscreen=false';
      (await isShowingLockscreen(dumpsys)).should.be.false;
    });
    it('should assume that screen is unlocked if can not determine lock state', async () => {
      let dumpsys = 'mShowingDream=false mTopIsFullscreen=false';
      (await isShowingLockscreen(dumpsys)).should.be.false;
    });
  });

  describe('buildStartCmd', () => {
    let startOptions = {
      pkg: 'com.something',
      activity: '.SomeActivity'
    };

    it('should parse optionalIntentArguments with single key', () => {
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: '-d key'}, startOptions), 20);
      cmd[cmd.length-2].should.eql('-d');
      cmd[cmd.length-1].should.eql('key');
    });
    it('should parse optionalIntentArguments with single key/value pair', () => {
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: '-d key value'}, startOptions), 20);
      cmd[cmd.length-3].should.eql('-d');
      cmd[cmd.length-2].should.eql('key');
      cmd[cmd.length-1].should.eql('value');
    });
    it('should parse optionalIntentArguments with single key/value pair with spaces', () => {
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: '-d key value value2'}, startOptions), 20);
      cmd[cmd.length-3].should.eql('-d');
      cmd[cmd.length-2].should.eql('key');
      cmd[cmd.length-1].should.eql('value value2');
    });
    it('should parse optionalIntentArguments with multiple keys', () => {
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: '-d key1 -e key2'}, startOptions), 20);
      cmd[cmd.length-4].should.eql('-d');
      cmd[cmd.length-3].should.eql('key1');
      cmd[cmd.length-2].should.eql('-e');
      cmd[cmd.length-1].should.eql('key2');
    });
    it('should parse optionalIntentArguments with multiple key/value pairs', () => {
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: '-d key1 value1 -e key2 value2'}, startOptions), 20);
      cmd[cmd.length-6].should.eql('-d');
      cmd[cmd.length-5].should.eql('key1');
      cmd[cmd.length-4].should.eql('value1');
      cmd[cmd.length-3].should.eql('-e');
      cmd[cmd.length-2].should.eql('key2');
      cmd[cmd.length-1].should.eql('value2');
    });
    it('should parse optionalIntentArguments with hyphens', () => {
      let arg = 'http://some-url-with-hyphens.com/';
      let cmd = buildStartCmd(_.defaults({optionalIntentArguments: `-d ${arg}`}, startOptions), 20);
      cmd[cmd.length-2].should.eql('-d');
      cmd[cmd.length-1].should.eql(arg);
    });
    it('should parse optionalIntentArguments with multiple arguments with hyphens', () => {
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
    it('should have -S option when stopApp is set', async () => {
      let cmd = buildStartCmd(_.defaults({stopApp: true}, startOptions), 20);
      cmd[cmd.length-1].should.eql('-S');
    });
    it('should not have -S option when stopApp is not set', async () => {
      let cmd = buildStartCmd(_.defaults({stopApp: false}, startOptions), 20);
      cmd[cmd.length-1].should.not.eql('-S');
    });
  });
});
