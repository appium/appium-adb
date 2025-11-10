const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const originalResolveFilename = Module._resolveFilename;

// Custom module resolver that maps lib/ imports to build/lib/
Module._resolveFilename = function (request, parent, isMain, options) {
  // Check if the request is for a file in lib/
  // Handle both absolute paths and relative paths like '../../lib/...'
  const libMatch = request.match(/(?:^|.*\/)lib\/(.+)$/);
  if (libMatch) {
    const libFile = libMatch[1];
    // Remove .js extension if present, or use as-is
    const prefix = libFile.replace(/\.js$/, '');

    // Try to resolve from build/lib/ first
    const buildPath = path.resolve(__dirname, 'build', 'lib', `${prefix}.js`);
    if (fs.existsSync(buildPath)) {
      request = buildPath;
    }
    // If build file doesn't exist, fall through to original resolution
    // which will use ts-node to handle .ts files
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

module.exports = {
  require: ['ts-node/register'],
  forbidOnly: Boolean(process.env.CI),
  color: true
};
