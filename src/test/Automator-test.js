/* global describe, it, before */

import 'source-map-support/register';
import Promise from 'bluebird';
import Automator from '../lib/Automator';
import assert from 'assert';
import wrench from 'wrench';
import path from 'path';
import rimraf from 'rimraf';
import mkdirp from 'mkdirp';
import fs from 'fs';

const tmp = path.resolve(__dirname, '..', '..', 'tmp');
const fixtures = path.resolve(__dirname, '..', '..', 'fixtures');

const fixturesSrc = path.resolve(fixtures, 'src');
const tmpSrc = path.resolve(tmp, 'src');
const tmpDest = path.resolve(tmp, 'dest');

describe('Automator class', () => {
  before(() => {
    rimraf.sync(tmp);
    mkdirp.sync(tmp);
    wrench.copyDirSyncRecursive(fixturesSrc, tmpSrc);
  });

  const controller = new Automator({
    cwd: tmp,
    src: tmpSrc,
    dest: tmpDest,
    waypoints: [
      function addTrailingCommentToJS(files) {
        return files.map((contents, file) => {
          if (file.endsWith('.js')) return contents + '\n\n// trailing comment!\n';
          return contents;
        });
      },
    ],
  });

  it('works', () => {
    return Promise.resolve()
      .then(() => controller.start())
      .then(() => {
        const jsContents = fs.readFileSync(path.resolve(tmpDest, 'main.js'), 'utf8');
        const htmlContents = fs.readFileSync(path.resolve(tmpDest, 'index.html'), 'utf8');

        assert(jsContents.endsWith('\n\n// trailing comment!\n'));
        assert(htmlContents);
      });
  });
});
