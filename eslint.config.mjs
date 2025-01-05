import appiumConfig from '@appium/eslint-config-appium-ts';

export default [
  ...appiumConfig,
  {
    ignores: [
      'keys/**',
    ],
  },
];
