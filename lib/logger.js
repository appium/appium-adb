'use strict';

var logger = require('winston'),
    _ = require('underscore');

var loggerWrap = {
  init:  function (_logger) {
    logger = _logger;
  },
};

_(['info','debug','warn','error']).each(function (level) {
  loggerWrap[level] = function () {
    var args = Array.prototype.slice.call(arguments, 0);
    logger[level].apply(logger, args);
  };
});

module.exports = loggerWrap;