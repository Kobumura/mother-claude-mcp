// Cascade config loader.
//
// A config lists doc sources in priority order. Later sources win on ID collision,
// which is what lets an adopter take someone else's `standards/code-standards` and
// then quietly replace it with their own. Same mental model as `tsconfig.extends`
// or ESLint `extends` — deliberately, so there is nothing new to learn.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve, join } from 'node:path';

export class ConfigError extends Error {}

const DEFAULT_CONFIG_NAMES = ['mother-claude.config.json', '.mother-claude.json'];

export function findConfig(startDir = process.cwd()) {
  let dir = resolve(startDir);
  for (;;) {
    for (const name of DEFAULT_CONFIG_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function asArray(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ConfigError(`"${field}" must be an array`);
  return value;
}

// A source is {path} (a directory of markdown) or {pack} (a named directory under
// packs/, resolved relative to the config file). `pack` exists so a shared starter
// pack can be referenced by name and version rather than by a brittle relative path.
function normalizeSource(raw, index, field, baseDir, packsDir) {
  if (typeof raw === 'string') raw = { path: raw };
  if (!raw || typeof raw !== 'object') {
    throw new ConfigError(`${field}[${index}] must be a string path or an object`);
  }
  if (!raw.path && !raw.pack) {
    throw new ConfigError(`${field}[${index}] needs either "path" or "pack"`);
  }
  if (raw.path && raw.pack) {
    throw new ConfigError(`${field}[${index}] cannot set both "path" and "pack"`);
  }

  let dir;
  let name;
  let version = null;
  if (raw.pack) {
    // `name@version` is accepted so configs read naturally, but the version is a
    // provenance label only — resolution is by directory name. Pinning would need a
    // real registry, and pretending otherwise would be dishonest.
    const [bare, declared] = String(raw.pack).split('@');
    name = bare;
    version = declared || null;
    dir = resolve(packsDir, bare);
  } else {
    // Source names label provenance in tool output, so strip the leading `./` and any
    // trailing slash rather than echoing however the config happened to spell the path.
    name = String(raw.path).replace(/^\.\//, '').replace(/\/+$/, '') || '.';
    dir = isAbsolute(raw.path) ? raw.path : resolve(baseDir, raw.path);
  }
  if (raw.name) name = String(raw.name);

  return {
    name,
    version,
    dir,
    kind: raw.pack ? 'pack' : 'path',
    include: asArray(raw.include, `${field}[${index}].include`).map(String),
    exclude: asArray(raw.exclude, `${field}[${index}].exclude`).map(String),
    // `public: yes|no` is this system's own visibility flag. A source marked
    // publicOnly serves only `public: yes` docs — the guard that lets one engine
    // back both a private instance and a shared one.
    publicOnly: raw.publicOnly === true,
    optional: raw.optional === true,
  };
}

export function loadConfig(configPath) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new ConfigError(`could not read config at ${configPath}: ${err.message}`);
  }

  const baseDir = dirname(resolve(configPath));
  const packsDir = raw.packsDir
    ? resolve(baseDir, raw.packsDir)
    : resolve(baseDir, 'packs');

  const rules = asArray(raw.rules, 'rules').map((s, i) =>
    normalizeSource(s, i, 'rules', baseDir, packsDir));
  const incidents = asArray(raw.incidents, 'incidents').map((s, i) =>
    normalizeSource(s, i, 'incidents', baseDir, packsDir));

  if (rules.length === 0) {
    throw new ConfigError('config must declare at least one source under "rules"');
  }

  for (const source of [...rules, ...incidents]) {
    if (source.optional) continue;
    if (!existsSync(source.dir) || !statSync(source.dir).isDirectory()) {
      throw new ConfigError(
        `source "${source.name}" resolves to ${source.dir}, which is not a directory ` +
        `(set "optional": true if it is allowed to be absent)`
      );
    }
  }

  return {
    path: resolve(configPath),
    baseDir,
    name: raw.name || 'mother-claude',
    rules,
    incidents,
    roster: raw.roster ? resolve(baseDir, raw.roster) : null,
    // Named argument presets, so `role` stays a consumer concept and the engine
    // ships with no opinion about what roles exist.
    profiles: raw.profiles && typeof raw.profiles === 'object' ? raw.profiles : {},
  };
}
