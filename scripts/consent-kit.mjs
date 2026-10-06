#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildConsent, verifyConsent } from './lib/consent.mjs';

const [command, ...args] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith('--')) throw new Error('Named arguments required');
  const name = args[i].slice(2);
  flags[name] = name === 'component-only' ? true : args[++i];
}
try {
  if (command === 'verify') console.log(JSON.stringify(await verifyConsent(path.resolve(flags.output))));
  else if (command === 'build') console.log(JSON.stringify(await buildConsent({
    settings: JSON.parse(await readFile(path.resolve(flags.settings), 'utf8')),
    outputRoot: path.resolve(flags.output),
    page: flags.page ? await readFile(path.resolve(flags.page), 'utf8') : undefined,
    componentOnly: flags['component-only'] === true,
  })));
  else throw new Error('Use build --settings FILE --output NEW_DIRECTORY [--page FILE | --component-only], or verify --output DIRECTORY');
} catch (error) { console.error('Ошибка: ' + error.message); process.exitCode = 1; }
