"use strict";

var gulp = require('gulp'),
    boilerplate = require('appium-gulp-plugins').boilerplate.use(gulp),
    _ = require('lodash'),
    DEFAULTS = require('appium-gulp-plugins').boilerplate.DEFAULTS,
    argv = require('yargs').argv;

boilerplate({
  build: 'appium-adb',
  jscs: false,
  e2eTest: _.defaults({
    android: argv.emu,
    avd: argv.avd
  }, DEFAULTS.e2eTest)
});
