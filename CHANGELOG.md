## [12.7.0](https://github.com/appium/appium-adb/compare/v12.6.2...v12.7.0) (2024-11-10)

### Features

* add support for activities with unicode chars ([#773](https://github.com/appium/appium-adb/issues/773)) ([8494f72](https://github.com/appium/appium-adb/commit/8494f7275690e219656c4246c20d0a008532d407))

## [12.6.2](https://github.com/appium/appium-adb/compare/v12.6.1...v12.6.2) (2024-11-09)

### Miscellaneous Chores

* use start-activity for api level 26+ ([#771](https://github.com/appium/appium-adb/issues/771)) ([8faa1f3](https://github.com/appium/appium-adb/commit/8faa1f33784307d6c807a1654fd6367fa27387a1))

## [12.6.1](https://github.com/appium/appium-adb/compare/v12.6.0...v12.6.1) (2024-10-31)

### Miscellaneous Chores

* Streamline locale validation ([#765](https://github.com/appium/appium-adb/issues/765)) ([1b7e859](https://github.com/appium/appium-adb/commit/1b7e85903ecb09104b539d4b723e375235b83e3a))

## [12.6.0](https://github.com/appium/appium-adb/compare/v12.5.3...v12.6.0) (2024-09-08)

### Features

* Add a method to list device ports ([#764](https://github.com/appium/appium-adb/issues/764)) ([01fff96](https://github.com/appium/appium-adb/commit/01fff962d1f6578b7cf5e6cdfb90f72df0743ac7))

## [12.5.3](https://github.com/appium/appium-adb/compare/v12.5.2...v12.5.3) (2024-09-05)

### Miscellaneous Chores

* Bump ini from 4.1.3 to 5.0.0 ([#762](https://github.com/appium/appium-adb/issues/762)) ([434f7bc](https://github.com/appium/appium-adb/commit/434f7bc0bcb156c6ea5275baeb743314a42fab31))

## [12.5.2](https://github.com/appium/appium-adb/compare/v12.5.1...v12.5.2) (2024-08-06)

### Bug Fixes

* Enforce '--user 0'  argument if `cmd package list packages` throws an access error ([#761](https://github.com/appium/appium-adb/issues/761)) ([89b3348](https://github.com/appium/appium-adb/commit/89b3348d2f61b55d2f4e2eba4b205d5130b427fa))

## [12.5.1](https://github.com/appium/appium-adb/compare/v12.5.0...v12.5.1) (2024-07-29)

### Miscellaneous Chores

* Bump @types/node from 20.14.13 to 22.0.0 ([#760](https://github.com/appium/appium-adb/issues/760)) ([b7308ff](https://github.com/appium/appium-adb/commit/b7308ff360ee90ee9367c5fd32707ac1fe765978))

## [12.5.0](https://github.com/appium/appium-adb/compare/v12.4.8...v12.5.0) (2024-07-10)

### Features

* Use aapt2 instead of ApkReader ([#757](https://github.com/appium/appium-adb/issues/757)) ([8efcf5b](https://github.com/appium/appium-adb/commit/8efcf5bdc41c695f8fc699f3cad2baaad0da3b42))

## [12.4.8](https://github.com/appium/appium-adb/compare/v12.4.7...v12.4.8) (2024-07-03)

### Miscellaneous Chores

* Simplify emulator output handling ([#754](https://github.com/appium/appium-adb/issues/754)) ([d1336e8](https://github.com/appium/appium-adb/commit/d1336e8c98b909a178fe91a5ecd346fd1da802d1))

## [12.4.7](https://github.com/appium/appium-adb/compare/v12.4.6...v12.4.7) (2024-07-02)

### Bug Fixes

* Fix recent entry retrieval ([#753](https://github.com/appium/appium-adb/issues/753)) ([67d4b06](https://github.com/appium/appium-adb/commit/67d4b06a1d1b65074c52759e197f2b369f9ede15))

## [12.4.6](https://github.com/appium/appium-adb/compare/v12.4.5...v12.4.6) (2024-06-30)

### Bug Fixes

* Prefer indexes over timestamps as logcat keys ([#752](https://github.com/appium/appium-adb/issues/752)) ([f499875](https://github.com/appium/appium-adb/commit/f49987590e9a4935e8fac07bdc1d237c4aec5cd1))

## [12.4.5](https://github.com/appium/appium-adb/compare/v12.4.4...v12.4.5) (2024-06-30)

### Miscellaneous Chores

* Optimize logcat callbacks handling ([#751](https://github.com/appium/appium-adb/issues/751)) ([5496a24](https://github.com/appium/appium-adb/commit/5496a2445f5f39b587fe081ff7bae819eadd2d5b))

## [12.4.4](https://github.com/appium/appium-adb/compare/v12.4.3...v12.4.4) (2024-06-21)

### Miscellaneous Chores

* Bump chai and chai-as-promised ([#750](https://github.com/appium/appium-adb/issues/750)) ([e6d8481](https://github.com/appium/appium-adb/commit/e6d84815450d24c19d2cd1b37c755179ec217b92))

## [12.4.3](https://github.com/appium/appium-adb/compare/v12.4.2...v12.4.3) (2024-06-12)

### Miscellaneous Chores

* Bump @appium/support from 4.5.0 to 5.0.3 ([#749](https://github.com/appium/appium-adb/issues/749)) ([41b0999](https://github.com/appium/appium-adb/commit/41b0999f68515cf4690a7b61164f44528584dfc4))

## [12.4.2](https://github.com/appium/appium-adb/compare/v12.4.1...v12.4.2) (2024-06-04)

### Miscellaneous Chores

* Bump semantic-release from 23.1.1 to 24.0.0 and conventional-changelog-conventionalcommits to 8.0.0 ([#747](https://github.com/appium/appium-adb/issues/747)) ([573c274](https://github.com/appium/appium-adb/commit/573c274a3a5acd556b36463c27a502bd0c40f351))

## [12.4.1](https://github.com/appium/appium-adb/compare/v12.4.0...v12.4.1) (2024-05-30)


### Bug Fixes

* Update lockscreen detection for various firmwares ([#746](https://github.com/appium/appium-adb/issues/746)) ([712d01f](https://github.com/appium/appium-adb/commit/712d01fa186af8dcaf566134a8061cfab25058bb))

## [12.4.0](https://github.com/appium/appium-adb/compare/v12.3.2...v12.4.0) (2024-05-26)


### Features

* enable window animation via settings ([#745](https://github.com/appium/appium-adb/issues/745)) ([d8be21b](https://github.com/appium/appium-adb/commit/d8be21bcc6d5ee0465dca1318ade156fde975c5b))

## [12.3.2](https://github.com/appium/appium-adb/compare/v12.3.1...v12.3.2) (2024-05-16)


### Miscellaneous Chores

* Bump eslint dependency ([#744](https://github.com/appium/appium-adb/issues/744)) ([e327cdc](https://github.com/appium/appium-adb/commit/e327cdc15f65e182213a6b534e72413b079ae05c))

## [12.3.1](https://github.com/appium/appium-adb/compare/v12.3.0...v12.3.1) (2024-05-16)


### Miscellaneous Chores

* Bump sinon from 17.0.2 to 18.0.0 ([#743](https://github.com/appium/appium-adb/issues/743)) ([3fb6f80](https://github.com/appium/appium-adb/commit/3fb6f80c04660de7ea88d056a0a05c1faf632a8f))

## [12.3.0](https://github.com/appium/appium-adb/compare/v12.2.0...v12.3.0) (2024-05-09)


### Features

* Add a method to control NFC adapter state ([#742](https://github.com/appium/appium-adb/issues/742)) ([5c6556f](https://github.com/appium/appium-adb/commit/5c6556fa08e3851390f7dc8cffa154a9ee6bf927))

## [12.2.0](https://github.com/appium/appium-adb/compare/v12.1.0...v12.2.0) (2024-05-08)


### Features

* let pass user for isAppInstalled ([#739](https://github.com/appium/appium-adb/issues/739)) ([90d1fc6](https://github.com/appium/appium-adb/commit/90d1fc66bffef5709f65ae12cf354c749fd96cb0))

## [12.1.0](https://github.com/appium/appium-adb/compare/v12.0.9...v12.1.0) (2024-05-07)


### Features

* Add a helper method to enable/disable bluetooth ([#737](https://github.com/appium/appium-adb/issues/737)) ([71c0d84](https://github.com/appium/appium-adb/commit/71c0d84243794ac0e70257d59ad4d6ec52930783))


### Miscellaneous Chores

* Always use reboot_readiness service to detect emulator startup for API 31+ ([#736](https://github.com/appium/appium-adb/issues/736)) ([c57d18b](https://github.com/appium/appium-adb/commit/c57d18b9597a0d5cc635105658ff2d45c86ca3e5))

## [12.0.9](https://github.com/appium/appium-adb/compare/v12.0.8...v12.0.9) (2024-05-03)


### Bug Fixes

* Add one more condition to the lock state detection ([#732](https://github.com/appium/appium-adb/issues/732)) ([92025fe](https://github.com/appium/appium-adb/commit/92025fe9e0b71f04ad84c479ae1c0e3a81bbf767))

## [12.0.8](https://github.com/appium/appium-adb/compare/v12.0.7...v12.0.8) (2024-04-07)


### Bug Fixes

* Respect the `udid` option ([#728](https://github.com/appium/appium-adb/issues/728)) ([4e48033](https://github.com/appium/appium-adb/commit/4e480332723b4fae177774b72e98daf24eca9dcb))

## [12.0.7](https://github.com/appium/appium-adb/compare/v12.0.6...v12.0.7) (2024-04-02)


### Bug Fixes

* Do not check if app is installed if we know it is ([#727](https://github.com/appium/appium-adb/issues/727)) ([7ddf5f3](https://github.com/appium/appium-adb/commit/7ddf5f393a78eeadd7ddea4aab52cec4cc74fa73))

## [12.0.6](https://github.com/appium/appium-adb/compare/v12.0.5...v12.0.6) (2024-04-01)


### Bug Fixes

* Make 'executable' opt optional ([#726](https://github.com/appium/appium-adb/issues/726)) ([e213744](https://github.com/appium/appium-adb/commit/e2137445762f3fa1c683d14e64474aa51607a86c))

## [12.0.5](https://github.com/appium/appium-adb/compare/v12.0.4...v12.0.5) (2024-03-29)


### Bug Fixes

* Do not call 'start-server' if the 'suppressKillServer' option is enabled ([#725](https://github.com/appium/appium-adb/issues/725)) ([0fd0210](https://github.com/appium/appium-adb/commit/0fd021049a5efe8317621ef431ea34d191989e01))

## [12.0.4](https://github.com/appium/appium-adb/compare/v12.0.3...v12.0.4) (2024-03-07)


### Miscellaneous Chores

* bump typescript ([5ee0265](https://github.com/appium/appium-adb/commit/5ee026583dbecb19530cf85174db58795a4b0ddd))
* Bump typescript from 5.2.2 to 5.4.2 ([#724](https://github.com/appium/appium-adb/issues/724)) ([6b28c01](https://github.com/appium/appium-adb/commit/6b28c0157f307d15c75eff0d4a98415dced207d9))

## [12.0.3](https://github.com/appium/appium-adb/compare/v12.0.2...v12.0.3) (2024-01-27)


### Miscellaneous Chores

* Remove husky and commitlint ([#722](https://github.com/appium/appium-adb/issues/722)) ([f7adefb](https://github.com/appium/appium-adb/commit/f7adefb82191de6e7d4c36d60b5b7512eb990e4f))

## [12.0.2](https://github.com/appium/appium-adb/compare/v12.0.1...v12.0.2) (2024-01-25)


### Miscellaneous Chores

* Update the implementation of extractStringsFromApk API ([#720](https://github.com/appium/appium-adb/issues/720)) ([ef091f4](https://github.com/appium/appium-adb/commit/ef091f4aa835b6fdaec0d85ce06e7196788ccd9c))

## [12.0.1](https://github.com/appium/appium-adb/compare/v12.0.0...v12.0.1) (2024-01-17)


### Miscellaneous Chores

* Bump semantic-release from 22.0.12 to 23.0.0 ([#717](https://github.com/appium/appium-adb/issues/717)) ([cba0e91](https://github.com/appium/appium-adb/commit/cba0e9100e3364b73df28c21e1c2b4145933dd8b))
* use latest lts for the publishment ([0312fed](https://github.com/appium/appium-adb/commit/0312fedabf4373d59b5f5152f5add8750866a763))

## [11.1.0](https://github.com/appium/appium-adb/compare/v11.0.9...v11.1.0) (2024-01-09)


### Features

* add isSettingsAppServiceRunningInForeground to check the settings' service existence better ([#715](https://github.com/appium/appium-adb/issues/715)) ([be0502e](https://github.com/appium/appium-adb/commit/be0502e28a15916bd4bcb079d569aa7b7d5803fe))

## [11.0.9](https://github.com/appium/appium-adb/compare/v11.0.8...v11.0.9) (2023-12-27)


### Miscellaneous Chores

* Bump @types/ini from 1.3.34 to 4.1.0 ([#713](https://github.com/appium/appium-adb/issues/713)) ([d68cb79](https://github.com/appium/appium-adb/commit/d68cb798061cd4a0ebdad211bcea1aced9029962))

## [11.0.8](https://github.com/appium/appium-adb/compare/v11.0.7...v11.0.8) (2023-11-19)


### Miscellaneous Chores

* Update the link in the troubleshooting error message ([#710](https://github.com/appium/appium-adb/issues/710)) ([c4f61dc](https://github.com/appium/appium-adb/commit/c4f61dc19b2180098d7ce850fd4cd739a33f03c6))

## [11.0.7](https://github.com/appium/appium-adb/compare/v11.0.6...v11.0.7) (2023-11-10)


### Miscellaneous Chores

* change the reference of adbkit-apkreader ([#709](https://github.com/appium/appium-adb/issues/709)) ([6acc15e](https://github.com/appium/appium-adb/commit/6acc15e292493edbb61a37c538667571a851f359))

## [11.0.6](https://github.com/appium/appium-adb/compare/v11.0.5...v11.0.6) (2023-11-07)


### Miscellaneous Chores

* Bump @types/sinon from 10.0.20 to 17.0.0 ([#708](https://github.com/appium/appium-adb/issues/708)) ([0d2eabe](https://github.com/appium/appium-adb/commit/0d2eabe03646533bfe5cc46f1d51440f3bf80690))

## [11.0.5](https://github.com/appium/appium-adb/compare/v11.0.4...v11.0.5) (2023-11-01)


### Miscellaneous Chores

* Bump asyncbox from 2.9.4 to 3.0.0 ([#707](https://github.com/appium/appium-adb/issues/707)) ([799dcad](https://github.com/appium/appium-adb/commit/799dcadfda28d60497de32a612ae0f1e02875636))

## [11.0.4](https://github.com/appium/appium-adb/compare/v11.0.3...v11.0.4) (2023-10-25)


### Miscellaneous Chores

* Bump @commitlint/config-conventional from 17.8.1 to 18.1.0 ([#706](https://github.com/appium/appium-adb/issues/706)) ([37a7476](https://github.com/appium/appium-adb/commit/37a7476e66029a51364c42eb1f25b9b4fa2e9625))

## [11.0.3](https://github.com/appium/appium-adb/compare/v11.0.2...v11.0.3) (2023-10-24)


### Miscellaneous Chores

* Bump @commitlint/cli from 17.8.1 to 18.0.0 ([#703](https://github.com/appium/appium-adb/issues/703)) ([da44361](https://github.com/appium/appium-adb/commit/da443616d397c0c983db4eabd28bd98567492508))
* Bump sinon from 16.1.3 to 17.0.0 ([#704](https://github.com/appium/appium-adb/issues/704)) ([152b210](https://github.com/appium/appium-adb/commit/152b2108c3b0bbcbd0b114592bbac54c34255eaf))

## [11.0.2](https://github.com/appium/appium-adb/compare/v11.0.1...v11.0.2) (2023-10-23)


### Bug Fixes

* Fix linter errors ([#705](https://github.com/appium/appium-adb/issues/705)) ([c3977b9](https://github.com/appium/appium-adb/commit/c3977b99ed8d2d16e02d81c816f470aed925fc00))


### Miscellaneous Chores

* Always use latest types ([618cab3](https://github.com/appium/appium-adb/commit/618cab30441123c463805fd3b1ca14c8dc9215f9))

## [11.0.1](https://github.com/appium/appium-adb/compare/v11.0.0...v11.0.1) (2023-10-18)


### Miscellaneous Chores

* Bump lint-staged from 14.0.1 to 15.0.1 ([#699](https://github.com/appium/appium-adb/issues/699)) ([8b19369](https://github.com/appium/appium-adb/commit/8b193696e8fb07b75ea1e76fe55ff8300ee3b165))
* Bump semantic-release from 21.1.2 to 22.0.5 ([#696](https://github.com/appium/appium-adb/issues/696)) ([40b8bad](https://github.com/appium/appium-adb/commit/40b8bad87f2a93e99c55e657c28495e7173c586d))

## [11.0.0](https://github.com/appium/appium-adb/compare/v10.0.0...v11.0.0) (2023-10-18)


### ⚠ BREAKING CHANGES

* The obsolete emPort property has been removed. Use emulatorPort instead
* The following coverage-related methods were removed as obsolete: endAndroidCoverage, instrument, androidCoverage
* The obsolete jars property has been removed.
* The obsolete instrumentProc property has been removed.

### Code Refactoring

* Remove obsolete methods and properties ([#700](https://github.com/appium/appium-adb/issues/700)) ([2673b96](https://github.com/appium/appium-adb/commit/2673b96915e3942bb3981a4a56740c3db40c36cc))

## [10.0.0](https://github.com/appium/appium-adb/compare/v9.14.12...v10.0.0) (2023-10-16)


### ⚠ BREAKING CHANGES

* Some type declarations have been changed in order to make the compiler happy

### Features

* Improve type declarations ([#698](https://github.com/appium/appium-adb/issues/698)) ([7d2588a](https://github.com/appium/appium-adb/commit/7d2588a1842be73dd77c08c493e7aef5aa4ee92d))

## [9.14.12](https://github.com/appium/appium-adb/compare/v9.14.11...v9.14.12) (2023-10-08)


### Bug Fixes

* Fallback the boot detection if the device does not have reboot_readiness service ([#697](https://github.com/appium/appium-adb/issues/697)) ([8a84148](https://github.com/appium/appium-adb/commit/8a841483429b1949ac663829f8801f62ee88f49c))


### Miscellaneous Chores

* Bump sinon from 15.2.0 to 16.0.0 ([7a51919](https://github.com/appium/appium-adb/commit/7a51919af82716beebba4880e404275925b54488))

## [9.14.11](https://github.com/appium/appium-adb/compare/v9.14.10...v9.14.11) (2023-09-14)


### Miscellaneous Chores

* Log a proper error message if getConnectedDevices API throws an exception ([#692](https://github.com/appium/appium-adb/issues/692)) ([8330a64](https://github.com/appium/appium-adb/commit/8330a64025fad6cb9cd7f59329ea58b190c69d8b))

## [9.14.10](https://github.com/appium/appium-adb/compare/v9.14.9...v9.14.10) (2023-09-12)


### Bug Fixes

* JSON data parsing with extras ([#691](https://github.com/appium/appium-adb/issues/691)) ([3adb3cd](https://github.com/appium/appium-adb/commit/3adb3cdb635d66696433da3963192d86d0cddda5))

## [9.14.9](https://github.com/appium/appium-adb/compare/v9.14.8...v9.14.9) (2023-08-28)


### Bug Fixes

* Move utf7 encoding primitives to the module codebase ([#689](https://github.com/appium/appium-adb/issues/689)) ([334c0b6](https://github.com/appium/appium-adb/commit/334c0b67d2e02d4c3216d7ecd09e9275cd44eb9a))


### Miscellaneous Chores

* Bump typescript from 5.0.4 to 5.2.2 ([#688](https://github.com/appium/appium-adb/issues/688)) ([f3b5be1](https://github.com/appium/appium-adb/commit/f3b5be1ae93f2cd6cc1039d6e8f8768a7d246491))

## [9.14.8](https://github.com/appium/appium-adb/compare/v9.14.7...v9.14.8) (2023-08-28)


### Miscellaneous Chores

* Bump conventional-changelog-conventionalcommits ([#690](https://github.com/appium/appium-adb/issues/690)) ([cb6c60b](https://github.com/appium/appium-adb/commit/cb6c60bbdc5aa7434c4194f41ef68efc41d87c6f))

## [9.14.7](https://github.com/appium/appium-adb/compare/v9.14.6...v9.14.7) (2023-08-25)


### Bug Fixes

* Arguments order for the LRUCache.dispose call ([#687](https://github.com/appium/appium-adb/issues/687)) ([e4a4eb3](https://github.com/appium/appium-adb/commit/e4a4eb311c599c3c23efef482f300df8a29075ae))

## [9.14.6](https://github.com/appium/appium-adb/compare/v9.14.5...v9.14.6) (2023-08-25)


### Miscellaneous Chores

* Bump semantic-release from 20.1.3 to 21.1.0 ([#686](https://github.com/appium/appium-adb/issues/686)) ([1429917](https://github.com/appium/appium-adb/commit/1429917b78e07934e452d32b199da663e25b0250))

## [9.14.5](https://github.com/appium/appium-adb/compare/v9.14.4...v9.14.5) (2023-08-14)


### Miscellaneous Chores

* Bump lint-staged from 13.3.0 to 14.0.0 ([#684](https://github.com/appium/appium-adb/issues/684)) ([ba3e7e1](https://github.com/appium/appium-adb/commit/ba3e7e166249007b36694dc6190070a35d813d28))

## [9.14.4](https://github.com/appium/appium-adb/compare/v9.14.3...v9.14.4) (2023-08-02)


### Miscellaneous Chores

* Bump lru-cache from 7.18.3 to 10.0.0 ([#669](https://github.com/appium/appium-adb/issues/669)) ([95de39f](https://github.com/appium/appium-adb/commit/95de39f78c6f88cbb117f053ed3fc0dd2fffb052))

## [9.14.3](https://github.com/appium/appium-adb/compare/v9.14.2...v9.14.3) (2023-08-02)


### Miscellaneous Chores

* Bump ini from 3.0.1 to 4.1.1 ([#657](https://github.com/appium/appium-adb/issues/657)) ([aa156b8](https://github.com/appium/appium-adb/commit/aa156b8452f25ff9bd1330de6ba118c9d9100bef))

## [9.14.2](https://github.com/appium/appium-adb/compare/v9.14.1...v9.14.2) (2023-07-07)


### Miscellaneous Chores

* Bump prettier from 2.8.8 to 3.0.0 ([#682](https://github.com/appium/appium-adb/issues/682)) ([a2b4e6d](https://github.com/appium/appium-adb/commit/a2b4e6de31f7bd3d98a8202bdb2fcbde3ebee463))

## [9.14.1](https://github.com/appium/appium-adb/compare/v9.14.0...v9.14.1) (2023-06-29)


### Miscellaneous Chores

* add husky and commitlint ([75e86fc](https://github.com/appium/appium-adb/commit/75e86fc6d1bd2a691b3051656fa880503f62380d))

## [9.14.0](https://github.com/appium/appium-adb/compare/v9.13.3...v9.14.0) (2023-06-29)


### Features

* **types:** export more types ([e57b97b](https://github.com/appium/appium-adb/commit/e57b97bbd4e1950449c4611b0ee1bedf7e48f2bc))

## [9.13.3](https://github.com/appium/appium-adb/compare/v9.13.2...v9.13.3) (2023-06-29)


### Miscellaneous Chores

* Update the name of the 'delete' method of LRU cache ([#678](https://github.com/appium/appium-adb/issues/678)) ([4e04e94](https://github.com/appium/appium-adb/commit/4e04e94d3595d695c64d25e9f9bde37603c82082))

## [9.13.2](https://github.com/appium/appium-adb/compare/v9.13.1...v9.13.2) (2023-06-23)


### Miscellaneous Chores

* Add a troubleshooting link to the WRITE_SECURE_SETTINGS error message ([#674](https://github.com/appium/appium-adb/issues/674)) ([b04b876](https://github.com/appium/appium-adb/commit/b04b8767e17500ac0a37150bc15f2e51d69a9872))

## [9.13.1](https://github.com/appium/appium-adb/compare/v9.13.0...v9.13.1) (2023-06-22)


### Miscellaneous Chores

* Speed up app installation detection ([#673](https://github.com/appium/appium-adb/issues/673)) ([dfd8357](https://github.com/appium/appium-adb/commit/dfd835701b912315b89f73b8735d057718d70a2e))

## [9.13.0](https://github.com/appium/appium-adb/compare/v9.12.2...v9.13.0) (2023-06-21)


### Features

* Add a helper to take screenshots ([#671](https://github.com/appium/appium-adb/issues/671)) ([30e61b5](https://github.com/appium/appium-adb/commit/30e61b554301b5232b69fe3336cc8ea864ddffb1))

## [9.12.2](https://github.com/appium/appium-adb/compare/v9.12.1...v9.12.2) (2023-06-21)


### Bug Fixes

* insert a missing await keyword ([#672](https://github.com/appium/appium-adb/issues/672)) ([63f8281](https://github.com/appium/appium-adb/commit/63f82817547d00014ee6feebaf0aae40c6cca401))

## [9.12.1](https://github.com/appium/appium-adb/compare/v9.12.0...v9.12.1) (2023-06-17)


### Miscellaneous Chores

* Bump @appium/types from 0.11.1 to 0.13.0 ([#670](https://github.com/appium/appium-adb/issues/670)) ([c09f359](https://github.com/appium/appium-adb/commit/c09f35957f7899667d3dff5e6642c32bea22d349))

## [9.12.0](https://github.com/appium/appium-adb/compare/v9.11.7...v9.12.0) (2023-06-14)


### Features

* export types ([#661](https://github.com/appium/appium-adb/issues/661)) ([269f3aa](https://github.com/appium/appium-adb/commit/269f3aae28dcb0a7627a780d2130f847bdf6889d))

## [9.11.7](https://github.com/appium/appium-adb/compare/v9.11.6...v9.11.7) (2023-06-11)


### Bug Fixes

* Streamline parameters validation for emulator commands ([#666](https://github.com/appium/appium-adb/issues/666)) ([70bdf96](https://github.com/appium/appium-adb/commit/70bdf96a5557a27fb2b035a9cc23fdb7a30db547))

## [9.11.6](https://github.com/appium/appium-adb/compare/v9.11.5...v9.11.6) (2023-06-07)


### Miscellaneous Chores

* Bump conventional-changelog-conventionalcommits ([#665](https://github.com/appium/appium-adb/issues/665)) ([dc89ea8](https://github.com/appium/appium-adb/commit/dc89ea82e777ae40fd7b0878f3bcdf2d10fcf642))

## [9.11.5](https://github.com/appium/appium-adb/compare/v9.11.4...v9.11.5) (2023-06-02)


### Bug Fixes

* Properly handle the situation where reboot_readiness check returns a non-zero exit code ([#660](https://github.com/appium/appium-adb/issues/660)) ([525a36b](https://github.com/appium/appium-adb/commit/525a36b34e212575b64a4181b702607045a43e22))

## [9.11.4](https://github.com/appium/appium-adb/compare/v9.11.3...v9.11.4) (2023-05-22)


### Miscellaneous Chores

* Perform boot readiness validation via reboot_readiness service on API 31+ ([#659](https://github.com/appium/appium-adb/issues/659)) ([c98fbcd](https://github.com/appium/appium-adb/commit/c98fbcd4a713296ab5e3a99f75f5cfa2233157cb))

## [9.11.3](https://github.com/appium/appium-adb/compare/v9.11.2...v9.11.3) (2023-05-18)


### Miscellaneous Chores

* Bump @appium/support from 3.1.11 to 4.0.0 ([#658](https://github.com/appium/appium-adb/issues/658)) ([1cc7515](https://github.com/appium/appium-adb/commit/1cc75158fa2771b6acadaaeaa34259f8da0dabb8))

## [9.11.2](https://github.com/appium/appium-adb/compare/v9.11.1...v9.11.2) (2023-04-29)


### Bug Fixes

* Update GPS toggle logic since Android 11 ([#655](https://github.com/appium/appium-adb/issues/655)) ([6251cf0](https://github.com/appium/appium-adb/commit/6251cf0548b7e4baec81122dddbf6e2bce3d7364))

## [9.11.1](https://github.com/appium/appium-adb/compare/v9.11.0...v9.11.1) (2023-04-18)


### Miscellaneous Chores

* Bump rimraf from 4.4.1 to 5.0.0 ([#644](https://github.com/appium/appium-adb/issues/644)) ([c47ad4d](https://github.com/appium/appium-adb/commit/c47ad4de460e77a813e064344edf697143687af5))

## [9.11.0](https://github.com/appium/appium-adb/compare/v9.10.24...v9.11.0) (2023-04-03)


### Features

* Add networking control commands supported on Android 11+ ([#641](https://github.com/appium/appium-adb/issues/641)) ([3dc4885](https://github.com/appium/appium-adb/commit/3dc48854cd554fabb2754e0de38f89f7e1dc3faf))

## [9.10.24](https://github.com/appium/appium-adb/compare/v9.10.23...v9.10.24) (2023-01-17)


### Miscellaneous Chores

* Bump semantic-release from 19.0.5 to 20.0.2 ([#632](https://github.com/appium/appium-adb/issues/632)) ([6b656bc](https://github.com/appium/appium-adb/commit/6b656bc4fc6751adcd9d7c63dacc179f0a982dbc))

## [9.10.23](https://github.com/appium/appium-adb/compare/v9.10.22...v9.10.23) (2023-01-14)


### Miscellaneous Chores

* Only fetch resource paths when they are requested ([#634](https://github.com/appium/appium-adb/issues/634)) ([64dabb1](https://github.com/appium/appium-adb/commit/64dabb18342cac388c50bbc43ed2c2514e7add68))

## [9.10.22](https://github.com/appium/appium-adb/compare/v9.10.21...v9.10.22) (2023-01-13)


### Miscellaneous Chores

* Bump rimraf from 3.0.2 to 4.0.4 ([#633](https://github.com/appium/appium-adb/issues/633)) ([2129c71](https://github.com/appium/appium-adb/commit/2129c7161a920f57af2ac3567c7967ccc8ba0658))

## [9.10.21](https://github.com/appium/appium-adb/compare/v9.10.20...v9.10.21) (2022-12-23)


### Miscellaneous Chores

* Remove redundant debug calls ([#631](https://github.com/appium/appium-adb/issues/631)) ([69931b1](https://github.com/appium/appium-adb/commit/69931b15122f743edc65a1770080216310de05fc))

## [9.10.20](https://github.com/appium/appium-adb/compare/v9.10.19...v9.10.20) (2022-12-22)


### Miscellaneous Chores

* Bump @appium/test-support from 2.0.2 to 3.0.1 ([#630](https://github.com/appium/appium-adb/issues/630)) ([b5d96b4](https://github.com/appium/appium-adb/commit/b5d96b4a5e2599b64ca542772ed7453f6f682e81))

## [9.10.19](https://github.com/appium/appium-adb/compare/v9.10.18...v9.10.19) (2022-12-14)


### Miscellaneous Chores

* Bump @appium/support from 2.61.1 to 3.0.0 ([#628](https://github.com/appium/appium-adb/issues/628)) ([8a11356](https://github.com/appium/appium-adb/commit/8a113560cf9cfaeb0e51880713c7ba6cf4240036))

## [9.10.18](https://github.com/appium/appium-adb/compare/v9.10.17...v9.10.18) (2022-12-01)


### Miscellaneous Chores

* update releaserc ([#627](https://github.com/appium/appium-adb/issues/627)) ([70bdfce](https://github.com/appium/appium-adb/commit/70bdfce2602c09aa6ef0549a1aa7f361e8320185))

## [9.10.17](https://github.com/appium/appium-adb/compare/v9.10.16...v9.10.17) (2022-11-29)

## [9.10.16](https://github.com/appium/appium-adb/compare/v9.10.15...v9.10.16) (2022-11-06)

## [9.10.15](https://github.com/appium/appium-adb/compare/v9.10.14...v9.10.15) (2022-11-06)
