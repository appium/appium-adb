import assert from 'node:assert/strict';
import path from 'node:path';
import {describe, it} from 'node:test';

import {fs} from '@appium/support';

import {ADB} from '../../lib/adb.js';

describe('ADB', function () {
  it('should correctly return adb if present', async function () {
    const adb = await ADB.createADB();
    assert.ok(adb.executable.path);
  });
  it('should throw when ANDROID_HOME is ivalid', async function () {
    const opts = {sdkRoot: '/aasdasdds'};
    await assert.rejects(ADB.createADB(opts));
  });
  it.skip('should error out if binary not persent', async function () {
    // TODO write a negative test
  });
  it('should initialize aapt', async function () {
    const adb = new ADB();
    await adb.initAapt();
    assert.ok(adb.binaries!.aapt.includes('aapt'));
  });
  it('should initialize aapt using the enforced build tools path', async function () {
    const buildToolsRoot = path.resolve(process.env.ANDROID_HOME!, 'build-tools');
    const buildToolsVersion = (await fs.readdir(buildToolsRoot))[0];
    const adb = new ADB({buildToolsVersion: buildToolsVersion || undefined});
    await adb.initAapt();
    assert.ok(adb.binaries!.aapt.includes('aapt'));
  });
  it('should initialize zipAlign', async function () {
    const adb = new ADB();
    await adb.initZipAlign();
    assert.ok(adb.binaries!.zipalign.includes('zipalign'));
  });
  it('should correctly initialize adb from parent', async function () {
    const adb = await ADB.createADB();
    assert.ok(adb.executable.path);
    const clone = adb.clone();
    assert.ok(clone.executable.path);
    assert.strictEqual(adb.executable.path, clone.executable.path);
  });
});
