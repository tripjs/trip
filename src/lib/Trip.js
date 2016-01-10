/**
 * Trip class
 *
 * This class is a wrapper around Automator and provides:
 *
 * - friendlier API
 * - dev server
 * - browser sync server
 * - reporting build results to stdout
 */

import Automator from './Automator';
import browserSync from 'browser-sync';
import connect from 'connect';
import errorSymbol from 'error-symbol';
import getBSSnippet from './getBSSnippet';
import getErrorSnippet from './getErrorSnippet';
import http from 'http';
import isGlob from 'is-glob';
import isValidGlob from 'is-valid-glob';
import opn from 'opn';
import path from 'path';
import portscannerPlus from 'portscanner-plus';
import prettyHRTime from 'pretty-hrtime';
import Promise from 'bluebird';
import resolveFrom from 'resolve-from';
import serveStatic from 'serve-static';
import stackTrace from 'stack-trace';
import staticTransform from 'connect-static-transform';
import successSymbol from 'success-symbol';
import url from 'url';
import {EventEmitter2} from 'eventemitter2';
import {isString, isFunction, isArray, isBoolean, isNumber} from 'lodash';
import {red, cyan, white, grey, underline} from 'chalk';

const {coroutine, promisify} = Promise;

const validPluginName = /^[a-z]([a-z]|(-(?!-)))+[a-z]$/; // http://refiddle.com/hfy

const privates = new WeakMap();


const buildDefaults = {
  watch: false,
  serve: false,
  browserSync: false, // just modifies the server, really
  open: false,
  verbose: false,
  autoLoaders: true,
  loadPaths: null,
};

const watchDefaults = {
  watch: true,
  serve: true,
  browserSync: true,
  open: true,
};

export class Trip extends EventEmitter2 {
  constructor() {
    super();

    privates.set(this, {viaCalls: []});
  }

  via(...args) {
    const {viaCalls} = privates.get(this);
    // store details of this call, including a stack in case we need it
    viaCalls.push({args, callSite: stackTrace.get()[1]});
    return this;
  }

  *[Symbol.iterator]() {
    const {viaCalls, cwd} = privates.get(this);

    for (const {args, callSite} of viaCalls) {
      try {
        const first = args[0];

        // option 1: a plugin specified by name: `.via('foo', ...)`
        if (isString(first)) {
          // check it's a valid plugin name
          if (!validPluginName.test(first)) {
            throw new Error(`trip: Invalid plugin name ${JSON.stringify(first)}`);
          }

          // resolve to a real path
          const moduleName = `trip-${first}`;
          const modulePath = resolveFrom(callSite.getFileName(), moduleName);

          // if it's not installed, just note this for reporting later
          if (!modulePath) {
            yield {missing: moduleName, callSite};
            continue;
          }

          // load the plugin and verify it's a function
          let plugin = require(modulePath); // eslint-disable-line global-require
          if (plugin && plugin.__esModule) plugin = plugin.default;
          if (!isFunction(plugin)) throw new Error(`The module ${moduleName} did not export a function.`);

          // apply the via call arguments to the plugin, and yield the resulting config(s)
          let fns = plugin.apply(null, args.slice(1));
          if (isArray(fns)) {
            for (let i = 0, l = fns.length; i < l; i++) {
              const fn = fns[i];
              if (!isFunction(fn)) {
                throw new Error(`The module ${moduleName} did not return a function when configured`);
              }

              Object.defineProperty(fn, '_waypointName', {value: `${moduleName} #${i}`});
              yield fn;
            }
          }
          else {
            Object.defineProperty(fns, '_waypointName', {value: moduleName});
            if (!isFunction(fns)) throw new Error(`The module ${moduleName} did not return a function when configured`);
            yield fns;
          }

          continue;
        }

        // option 2: an iterable (e.g. another trip instance, or an array)
        if (first[Symbol.iterator]) {
          yield* first;
          continue;
        }

        // option 3: just a function
        if (isFunction(first)) {
          Object.defineProperty(first, '_waypointName', {value: first.name || '[anonymous waypoint]'});
          yield first;
          continue;
        }
      }
      catch (error) {
        // print the call site prettily (TODO: use ansi-error-excerpt or something)
        console.error(
          red(`Bad .via() call at `) +
          path.relative(cwd, callSite.getFileName()) + grey(':') +
          callSite.getLineNumber() + grey(':') +
          callSite.getColumnNumber()
        );

        throw error;
      }
    }
  }

  /**
   * Closes anything that's keeping the process open.
   */
  stop() {
    const priv = privates.get(this);

    if (priv.server) priv.server.close();
    if (priv.bsAPI) priv.bsAPI.exit();

    if (priv.automator) priv.automator.stop();
  }
}

// Add fake async methods - workaround for https://phabricator.babeljs.io/T2765
{
  /**
   * Trip#build()
   *
   * Starts up the trip, buildilng from A to B.
   */
  Object.defineProperty(Trip.prototype, 'build', {value: coroutine(function *_build(srcGlob, dest, useWatchDefaults, options) {
    const priv = privates.get(this);

    // validate args
    {
      if (!isString(srcGlob) || !isValidGlob(srcGlob)) throw new Error(`Not a valid glob: ${srcGlob}`);
      if (!isString(dest)) throw new Error(`Not a valid destination: ${dest}`);
    }

    // prevent multiple invocations
    if (priv.busy) throw new Error('trip already running');
    priv.busy = true;

    // juggle args
    if (useWatchDefaults && !isBoolean(useWatchDefaults)) {
      options = useWatchDefaults;
      useWatchDefaults = false;
    }

    // process args
    options = Object.assign({}, buildDefaults, useWatchDefaults ? watchDefaults : null, options);
    if (!options.serve) options.open = false;

    const cwd = options.cwd || process.cwd();

    dest = path.resolve(cwd, dest);

    // break up the srcGlob into the base and the magic part - e.g. "src/**" becomes "src" and "**"
    const [src, srcFilter] = (() => {
      const parts = srcGlob.split('/');

      for (let i = parts.length - 1; i >= 0; i--) {
        if (!isGlob(parts[i])) {
          return [
            path.resolve(cwd, parts.slice(0, i + 1).join(path.sep)), // real path
            parts.slice(i + 1).join('/'), // glob
          ];
        }
      }

      throw new Error(`Invalid glob ${srcGlob}`);
    })();

    console.assert(path.isAbsolute(src), 'src should be absolute at this point');
    console.assert(isGlob(srcFilter), 'src should be some kind of glob');

    priv.cwd = cwd;

    const srcRelative = path.relative(cwd, src);
    const destRelative = path.relative(cwd, dest);

    // get a flattened, resolved array of waypoints for this trip
    const waypoints = [...this];

    // if any modules were missing, exit with a helpful message
    {
      const missingDeps = waypoints.filter(w => w && w.missing).map(w => w.missing);
      const numMissing = missingDeps.length;
      if (numMissing) {
        if (numMissing > 1) {
          console.log(red(`Couldn't load ${numMissing} plugins.`));
          console.log(`If they're published on npm, you can install them:`);
          console.log([`  npm install --save-dev`, ...missingDeps].join(` \\\n    `));
        }
        else {
          const moduleName = missingDeps[0];

          console.log(red(`Couldn't load plugin: ${white(moduleName)}`));
          console.log(`If it's published on npm, you can install it:`);
          console.log(cyan(`  npm install --save-dev ${moduleName}\n`));
        }

        process.exit(1);
      }
    }

    // get ports to use for connect server and/or browserSync server (if options set for that)
    const portsReady = (options.browserSync || options.serve) ? (() => {
      const names = [];
      if (options.serve) names.push('server');
      if (options.browserSync) names.push('browserSync', 'bsUI', 'weinre');

      return Promise.resolve(portscannerPlus.getPorts(names.length, 8000, 9000, names))
        .timeout(3000, 'Timed out scanning for free ports');
    })() : Promise.resolve();

    // get a browser-sync server going (if enabled)
    const browserSyncReady = options.browserSync ? portsReady.then(ports => {
      console.assert(isNumber(ports.browserSync));

      const bs = browserSync.create(); // eslint-disable-line global-require

      const bsOptions = {
        logLevel: 'silent',
        port: ports.browserSync,
        ui: {
          port: ports.bsUI,
          weinre: {port: ports.weinre},
        },
      };

      return promisify(bs.init).call(bs, bsOptions)
        .timeout(12000, 'Timed out initialising BrowserSync server')
        .return(bs);
    }) : Promise.resolve();

    // and get a connect server going for the destDir (if enabled)
    const serverReady = options.serve ? Promise.all([portsReady, browserSyncReady])
      .then(([ports]) => {
        console.assert(isNumber(ports.server));

        const app = connect();

        // add middleware to inject browser-sync snippet if appropriate
        const bsSnippet = options.browserSync ? getBSSnippet(ports.browserSync) : '';

        // add middleware to hack HTML responses
        app.use(staticTransform({
          root: src,

          // the middleware expects a regex, but we can use a duck object
          match: {
            test(str) {
              const {pathname} = url.parse(str);
              const basename = pathname.split('/').pop();
              return basename === '' || basename.substr(-5) === '.html';
            },
          },

          // convert a request path to a system path
          // e.g. /foo/bar.html?asdf -> \foo\bar.html (for win32)
          normalize(requestPath) {
            requestPath = requestPath.split('?')[0];
            if (requestPath.substr(-1) === '/') requestPath += 'index.html';
            if (path.sep !== '/') requestPath = requestPath.replace(/\//g, path.sep);
            return requestPath;
          },

          // function to hack HTML responses
          transform(path, html, send) {
            const errorSnippet = getErrorSnippet(priv.errorFromLastBuild);

            if (errorSnippet || bsSnippet) {
              let index = html.lastIndexOf('</body>');
              if (index === -1) index = html.lastIndexOf('</html>');
              if (index === -1) index = html.length;

              html = (
                html.substring(0, index) +
                bsSnippet + errorSnippet +
                html.substring(index)
              );
            }

            send(html, {'Content-Type': 'text/html; charset=utf-8'});
          },
        }));

        // use serve-static for anything not yet handled (i.e. non-HTML files)
        app.use(serveStatic(dest));

        // start the server, and resolve the promise with its API
        const server = http.createServer(app);
        return promisify(server.listen.bind(server))(ports.server)
          .return(server);
      }) : Promise.resolve();

    // make an automator, which will run repeated builds (once we tell it to start)
    const automator = new Automator({
      srcFilter, src, dest, waypoints, cwd,
      watch: options.watch,
    });

    priv.automator = automator;

    // report batches
    automator.on('build-starting', ({input, triggers}) => {
      let headline;
      if (!triggers) {
        // it's the first build.
        const numFiles = input.size;
        headline = cyan('load') + ' ' + srcRelative + ' ' + grey(
          numFiles === 1 ? '(1 file)' : `(${numFiles} files)`
        );
      }
      else {
        headline = cyan('edit');
        const filenames = Object.keys(triggers);
        if (filenames.length <= 4) {
          headline += ' ' + grey(filenames.map(f => path.join(srcRelative, f)).join(', '));
        }
        else headline += ` [${filenames.length} files]`;
      }

      console.log('\n' + headline);
    });

    automator.on('build-complete', ({duration, changes, id}) => {
      if (priv.errorFromLastBuild) {
        delete priv.errorFromLastBuild;
        if (options.browserSync) priv.bsAPI.reload();
      }
      else if (id > 0 && options.browserSync) {
        priv.bsAPI.reload(changes.map(change => change.file));
      }

      if (changes.length) {
        for (const {file, type, sizeDifference} of changes) {
          console.log(
            '  ' + cyan(type) + ' ' + path.join(destRelative, file) +
            ' ' + grey(sizeDifference)
          );
        }
      }
      else console.log(grey('  [no changes]'));

      console.log(grey(`  ${successSymbol} ` + prettyHRTime(duration)));
    });

    automator.on('build-failed', error => {
      priv.errorFromLastBuild = error;
      if (options.browserSync && priv.bsAPI) priv.bsAPI.reload();
      console.log(red(errorSymbol), grey('build failed'));
    });

    // start everything up in parallel
    const [firstBatchResult, server, bsAPI] = yield Promise.all([
      // start the automator, and ge the first batch result
      automator.start(),

      // start the connect server, and get back the server (for closing)
      serverReady,

      // start browser sync, and get back the API
      browserSyncReady,
    ]).catch(error => {
      // to allow the process to exit,
      // close everything up manually then re-throw
      return Promise.all([
        serverReady.then(server => {
          if (server) server.close();
        }),
        browserSyncReady.then(bsAPI => {
          if (bsAPI) bsAPI.exit();
        }),
      ]).then(() => {
        automator.stop();
        throw error;
      });
    });

    // store server APIs on priv (so Trip#stop() can close them)
    if (options.serve) priv.server = server;
    if (options.browserSync) priv.bsAPI = bsAPI;

    // log details of the dev server and open it in the browser (if configured)
    if (options.serve) {
      const serverURL = `http://localhost:${(yield portsReady).server}/`;

      console.log(
        '\n' + cyan('serving ') + path.relative(cwd, dest) +
        grey(' at ') + underline(serverURL) + '\n'
      );

      if (options.open) opn(serverURL);
    }


    // finish up and return the first build result
    priv.busy = false;
    return firstBatchResult;
  })});
}

export default function trip(...args) {
  return new Trip(...args);
}
