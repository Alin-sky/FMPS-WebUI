// 漫画更新模块：从腾讯 COS 拉取话数 + gamekee 自动抓取（Referer 头）
// 生成的 manga_main.json 键名与老 FMPS 系统一致：[{ id, wikiurl }]
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { config } from './config.js';
import { fetchCloudJson } from './cloud.js';
import { crawlEvents } from './crawl.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const GK_HEADERS = {
  'User-Agent': UA,
  'Referer': 'https://www.gamekee.com/',
  'game-alias': 'ba',
  'X-Requested-With': 'XMLHttpRequest',
  'Accept': 'application/json',
};

// id 段与系列标题的映射（沿用老 FMPS 的编号约定）
// 布噜布噜档案1和[CN]布噜布噜档案2共用9000段（合计约49话，9000-9048）
const SEGMENT_MAP = {
  '[JP]【碧蓝档案！】': { base: 1000 },
  '[GL]【蔚蓝档案四格漫画】': { base: 3000 },
  '[JP]【青春记录】': { base: 6000 },
  '布噜布噜档案1': { base: 9000 },
  '[CN]布噜布噜档案2': { base: 9000 },
};
// 默认段（未登记系列的新话落到 9200 之后）
const FALLBACK_BASE = 9200;

const mangaInfoPath = () => path.join(config.dataDir, 'manga_info.json');
const mangaMainPath = () => path.join(config.jsonDir, 'manga_main.json');

function log(msg) {
  crawlEvents.emit('log', msg);
}

// 规范化图片 URL（处理 // 开头的协议相对路径，统一 CDN 域名避免伪更新）
function normalizeImgUrl(url) {
  if (!url) return url;
  if (url.startsWith('//')) url = 'https:' + url;
  if (!url.startsWith('http')) url = 'https:' + url;
  // 统一 gamekee CDN 域名，避免 cdnimg 和 cdnimg-v2 切换导致的数据“伪更新”
  url = url.replace('//cdnimg-v2.gamekee.com/', '//cdnimg.gamekee.com/');
  return url;
}

// 提取图片路径键（去掉域名，用于新旧 CDN 域名 cdnimg / cdnimg-v2 的匹配去重）
function urlPathKey(url) {
  try {
    return new URL(normalizeImgUrl(url)).pathname;
  } catch {
    return url;
  }
}

async function gkGet(url) {
  const res = await fetch(url, { headers: GK_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// ---------- 读取本地数据 ----------

export async function readMangaMain() {
  try {
    return JSON.parse(await fs.readFile(mangaMainPath(), 'utf8'));
  } catch {
    return [];
  }
}

export async function readMangaInfo() {
  try {
    return JSON.parse(await fs.readFile(mangaInfoPath(), 'utf8'));
  } catch {
    return { episodes: [], categories: {} };
  }
}

async function writeMangaMain(list) {
  await fs.mkdir(config.jsonDir, { recursive: true });
  await fs.writeFile(mangaMainPath(), JSON.stringify(list, null, 2), 'utf8');
}

async function writeMangaInfo(info) {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(mangaInfoPath(), JSON.stringify(info, null, 2), 'utf8');
}

// ---------- 系列排除配置（汉化合集/同人漫画等不爬取的系列） ----------

const mangaExcludePath = () => path.join(config.dataDir, 'manga-exclude.json');

export async function readMangaExclude() {
  try {
    const raw = JSON.parse(await fs.readFile(mangaExcludePath(), 'utf8'));
    // 兼容纯数组与 { series: [...] } 两种格式
    const series = Array.isArray(raw) ? raw : Array.isArray(raw.series) ? raw.series : [];
    return { series };
  } catch {
    return { series: [] };
  }
}

async function writeMangaExclude(series) {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(mangaExcludePath(), JSON.stringify({ series }, null, 2), 'utf8');
}

// 设置排除系列（全量覆盖）
export async function setMangaExclude(series) {
  const list = [...new Set((series || []).filter(Boolean))];
  await writeMangaExclude(list);
  return { series: list };
}

// 删除系列爬取记录：从 manga_info 与 manga_main 中移除该系列全部话数/条目，
// 默认同时加入排除名单（后续爬取自动跳过）。返回删除统计。
export async function deleteMangaSeries(seriesNames, { exclude = true } = {}) {
  const names = new Set((seriesNames || []).filter(Boolean));
  if (names.size === 0) return { removedEpisodes: 0, removedEntries: 0, series: [], excluded: [] };
  const info = await readMangaInfo();
  const main = await readMangaMain();
  const removedIds = new Set();
  const keptEpisodes = [];
  for (const ep of info.episodes || []) {
    if (names.has(ep.series)) removedIds.add(String(ep.id));
    else keptEpisodes.push(ep);
  }
  const keptMain = main.filter((m) => !removedIds.has(String(m.id)));
  const removedEpisodes = removedIds.size;
  const removedEntries = main.length - keptMain.length;
  info.episodes = keptEpisodes;
  await writeMangaInfo(info);
  await writeMangaMain(keptMain);
  let excluded = [];
  if (exclude) {
    const cur = await readMangaExclude();
    excluded = [...new Set([...cur.series, ...names])];
    await writeMangaExclude(excluded);
  }
  log(`🗑️ 已删除 ${names.size} 个系列的爬取记录（${removedEpisodes} 话 / ${removedEntries} 条 manga_main 条目）：${[...names].join('、')}`);
  return { removedEpisodes, removedEntries, series: [...names], excluded };
}

// ---------- gamekee 抓取 ----------

// 递归拉取分类树（pid=51508 是漫画总入口）
export async function fetchCategoryTree(pid = 51508) {
  const res = await gkGet(`https://www.gamekee.com/v1/entry/treesByPid?pid=${pid}`);
  if (res.code !== 0 || !Array.isArray(res.data)) throw new Error(`gamekee 目录失败: ${res.msg || '未知错误'}`);
  return res.data;
}

// 递归收集话数：children 里 content_id>0 的是话，grad>0 且无 content_id 的继续钻
async function collectEpisodes(entryId, out, depth = 0, subName = '') {
  if (depth > 4) return; // 防止无限递归
  const children = await fetchCategoryTree(entryId);
  for (const c of children) {
    if (c.content_id > 0) {
      out.push({ ...c, subName });
    } else if (c.grad > 0) {
      await collectEpisodes(c.id, out, depth + 1, subName);
    }
  }
}

// 拉取完整树（按 tab_num 分组：grad=1 是系列标题，grad=2 是其子分类，grad=0 是独立系列）
export async function fetchFullTree() {
  const roots = await fetchCategoryTree(51508);
  const categories = [];
  let currentSeries = null;
  for (const r of roots) {
    if (r.grad === 1) {
      // 新系列标题
      const seg = SEGMENT_MAP[r.name] || null;
      currentSeries = {
        id: r.id,
        name: r.name,
        tab: r.tab_num,
        sort: r.sort,
        grad: 1,
        segment: seg,
        subCategories: [],
        episodes: [],
      };
      categories.push(currentSeries);
      try {
        await collectEpisodes(r.id, currentSeries.episodes, 0, '');
      } catch (e) {
        currentSeries.error = e.message;
        log(`⚠️ 系列「${r.name}」目录抓取失败：${e.message}`);
      }
    } else if (r.grad === 2 && currentSeries) {
      // 子分类（1-100 / 101-200 等），归入当前系列
      currentSeries.subCategories.push(r.name);
      try {
        await collectEpisodes(r.id, currentSeries.episodes, 0, r.name);
      } catch (e) {
        log(`⚠️ 子分类「${currentSeries.name} / ${r.name}」抓取失败：${e.message}`);
      }
    } else {
      // grad=0 独立系列（画廊 / 布噜布噜档案1 等）
      const cat = {
        id: r.id,
        name: r.name,
        tab: r.tab_num,
        sort: r.sort,
        grad: 0,
        segment: SEGMENT_MAP[r.name] || null,
        episodes: [],
      };
      try {
        await collectEpisodes(r.id, cat.episodes, 0, '');
      } catch (e) {
        cat.error = e.message;
        log(`⚠️ 系列「${r.name}」目录抓取失败：${e.message}`);
      }
      categories.push(cat);
      currentSeries = null; // 独立系列后，后续 grad=2 不再归入前面的系列
    }
  }
  // 汇总日志
  for (const c of categories) {
    log(`📁 [${c.name}] ${c.episodes.length} 话${c.subCategories && c.subCategories.length ? `（子分类：${c.subCategories.join('、')}）` : ''}`);
  }
  return categories;
}

// 抓取单话正文，提取图片列表 + 标题
export async function fetchEpisode(contentId) {
  const detail = await gkGet(`https://www.gamekee.com/v1/content/detail/${contentId}`);
  if (detail.code !== 0 || !detail.data) throw new Error(`话详情失败(${contentId}): ${detail.msg || '未知'}`);
  const d = detail.data;
  let cdn = d.content_cdn || '';
  if (cdn.startsWith('//')) cdn = 'https:' + cdn;
  let images = [];
  let textPreview = '';
  if (cdn) {
    try {
      const bodyRes = await fetch(cdn, {
        headers: { 'User-Agent': UA, 'Referer': 'https://www.gamekee.com/' },
      });
      const body = await bodyRes.json();
      const rawContent = body.content;
      // 兼容两种正文格式：新版 CKEditor JSON 数组 / 旧版 HTML 字符串
      if (typeof rawContent === 'string') {
        const trimmed = rawContent.trim();
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          // 新版：CKEditor JSON 字符串
          const parsed = JSON.parse(trimmed);
          images = extractImages(parsed).map(normalizeImgUrl);
          textPreview = extractText(parsed).slice(0, 120);
        } else {
          // 旧版：HTML 字符串，用正则提取 <img> 的 src/data-real
          images = extractImagesFromHtml(trimmed).map(normalizeImgUrl);
          textPreview = extractTextFromHtml(trimmed).slice(0, 120);
        }
      } else if (rawContent && typeof rawContent === 'object') {
        images = extractImages(rawContent).map(normalizeImgUrl);
        textPreview = extractText(rawContent).slice(0, 120);
      }
    } catch (e) {
      // 正文 CDN 失败不致命，images 留空
    }
  }
  return { contentId, title: d.title, images, textPreview, updatedAt: d.updated_at };
}

// 从旧版 HTML 正文提取漫画图片（<img> 的 src / data-real）
function extractImagesFromHtml(html) {
  const out = [];
  const re = /<img[^>]+?(?:src|data-real)=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    if (!/cdnimg|gamekee/.test(url)) continue;
    // 只保留漫画正文大图（含 w_/h_ 尺寸参数的正图），过滤表情 gif 等小图
    if (/w_\d+\/h_\d+/.test(url) || /\.webp|\.png|\.jpe?g/.test(url)) {
      out.push(url);
    }
  }
  return out;
}

// 从旧版 HTML 正文提取文字预览
function extractTextFromHtml(html) {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

// 从 CKEditor 正文 JSON 提取漫画图片（type=image 的 src + type=image-album 的 data 数组）
function extractImages(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach((n) => extractImages(n, out));
    return out;
  }
  if (node && typeof node === 'object') {
    // 单图：type=image 的 src
    if (node.type === 'image' && typeof node.src === 'string' && /cdnimg|gamekee/.test(node.src)) {
      out.push(node.src);
    }
    // 图集：type=image-album 的 data 数组
    if (node.type === 'image-album' && Array.isArray(node.data)) {
      for (const url of node.data) {
        if (typeof url === 'string' && /cdnimg|gamekee/.test(url)) out.push(url);
      }
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') extractImages(v, out);
    }
  }
  return out;
}

function extractText(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach((n) => extractText(n, out));
    return out;
  }
  if (node && typeof node === 'object') {
    if (typeof node.text === 'string' && node.text.trim()) out.push(node.text.trim());
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') extractText(v, out);
    }
  }
  return out.join(' ');
}

// ---------- 主图选择算法 ----------

// 从 gamekee CDN URL 的 w_/h_ 参数解析图片尺寸（如 .../w_800/h_1280/...）
export function parseDimsFromUrl(url) {
  const m = normalizeImgUrl(url || '').match(/w_(\d+)\/h_(\d+)/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return null;
  return { w, h };
}

// 解析图片二进制头获取尺寸（PNG / JPEG / GIF / WebP），无需解码整图
export function parseImageSize(buf) {
  if (!buf || buf.length < 30) return null;
  // PNG: IHDR
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // GIF
  if (buf.slice(0, 3).toString('latin1') === 'GIF') {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  // JPEG: 逐段扫描 SOF 标记
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off++; continue; }
      const marker = buf[off + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) };
      }
      off += 2 + buf.readUInt16BE(off + 2);
    }
    return null;
  }
  // WebP
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') {
    const fmt = buf.slice(12, 16).toString('latin1');
    if (fmt === 'VP8 ') {
      return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    }
    if (fmt === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
    if (fmt === 'VP8X') {
      return {
        w: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
        h: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
      };
    }
  }
  return null;
}

// 获取图片尺寸：优先 URL 参数（免下载），否则走本地缓存/下载后解析图片头
async function getImageDims(url) {
  const fromUrl = parseDimsFromUrl(url);
  if (fromUrl) return fromUrl;
  try {
    const { buf } = await proxyGamekeeImage(url);
    return parseImageSize(buf);
  } catch {
    return null;
  }
}

// 主图选择：获取到多张图时，保留「最大且竖屏」的一张作为漫画主图（其余为杂图）。
// 优先在竖屏(h>w)里选面积最大的；若无竖屏则退回面积最大的横图；全部识别失败退回第一张。
export async function selectMainImage(images) {
  if (!images || images.length === 0) return '';
  if (images.length === 1) return images[0];
  const dims = await Promise.all(images.map(getImageDims));
  let bestPortrait = null; // 最大竖屏
  let bestAny = null;      // 最大任意方向
  for (let i = 0; i < images.length; i++) {
    const d = dims[i];
    if (!d) continue;
    const area = d.w * d.h;
    if (!bestAny || area > bestAny.area) bestAny = { url: images[i], area };
    if (d.h > d.w && (!bestPortrait || area > bestPortrait.area)) bestPortrait = { url: images[i], area };
  }
  const pick = bestPortrait || bestAny;
  return pick ? pick.url : images[0];
}

// ---------- 重复检测与清理（MD5 校验） ----------

// 重复检测：① URL 路径重复（同图不同 CDN 域名/重复录入）② 图片内容 MD5 重复（识图级校验）
export async function checkMangaDuplicates({ withMd5 = true } = {}) {
  const main = await readMangaMain();
  const report = { total: main.length, checked: 0, urlDuplicates: [], md5Duplicates: [] };
  // URL 路径分组
  const byPath = new Map();
  for (const m of main) {
    const k = urlPathKey(m.wikiurl);
    if (!byPath.has(k)) byPath.set(k, []);
    byPath.get(k).push(m);
  }
  for (const [k, group] of byPath) {
    if (group.length > 1) {
      report.urlDuplicates.push({
        image: k,
        entries: group.map((g) => ({ id: g.id, wikiurl: g.wikiurl })).sort((a, b) => Number(a.id) - Number(b.id)),
      });
    }
  }
  // MD5 内容校验（走本地缓存，未缓存的会下载）
  if (withMd5) {
    const byMd5 = new Map();
    const concurrency = 8;
    for (let i = 0; i < main.length; i += concurrency) {
      const chunk = main.slice(i, i + concurrency);
      await Promise.all(chunk.map(async (m) => {
        try {
          const { buf } = await proxyGamekeeImage(m.wikiurl);
          const md5 = createHash('md5').update(buf).digest('hex');
          if (!byMd5.has(md5)) byMd5.set(md5, []);
          byMd5.get(md5).push(m);
          report.checked++;
        } catch {}
      }));
      if (crawlState && crawlState.running) break; // 有爬取任务在跑时中止，避免争抢缓存
    }
    for (const [md5, group] of byMd5) {
      if (group.length > 1) {
        report.md5Duplicates.push({
          md5,
          entries: group.map((g) => ({ id: g.id, wikiurl: g.wikiurl })).sort((a, b) => Number(a.id) - Number(b.id)),
        });
      }
    }
  }
  return report;
}

// 清理重复条目：同一图片（URL 路径或 MD5 内容相同）只保留最小 id 的条目；
// manga_info 中被删条目对应话数的 id 重定向到保留 id。返回删除明细。
export async function cleanMangaDuplicates() {
  const main = await readMangaMain();
  const info = await readMangaInfo();
  // 计算 MD5（走缓存）
  const md5ById = new Map();
  const concurrency = 8;
  for (let i = 0; i < main.length; i += concurrency) {
    const chunk = main.slice(i, i + concurrency);
    await Promise.all(chunk.map(async (m) => {
      try {
        const { buf } = await proxyGamekeeImage(m.wikiurl);
        md5ById.set(String(m.id), createHash('md5').update(buf).digest('hex'));
      } catch {}
    }));
  }
  // 按 id 升序遍历，先到先得：路径或 MD5 任一命中即判为重复
  const sorted = [...main].sort((a, b) => Number(a.id) - Number(b.id));
  const seenPath = new Map(); // pathKey -> 保留 id
  const seenMd5 = new Map();  // md5 -> 保留 id
  const keep = [];
  const removed = [];
  for (const m of sorted) {
    const pk = urlPathKey(m.wikiurl);
    const mk = md5ById.get(String(m.id)) || null;
    const keptByPath = seenPath.get(pk);
    const keptByMd5 = mk ? seenMd5.get(mk) : undefined;
    if (keptByPath !== undefined || keptByMd5 !== undefined) {
      const keptId = keptByPath !== undefined ? keptByPath : keptByMd5;
      removed.push({ id: m.id, keptId, wikiurl: m.wikiurl });
      // info 里该话的 id 重定向到保留 id
      for (const ep of info.episodes || []) {
        if (String(ep.id) === String(m.id)) ep.id = keptId;
      }
    } else {
      seenPath.set(pk, m.id);
      if (mk) seenMd5.set(mk, m.id);
      keep.push(m);
    }
  }
  if (removed.length > 0) {
    await writeMangaMain(keep);
    await writeMangaInfo(info);
  }
  return { removed, kept: keep.length };
}

// 主图置顶：把选中的主图移到 images 数组首位（前端缩略图/预览第一张始终是主图）
function putMainFirst(images, mainUrl) {
  if (!mainUrl || !Array.isArray(images) || images.length === 0) return images;
  if (images[0] === mainUrl) return images;
  return [mainUrl, ...images.filter((u) => u !== mainUrl)];
}

// 主图修复：按「最大竖屏」算法重算全部已抓话数的主图，修正历史上误选的杂图/横图；
// 同时把主图移到 images 首位（前端缩略图与预览第一张始终是主图）
export async function fixMangaMainImages() {
  const info = await readMangaInfo();
  const main = await readMangaMain();
  const mainById = new Map(main.map((m) => [String(m.id), m]));
  let fixed = 0;
  let infoChanged = false;
  for (const ep of info.episodes || []) {
    if (!ep.id || !Array.isArray(ep.images) || ep.images.length === 0) continue;
    const want = await selectMainImage(ep.images);
    if (!want) continue;
    const entry = mainById.get(String(ep.id));
    if (entry) {
      if (entry.wikiurl !== want) {
        entry.wikiurl = want;
        fixed++;
      }
    } else {
      // manga_main 缺失该条目（如被 COS 覆盖丢失）→ 补写回
      main.push({ id: String(ep.id), wikiurl: want });
      mainById.set(String(ep.id), main[main.length - 1]);
      fixed++;
    }
    // 主图置顶
    const reordered = putMainFirst(ep.images, want);
    if (reordered !== ep.images) {
      ep.images = reordered;
      infoChanged = true;
    }
  }
  if (fixed > 0) await writeMangaMain(main);
  if (infoChanged) await writeMangaInfo(info);
  return { fixed, total: (info.episodes || []).length };
}

// ---------- 爬取任务 ----------

let crawlState = null;

export function getMangaCrawlState() {
  return crawlState;
}

// 从 COS 拉取当前 manga_main.json（话数基准）
export async function fetchCosManga() {
  try {
    const data = await fetchCloudJson('manga_main.json');
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

// COS 基线缓存（用于判断新/旧）
let cosBaseline = null;
let cosBaselineAt = 0;
export async function getCosBaselineIds() {
  // 5 分钟缓存
  if (cosBaseline && Date.now() - cosBaselineAt < 5 * 60 * 1000) {
    return cosBaseline;
  }
  const data = await fetchCosManga();
  cosBaseline = data ? new Set(data.map((m) => String(m.id))) : null;
  cosBaselineAt = Date.now();
  return cosBaseline;
}

// 启动爬取：categories 为 [{entryId, name, base}]，从 gamekee 增量抓取
export async function startMangaCrawl(options = {}) {
  if (crawlState && crawlState.running) throw new Error('已有漫画爬取任务在运行');
  const { entryIds } = options;
  crawlState = { running: true, done: 0, total: 0, ok: 0, failed: [], errors: [], startTime: Date.now() };

  // 后台执行
  (async () => {
    try {
      await runMangaCrawl(entryIds);
    } catch (e) {
      log(`❌ 漫画爬取失败：${e.message}`);
      crawlState.errors.push(e.message);
    } finally {
      crawlState.running = false;
      log(`✅ 漫画爬取结束：成功 ${crawlState.ok} / 失败 ${crawlState.failed.length}`);
    }
  })();

  return crawlState;
}

async function runMangaCrawl(entryIds) {
  const info = await readMangaInfo();
  if (!Array.isArray(info.episodes)) info.episodes = [];
  const infoByContent = new Map(info.episodes.map((e) => [e.contentId, e]));

  // 读本地 manga_main，找各段当前最大 id，并建「图片路径 → id」映射用于去重（新/旧判断）
  const main = await readMangaMain();
  const maxIdByBase = {};
  const pathToId = new Map();
  const idExists = new Set();
  for (const item of main) {
    const idNum = Number(item.id);
    const base = Math.floor(idNum / 1000) * 1000;
    if (!maxIdByBase[base] || idNum > maxIdByBase[base]) maxIdByBase[base] = idNum;
    pathToId.set(urlPathKey(item.wikiurl), item.id);
    idExists.add(String(item.id));
  }

  // 拉完整分类树
  log('📚 拉取 gamekee 漫画目录树...');
  const categories = await fetchFullTree();
  log(`📚 共 ${categories.length} 个系列`);

  // 排除名单（汉化合集/同人漫画等）：不爬取这些系列
  const excludeConf = await readMangaExclude();
  const excludeSet = new Set(excludeConf.series);
  if (excludeSet.size > 0) {
    log(`⛔ 排除 ${excludeSet.size} 个系列（已配置不爬取）：${[...excludeSet].join('、')}`);
  }

  // 收集待爬话
  const targets = [];
  for (const cat of categories) {
    if (entryIds && entryIds.length && !entryIds.includes(cat.id)) continue;
    if (excludeSet.has(cat.name)) continue; // 排除的系列直接跳过
    const base = (cat.segment || { base: FALLBACK_BASE }).base;
    for (const ep of cat.episodes) {
      targets.push({ catId: cat.id, catName: cat.name, base, ep });
    }
  }
  crawlState.total = targets.length;
  log(`🎯 待检查话数：${targets.length}`);

  let added = 0;
  for (const t of targets) {
    const { ep, catId, catName, base } = t;
    crawlState.done++;
    const known = infoByContent.get(ep.content_id);
    // 已抓过且其 id 仍在 manga_main 中 → 跳过；若被 COS 覆盖丢失，则需重新写回
    if (known && known.id && idExists.has(String(known.id))) {
      continue;
    }
    try {
      const result = await fetchEpisode(ep.content_id);
      // 主图选择：多图时按「最大竖屏」算法保留漫画主图（GL 系列常含大量杂图）
      const mainUrl = await selectMainImage(result.images);
      // 主图置顶：images[0] 永远是主图（前端缩略图/预览第一张）
      const images = putMainFirst(result.images, mainUrl);
      let newId = null;
      if (mainUrl) {
        const pathKey = urlPathKey(mainUrl);
        // 图片已存在 → 复用旧 id（旧话，不重复新增）
        if (pathToId.has(pathKey)) {
          newId = pathToId.get(pathKey);
        }
      }
      if (!newId) {
        // 新话：分配 id = 该段最大值 +1
        maxIdByBase[base] = (maxIdByBase[base] || base - 1) + 1;
        newId = String(maxIdByBase[base]);
      }
      // 写 manga_main（仅当有图且 id 不重复）
      if (mainUrl && !main.some((m) => m.id === newId)) {
        main.push({ id: newId, wikiurl: mainUrl });
        pathToId.set(urlPathKey(mainUrl), newId);
        idExists.add(String(newId));
        added++;
        crawlState.added = added;
      }
      const epRecord = {
        contentId: ep.content_id,
        entryId: catId,
        series: catName,
        sub: ep.subName || '',
        name: ep.name,
        title: result.title,
        id: newId,
        images: images,
        textPreview: result.textPreview,
        updatedAt: result.updatedAt,
        crawledAt: new Date().toISOString(),
      };
      if (known) {
        // 已抓过但 id 丢失（被 COS 覆盖），原位更新而非新增
        Object.assign(known, epRecord);
      } else {
        info.episodes.push(epRecord);
        infoByContent.set(ep.content_id, info.episodes[info.episodes.length - 1]);
      }
      crawlState.ok++;
      if (added % 10 === 0) await writeMangaMain(main);
      await writeMangaInfo(info);
      log(`✔ [${catName}] ${ep.name}「${result.title}」→ id ${newId}（${result.images.length} 图）`);
    } catch (e) {
      crawlState.failed.push({ contentId: ep.content_id, name: ep.name, series: catName, entryId: catId, error: e.message });
      log(`✖ [${catName}] ${ep.name} 抓取失败：${e.message}`);
    }
    // 轻微节流，避免触发 gamekee 风控
    await new Promise((r) => setTimeout(r, 120));
  }

  // 收尾：URL 路径级自动去重（同一图片路径只保留最小 id 条目，防止重复更新）
  const beforeDedup = main.length;
  dedupeMainByPath(main);
  if (main.length < beforeDedup) {
    log(`🧹 自动去重：移除 ${beforeDedup - main.length} 条重复图片条目`);
  }

  await writeMangaMain(main);
  await writeMangaInfo(info);
  crawlState.added = added;
  log(`💾 manga_main.json 已更新：共 ${main.length} 条（本次新增 ${added}）`);
}

// 就地按 URL 路径去重：同路径保留最小 id 的条目（保持原顺序），其余移除（不触碰 info）
function dedupeMainByPath(main) {
  // 每个路径的最小 id
  const minIdByPath = new Map();
  for (const m of main) {
    const k = urlPathKey(m.wikiurl);
    const cur = minIdByPath.get(k);
    if (cur === undefined || Number(m.id) < Number(cur)) minIdByPath.set(k, m.id);
  }
  let write = 0;
  for (let i = 0; i < main.length; i++) {
    const m = main[i];
    if (String(minIdByPath.get(urlPathKey(m.wikiurl))) === String(m.id)) {
      main[write++] = m;
    }
  }
  main.length = write;
}

// 重试失败项
export async function retryFailedEpisodes() {
  if (!crawlState || !crawlState.failed.length) return { retried: 0, ok: 0 };
  const failed = crawlState.failed.splice(0);
  const info = await readMangaInfo();
  const main = await readMangaMain();
  const maxIdByBase = {};
  for (const item of main) {
    const idNum = Number(item.id);
    const base = Math.floor(idNum / 1000) * 1000;
    if (!maxIdByBase[base] || idNum > maxIdByBase[base]) maxIdByBase[base] = idNum;
  }
  let ok = 0;
  for (const f of failed) {
    try {
      const result = await fetchEpisode(f.contentId);
      // SEGMENT_MAP 以系列名为键（f.entryId 是目录 id，查不到会错落到 9xxx 段）
      const seg = SEGMENT_MAP[f.series];
      const base = (seg || { base: FALLBACK_BASE }).base;
      maxIdByBase[base] = (maxIdByBase[base] || base - 1) + 1;
      const newId = String(maxIdByBase[base]);
      const mainUrl = await selectMainImage(result.images);
      const images = putMainFirst(result.images, mainUrl);
      if (mainUrl && !main.some((m) => m.id === newId)) {
        main.push({ id: newId, wikiurl: mainUrl });
      }
      const existing = info.episodes.find((e) => e.contentId === f.contentId);
      const epRecord = {
        contentId: f.contentId, entryId: f.entryId, series: f.series, name: f.name,
        title: result.title, id: newId, images: images,
        textPreview: result.textPreview, updatedAt: result.updatedAt,
        crawledAt: new Date().toISOString(),
      };
      if (existing) Object.assign(existing, epRecord);
      else info.episodes.push(epRecord);
      ok++;
    } catch (e) {
      crawlState.failed.push({ ...f, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  await writeMangaMain(main);
  await writeMangaInfo(info);
  return { retried: failed.length, ok };
}

// gamekee 图片代理（必须带 Referer，本地缓存；外网请求 30s 超时，防挂起连接堆积拖垮服务）
export async function proxyGamekeeImage(url) {
  const cacheDir = path.join(config.imgDir, 'manga');
  const hash = createHash('md5').update(url).digest('hex');
  const ext = (url.match(/\.(png|jpg|jpeg|webp|gif)(?:\?|$)/i) || [])[1] || 'png';
  const filePath = path.join(cacheDir, `${hash}.${ext}`);
  try {
    const buf = await fs.readFile(filePath);
    return { buf, type: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}` };
  } catch {}
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': 'https://www.gamekee.com/' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') || 'image/png';
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(filePath, buf);
  } catch {}
  return { buf, type };
}
