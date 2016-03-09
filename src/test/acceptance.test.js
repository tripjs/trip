import execa from 'execa';
import path from 'path';
import test from 'ava';
import { grey } from 'chalk';

const cliPath = path.resolve(__dirname, '..', '..', 'cli.js');
const fixturesDir = path.resolve(__dirname, '..', '..', 'fixtures');

test.before(() => {
	process.chdir(fixturesDir);
});

// TODO: switch to test.series() when it ships in ava

test('regular async task (success)', async t => {
	const { stdout, stderr } = await run(cliPath, ['greet']);
	const lines = getLogs(stdout);

	t.same(lines, ['Hello,', 'world!']);
	t.is(stderr, '');
});

test('regular async task (success, with flags)', async t => {
	const { stdout, stderr } = await run(cliPath, ['greet:leaving']);
	const lines = getLogs(stdout);

	t.same(lines, ['Goodbye,', 'world!']);
	t.is(stderr, '');
});

test('callback-style async task (success)', async t => {
	const { stdout, stderr } = await run(cliPath, ['oldSchool']);
	const lines = getLogs(stdout);

	t.same(lines, ['about to call back']);
	t.is(stderr, '');
});

test('node-style callbacks (error, with flags)', async t => {
	let error;
	try {
		await run(cliPath, ['oldSchool:shouldFail']);
	}
	catch (_error) {
		error = _error;
	}

	t.true(error instanceof Error);

	const { stdout, stderr } = error;
	const lines = getLogs(stdout);

	t.same(lines, ['about to call back']);
	t.not(stderr, '');
});

test('sync, default function (success)', async t => {
	const { stdout, stderr } = await run(cliPath);
	const lines = getLogs(stdout);

	t.same(lines, ['this is the default task']);
	t.is(stderr, '');
});

test('returning a stream (success)', async t => {
	const { stdout, stderr } = await run(cliPath, ['streamy']);
	const lines = getLogs(stdout);

	t.same(lines, []);
	t.is(stderr, '');
});

// test.todo('tasks can return streams, e.g. gulp streams');
// test.todo('tasks that return/resolve with something unexpected cause an exception');

// grab relevant lines from a stdout string (excluding trip control messages)
function getLogs(stdout) {
	return stdout.split('\n').filter(line => line.length && line.indexOf('·') === -1);
}

// run a command, and print all the output for debugging
async function run(command, commandArgs) {
	const { stdout, stderr } = await execa(command, commandArgs);

	console.log(grey('\n\n=== STDOUT:\n', stdout, '\n=== /STDOUT'));
	console.log(grey('\n\n=== STDERR:', stderr, '\n=== /STDERR'));

	return { stdout, stderr };
}
