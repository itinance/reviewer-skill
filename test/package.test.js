// Package hygiene: supply-chain rules for the installer and its docs, and a guard that
// no project-specific content from the source project leaks into the templates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES, SNIPPET_SRC, TEMPLATE_DIR } from '../lib/install.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const templateFiles = await walk(TEMPLATE_DIR);
const docFiles = [path.join(ROOT, 'README.md'), ...templateFiles];

test('package.json: no dependencies and no lifecycle scripts', () => {
  for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies']) {
    assert.equal(pkg[k], undefined, `${k} must not exist`);
  }
  const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare', 'prepublish', 'prepack', 'postpack', 'dependencies'];
  for (const s of Object.keys(pkg.scripts ?? {})) assert.ok(!lifecycle.includes(s), `lifecycle script: ${s}`);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test('docs: every install command pins the exact current version', async () => {
  const name = pkg.name.replace('/', '\\/');
  for (const f of docFiles) {
    const text = await fs.readFile(f, 'utf8');
    for (const m of text.matchAll(new RegExp(`${name}(@[^\\s\`)]*)?`, 'g'))) {
      const line = text.slice(text.lastIndexOf('\n', m.index) + 1, text.indexOf('\n', m.index));
      if (!/\b(npx|bunx|npm (exec|i|install|view))\b/.test(line)) continue;
      if (/npm view \S+ time --json/.test(line)) continue; // lists all versions, runs nothing
      assert.equal(m[1], `@${pkg.version}`, `${path.relative(ROOT, f)}: ${line.trim()}`);
    }
    const tag = text.match(/--branch v(\d+\.\d+\.\d+)/);
    if (tag) assert.equal(tag[1], pkg.version, `${path.relative(ROOT, f)}: git tag`);
  }
});

test('docs: no floating tags, no auto-confirm, no pipe-to-shell', async () => {
  for (const f of docFiles) {
    const rel = path.relative(ROOT, f);
    for (const [i, line] of (await fs.readFile(f, 'utf8')).split('\n').entries()) {
      const where = `${rel}:${i + 1}`;
      // Lines that only warn about a pattern are allowed to name it.
      if (/\b(never|do not|not|no)\b/i.test(line)) continue;
      assert.doesNotMatch(line, /@(latest|next)\b/, where);
      assert.doesNotMatch(line, /\b(npx|bunx|npm exec)\b.*\s(-y|--yes)\b/, where);
      assert.doesNotMatch(line, /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, where);
    }
  }
});

// Terms that must never be published (project, customer or vendor names) live in a local,
// git-ignored file `.private-terms`: one case-insensitive regex per line, `#` for comments.
// The list itself is private, so it is not in this repository.
test('package files: no private terms', async (t) => {
  let raw;
  try {
    raw = await fs.readFile(path.join(ROOT, '.private-terms'), 'utf8');
  } catch {
    t.skip('no local .private-terms file');
    return;
  }
  const terms = raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const files = [...docFiles, path.join(ROOT, 'package.json'), path.join(ROOT, 'LICENSE'),
    ...(await walk(path.join(ROOT, 'bin'))), ...(await walk(path.join(ROOT, 'lib'))),
    ...(await walk(path.join(ROOT, 'test')))];
  for (const f of files) {
    for (const [i, line] of (await fs.readFile(f, 'utf8')).split('\n').entries()) {
      for (const term of terms) {
        // Print the line number only, never the matched term.
        assert.ok(!new RegExp(term, 'i').test(line), `private term #${terms.indexOf(term) + 1} in ${path.relative(ROOT, f)}:${i + 1}`);
      }
    }
  }
});

test('templates: every file is installed, every installed file exists', async () => {
  const listed = new Set([...FILES.map((f) => f.src), SNIPPET_SRC]);
  const present = new Set(templateFiles.map((f) => path.relative(TEMPLATE_DIR, f).split(path.sep).join('/')));
  assert.deepEqual([...present].sort(), [...listed].sort());
});

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'missing frontmatter');
  return Object.fromEntries(m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
}

test('agents: frontmatter name matches the file, read-only tool set plus Write', async () => {
  for (const f of FILES.filter((x) => x.src.startsWith('agents/'))) {
    const fm = frontmatter(await fs.readFile(path.join(TEMPLATE_DIR, f.src), 'utf8'));
    assert.equal(fm.name, path.basename(f.src, '.md'));
    assert.ok(fm.description.length > 0);
    assert.equal(fm.tools, 'Bash, Read, Grep, Glob, Write');
  }
});

test('skill: frontmatter name matches the directory, description says when to use it', async () => {
  const f = FILES.find((x) => x.src.endsWith('SKILL.md'));
  const fm = frontmatter(await fs.readFile(path.join(TEMPLATE_DIR, f.src), 'utf8'));
  assert.equal(fm.name, path.basename(path.dirname(f.src)));
  assert.match(fm.name, /^[a-z0-9-]+$/);
  assert.match(fm.description, /^Use when /);
  assert.ok(fm.description.length <= 1024);
});

test('templates: merge mechanics and local runs are left to the project', async () => {
  // Opinionated rules that projects handle differently; they belong in section 4, not here.
  const opinionated = /update-branch|never squash|never rebase|squash|--merge\b|merge the base branch into|worktree add|throwaway worktree|decisions table/i;
  for (const f of templateFiles) {
    for (const [i, line] of (await fs.readFile(f, 'utf8')).split('\n').entries()) {
      assert.doesNotMatch(line, opinionated, `${path.relative(ROOT, f)}:${i + 1}`);
    }
  }
});
