import figures from 'figures';
import prettyHRTime from 'pretty-hrtime';
import Promise from 'bluebird';
import {grey, cyan, red, green} from 'chalk';
import {isString, isFunction} from 'lodash';

let taskRunner;

export async function run(taskName) {
  const actions = taskRunner.tasks[taskName];

  if (!Array.isArray(actions)) {
    throw new Error('task not found: "' + taskName + '"');
  }

  // run all the tasks in series
  const taskStart = process.hrtime();
  log(cyan(taskName), grey('started'));
  taskRunner._running++;

  try {
    for (let i = 0, l = actions.length; i < l; i++) {
      const action = actions[i];

      if (Array.isArray(action)) {
        // run all of the sub-actions in parallel
        await Promise.map(action, subAction => { // eslint-disable-line no-loop-func
          if (Array.isArray(subAction)) throw new Error('tasks nested too deeply.');

          if (isString(subAction)) return run(subAction);
          else if (isFunction(subAction)) return subAction.call(taskRunner);

          throw new TypeError(`unexpected type for subtask: ${typeof subAction}`);
        });
      }
      else if (isString(action)) await run(action);
      else if (isFunction(action)) await Promise.resolve(action.call(taskRunner));
      else throw new TypeError(`unexpected type for action ${i} of task: ${typeof action}`);
    }

    taskRunner._running--;
  }
  catch (error) {
    log(
      cyan(taskName),
      red(`${figures.cross} error`),
      grey(prettyHRTime(process.hrtime(taskStart)))
    );

    throw error;
  }


  log(
    cyan(taskName),
    green(figures.tick),
    grey(prettyHRTime(process.hrtime(taskStart)))
  );
}

taskRunner = {
  _running: 0,
  run,
  log,
};

export default taskRunner;

export function log(...args) {
  const date = new Date();
  let hh = String(date.getHours());
  let mm = String(date.getMinutes());
  let ss = String(date.getSeconds());

  if (hh.length < 2) hh = '0' + hh;
  if (mm.length < 2) mm = '0' + mm;
  if (ss.length < 2) ss = '0' + ss;

  console.log(
    grey(`[${hh}:${mm}:${ss}]`),
    args.join(' ')
  );
}
