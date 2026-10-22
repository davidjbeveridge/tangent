'use strict';

const { createReleaseConfig } = require('./scripts/release-config.cjs');
module.exports = createReleaseConfig(require('./package.json').build);
