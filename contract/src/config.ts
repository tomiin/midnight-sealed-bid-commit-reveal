import path from 'node:path';
import { fileURLToPath } from 'node:url';

// NOTE: use fileURLToPath, NOT `new URL(import.meta.url).pathname`. The latter
// leaves spaces in a path encoded as %20, which breaks file lookups on machines
// where the project lives under a path with spaces.
export const currentDir = path.resolve(fileURLToPath(import.meta.url), '..');

export interface Config {
  readonly logDir: string;
}

export class LogicTestingConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'logic-testing', `${new Date().toISOString()}.log`);
  constructor() {}
}
