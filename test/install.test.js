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
