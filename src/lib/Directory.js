/**
 * Directory
 *
 * Represents a directory on disk. Has a `prime()` method that loads the real
 * files from disk into an immutable map of files.
 *
 * Not instantiated directly; used as an abstract base class for Source and
 * Destination.
 */

import Immutable from 'immutable';
import path from 'path';
import prettyBytes from 'pretty-bytes';
import Promise from 'bluebird';
import sander from 'sander';
import micromatch from 'micromatch';
import {EventEmitter2} from 'eventemitter2';

const privates = new WeakMap();

function loadDirectory(baseDir, filter, limit = Infinity) {
  const files = {};
  let size = 0;

  const load = dir => Promise.each(sander.readdir(dir), async function (file) {
    file = path.resolve(dir, file);
    const fileFromBase = path.relative(baseDir, file);

    const stat = await sander.lstat(file);

    if (stat.isFile()) {
      if (filter && !micromatch.isMatch(fileFromBase, filter)) return;

      const contents = await sander.readFile(file);
      size += contents.length;
      if (size > limit) {
        throw new Error(`Contents of directory exceeded ${prettyBytes(limit)} limit: ${baseDir}`);
      }
      files[fileFromBase] = contents;
    }
    else if (stat.isDirectory()) await load(file);
    else throw new Error('Not a file or directory: ' + file);
  });

  return load(baseDir).then(() => ({files, size}));
}

export default class Directory extends EventEmitter2 {
  constructor({priv}) {
    super();

    privates.set(this, priv);
  }

  /**
   * Recursively loads the directory's contents into memory.
   */
  prime() {
    const priv = privates.get(this);

    if (!priv.primePromise) {
      priv.primePromise = loadDirectory(priv.dir, priv.filter, priv.limit)
        .catch(error => {
          if (error.code !== 'ENOENT' || error.path !== priv.dir) throw error;
          // the dir doesn't exist - create it
          return sander.mkdir(priv.dir)
            .then(() => ({files: {}, size: 0}));
        })
        .then(({files, size}) => {
          priv.files = Immutable.Map(files);
          priv.size = size;
        });
    }

    return priv.primePromise;
  }

  /**
   * Allows anyone to read the files map.
   */
  get files() {
    return privates.get(this).files;
  }

  /**
   * Disallows setting `.files` from outside.
   */
  set files(value) { // eslint-disable-line no-unused-vars
    throw new Error(`Cannot set files property from outside.`);
  }
}
