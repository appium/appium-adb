'use strict';

const gulp = require('gulp');
const boilerplate = require('@appium/gulp-plugins').boilerplate.use(gulp);

boilerplate({
  build: 'appium-adb',
  files: ['index.js', 'lib/**/*.js', 'test/**/*.js', '!gulpfile.js'],
  e2eTest: {
    android: true,
  },
  eslint: true,
});
