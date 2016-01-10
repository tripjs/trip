/**
 * Source
 *
 * Extends Directory class, adding filesystem watching. Responds to changes on
 * disk by updating the in-memory files map and emitting 'updated' events.
 */

import Directory from './Directory';
import path from 'path';
import prettyBytes from 'pretty-bytes';
import Promise from 'bluebird';
import sander from 'sander';
import sane from 'sane';
import _ from 'lodash';
import {red} from 'chalk';

const privates = new WeakMap();

export default class Source extends Directory {
  constructor({dir, filter, watch, limit}) {
    const priv = {
      dir, filter, watch, limit,
      size: 0,
      filesLastTouched: {},
    };

    super({priv});

    privates.set(this, priv);
  }

  watch() {
    const priv = privates.get(this);

    console.assert(priv.watch);

    if (!priv.watchPromise) {
      priv.watchPromise = new Promise((resolve, reject) => {
        priv.watcher = sane(priv.dir, {
          watchman: false,
          poll: false,
          dot: true,
          glob: priv.filter,
        });

        const source = this;

        for (const eventType of ['change', 'add', 'delete']) {
          priv.watcher.on(eventType, async function (file, root, stat) {
            console.assert(!path.isAbsolute(file));

            if (!stat) {
              // the file on disk has been deleted.
              console.assert(eventType === 'delete');

              const newFiles = priv.files.remove(file);

              // if this file exists in the cache, remove it and reduce the byte count
              if (!priv.files.equals(newFiles)) {
                const contents = priv.files.get(file);

                priv.size -= contents.length;

                priv.files = newFiles;
              }

              delete priv.filesLastTouched[file];

              // emit an updated event, even if the files didn't actually change
              // (so user may trigger a build just by touching a file)
              source.emit('updated', eventType, file);
            }

            else if (stat.isFile()) {
              // the file on disk has been modified or created.
              console.assert(
                eventType === 'change' || eventType === 'add',
                `unexpected type: ${eventType}`
              );

              let contents;
              try {
                contents = await sander.readFile(priv.dir, file);
              }
              catch (error) {
                // tolerate a file having gone missing since we stat'd it (could be a quick rename)
                if (error.code === 'ENOENT') {
                  priv.files = priv.files.remove(file);
                  source.emit('updated', eventType, file);
                }
                else {
                  // we could not read the file because of permissions or some other issue.
                  console.error(red(`\ntrip: watcher cannot read file:`) + ` ${file}\n${error.stack}\n`);
                  source.emit('error', error);
                }

                return;
              }

              // see when this file was last touched (and update our record for next time)
              let timeSinceLastTouch = 0;
              {
                const now = Date.now();
                if (priv.filesLastTouched[file]) timeSinceLastTouch = now - priv.filesLastTouched[file];
                priv.filesLastTouched[file] = now;
              }

              // see if the contents have actually changed...
              const oldContents = priv.files.get(file);
              let changed = false;
              if (!oldContents || !contents.equals(oldContents)) {
                changed = true;

                // update the byte count
                if (oldContents) priv.size -= oldContents.length;
                priv.size += contents.length;
                console.assert(_.isNumber(priv.size), 'debugging');

                // check it's not taken us over the memory limit
                if (priv.size > priv.limit) {
                  throw new Error(
                    `Reading this file took the source directory cache over the ${prettyBytes(priv.limit)} limit: ${path}`
                  );
                }

                // update to the new files
                priv.files = priv.files.set(file, contents);
              }

              // skip emitting if it's a quick re-touch with no changes - effectively debounces quick repeat saves to the file if the contents aren't changing, to solve the problem of some editors (ST3?)
              if (changed || timeSinceLastTouch > 250) source.emit('updated', eventType, file);
            }
          });
        }

        priv.watcher.on('ready', () => resolve());
        priv.watcher.on('error', reject);
      });
    }

    return priv.watchPromise;
  }

  stop() {
    const {watcher} = privates.get(this);
    if (watcher) watcher.close();
  }
}
