import Trip from './Trip';

// use commonjs export so user doesn't have to do `require('trip').default`
module.exports = function trip(...args) {
  return new Trip(...args);
};

module.exports.Trip = Trip;
