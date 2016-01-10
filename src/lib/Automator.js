/**
 * Automator class
 *
 * Manages a build (optionally watch-driven) from one src -> dest.
 */

import _ from 'lodash';
import chalk from 'chalk';
import CodeError from 'code-error';
import Destination from './Destination';
import Immutable from 'immutable';
import indentString from 'indent-string';
import path from 'path';
import Promise, {coroutine} from 'bluebird';
import Result from './Result';
import Source from './Source';
import subdir from 'subdir';
import {EventEmitter2} from 'eventemitter2';
import {isString, isFunction, isBoolean, isNumber} from 'lodash';

const privates = new WeakMap();

/**
 * build()
 *
 * Private async method that performs a single [re]build, passing the source
 * files through the waypoints and syncing the final output to disk.
 */
async function build(priv, safeDelete) {
  if (priv.building) throw new Error('Cannot do concurrent builds!');
  priv.building = true;

  const {source, destination, waypoints, buildContext, cwd} = priv;

  const startTime = process.hrtime();

  const steps = [];
  const initialInput = source.files;
  let finalOutput;

  // run the sequence of waypoints
  {
    let input = initialInput;
    let output = input;

    for (let i = 0, l = waypoints.length; i < l; i++) {
      const waypoint = waypoints[i];

      try {
        output = await Promise.resolve(waypoint.call(buildContext, input));

        // validate output
        console.assert(Immutable.Map.isMap(output), 'output must be a an Immutable Map');

        // normalise the output, if it's changed
        if (output !== input) {
          // resolve any promises for contents
          output = Immutable.Map(await Promise.props(output.toObject()));

          // ensure all contents are buffers
          output = output.map((contents, file) => {
            if (!Buffer.isBuffer(contents)) {
              if (!isString(contents)) {
                throw new TypeError(
                  `Waypoint #${i} return value is of invalid type: ${contents}`
                );
              }

              contents = new Buffer(contents);
            }

            // prefer the existing buffer if the new one is identical
            const oldContents = input.get(file);
            if (oldContents && oldContents.equals(contents)) return oldContents;

            return contents;
          });
        }

        // record the input and output of this step
        steps[i] = {input, output};

        // use output as input for next waypoint, if any
        input = output;
      }
      catch (error) {
        // report the error here if it's an easy one
        console.error(`\n  error from ${waypoint._waypointName}\n`);

        if (error instanceof CodeError) {
          console.error(indentString(chalk.red(error.message), ' ', 2));

          console.error('');
          if (error.file) {
            console.error(indentString(path.relative(cwd, error.file) + chalk.grey(error.suffix), ' ', 2));
          }

          console.error(indentString(error.ansiExcerpt, ' ', 2));
          console.error('');
        }
        else if (error && error.stack) {
          console.error(error.stack);
        }
        else console.error(error);

        priv.building = false;
        throw error;
      }
    }

    finalOutput = output;
  }

  // put the output in the destination (it will sync any changes to disk, then
  // return details of those changes)
  const changes = await destination.update(finalOutput, safeDelete);

  // finish up
  const duration = process.hrtime(startTime);

  priv.building = false;

  return Object.assign(Object.create(Result), {
    changes, duration, steps,
    input: initialInput,
    output: finalOutput,
    srcSize: source.size,
    destSize: destination.size,
    id: priv.buildCount++,
  });
}

export default class Automator extends EventEmitter2 {
  constructor({
    cwd = process.cwd(), src: srcDir, dest: destDir, srcFilter,
    waypoints = [], watch = false, limit = 100000000,
  }) {
    // validate/normalise args
    {
      if (!isString(cwd)) throw new TypeError('cwd must be a string');
      cwd = path.resolve(cwd);

      if (!isString(srcDir)) throw new TypeError('src must be a string');
      srcDir = path.resolve(cwd, srcDir);
      if (!subdir(cwd, srcDir)) throw new Error('src cannot be outside the CWD');

      if (!isString(destDir)) throw new TypeError('dest must be a string');
      destDir = path.resolve(cwd, destDir);
      if (!subdir(cwd, destDir)) throw new Error('dest cannot be outside the CWD');

      if (destDir === srcDir || subdir(srcDir, destDir)) throw new Error('dest must be outside the src directory');

      if (!waypoints.every(isFunction)) throw new TypeError('waypoints must all be functions');

      if (!isBoolean(watch)) throw new TypeError('option "watch" must be boolean if set');

      if (!isNumber(limit)) throw new TypeError(`option "limit" must be a number if set`);
    }

    super();

    const priv = {
      waypoints, cwd, srcDir, destDir, watch,
      source: new Source({dir: srcDir, filter: srcFilter, limit, watch}),
      destination: new Destination({dir: destDir}),
      buildCount: 0,

      // object to be used as `this` for waypoint functions
      buildContext: Object.defineProperties({}, {
        src: {value: srcDir},
        dest: {value: destDir},
      }),
    };

    privates.set(this, priv);
  }

  /**
   * Stops disk-watching.
   */
  stop() {
    const {watch, source} = privates.get(this);
    if (watch) source.stop();
  }
}

// add 'async' methods from outside - workaround for https://phabricator.babeljs.io/T2765
{
  /**
   * Automator#start()
   *
   * Starts the automator, and asynchronously returns the results of the first build.
   */
  Object.defineProperty(Automator.prototype, 'start', {
    value: coroutine(function *_start() {
      const priv = privates.get(this);
      const {source, destination, watch} = priv;

      // wait for the source to be primed
      yield source.prime();

      // run the first build
      this.emit('build-starting', {input: source.files, triggers: null});
      const firstBuild = build.call(this, priv, true);

      // prime the dest now while the first build is running
      yield destination.prime();

      // start getting the watcher ready, if configured
      if (watch) source.watch();

      // wait for the first build to be done
      let firstResult;
      try {
        firstResult = yield firstBuild;
        this.emit('build-complete', firstResult);
      }
      catch (error) {
        this.emit('build-failed', error);

        // failed initial build in watch mode should not reject; should instead
        // fulfill with the error
        if (watch) firstResult = error;
        else throw error;
      }

      // set up watching for further batches
      if (watch) {
        // wait for the watcher to be ready
        yield source.watch();

        // whenever a file is updated, do another build (debounced, so multiple
        // changes in very quick succession can be handled in one go e.g. due
        // to a rename or pasting a bunch of files)
        {
          let building = Promise.resolve();
          let triggers = {};

          const handleUpdate = _.debounce(() => {
            // wait for any existing build to finish before starting the next
            building = building.then(() => {
              this.emit('build-starting', {input: source.files, triggers});
              triggers = {};

              return build.call(this, priv)
                /* eslint-disable max-nested-callbacks */
                .then(result => {
                  this.emit('build-complete', result);
                })
                .catch(error => {
                  this.emit('build-failed', error);

                  // NB. swallowing error here is important
                })
                /* eslint-enable max-nested-callbacks */
              ;
            });
          }, 10);

          source.on('updated', (type, file) => {
            triggers[file] = type;
            handleUpdate();
          });
        }
      }

      return firstResult;
    }),
  });
}
