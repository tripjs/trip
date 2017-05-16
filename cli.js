#!/usr/bin/env node

var semver = require('semver');
var pkg = require('./package.json');

if (!semver.satisfies(process.versions.node, pkg.engines.node)) {
  console.log('\nPlease upgrade to Node', pkg.engines.node);
  process.exit(1);
}

require('./dist/lib/index.js');
