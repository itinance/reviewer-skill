import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  install,
  branchInfo,
  FILES,
  readTemplate,
  snippetBlock,
  ignoresScratch,
  SNIPPET_START,
  NEW_SUFFIX,
} from '../lib/install.js';

const run = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/reviewer-skill.js', import.meta.url));

async function tmpProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reviewer-skill-test-'));
}

// Scripted answers for `ask`; fails the test if more questions come than expected.
function scripted(answers) {
  const asked = [];
  const ask = async (question) => {
    asked.push(question);
    if (!answers.length) throw new Error(`unexpected question: ${question}`);
    return answers.shift();
  };
  return { ask, asked };
}

const byPath = (results) => Object.fromEntries(results.map((r) => [r.path, r]));

test('fresh project: creates every file with the template content, skips optional steps', async () => {
  const dir = await tmpProject();
  const res = byPath(await install({ target: dir }));
  for (const f of FILES) {
    assert.equal(res[f.dest].action, 'created', f.dest);
    assert.equal(await fs.readFile(path.join(dir, f.dest), 'utf8'), await readTemplate(f.src));
  }
  assert.equal(res['CLAUDE.md'].action, 'skipped');
  assert.equal(res['.gitignore'].action, 'skipped');
  await assert.rejects(fs.access(path.join(dir, 'CLAUDE.md')));
  await assert.rejects(fs.access(path.join(dir, '.gitignore')));
});

test('second run reports unchanged and asks nothing', async () => {
  const dir = await tmpProject();
  await install({ target: dir });
  const { ask, asked } = scripted([]);
  await fs.writeFile(path.join(dir, '.gitignore'), '.scratch/\n');
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), `# P\n\n${await snippetBlock()}`);
  const res = await install({ target: dir, ask });
  assert.deepEqual(asked, []);
  for (const r of res) assert.equal(r.action, 'unchanged', r.path);
});

test('non-interactive: an existing file with other content is never changed', async () => {
  const dir = await tmpProject();
  const dest = path.join(dir, FILES[0].dest);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, 'my own reviewer\n');
  const res = byPath(await install({ target: dir }));
  assert.equal(res[FILES[0].dest].action, 'skipped');
  assert.equal(await fs.readFile(dest, 'utf8'), 'my own reviewer\n');
  await assert.rejects(fs.access(dest + NEW_SUFFIX));
});

test('interactive: skip keeps the file, overwrite replaces it, new writes a side file', async () => {
  const dir = await tmpProject();
  const [a, b, c] = FILES.map((f) => path.join(dir, f.dest));
  for (const p of [a, b, c]) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, 'local\n');
  }
  const { ask, asked } = scripted(['s', 'o', 'n', 'n', 'n']);
  const res = byPath(await install({ target: dir, ask }));
  assert.equal(asked.length, 5); // 3 conflicts + CLAUDE.md + .gitignore
  assert.equal(res[FILES[0].dest].action, 'skipped');
  assert.equal(await fs.readFile(a, 'utf8'), 'local\n');
  assert.equal(res[FILES[1].dest].action, 'overwritten');
  assert.equal(await fs.readFile(b, 'utf8'), await readTemplate(FILES[1].src));
  assert.equal(res[FILES[2].dest].action, 'new-file');
  assert.equal(await fs.readFile(c, 'utf8'), 'local\n');
  assert.equal(await fs.readFile(c + NEW_SUFFIX, 'utf8'), await readTemplate(FILES[2].src));
});

test('an existing side file is not overwritten', async () => {
  const dir = await tmpProject();
  const p = path.join(dir, FILES[0].dest);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, 'local\n');
  await fs.writeFile(p + NEW_SUFFIX, 'older side file\n');
  const { ask } = scripted(['n', 'n', 'n']);
  const res = byPath(await install({ target: dir, ask }));
  assert.equal(res[FILES[0].dest].action, 'skipped');
  assert.equal(await fs.readFile(p + NEW_SUFFIX, 'utf8'), 'older side file\n');
});

test('a symlink at a destination is not followed or replaced', async () => {
  const dir = await tmpProject();
  const outside = path.join(await tmpProject(), 'victim.md');
  await fs.writeFile(outside, 'do not touch\n');
  const p = path.join(dir, FILES[0].dest);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.symlink(outside, p);
  const { ask } = scripted(['n', 'n']);
  const res = byPath(await install({ target: dir, ask }));
  assert.equal(res[FILES[0].dest].action, 'skipped');
  assert.equal(await fs.readFile(outside, 'utf8'), 'do not touch\n');
  assert.ok((await fs.lstat(p)).isSymbolicLink());
});

test('dry run writes nothing and asks nothing', async () => {
  const dir = await tmpProject();
  const { ask, asked } = scripted([]);
  const res = await install({ target: dir, ask, dryRun: true });
  assert.deepEqual(asked, []);
  assert.deepEqual(await fs.readdir(dir), []);
  for (const f of FILES) assert.equal(byPath(res)[f.dest].action, 'would-create');
});

test('CLAUDE.md: appends the marked section once and keeps the existing text', async () => {
  const dir = await tmpProject();
  const claude = path.join(dir, 'CLAUDE.md');
  await fs.writeFile(claude, '# My project\n\nKeep this.');
  await install({ target: dir, ask: scripted(['y', 'n']).ask });
  const text = await fs.readFile(claude, 'utf8');
  assert.ok(text.startsWith('# My project\n\nKeep this.\n\n'));
  assert.ok(text.endsWith(await snippetBlock()));
  const again = byPath(await install({ target: dir, ask: scripted(['n']).ask }));
  assert.equal(again['CLAUDE.md'].action, 'unchanged');
  assert.equal(text.split(SNIPPET_START).length, 2);
});

test('CLAUDE.md: declined means untouched', async () => {
  const dir = await tmpProject();
  const claude = path.join(dir, 'CLAUDE.md');
  await fs.writeFile(claude, '# Mine\n');
  await install({ target: dir, ask: scripted(['n', 'n']).ask });
  assert.equal(await fs.readFile(claude, 'utf8'), '# Mine\n');
});

test('.gitignore: appends the entry on a new line', async () => {
  const dir = await tmpProject();
  const gi = path.join(dir, '.gitignore');
  await fs.writeFile(gi, 'node_modules');
  await install({ target: dir, ask: scripted(['n', 'y']).ask });
  assert.equal(await fs.readFile(gi, 'utf8'), 'node_modules\n.scratch/\n');
});

test('ignoresScratch recognises common forms only', () => {
  assert.ok(ignoresScratch('a\n.scratch/\n'));
  assert.ok(ignoresScratch('/.scratch'));
  assert.ok(ignoresScratch('x\r\n.scratch\r\n'));
  assert.ok(!ignoresScratch('.scratchpad/\n# .scratch/\n'));
});

test('a target that is not a directory is rejected', async () => {
  const dir = await tmpProject();
  await assert.rejects(install({ target: path.join(dir, 'missing') }), /not a directory/);
});

test('CLI: install without a terminal creates files and leaves existing ones alone', async () => {
  const dir = await tmpProject();
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), '# Mine\n');
  const { stdout } = await run(process.execPath, [BIN, 'install', '--target', dir]);
  assert.match(stdout, /No terminal/);
  assert.match(stdout, /created\s+\.claude\/agents\/review-tests\.md/);
  assert.equal(await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8'), '# Mine\n');
});

test('CLI: --version, print-snippet, unknown argument', async () => {
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal((await run(process.execPath, [BIN, '--version'])).stdout.trim(), pkg.version);
  assert.equal((await run(process.execPath, [BIN, 'print-snippet'])).stdout, await snippetBlock());
  await assert.rejects(run(process.execPath, [BIN, '--force']), /unknown argument/);
});

// --- 0.2.0: explicit optional edits, branch guard ---------------------------------

test('flags: non-interactive run makes the two named edits, once', async () => {
  const dir = await tmpProject();
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), '# Mine\n');
  await fs.writeFile(path.join(dir, '.gitignore'), 'dist/\n');
  const opts = { target: dir, appendClaudeMd: true, gitignoreScratch: true };
  const first = byPath(await install(opts));
  assert.equal(first['CLAUDE.md'].action, 'appended');
  assert.equal(first['.gitignore'].action, 'appended');
  const second = byPath(await install(opts));
  assert.equal(second['CLAUDE.md'].action, 'unchanged');
  assert.equal(second['.gitignore'].action, 'unchanged');
  const claude = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.equal(claude.split(SNIPPET_START).length, 2);
  assert.equal(await fs.readFile(path.join(dir, '.gitignore'), 'utf8'), 'dist/\n.scratch/\n');
});

test('flags: an existing .scratch line is kept as it is', async () => {
  const dir = await tmpProject();
  await fs.writeFile(path.join(dir, '.gitignore'), '/.scratch\n');
  const res = byPath(await install({ target: dir, gitignoreScratch: true }));
  assert.equal(res['.gitignore'].action, 'unchanged');
  assert.equal(await fs.readFile(path.join(dir, '.gitignore'), 'utf8'), '/.scratch\n');
});

test('flags: with a terminal, a named edit is not asked again', async () => {
  const dir = await tmpProject();
  const { ask, asked } = scripted([]);
  const res = byPath(await install({ target: dir, ask, appendClaudeMd: true, gitignoreScratch: true }));
  assert.deepEqual(asked, []);
  assert.equal(res['CLAUDE.md'].action, 'created');
  assert.equal(res['.gitignore'].action, 'created');
});

test('flags: dry run reports the named edits and writes nothing', async () => {
  const dir = await tmpProject();
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), '# Mine\n');
  const res = byPath(await install({ target: dir, dryRun: true, appendClaudeMd: true, gitignoreScratch: true }));
  assert.equal(res['CLAUDE.md'].action, 'would-append');
  assert.equal(res['.gitignore'].action, 'would-create');
  assert.equal(await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8'), '# Mine\n');
  await assert.rejects(fs.access(path.join(dir, '.gitignore')));
});

async function gitRepo(branch = 'main') {
  const dir = await tmpProject();
  await run('git', ['-C', dir, 'init', '-q', '-b', branch]);
  return dir;
}

test('branch guard: refuses on main, writes nothing', async () => {
  const dir = await gitRepo('main');
  await assert.rejects(install({ target: dir }), /default branch "main"/);
  await assert.rejects(fs.access(path.join(dir, '.claude')));
});

test('branch guard: allowed with allowDefaultBranch, and on a feature branch', async () => {
  const onMain = await gitRepo('main');
  assert.equal(byPath(await install({ target: onMain, allowDefaultBranch: true }))[FILES[0].dest].action, 'created');
  const feature = await gitRepo('chore/reviewer-skill');
  assert.equal(byPath(await install({ target: feature }))[FILES[0].dest].action, 'created');
});

test('branch guard: origin/HEAD decides the default branch', async () => {
  const dir = await gitRepo('develop');
  await run('git', ['-C', dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop']);
  await assert.rejects(install({ target: dir }), /default branch "develop"/);
  const info = await branchInfo(dir);
  assert.deepEqual(info.defaults, ['develop']);
});

test('branch guard: dry run on main reports would-refuse', async () => {
  const dir = await gitRepo('main');
  const res = await install({ target: dir, dryRun: true });
  assert.equal(res[0].action, 'would-refuse');
  assert.deepEqual(await fs.readdir(dir), ['.git']);
});

test('CLI: refuses on main with exit 1, explicit flags work on a branch', async () => {
  const main = await gitRepo('main');
  await assert.rejects(run(process.execPath, [BIN, 'install', '--target', main]), /default branch/);
  const dir = await gitRepo('chore/x');
  const { stdout } = await run(process.execPath, [BIN, 'install', '--target', dir, '--append-claude-md', '--gitignore-scratch']);
  assert.match(stdout, /created\s+CLAUDE\.md/);
  assert.equal(await fs.readFile(path.join(dir, '.gitignore'), 'utf8'), '.scratch/\n');
});

test('docs template: the open-gate marker appears only in section 4', async () => {
  const text = await readTemplate('docs/REVIEW_AND_MERGE.md');
  const s4 = text.slice(text.indexOf('\n## 4.'), text.indexOf('\n## 5.'));
  const all = text.split('TODO(project)').length - 1;
  assert.ok(all > 0);
  assert.equal(s4.split('TODO(project)').length - 1, all);
});
