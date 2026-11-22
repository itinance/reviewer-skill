import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'templates',
);

// Template file -> path in the target project.
export const FILES = [
  { src: 'agents/review-correctness.md', dest: '.claude/agents/review-correctness.md' },
  { src: 'agents/review-security.md', dest: '.claude/agents/review-security.md' },
  { src: 'agents/review-tests.md', dest: '.claude/agents/review-tests.md' },
  { src: 'skills/review-round/SKILL.md', dest: '.claude/skills/review-round/SKILL.md' },
  { src: 'docs/REVIEW_AND_MERGE.md', dest: 'docs/REVIEW_AND_MERGE.md' },
];

export const SNIPPET_SRC = 'CLAUDE.snippet.md';
export const SNIPPET_START = '<!-- reviewer-skill:start -->';
export const SNIPPET_END = '<!-- reviewer-skill:end -->';
export const GITIGNORE_ENTRY = '.scratch/';
export const NEW_SUFFIX = '.reviewer-skill.new';

async function lstatOrNull(p) {
  try {
    return await fs.lstat(p);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function insideTarget(target, p) {
  const rel = path.relative(target, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export async function readTemplate(src) {
  return fs.readFile(path.join(TEMPLATE_DIR, src), 'utf8');
}

export async function snippetBlock() {
  const body = (await readTemplate(SNIPPET_SRC)).trimEnd();
  return `${SNIPPET_START}\n${body}\n${SNIPPET_END}\n`;
}

// True when a .gitignore line already ignores the .scratch directory.
export function ignoresScratch(gitignoreText) {
  return gitignoreText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .some((l) => ['.scratch', '.scratch/', '/.scratch', '/.scratch/', '.scratch/*', '/.scratch/*'].includes(l));
}

/**
 * Install the review files into `target`.
 *
 * `ask(question, choices, fallback)` returns one of `choices`. When `ask` is null the
 * run is non-interactive: it creates missing files and never changes an existing file.
 * `dryRun` writes nothing and asks nothing.
 *
 * Returns a list of { path, action, note? } in install order.
 */
export async function install({ target, ask = null, dryRun = false }) {
  const root = path.resolve(target);
  const rootStat = await lstatOrNull(root);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`target is not a directory: ${root}`);
  }

  const results = [];
  const record = (dest, action, note) => results.push({ path: dest, action, ...(note ? { note } : {}) });

  for (const file of FILES) {
    const dest = path.join(root, file.dest);
    if (!insideTarget(root, dest)) throw new Error(`refusing path outside target: ${file.dest}`);
    const content = await readTemplate(file.src);
    const st = await lstatOrNull(dest);

    if (!st) {
      if (!dryRun) {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, content, { flag: 'wx' });
      }
      record(file.dest, dryRun ? 'would-create' : 'created');
      continue;
    }

    if (!st.isFile()) {
      record(file.dest, 'skipped', 'exists and is not a regular file (symlink or directory); not touched');
      continue;
    }

    const existing = await fs.readFile(dest, 'utf8');
    if (existing === content) {
      record(file.dest, 'unchanged');
      continue;
    }

    if (dryRun) {
      record(file.dest, 'would-ask', 'exists with different content');
      continue;
    }
    if (!ask) {
      record(file.dest, 'skipped', 'exists with different content; run in a terminal to choose');
      continue;
    }

    const choice = await ask(
      `${file.dest} exists and differs. [s]kip, [o]verwrite, write [n]ew file next to it?`,
      ['s', 'o', 'n'],
      's',
    );
    if (choice === 'o') {
      await fs.writeFile(dest, content);
      record(file.dest, 'overwritten');
    } else if (choice === 'n') {
      const side = dest + NEW_SUFFIX;
      try {
        await fs.writeFile(side, content, { flag: 'wx' });
        record(file.dest, 'new-file', `wrote ${file.dest}${NEW_SUFFIX}`);
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        record(file.dest, 'skipped', `${file.dest}${NEW_SUFFIX} already exists; not touched`);
      }
    } else {
      record(file.dest, 'skipped', 'kept your version');
    }
  }

  results.push(await installSnippet(root, { ask, dryRun }));
  results.push(await installGitignore(root, { ask, dryRun }));
  return results;
}

async function installSnippet(root, { ask, dryRun }) {
  const rel = 'CLAUDE.md';
  const dest = path.join(root, rel);
  const st = await lstatOrNull(dest);
  if (st && !st.isFile()) return { path: rel, action: 'skipped', note: 'not a regular file; not touched' };

  const existing = st ? await fs.readFile(dest, 'utf8') : null;
  if (existing !== null && existing.includes(SNIPPET_START)) return { path: rel, action: 'unchanged' };

  const verb = existing === null ? 'Create CLAUDE.md with' : 'Append to CLAUDE.md';
  if (dryRun) return { path: rel, action: 'would-ask', note: `optional: ${verb.toLowerCase()} the review section` };
  if (!ask) {
    return { path: rel, action: 'skipped', note: 'optional; print it with `reviewer-skill print-snippet`' };
  }

  const choice = await ask(`${verb} the "Review and merge" section? [y/N]`, ['y', 'n'], 'n');
  if (choice !== 'y') return { path: rel, action: 'skipped', note: 'declined' };

  const block = await snippetBlock();
  if (existing === null) {
    await fs.writeFile(dest, block, { flag: 'wx' });
    return { path: rel, action: 'created' };
  }
  const sep = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  await fs.appendFile(dest, sep + block);
  return { path: rel, action: 'appended' };
}

async function installGitignore(root, { ask, dryRun }) {
  const rel = '.gitignore';
  const dest = path.join(root, rel);
  const st = await lstatOrNull(dest);
  if (st && !st.isFile()) return { path: rel, action: 'skipped', note: 'not a regular file; not touched' };

  const existing = st ? await fs.readFile(dest, 'utf8') : null;
  if (existing !== null && ignoresScratch(existing)) return { path: rel, action: 'unchanged' };

  const note = `reports in .scratch/reviews/ must be git-ignored: add "${GITIGNORE_ENTRY}"`;
  if (dryRun) return { path: rel, action: 'would-ask', note };
  if (!ask) return { path: rel, action: 'skipped', note };

  const verb = existing === null ? 'Create .gitignore with' : 'Add';
  const choice = await ask(`${verb} "${GITIGNORE_ENTRY}" (review reports)? [y/N]`, ['y', 'n'], 'n');
  if (choice !== 'y') return { path: rel, action: 'skipped', note };

  const line = `${GITIGNORE_ENTRY}\n`;
  if (existing === null) {
    await fs.writeFile(dest, line, { flag: 'wx' });
    return { path: rel, action: 'created' };
  }
  await fs.appendFile(dest, (existing === '' || existing.endsWith('\n') ? '' : '\n') + line);
  return { path: rel, action: 'appended' };
}
