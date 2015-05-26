import fs from 'fs';
import path from 'path';
//import AdmZip from 'adm-zip';
import os from 'os';
import _ from 'lodash';
import { exec } from 'teen_process';
//import { vargs as Args } from 'vargs';
//let exec = require('child_process').exec;
let isWindows = (os.type() === 'Windows_NT');

async function getDirectories (rootPath) {
  let files = fs.readdirSync(rootPath);
  let dirs = [];
  _.each(files, (file) => {
      let pathString = path.resolve(rootPath, file);
      if (fs.lstatSync(pathString).isDirectory()) dirs.push(file);
  });
  // It is not a clean way to sort it, but in this case would work fine because we have numerics and alphanumeric
  // will return some thing like this ["17.0.0", "18.0.1", "19.0.0", "19.0.1", "19.1.0", "20.0.0", "android-4.2.2", "android-4.3", "android-4.4"]
  return dirs.sort();
}

function wrapForExec (s) {
  // not a string
  if (typeof s !== 'string') return s;
  // already wrapped
  if (s.match(/^['"].*['"]$/)) return s;
  // wrap if necessary;
  if (s.match(/[\s"]/)) {
    // escape quote
    s = s.replace(/"/g, '\\"');
    return '"' + s + '"';
  }
  return s;
}

async function prettyExec (/*cmd, args, opts, cb*/...vargs) {
  let cmdOpts = vargs[2] || {};
  delete cmdOpts.wrapArgs;
  if (_.isEmpty(cmdOpts)) cmdOpts = undefined;
  let cmd = wrapForExec(vargs[0]);
  return await exec(cmd, vargs[1], cmdOpts);
}

export { isWindows, getDirectories, prettyExec };
