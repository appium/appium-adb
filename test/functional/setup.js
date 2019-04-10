// https://developer.android.com/guide/topics/manifest/uses-sdk-element.html
const API_LEVEL_MAP = {
  4.1: '16',
  4.2: '17',
  4.3: '18',
  4.4: '19',
  5: '21',
  5.1: '22',
  6: '23',
  7: '24',
  7.1: '25',
  8.0: '26',
  8.1: '27',
  9: '28',
};

const avdName = process.env.ANDROID_AVD || 'NEXUS_S_18_X86';
const platformVersion = process.env.PLATFORM_VERSION || 4.3;

let apiLevel = process.env.API_LEVEL ||
               API_LEVEL_MAP[parseFloat(platformVersion)];
apiLevel = parseInt(apiLevel, 10);

const MOCHA_TIMEOUT = process.env.TRAVIS ? 240000 : 60000;
const MOCHA_LONG_TIMEOUT = MOCHA_TIMEOUT * 10;

export { apiLevel, platformVersion, avdName, MOCHA_TIMEOUT, MOCHA_LONG_TIMEOUT };
