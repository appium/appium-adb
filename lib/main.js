'use strict';

var path = require('path'),
    _ = require('underscore');

jars = {};

var jars = _(['dump2json.jar', 'move_manifest.jar', 'sign.jar', 'strings_from_apk.jar', 'unsign.jar',
  'verify.jar']).each(function (jarName) {
    jars[jarName] = path.resolve(__dirname, '..', 'helpers', jarName);
  });

module.exports = {
  logger: require('./logger'),
  ADB: require('./adb'),
  jars: jars
};
