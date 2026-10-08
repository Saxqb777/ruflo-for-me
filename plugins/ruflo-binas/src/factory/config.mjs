// The workshop's remembered settings: ~/.binas/config.json, readable only by the owner (0600). Holds the
// showroom URL, the master key and the Vercel team, so after the first run `binas run` needs no flags.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const KEYS = ['cloud', 'key', 'vercelTeamId', 'githubOwner'];
export const configPath = (home = homedir()) => join(home, '.binas', 'config.json');

export function loadConfig(home = homedir()) {
  try { const j = JSON.parse(readFileSync(configPath(home), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
/** Merge known keys into the file; returns the saved object. Unknown keys and empty values are dropped. */
export function saveConfig(patch, home = homedir()) {
  const next = { ...loadConfig(home) };
  for (const k of KEYS) if (typeof patch[k] === 'string' && patch[k].trim()) next[k] = patch[k].trim();
  const file = configPath(home); mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 }); try { chmodSync(file, 0o600); } catch { /* not POSIX */ }
  return next;
}
export const hasConfig = (home = homedir()) => existsSync(configPath(home));
