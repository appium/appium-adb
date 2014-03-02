'use strict';

var logger = require('winston');

module.exports = {
  init:  function (logger) {
    logger = logger;
  },
  get: function () {
    return logger;
  }
};
