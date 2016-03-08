import 'babel-polyfill';
import Bluebird from 'bluebird';
import clearTrace from 'clear-trace';
import figures from 'figures';
import Liftoff from 'liftoff';
import minimist from 'minimist';
import prettyHRTime from 'pretty-hrtime';
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
	process.exit(0);
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
	// choose ideal presets for the current engine
	const presets = ['stage-0'];
	const nodeVersion = Number(process.versions.node.split('.'));
	if (nodeVersion > 4) presets.push('es2015-node5');
	else if (nodeVersion === 4) presets.push('es2015-node4');
	else presets.push('es2015');

	require('babel-register')({ presets }); // eslint-disable-line global-require
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

	// check for version difference between cli and local installation
	if (cliPackage.version !== env.modulePackage.version) {
		say(yellow('Warning: trip version mismatch:'));
		say(yellow('Global trip is'), cliPackage.version);
		say(yellow('Local trip is'), env.modulePackage.version);
	}

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
					if (fn.length > 1) await Bluebird.promisify(fn)(flags);
					else await Bluebird.resolve(fn(flags));
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
