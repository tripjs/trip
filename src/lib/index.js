import 'babel-polyfill';
import Bluebird from 'bluebird';
import clearTrace from 'clear-trace';
import endOfStream from 'end-of-stream';
import figures from 'figures';
import Liftoff from 'liftoff';
import minimist from 'minimist';
import prettyHRTime from 'pretty-hrtime';
import streamConsume from 'stream-consume';
import tildify from 'tildify';
import { isFunction } from 'lodash';
import { red, grey, yellow, cyan, green } from 'chalk';

let taskRunning = false;
let failed = false;
const start = process.hrtime();

function finish() {
	say(grey('total:', prettyHRTime(process.hrtime(start))));
	if (failed) {
		say(red(figures.cross, 'exiting with code 1'));
		process.exit(1);
	}
}

process.on('uncaughtException', err => {
	let type;
	if (err instanceof Error) type = 'error';
	else type = typeof err;

	say(red(`${type} thrown:`));
	console.error(clearTrace(err), '\n');
	process.exit(1);
});

process.on('unhandledRejection', err => {
	say(red('unhandled rejection:'));
	console.error(clearTrace(err), '\n');
	process.exit(1);
});

process.on('exit', () => {
	if (taskRunning) {
		say(red(`task didn't finish`));
		process.exit(1);
	}
});

function say(...args) {
	const date = new Date();
	let hh = String(date.getHours());
	let mm = String(date.getMinutes());
	let ss = String(date.getSeconds());

	if (hh.length < 2) hh = `0${hh}`;
	if (mm.length < 2) mm = `0${mm}`;
	if (ss.length < 2) ss = `0${ss}`;

	console.log(
		grey(`${hh}:${mm}:${ss} ·`),
		args.join(' ')
	);
}

const argv = minimist(process.argv.slice(2));

const cliPackage = require('../../package.json');

if (argv.babel !== '0') {
	// choose ideal babel config for the current engine
	const presets = ['stage-0'];
	const nodeVersion = Number(process.versions.node.split('.')[0]);
	if (nodeVersion > 4) presets.push('es2015-node5');
	else if (nodeVersion === 4) presets.push('es2015-node4');
	else presets.push('es2015');

	// eslint-disable-line global-require
	require('babel-register')({
		presets,
		ignore: /node_modules/,
	});
}

const cli = new Liftoff({
	name: 'trip',
	extensions: {
		'.js': null,
		'.jsx': null,
	},
});

const options = {
	cwd: argv.cwd,
	configPath: argv.file,
};

cli.launch(options, async env => {
	console.log(); // intentional blank line

	if (!env.configPath) {
		console.error(red('no tripfile found'));
		process.exit(1);
	}

	// NOT WORKING:
	// // check for version difference between cli and local installation
	// if (cliPackage.version !== env.modulePackage.version) {
	// 	say(yellow('Warning: trip version mismatch:'));
	// 	say(yellow('  Global trip is'), cliPackage.version);
	// 	say(yellow('  Local trip is'), env.modulePackage.version);
	// }

	// change directory if necessary, and warn about it
	if (env.configBase !== process.cwd()) {
		say(yellow(`cd ${tildify(env.configBase)}`));
		process.chdir(env.configBase);
	}

	// load the user's tripfile
	let tripfile;
	try {
		tripfile = require(env.configPath); // eslint-disable-line global-require
	}
	catch (error) {
		say(red('error while reading tripfile'));

		console.error(' ', clearTrace(error).split('\n').join('\n  '));
		console.error('');

		failed = true;
		finish();
	}

	// get list of tasks to run
	const tasks = argv._ || [];
	if (tasks.length === 0) tasks[0] = 'default';

	try {
		for (const taskNameWithFlags of tasks) {
			// split out any flags
			const flagNames = taskNameWithFlags.split(':');
			const taskName = flagNames.shift();
			const flags = {};
			for (const flagName of flagNames) flags[flagName] = true;

			// verify the function exists
			const fn = tripfile[taskName];
			if (!isFunction(fn)) {
				const error = new Error(`task not found`);
				error._taskNotFound = taskName;
				throw error;
			}

			// run the task
			{
				const prettyName = cyan(taskName) + (
					flagNames.length ?
						grey(`:${flagNames.join(':')}`) :
						''
				);

				say(prettyName, grey('started'));

				taskRunning = true;
				const taskStart = process.hrtime();

				try {
					if (fn.length > 1) {
						// call it with a done-callback, and assert that it doesn't return a value
						await new Bluebird((resolve, reject) => {
							const r = fn(flags, error => {
								if (error) {
									reject(error);
									return;
								}
								resolve();
							});

							if (r) {
								say(red(`task function "${taskName}" accepted a 'done' callback but also returned something`));
								reject(new Error('trip: callback-style task must not return anything'));
							}
						});
					}
					else {
						const r = await Bluebird.resolve(fn(flags));

						// handle task returning a stream
						if (r) {
							if (isFunction(r.pipe)) {
								await new Bluebird((resolve, reject) => {
									endOfStream(r, { error: true, readable: r.readable, writable: r.writable && !r.readable }, error => {
										if (error) reject(error);
										else resolve();
									});

									// make sure the stream ends
									streamConsume(r);
								});
							}
							else {
								say(red(`unsupported return value from task function: ${taskName}`));
								say(red(`(you may only return/resolve with a stream or undefined)`));

								throw new Error(`trip: task returned an unsupported value`);
							}
						}
					}
				}
				catch (error) {
					// report task failure
					say(
						prettyName,
						red(`${figures.cross} error`),
						grey(prettyHRTime(process.hrtime(taskStart)))
					);

					taskRunning = false;

					throw error;
				}

				// report success
				say(
					prettyName,
					green(figures.tick),
					grey(prettyHRTime(process.hrtime(taskStart)))
				);

				taskRunning = false;
			}
		}
	}
	catch (error) {
		failed = true;

		if (error._taskNotFound) {
			say(red('task not found:'), error._taskNotFound);

			console.log(grey('\navailable tasks:\n'));

			for (const taskName of Object.keys(tripfile)) {
				if (isFunction(tripfile[taskName])) console.log(' ', cyan(taskName));
			}
			console.log('');
		}
		else {
			console.error(' ', clearTrace(error).split('\n').join('\n  '));
			console.error('');
		}
	}

	finish();
});
