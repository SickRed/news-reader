#!/usr/bin/env node
'use strict';

// Prints the curated feed list as OPML (import into NetNewsWire, Reeder, Feedly, Inoreader, …).
const { readDefault } = require('../src/main/config');
const { toOpml } = require('../src/main/opml');

process.stdout.write(toOpml(readDefault()));
