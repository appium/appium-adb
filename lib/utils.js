import _mv from 'mv';
import _mkdirp from 'mkdirp';
import B from 'bluebird';
import _rimraf from 'rimraf';
import _ncp from 'ncp';
import _fs from 'fs';

const mkdirp = B.promisify(_mkdirp),
      mv = B.promisify(_mv),
      rimraf = B.promisify(_rimraf),
      ncp = B.promisify(_ncp),
      fs = {
        lstat: B.promisify(_fs.lstat),
        readdir: B.promisify(_fs.readdir),
        writeFile: B.promisify(_fs.writeFile)
      };

export { mkdirp, mv, rimraf, ncp, fs };
