import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);

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

async function git(cwd, args) {
  try {
    const { stdout } = await execFileP('git', ['-C', cwd, ...args]);
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * The current branch of the checkout at `target` and the names that count as its default
 * branch: `origin/HEAD` if it is set, else `main` and `master`. Returns null when `target`
 * is not in a git work tree. `current` is '' on a detached HEAD.
 */
export async function branchInfo(target) {
  if ((await git(target, ['rev-parse', '--is-inside-work-tree'])) !== 'true') return null;
  const current = (await git(target, ['branch', '--show-current'])) ?? '';
  const originHead = await git(target, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const defaults = originHead ? [originHead.replace(/^origin\//, '')] : ['main', 'master'];
  return { current, defaults, onDefault: current !== '' && defaults.includes(current) };
}

/**
 * Install the review files into `target`.
 *
 * `ask(question, choices, fallback)` returns one of `choices`. When `ask` is null the
 * run is non-interactive: it creates missing files and never changes an existing file,
 * except for the two optional edits that the caller asks for by name:
 * `appendClaudeMd` (the marked section in CLAUDE.md) and `gitignoreScratch` (the
 * `.scratch/` line in .gitignore). Both are idempotent.
 * `dryRun` writes nothing and asks nothing.
 * The install refuses to write on the default branch unless `allowDefaultBranch` is set.
 *
 * Returns a list of { path, action, note? } in install order.
 */
export async function install({
  target,
  ask = null,
  dryRun = false,
  appendClaudeMd = false,
  gitignoreScratch = false,
  allowDefaultBranch = false,
}) {
  const root = path.resolve(target);
  const rootStat = await lstatOrNull(root);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`target is not a directory: ${root}`);
  }

  const branch = await branchInfo(root);
  if (branch?.onDefault && !allowDefaultBranch && !dryRun) {
    throw new Error(
      `the checkout is on the default branch "${branch.current}". Install in a feature branch ` +
        'or worktree (for example `git switch -c chore/reviewer-skill`), or pass --allow-default-branch.',
    );
  }

  const results = [];
  const record = (dest, action, note) => results.push({ path: dest, action, ...(note ? { note } : {}) });
  if (branch?.onDefault && !allowDefaultBranch && dryRun) {
    record(`branch ${branch.current}`, 'would-refuse', 'default branch; create a feature branch or worktree first');
  }

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

  results.push(await installSnippet(root, { ask, dryRun, wanted: appendClaudeMd }));
  results.push(await installGitignore(root, { ask, dryRun, wanted: gitignoreScratch }));
  return results;
}

async function installSnippet(root, { ask, dryRun, wanted }) {
  const rel = 'CLAUDE.md';
  const dest = path.join(root, rel);
  const st = await lstatOrNull(dest);
  if (st && !st.isFile()) return { path: rel, action: 'skipped', note: 'not a regular file; not touched' };

  const existing = st ? await fs.readFile(dest, 'utf8') : null;
  if (existing !== null && existing.includes(SNIPPET_START)) return { path: rel, action: 'unchanged' };

  const verb = existing === null ? 'Create CLAUDE.md with' : 'Append to CLAUDE.md';
  if (dryRun) {
    if (wanted) return { path: rel, action: existing === null ? 'would-create' : 'would-append' };
    return { path: rel, action: 'would-ask', note: `optional: ${verb.toLowerCase()} the review section` };
  }
  if (!wanted) {
    if (!ask) {
      return { path: rel, action: 'skipped', note: 'optional; pass --append-claude-md, or print it with `reviewer-skill print-snippet`' };
    }
    const choice = await ask(`${verb} the "Review and merge" section? [y/N]`, ['y', 'n'], 'n');
    if (choice !== 'y') return { path: rel, action: 'skipped', note: 'declined' };
  }

  const block = await snippetBlock();
  if (existing === null) {
    await fs.writeFile(dest, block, { flag: 'wx' });
    return { path: rel, action: 'created' };
  }
  const sep = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  await fs.appendFile(dest, sep + block);
  return { path: rel, action: 'appended' };
}

async function installGitignore(root, { ask, dryRun, wanted }) {
  const rel = '.gitignore';
  const dest = path.join(root, rel);
  const st = await lstatOrNull(dest);
  if (st && !st.isFile()) return { path: rel, action: 'skipped', note: 'not a regular file; not touched' };

  const existing = st ? await fs.readFile(dest, 'utf8') : null;
  if (existing !== null && ignoresScratch(existing)) return { path: rel, action: 'unchanged' };

  const note = `reports in .scratch/reviews/ must be git-ignored: add "${GITIGNORE_ENTRY}" or pass --gitignore-scratch`;
  if (dryRun) {
    if (wanted) return { path: rel, action: existing === null ? 'would-create' : 'would-append' };
    return { path: rel, action: 'would-ask', note };
  }
  if (!wanted) {
    if (!ask) return { path: rel, action: 'skipped', note };
    const verb = existing === null ? 'Create .gitignore with' : 'Add';
    const choice = await ask(`${verb} "${GITIGNORE_ENTRY}" (review reports)? [y/N]`, ['y', 'n'], 'n');
    if (choice !== 'y') return { path: rel, action: 'skipped', note };
  }

  const line = `${GITIGNORE_ENTRY}\n`;
  if (existing === null) {
    await fs.writeFile(dest, line, { flag: 'wx' });
    return { path: rel, action: 'created' };
  }
  await fs.appendFile(dest, (existing === '' || existing.endsWith('\n') ? '' : '\n') + line);
  return { path: rel, action: 'appended' };
}
