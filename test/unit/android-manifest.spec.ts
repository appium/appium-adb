import assert from 'node:assert/strict';
import path from 'node:path';
import {describe, it, beforeEach, afterEach} from 'node:test';

import {fs} from '@appium/support';
import sinon from 'sinon';

import {getAndroidPlatformAndPath} from '../../lib/tools/android-manifest.js';

describe('android manifest', function () {
  let sandbox: sinon.SinonSandbox;
  let mocks: {fs: any};

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    mocks = {
      fs: sandbox.mock(fs),
    };
  });

  afterEach(function () {
    sandbox.verify();
    sandbox.restore();
  });

  describe('getAndroidPlatformAndPath', function () {
    it('should get the latest available API', async function () {
      const ANDROID_HOME = '/path/to/android/home';

      mocks.fs
        .expects('glob')
        .returns([
          path.resolve(ANDROID_HOME, 'platforms', 'android-17', 'build.prop'),
          path.resolve(ANDROID_HOME, 'platforms', 'android-25', 'build.prop'),
          path.resolve(ANDROID_HOME, 'platforms', 'android-22', 'build.prop'),
        ]);
      mocks.fs
        .expects('readFile')
        .exactly(3)
        .onCall(0)
        .returns(
          `
          ro.build.version.incremental=1425461
          ro.build.version.sdk=17
          ro.build.version.codename=REL
          ro.build.version.release=4.2.2`,
        )
        .onCall(1)
        .returns(
          `
          ro.build.version.incremental=1425461
          ro.build.version.sdk=25
          ro.build.version.codename=REL
          ro.build.version.release=7.0`,
        )
        .onCall(2).returns(`
          ro.build.version.incremental=1425461
          ro.build.version.sdk=22
          ro.build.version.codename=REL
          ro.build.version.release=5.1`);
      const platformAndPath = await getAndroidPlatformAndPath(ANDROID_HOME);
      assert.strictEqual(platformAndPath.platform, 'android-25');
      assert.strictEqual(platformAndPath.platformPath, path.resolve(ANDROID_HOME, 'platforms', 'android-25'));
    });
  });
});
