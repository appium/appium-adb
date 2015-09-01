import _mv from 'mv';
import _mkdirp from 'mkdirp';
import B from 'bluebird';
import _rimraf from 'rimraf';
import _ncp from 'ncp';
import _fs from 'fs';
import path from 'path';

const mkdirp = B.promisify(_mkdirp),
      mv = B.promisify(_mv),
      rimraf = B.promisify(_rimraf),
      ncp = B.promisify(_ncp),
      fs = {
        lstat: B.promisify(_fs.lstat),
        readdir: B.promisify(_fs.readdir),
        writeFile: B.promisify(_fs.writeFile),
        readFile: B.promisify(_fs.readFile)
      },
      rootDir = path.resolve(__dirname, process.env.NO_PRECOMPILE ? '..' : '../..'),
      androidPlatforms = ['android-4.2', 'android-17', 'android-4.3', 'android-18',
                          'android-4.4', 'android-19', 'android-L', 'android-20',
                          'android-5.0', 'android-21', 'android-22', 'android-MNC',
                          'android-23', 'android-6.0'];

export { mkdirp, mv, rimraf, ncp, fs , rootDir, androidPlatforms };
