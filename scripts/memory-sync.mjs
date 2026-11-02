#!/usr/bin/env node
// 项目记忆同步：本地 .workbuddy/memory/  <->  仓库 memory/
//
// 背景：.workbuddy/ 被 .gitignore 排除（内部状态不进仓库），导致换机器后
// 助手读不到项目记忆。本脚本把记忆目录镜像到仓库内的 memory/，让记忆随 git 走。
//
// 用法：
//   node scripts/memory-sync.mjs           本地 → 仓库（写完记忆后跑，然后提交）
//   node scripts/memory-sync.mjs --pull    仓库 → 本地（换机器 clone 后跑一次）
//   node scripts/memory-sync.mjs --check   只比较不写盘；有差异退出码 1（可用于提交前检查）
//
// 安全策略：
//   · push（默认）是真正的镜像：仓库 memory/ 会删掉本地已不存在的 .md，保证两边一致
//   · pull 只补不删：本地已存在且内容不同的文件会被跳过并提示，避免覆盖另一台机器上的新记录

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = path.join(ROOT, '.workbuddy', 'memory');
const REPO = path.join(ROOT, 'memory');
// 仓库 memory/ 内的说明文件，不参与镜像（本地记忆目录里没有它，别被清掉）
const PROTECTED = new Set(['README.md']);

const args = process.argv.slice(2);
const mode = args.includes('--pull') ? 'pull' : args.includes('--check') ? 'check' : 'push';

/** 读目录下的 .md 文件名清单（不存在则返回空数组；README 类说明文件不参与镜像） */
function listMd(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !PROTECTED.has(f)).sort();
}

function readFileOrNull(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ── 检查模式：逐文件比较 ─────────────────────────────────────────────
if (mode === 'check') {
  const localFiles = listMd(LOCAL);
  const repoFiles = listMd(REPO);
  const all = [...new Set([...localFiles, ...repoFiles])].sort();
  let diff = 0;
  for (const f of all) {
    const a = readFileOrNull(path.join(LOCAL, f));
    const b = readFileOrNull(path.join(REPO, f));
    if (a === null) { console.log(`  仅仓库有：${f}`); diff++; }
    else if (b === null) { console.log(`  未同步：  ${f}`); diff++; }
    else if (a !== b) { console.log(`  内容不同：${f}`); diff++; }
  }
  if (diff === 0) {
    console.log('记忆已同步（本地与仓库 memory/ 完全一致）');
    process.exit(0);
  }
  console.log(`\n共 ${diff} 处差异 → 跑 node scripts/memory-sync.mjs 同步后再提交`);
  process.exit(1);
}

// ── 拉取：仓库 → 本地（只补不删）─────────────────────────────────────
if (mode === 'pull') {
  const repoFiles = listMd(REPO);
  if (repoFiles.length === 0) {
    console.error('仓库内 memory/ 为空或不存在，没有可拉取的记忆。');
    process.exit(1);
  }
  ensureDir(LOCAL);
  let copied = 0, skipped = 0;
  for (const f of repoFiles) {
    const src = path.join(REPO, f);
    const dst = path.join(LOCAL, f);
    const repoText = readFileOrNull(src) ?? '';
    const localText = readFileOrNull(dst);
    if (localText !== null && localText !== repoText) {
      console.log(`  跳过（本地已有不同内容）：${f}`);
      skipped++;
      continue;
    }
    if (localText === repoText) continue;
    fs.writeFileSync(dst, repoText, 'utf8');
    console.log(`  还原：${f}`);
    copied++;
  }
  console.log(`\n拉取完成：还原 ${copied} 个，跳过 ${skipped} 个 → ${LOCAL}`);
  process.exit(0);
}

// ── 推送：本地 → 仓库（镜像）─────────────────────────────────────────
const localFiles = listMd(LOCAL);
if (localFiles.length === 0) {
  console.error(`本地记忆目录为空或不存在：${LOCAL}`);
  process.exit(1);
}
ensureDir(REPO);
let copied = 0;
for (const f of localFiles) {
  const src = path.join(LOCAL, f);
  const dst = path.join(REPO, f);
  const text = readFileOrNull(src) ?? '';
  if (readFileOrNull(dst) === text) continue;
  fs.writeFileSync(dst, text, 'utf8');
  console.log(`  同步：${f}`);
  copied++;
}
// 镜像语义：清掉仓库里本地已不存在的 md
let removed = 0;
for (const f of listMd(REPO)) {
  if (!localFiles.includes(f)) {
    fs.rmSync(path.join(REPO, f));
    console.log(`  移除（本地已无）：${f}`);
    removed++;
  }
}
console.log(`\n同步完成：更新 ${copied} 个，移除 ${removed} 个 → memory/（记得 git add）`);
