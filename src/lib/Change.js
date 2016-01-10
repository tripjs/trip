import prettyBytes from 'pretty-bytes';

/**
 * Class for an object that details any change occuring at a given file path.
 */
export default class Change {
  constructor({file, contents, oldContents}) {
    let type;
    if (contents) {
      if (oldContents) type = 'modify';
      else type = 'add';
    }
    else type = 'delete';

    Object.defineProperties(this, {
      file        : {enumerable: true, value: file},
      contents    : {enumerable: true, value: contents},
      oldContents : {enumerable: true, value: oldContents},
      type        : {enumerable: true, value: type},
    });
  }

  /**
   * Makes change instances appear nicely in console.logs.
   */
  inspect() {
    let amount;
    switch (this.type) {
      case 'add':
        amount = prettyBytes(this.contents.length);
        break;
      case 'delete':
        amount = `was ${prettyBytes(this.oldContents.length)}`;
        break;
      case 'modify':
        amount = `${prettyBytes(this.oldContents.length)} => ${prettyBytes(this.contents.length)}`;
        break;
      default: throw new Error('Unexpected value for type property: ' + this.type);
    }

    return `<change: ${this.type} ${this.file} (${amount})>`;
  }

  /**
   * Get a string saying how much the contents have changed in size.
   */
  get sizeDifference() {
    const difference = (
      (this.contents ? this.contents.length : 0) -
      (this.oldContents ? this.oldContents.length : 0)
    );

    return difference >= 0 ? `+${prettyBytes(difference)}` : prettyBytes(difference);
  }
}
