/**
 * Destination
 *
 * Extends Directory class with an `update()` method for replacing the in-memory
 * map of files. When the files map is replaced, any differences are written out
 * to the real directory on disk. As an aside, whenever the deletion of a file
 * results in an empty directory, that directory is deleted too.
 */

import Change from './Change';
import Directory from './Directory';
import Immutable from 'immutable';
import path from 'path';
import Promise, {coroutine} from 'bluebird';
import sander from 'sander';
import subdir from 'subdir';
import trash from 'trash';

const privates = new WeakMap();

export default class Destination extends Directory {
  constructor({dir}) {
    const priv = {dir};

    super({priv});

    privates.set(this, priv);
  }
}

// Add 'async' methods - workaround until https://phabricator.babeljs.io/T2765 is fixed
{
  /**
   * Destination#update()
   *
   * Updates the files object, and returns details of any changes.
   */
  Object.defineProperty(Destination.prototype, 'update', {value: coroutine(function *_update(newFiles, safeDelete) {
    // ensure the in-memory cache has already been primed
    yield this.prime();

    console.assert(Immutable.Map.isMap(newFiles));

    const priv = privates.get(this);

    // return quickly if no change
    const oldFiles = priv.files;
    if (oldFiles && oldFiles.equals(newFiles)) return [];

    // update now to the new files object
    priv.files = newFiles;

    // write any changes to disk...
    const [writes, deletions] = yield Promise.all([
      // write newly created/modified files to disk
      Promise.map(newFiles.entries(), ([file, contents]) => {
        const oldContents = oldFiles.get(file);

        if (!oldContents || !contents.equals(oldContents)) {
          return sander.writeFile(priv.dir, file, contents)
            .then(() => new Change({file, contents, oldContents}));
        }
      }).filter(x => x),

      // for any files from the old map that are not present in the new, delete them on disk
      Promise.map(oldFiles.entries(), ([file, oldContents]) => {
        if (!newFiles.has(file)) {
          return (
            safeDelete ?
              trash([path.join(priv.dir, file)]) :
              sander.unlink(priv.dir, file)
          ).then(() => new Change({file, contents: null, oldContents}));
        }
      }).filter(x => x),
    ]);

    // delete any directories that are now empty due to deleted files
    for (const {file} of deletions) {
      yield deleteEmptyParents(path.resolve(priv.dir, file), priv.dir);
    }

    return [...writes, ...deletions];
  })});
}

function deleteEmptyParents(file, until) {
  return Promise.resolve().then(() => {
    if (until === file || !subdir(until, file)) return null;

    file = path.dirname(file);

    return sander.rmdir(file)
      .then(() => deleteEmptyParents(file, until))
      .catch(error => {
        if (error.code !== 'ENOTEMPTY') throw error;
      });
  });
}
