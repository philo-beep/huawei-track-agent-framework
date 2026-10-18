#!/usr/bin/env node
'use strict';

const { cli } = require('./backend/marketing/main.js');

cli(process.argv.slice(2));
