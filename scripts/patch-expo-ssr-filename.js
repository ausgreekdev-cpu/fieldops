#!/usr/bin/env node
/**
 * Patch @expo/cli so Metro's SSR eval filename is filesystem-safe.
 *
 * Bug: for projects whose absolute path contains characters that encodeURI
 * escapes (e.g. a space — "/home/aiuser/Feild worker"), Metro builds the
 * SSR module filename via `encodeURI(absolutePath)` (metroOptions.js:
 * createBundleUrlOsPath) and hands it to require-from-string. Node then
 * resolves `require('react')` relative to the ENCODED directory
 * (`Feild%20worker/...`), which does not exist → web dev server dies with
 * "Cannot find module 'react'". `expo export` is unaffected (relative paths).
 *
 * Fix: decodeURI the filename at the require-from-string call site.
 * Idempotent — safe to run on every `npm install` (postinstall).
 */
const fs = require('fs');
const path = require('path');

const MARKER = 'decodeURISafeFilename';

function findTarget() {
  // Prefer the package location so this works regardless of hoisting.
  try {
    return path.join(
      path.dirname(require.resolve('@expo/cli/package.json')),
      'build/src/start/server/getStaticRenderFunctions.js'
    );
  } catch {
    return path.join(__dirname, '..', 'node_modules', '@expo', 'cli', 'build', 'src', 'start', 'server', 'getStaticRenderFunctions.js');
  }
}

const target = findTarget();
if (!fs.existsSync(target)) {
  console.warn(`[patch-expo-ssr-filename] target not found, skipping: ${target}`);
  process.exit(0);
}

const src = fs.readFileSync(target, 'utf8');
if (src.includes(MARKER)) {
  console.log('[patch-expo-ssr-filename] already applied');
  process.exit(0);
}

const original = '(0, _profile.profile)(_requireFromString().default, "eval-metro-bundle")(src, filename);';
const replacement = '(0, _profile.profile)(_requireFromString().default, "eval-metro-bundle")(src, ' + MARKER + '(filename));';
if (!src.includes(original)) {
  console.warn('[patch-expo-ssr-filename] expected call site not found — @expo/cli layout changed; skipping');
  process.exit(0);
}

const helper = `function ${MARKER}(value) {
    try { return decodeURI(value); } catch { return value; }
}
function evalMetroNoHandling(`;

const patched = src.replace(original, replacement).replace('function evalMetroNoHandling(', helper);
fs.writeFileSync(target, patched);
console.log(`[patch-expo-ssr-filename] applied to ${target}`);
