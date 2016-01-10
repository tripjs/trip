/* global describe, it, before, after */

import 'source-map-support/register';
import Promise from 'bluebird';
import trip from '../lib/index';
import wrench from 'wrench';
import path from 'path';
import rimraf from 'rimraf';
import mkdirp from 'mkdirp';
import sander from 'sander';

const projectRoot = path.resolve(__dirname, '..', '..');
const tmp = path.resolve(projectRoot, 'tmp');
const fixtures = path.resolve(projectRoot, 'fixtures');

const fixturesSrc = path.resolve(fixtures, 'src');
const tmpSrc = path.resolve(tmp, 'src');
const tmpDest = path.resolve(tmp, 'dest');

describe('trip() API', () => {
  before(() => {
    rimraf.sync(tmp);
    mkdirp.sync(tmp);
    wrench.copyDirSyncRecursive(fixturesSrc, tmpSrc);
  });

  const app = trip()
    .via(function foop(files) {
      for (const [file, contents] of files.entries()) {
        if (file.endsWith('.js')) {
          files = files.merge({
            [file]: contents + '\n\n//FUCK\n',
            [file + '.foo']: ':)',
          });
        }
      }

      return files;
    })
    .via(
      trip()
        .via(files => files.map((contents, file) => {
          if (file.endsWith('.js')) return contents + 'more';
          return contents;
        }))
    );

  it('works', function () {
    this.timeout(20000);

    return Promise.resolve()
      .then(() => app.build(tmpSrc + '/**', tmpDest, {
        cwd: projectRoot,
        watch: true,
        serve: true,
        browserSync: true,
      }))
      .then(() => Promise.delay(1000))
      // todo: verify served page
      .then(() => sander.writeFile(path.resolve(tmpSrc, 'index.html'), '<body>NEW!</body>'))
      .then(() => Promise.delay(500))
      // todo verify it again
    ;
  });

  after(() => {
    app.stop();
  });
});
