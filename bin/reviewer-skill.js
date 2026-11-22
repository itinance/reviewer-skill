#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { install, snippetBlock } from '../lib/install.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const HELP = `reviewer-skill ${pkg.version}

Installs the 3-reviewer PR process for Claude Code into a project:
  .claude/agents/review-{correctness,security,tests}.md
  .claude/skills/review-round/SKILL.md
  docs/REVIEW_AND_MERGE.md          (template, fill in the TODO(project) gates)
  CLAUDE.md section, .gitignore entry (optional: asked, or by flag)

Usage:
  reviewer-skill [install] [options]
  reviewer-skill print-snippet      print the CLAUDE.md section
  reviewer-skill --help | --version

Options:
  --target <dir>           project root (default: current directory)
  --dry-run                show what would happen; write nothing
  --append-claude-md       append the marked review section to CLAUDE.md (once)
  --gitignore-scratch      add ".scratch/" to .gitignore (once)
  --allow-default-branch   install on the default branch (normally refused)

Existing files are never changed without asking. Without a terminal (for example
when an agent runs it), missing files are created and existing files are left alone;
only the two edits named by --append-claude-md and --gitignore-scratch are made.
There is no flag that answers every question with yes.
`;

function parseArgs(argv) {
  const opts = {
    command: 'install',
    target: process.cwd(),
    dryRun: false,
    appendClaudeMd: false,
    gitignoreScratch: false,
    allowDefaultBranch: false,
  };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === 'install' || a === 'print-snippet') opts.command = a;
    else if (a === '--target') {
      const v = args.shift();
      if (!v) throw new Error('--target needs a directory');
      opts.target = v;
    } else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--append-claude-md') opts.appendClaudeMd = true;
    else if (a === '--gitignore-scratch') opts.gitignoreScratch = true;
    else if (a === '--allow-default-branch') opts.allowDefaultBranch = true;
    else if (a === '--help' || a === '-h') opts.command = 'help';
    else if (a === '--version' || a === '-v') opts.command = 'version';
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

function makeAsk() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return { ask: null, close() {} };
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    async ask(question, choices, fallback) {
      for (;;) {
        const a = (await rl.question(`${question} `)).trim().toLowerCase();
        if (a === '') return fallback;
        if (choices.includes(a[0])) return a[0];
      }
    },
    close: () => rl.close(),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === 'help') return void process.stdout.write(HELP);
  if (opts.command === 'version') return void process.stdout.write(`${pkg.version}\n`);
  if (opts.command === 'print-snippet') return void process.stdout.write(await snippetBlock());

  const prompt = opts.dryRun ? { ask: null, close() {} } : makeAsk();
  let results;
  try {
    results = await install({
      target: opts.target,
      ask: prompt.ask,
      dryRun: opts.dryRun,
      appendClaudeMd: opts.appendClaudeMd,
      gitignoreScratch: opts.gitignoreScratch,
      allowDefaultBranch: opts.allowDefaultBranch,
    });
  } finally {
    prompt.close();
  }

  if (!prompt.ask && !opts.dryRun) {
    process.stdout.write('No terminal: existing files are left alone; optional edits only by flag.\n');
  }
  for (const r of results) {
    process.stdout.write(`  ${r.action.padEnd(12)} ${r.path}${r.note ? `  (${r.note})` : ''}\n`);
  }
  process.stdout.write(`
Next:
  1. Fill in the project gates (section 4) from repo facts:
     sed -n '/^## 4\./,/^## 5\./p' docs/REVIEW_AND_MERGE.md | grep -c 'TODO(project)'   # 0 when done
  2. Restart Claude Code (or open /agents) so that it loads the new agents.
  3. Commit only these files, open a draft PR, and make it the first review round.
`);
}

main().catch((err) => {
  process.stderr.write(`reviewer-skill: ${err.message}\n`);
  process.exit(1);
});
