"use strict";

var gulp = require('gulp'),
    boilerplate = require('appium-gulp-plugins').boilerplate.use(gulp),
    _ = require('lodash'),
    DEFAULTS = require('appium-gulp-plugins').boilerplate.DEFAULTS;

boilerplate({
  build: 'appium-adb',
  jscs: false,
  e2eTest: { android: true }
});
