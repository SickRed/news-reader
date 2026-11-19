'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, '..', '..', 'config', 'default-config.json');

function readDefault() {
  return JSON.parse(fs.readFileSync(DEFAULT_PATH, 'utf8'));
}

/**
 * The user config lives in the app data dir so it can be edited without rebuilding.
 * It is created from the bundled default on first start.
 */
function loadUserConfig(userPath) {
  if (!fs.existsSync(userPath)) {
    fs.mkdirSync(path.dirname(userPath), { recursive: true });
    fs.copyFileSync(DEFAULT_PATH, userPath);
  }
  return JSON.parse(fs.readFileSync(userPath, 'utf8'));
}

function resetUserConfig(userPath) {
  if (fs.existsSync(userPath)) fs.copyFileSync(userPath, `${userPath}.bak`);
  fs.copyFileSync(DEFAULT_PATH, userPath);
}

module.exports = { readDefault, loadUserConfig, resetUserConfig, DEFAULT_PATH };
