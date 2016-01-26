import { getPossibleActivityNames, getDirectories, getAndroidPlatformAndPath } from '../../lib/helpers';
import { withMocks } from 'appium-test-support';
import { fs } from 'appium-support';
import path from 'path';
import chai from 'chai';


const should = chai.should;

describe('helpers', () => {
  describe('getPossibleActivityNames', () => {
    it('should correctly remove pkg from pkg.activity.name', () => {
      getPossibleActivityNames('pkg', 'pkg.activity.name')
        .should.include('.activity.name');
    });
    it('should return .act.name when act.name is passed', () => {
      getPossibleActivityNames('pkg', 'act.name')
        .should.include('.act.name');
    });
    it('should not amend a valid activity name', () => {
      getPossibleActivityNames('pkg', '.activity.name')
        .should.include('.activity.name');
    });
    it('should handle case where application id is different from package name', () => {
       getPossibleActivityNames('com.ga.aaa.android.bbb.activities.local', 'com.ga.aaa.android.bbb.activity.FirstLaunchActivity')
         .should.include('com.ga.aaa.android.bbb.activity.FirstLaunchActivity');
     });
  });

  describe('getDirectories', withMocks({fs}, (mocks) => {
    it('should sort the directories', async () => {
      let rootPath = '/path/to/root';
      let directories = ['c', 'b', 'a', '1', '2'];
      mocks.fs.expects('readdir')
        .once().withExactArgs(rootPath)
        .returns(directories);
      mocks.fs.expects('lstat')
        .exactly(5)
        .returns(Promise.resolve({isDirectory: () => {return true;}}));
      (await getDirectories(rootPath)).should.eql(['1', '2', 'a', 'b', 'c']);
      mocks.fs.verify();
    });
  }));

  describe('getAndroidPlatformAndPath', withMocks({fs, path}, (mocks) => {
    it('should return null if no ANDROID_HOME is set', async () => {
      should(await getAndroidPlatformAndPath()).not.exist;
    });
    it('should get the latest available API', async () => {
      let oldAndroidHome = process.env.ANDROID_HOME;
      process.env.ANDROID_HOME = '/path/to/android/home';
      mocks.fs.expects('exists')
        .exactly(2)
        .onCall(0).returns(false)
        .onCall(1).returns(true);
      mocks.path.expects('resolve')
        .exactly(4)
        .onCall(0).returns('/path/to/apis0')
        .onCall(1).returns('/path/to/apis1')
        .onCall(2).returns('/path/to/apis2')
        .onCall(3).returns('/path/to/apis3');

      let platformAndPath = await getAndroidPlatformAndPath();
      platformAndPath.platform.should.equal('android-23');
      platformAndPath.platformPath.should.equal('/path/to/apis3');

      mocks.fs.verify();
      mocks.path.verify();
      process.env.ANDROID_HOME = oldAndroidHome;
    });
  }));
});
