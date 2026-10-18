#!/usr/bin/env node
// Graph health check for docs/ as an Obsidian vault (read-only).
//
//   node .claude/skills/wiki-ingest/graph-check.mjs            orphans, wiki pages missing an "Up:" line, wiki pages in no MOC, top hubs
//   node .claude/skills/wiki-ingest/graph-check.mjs --top 20   same, with a longer hub list
//
// Counts relative markdown links ([text](path) and [text](<path with spaces>)) the way Obsidian draws them.
// An orphan is a .md file under docs/ with no inbound link from any other .md file in docs/ or the repo root.
// Built-in modules only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DOCS = path.join(ROOT, 'docs');
const WIKI = path.join(DOCS, 'wiki');
const MOC = path.join(WIKI, 'moc');
const top = process.argv.includes('--top') ? Number(process.argv[process.argv.indexOf('--top') + 1]) || 10 : 10;

const key = (p) => path.normalize(p).toLowerCase();
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

const files = [];
(function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs);
    else if (ent.isFile() && ent.name.endsWith('.md')) files.push(abs);
  }
})(DOCS);
// Root CLAUDE.md / AGENTS.md / README.md link into docs/, so they count as linkers, never as orphans.
const rootFiles = fs.readdirSync(ROOT).filter((n) => n.endsWith('.md')).map((n) => path.join(ROOT, n));

const byKey = new Map(files.map((f) => [key(f), f]));
const inbound = new Map(files.map((f) => [key(f), new Set()]));
const LINK = /\]\(\s*(<[^>]+>|[^)\s]+)/g;
const text = new Map();

for (const f of [...files, ...rootFiles]) {
  const s = fs.readFileSync(f, 'utf8');
  text.set(f, s);
  for (const m of s.matchAll(LINK)) {
    let t = m[1].replace(/^<|>$/g, '').split('#')[0];
    if (!t || /^[a-z]+:/i.test(t)) continue;
    try { t = decodeURIComponent(t); } catch {}
    const k = key(path.resolve(path.dirname(f), t));
    if (k !== key(f) && inbound.has(k)) inbound.get(k).add(key(f));
  }
}

const inWiki = (f) => key(f).startsWith(key(WIKI) + path.sep);
// index, log and the AGENTS.md contract are the wiki's own scaffolding, not topic pages.
const isHubFile = (f) => key(path.dirname(f)) === key(WIKI) && ['index.md', 'log.md', 'agents.md'].includes(path.basename(f).toLowerCase());
const isMoc = (f) => key(path.dirname(f)) === key(MOC);

const orphans = files.filter((f) => inbound.get(key(f)).size === 0);
// The "Up:" line must be the first text after the page's H1.
const afterTitle = (s) => s.replace(/^﻿?#[^\n]*\n/, '').trimStart();
const noUp = files.filter((f) => inWiki(f) && !isHubFile(f) && !afterTitle(text.get(f)).startsWith('Up: ['));
const mocs = files.filter(isMoc);
const noMoc = files.filter((f) => inWiki(f) && !isHubFile(f) && !isMoc(f) && !mocs.some((m) => inbound.get(key(f)).has(key(m))));
const hubs = [...inbound.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, top);

const section = (title, list) => {
  console.log(`\n${title} (${list.length})`);
  for (const f of list) console.log(`  ${rel(f)}`);
};
section('Orphans: no inbound link', orphans);
section('Wiki pages missing an "Up:" line', noUp);
section('Wiki pages listed in no MOC', noMoc);
console.log(`\nMost-linked pages (top ${top})`);
for (const [k, s] of hubs) console.log(`  ${String(s.size).padStart(3)}  ${rel(byKey.get(k))}`);
