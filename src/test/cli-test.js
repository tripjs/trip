/* global describe, it */

import 'source-map-support/register';
import assert from 'assert';
import execa from 'execa';
import path from 'path';
import {grey} from 'chalk';

describe('trip CLI', () => {
  const cliPath = path.resolve(__dirname, '..', '..', 'cli.js');
  const fixturesDir = path.resolve(__dirname, '..', '..', 'fixtures');

  process.chdir(fixturesDir);

  it('can run subtasks in series and parallel', async function () {
    this.timeout(5000);

    const {stdout, stderr} = await run(cliPath, ['parallel-subtasks']);
    const lines = getLogs(stdout);

    assert.strictEqual(lines[0], 'thing 1');
    assert.strictEqual(lines[1], 'thing 2');
    assert.strictEqual(lines[2], 'thing 3');
    assert.strictEqual(lines[3], 'thing 4');
    assert.strictEqual(stderr, '');
  });

  // it('can receive flags from CLI', async function () {
  //   this.timeout(5000);

  //   const {stdout, stderr} = await run(cliPath + ' task-arguments:"from command line":"hi"');
  //   const lines = getLogs(stdout);

  //   assert.strictEqual(lines[0], 'action 1 from command line hi'); // can receive params from cli
  //   assert.strictEqual(lines[1], 'action 2 null'); // should not have anything passed
  //   assert.strictEqual(stderr, '');
  // });

  it('tasks can complete synchronously');
  it('tasks that throw a synchronous error cause an exception');
  it('tasks that return a miscellaneous type cause an exception');
  it('tasks can return promises');
  it('tasks can return streams');
  it('tasks as generators act like async functions');
});

// grab relevant lines from a stdout string
function getLogs(stdout) {
  return stdout.split('\n').filter(line => line.length && line.charAt(0) !== '[');
}

// run a command and print out the output so we can see what's going on
async function run(command, commandArgs) {
  const {stdout, stderr} = await execa(command, commandArgs);

  console.log(grey('\n\n=== STDOUT:\n', stdout, '\n=== /STDOUT'));
  console.log(grey('\n\n=== STDERR:', stderr, '\n=== /STDERR'));

  return {stdout, stderr};
}
