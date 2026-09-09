// schaledb 爬取模块（独立实现，用 Node 原生 fetch）
import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// 通用超时（防外网挂起连接无限堆积）
const FETCH_TIMEOUT = 60_000;

export async function fetchJson(url, retries = 3) {
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Referer': 'https://schaledb.com/' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      console.log(`[crawler] 第 ${i} 次抓取失败: ${url} (${e.message})`);
      if (i < retries) await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastErr;
}

export async function fetchBinary(url, retries = 3) {
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Referer': 'https://schaledb.com/' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      console.log(`[crawler] 图片下载失败(${i}): ${url} (${e.message})`);
      if (i < retries) await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastErr;
}

// 下载 5 语言学生数据
export async function fetchStudents() {
  const [cn, jp, tw, kr, zh] = await Promise.all([
    fetchJson(config.sources.students.cn),
    fetchJson(config.sources.students.jp),
    fetchJson(config.sources.students.tw),
    fetchJson(config.sources.students.kr),
    fetchJson(config.sources.students.zh),
  ]);
  return { cn, jp, tw, kr, zh };
}

export async function fetchItems() {
  return fetchJson(config.sources.items);
}

// 下载头像到本地
export async function downloadAvatar(id, targetDir, filename) {
  const url = config.avatar.icon(id);
  const buf = await fetchBinary(url);
  await fs.mkdir(targetDir, { recursive: true });
  const filePath = path.join(targetDir, filename);
  await fs.writeFile(filePath, buf);
  return filePath;
}
