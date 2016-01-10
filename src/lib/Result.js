/**
 * Result
 *
 * The prototype for a build result object (the object used as the fulfillment
 * value for a `.build()` call). Provides an `inspect()` method to make it look
 * nice when you `console.log(result)`.
 */

import prettyHRTime from 'pretty-hrtime';
import prettyBytes from 'pretty-bytes';

export default {
  inspect() {
    return `<<< BUILD #${this.id}\n  ` + [
      `completed in ${prettyHRTime(this.duration)}`,
      `input (${(this.srcSize)}):`,
      `  ` + fileList(this.input).join(`\n    `),
      `output (${(this.destSize)}):`,
      `  ` + fileList(this.output).join(`\n    `),
    ].join(`\n  `) + `\n>>>`;
  },
};

function fileList(files) {
  return [...files.entries()].map(([file, contents]) => `${file} (${prettyBytes(contents.length)})`);
}

/*
  properties available:
    id,
    changes,
    duration,
    steps,
    input,
    output,
    srcSize,
    destSize,
 */
