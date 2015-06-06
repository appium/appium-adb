import _mv from 'mv';
import _mkdirp from 'mkdirp';
import B from 'bluebird';
import _rimraf from 'rimraf';
import _ncp from 'ncp';

const mkdirp = B.promisify(_mkdirp),
      mv = B.promisify(_mv),
      rimraf = B.promisify(_rimraf),
      ncp = B.promisify(_ncp);

export { mkdirp, mv, rimraf, ncp };
