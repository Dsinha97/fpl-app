#!/usr/bin/env node
// Graph health check for the docs/ Obsidian vault (read-only).
//
//   node .claude/skills/wiki-ingest/graph-check.mjs            loose dots, no-inbound notes, broken links, missing "Up:", pages in no MOC, top hubs
//   node .claude/skills/wiki-ingest/graph-check.mjs --top 20   same, with a longer hub list
//
// Mirrors what Obsidian draws for a vault rooted at docs/ (docs/.obsidian): every .md file outside
// dot-folders is a node, and a relative markdown link ([text](path) or [text](<path with spaces>))
// to another .md file in the vault is an edge. The graph is undirected, so a loose dot is a note
// with no link in either direction. Built-in modules only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VAULT = path.join(ROOT, 'docs');
const WIKI = path.join(VAULT, 'wiki');
const MOC = path.join(WIKI, 'moc');
const top = process.argv.includes('--top') ? Number(process.argv[process.argv.indexOf('--top') + 1]) || 10 : 10;

const key = (p) => path.normalize(p).toLowerCase();
const rel = (p) => path.relative(VAULT, p).split(path.sep).join('/');

const files = [];
(function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue; // Obsidian never indexes dot-folders
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs);
    else if (ent.isFile() && ent.name.endsWith('.md')) files.push(abs);
  }
})(VAULT);

const byKey = new Map(files.map((f) => [key(f), f]));
const inbound = new Map(files.map((f) => [key(f), new Set()]));
const outbound = new Map(files.map((f) => [key(f), new Set()]));
const broken = []; // [from, target]: outside the vault or missing; hidden on the graph (hideUnresolved)
const LINK = /\]\(\s*(<[^>]+>|[^)\s]+)/g;
const text = new Map();

for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  text.set(f, s);
  for (const m of s.matchAll(LINK)) {
    let t = m[1].replace(/^<|>$/g, '').split('#')[0];
    if (!t || /^[a-z]+:/i.test(t)) continue;
    try { t = decodeURIComponent(t); } catch {}
    const abs = path.resolve(path.dirname(f), t);
    const k = key(abs);
    if (k === key(f)) continue;
    if (inbound.has(k)) { inbound.get(k).add(key(f)); outbound.get(key(f)).add(k); }
    else if (!key(abs).startsWith(key(VAULT) + path.sep) || !fs.existsSync(abs)) broken.push([f, t]);
    // anything else is an existing attachment or folder inside the vault: not a note, not a problem
  }
}

const inWiki = (f) => key(f).startsWith(key(WIKI) + path.sep);
// index, log and the AGENTS.md contract are the wiki's own scaffolding, not topic pages.
const isHubFile = (f) => key(path.dirname(f)) === key(WIKI) && ['index.md', 'log.md', 'agents.md'].includes(path.basename(f).toLowerCase());
const isMoc = (f) => key(path.dirname(f)) === key(MOC);

const loose = files.filter((f) => inbound.get(key(f)).size === 0 && outbound.get(key(f)).size === 0);
const noInbound = files.filter((f) => inbound.get(key(f)).size === 0 && outbound.get(key(f)).size > 0);
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
console.log(`Vault: docs/ (${files.length} notes)`);
section('Loose dots: no link in or out', loose);
section('No inbound link (attached only by their own outbound links)', noInbound);
console.log(`\nLinks out of the vault or to missing files (${broken.length})`);
for (const [f, t] of broken) console.log(`  ${rel(f)} -> ${t}`);
section('Wiki pages missing an "Up:" line', noUp);
section('Wiki pages listed in no MOC', noMoc);
console.log(`\nMost-linked notes (top ${top})`);
for (const [k, s] of hubs) console.log(`  ${String(s.size).padStart(3)}  ${rel(byKey.get(k))}`);
