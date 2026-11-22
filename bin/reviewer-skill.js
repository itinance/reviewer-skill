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
  CLAUDE.md section, .gitignore entry (optional, asked)

Usage:
  reviewer-skill [install] [--target <dir>] [--dry-run]
  reviewer-skill print-snippet      print the CLAUDE.md section
  reviewer-skill --help | --version

Existing files are never changed without asking. Without a terminal (for example
when an agent runs it), missing files are created and existing files are left alone.
`;

function parseArgs(argv) {
  const opts = { command: 'install', target: process.cwd(), dryRun: false };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === 'install' || a === 'print-snippet') opts.command = a;
    else if (a === '--target') {
      const v = args.shift();
      if (!v) throw new Error('--target needs a directory');
      opts.target = v;
    } else if (a === '--dry-run') opts.dryRun = true;
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
    results = await install({ target: opts.target, ask: prompt.ask, dryRun: opts.dryRun });
  } finally {
    prompt.close();
  }

  if (!prompt.ask && !opts.dryRun) {
    process.stdout.write('No terminal: existing files are left alone, optional steps are skipped.\n');
  }
  for (const r of results) {
    process.stdout.write(`  ${r.action.padEnd(12)} ${r.path}${r.note ? `  (${r.note})` : ''}\n`);
  }
  process.stdout.write(`
Next:
  1. Fill in the project gates: grep -n "TODO(project)" docs/REVIEW_AND_MERGE.md
  2. Restart Claude Code (or open /agents) so that it loads the new agents.
  3. Review a PR: ask Claude to "run a review round on PR <number>".
`);
}

main().catch((err) => {
  process.stderr.write(`reviewer-skill: ${err.message}\n`);
  process.exit(1);
});
