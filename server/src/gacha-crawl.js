// 卡池自动爬取：从 gamekee wiki 卡池页面解析三服当前卡池
// 数据源：
//   国服: 「国服往期卡池一览」(content 599302) —— 单个大表格，最新在前
//   国际服: 「国际服往期卡池一览」(content 609133) —— 每池一个小表格，最新在前
//   日服: 「日服当期卡池评测」(content 716313) —— 标题含池名+时间，正文含 PU 学生名
import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const GK_HEADERS = {
  'User-Agent': UA,
  'Referer': 'https://www.gamekee.com/',
  'game-alias': 'ba',
  'Accept': 'application/json',
};

// 各服卡池页面 content_id
const PAGES = {
  cn: 599302, // 国服往期卡池一览（大表格，最新在前）
  in: 609133, // 国际服往期卡池一览（每池一个小表格，最新在前）
  jp: 716313, // 日服当期卡池评测（标题+正文）
};

// 各服卡池开始/结束的小时惯例（仅初值，前端可修正）
const TIME_CONVENTION = {
  cn: { start: [14, 0], end: [13, 59] },
  jp: { start: [18, 0], end: [9, 59] },
  in: { start: [13, 0], end: [9, 59] },
};

async function gkGet(url) {
  const res = await fetch(url, { headers: GK_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchContent(contentId) {
  const detail = await gkGet(`https://www.gamekee.com/v1/content/detail/${contentId}`);
  if (detail.code !== 0 || !detail.data) throw new Error(`页面详情失败(${contentId}): ${detail.msg || '未知'}`);
  let cdn = detail.data.content_cdn || '';
  if (cdn.startsWith('//')) cdn = 'https:' + cdn;
  const bodyRes = await fetch(cdn, { headers: { 'User-Agent': UA, 'Referer': 'https://www.gamekee.com/' }, signal: AbortSignal.timeout(30_000) });
  const body = await bodyRes.json();
  return { title: detail.data.title || '', updatedAt: detail.data.updated_at, content: body.content };
}

// ---------- CKEditor JSON 工具 ----------

function cellText(n) {
  if (Array.isArray(n)) return n.map(cellText).join('');
  if (n && typeof n === 'object') return (n.text || '') + cellText(n.children || []);
  return '';
}

function collectTables(node, out = []) {
  if (Array.isArray(node)) { node.forEach((n) => collectTables(n, out)); return out; }
  if (node && typeof node === 'object') {
    if (node.type === 'table') out.push(node);
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') collectTables(v, out);
    }
  }
  return out;
}

function collectTexts(node, out = []) {
  if (Array.isArray(node)) { node.forEach((n) => collectTexts(n, out)); return out; }
  if (node && typeof node === 'object') {
    if (typeof node.text === 'string' && node.text.trim()) out.push(node.text.trim());
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') collectTexts(v, out);
    }
  }
  return out;
}

// ---------- 学生名匹配 ----------

async function buildNameIndex() {
  const studata = JSON.parse(await fs.readFile(path.join(config.jsonDir, 'sms_studata_main.json'), 'utf8'));
  const idx = new Map(); // 归一化名字 → Id_db
  const norm = (s) => String(s || '').replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '').trim();
  for (const s of studata) {
    for (const key of ['Name_zh_cn', 'Name_zh_tw', 'Name_zh_ft', 'Name_jp']) {
      if (s[key]) {
        const k = norm(s[key]);
        if (k && !idx.has(k)) idx.set(k, s.Id_db);
      }
    }
  }
  return { idx, norm };
}

// 形态后缀变体（wiki 与库内用词不同，语义等价），成对互换重试
const SUFFIX_PAIRS = [
  ['私服', '便服'],
  ['泳装', '水着'],
  ['正月', '新年'],
  ['临战', '武装'],
];

// 常见异写对照（wiki 译名 → 库内译名），逐对替换后重试
const ALIAS_MAP = {
  '妮娅': '尼娅',
  '仁耶': '尼娅',
};

// 单个名字 → Id_db（多级匹配）
function matchOne(name, idx) {
  if (idx.has(name)) return idx.get(name);
  // 1) 后缀变体互换：如 濑名(私服) ↔ 濑名(便服)、水着 ↔ 泳装
  for (const [a, b] of SUFFIX_PAIRS) {
    if (name.includes(a)) {
      const alt = name.split(a).join(b);
      if (idx.has(alt)) return idx.get(alt);
    }
    if (name.includes(b)) {
      const alt = name.split(b).join(a);
      if (idx.has(alt)) return idx.get(alt);
    }
  }
  // 2) 异写对照替换
  let alt = name;
  let changed = false;
  for (const [from, to] of Object.entries(ALIAS_MAP)) {
    if (alt.includes(from)) { alt = alt.split(from).join(to); changed = true; }
  }
  if (changed && idx.has(alt)) return idx.get(alt);
  // 3) 去掉括号后缀的裸名（最后手段，如 "濑名" → 常驻濑名）
  const base = name.replace(/\([^)]*\)/g, '');
  if (base && base !== name && idx.has(base)) return idx.get(base);
  return null;
}

// ---------- 时间解析 ----------

function pad(n) { return String(n).padStart(2, '0'); }

function isoTime(y, mo, d, [h, mi]) {
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00+08:00`;
}

// 国服: "2026.9.10|2026.9.24"（年.月.日）
function parseCnTime(raw) {
  const parts = String(raw).split('|').map((p) => p.trim());
  if (parts.length !== 2) return null;
  const parse = (p) => {
    const m = p.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
    return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
  };
  const s = parse(parts[0]);
  const e = parse(parts[1]);
  if (!s || !e) return null;
  return {
    start: isoTime(s.y, s.mo, s.d, TIME_CONVENTION.cn.start),
    end: isoTime(e.y, e.mo, e.d, TIME_CONVENTION.cn.end),
  };
}

// 国际服/日服: "8月18日～9月1日" / "8月12日~~8月26日"（无年份，取当前年并智能跨年）
function parseMonthDayTime(raw, conv) {
  const nums = [...String(raw).matchAll(/(\d{1,2})月(\d{1,2})日/g)].map((m) => ({ mo: +m[1], d: +m[2] }));
  if (nums.length < 2) return null;
  const now = new Date();
  const year = now.getFullYear();
  let [s, e] = [nums[0], nums[nums.length - 1]];
  // 跨年推断：若结束月明显早于开始月（如 12月~1月），结束日期加一年
  let eYear = year;
  if (e.mo < s.mo) eYear = year + 1;
  return {
    start: isoTime(year, s.mo, s.d, conv.start),
    end: isoTime(eYear, e.mo, e.d, conv.end),
  };
}

// ---------- 各服解析 ----------

// 国服：大表格，每行 [卡池信息, ?, 时间]，最新在前（跳过表头）
// 优先取「当前进行中」的池（begin ≤ now ≤ end），否则回退第一行（最新/预告池）
function parseCn(tables) {
  if (!tables.length) throw new Error('国服卡池页无表格');
  const rows = (tables[0].children || []).slice(1); // 跳过表头
  const now = Date.now();
  let first = null;
  for (const row of rows) {
    const cells = (row.children || []).map((c) => cellText(c.children || []).trim());
    const time = parseCnTime(cells[cells.length - 1] || '');
    if (!time) continue;
    const entry = { raw: cells[0] || '', ...time };
    if (!first) first = entry;
    const s = new Date(time.start).getTime();
    const e = new Date(time.end).getTime();
    if (now >= s && now <= e) return entry; // 进行中的池
  }
  if (first) return first;
  throw new Error('国服卡池页未解析到有效时间行');
}

// 国际服：每池一个小表格（表格0为表头）；每个表格第一行 [图, PU学生, 时间]，后续行补学生
// 优先取当前进行中的池，否则取最新的（表格1）
function parseIn(tables) {
  if (tables.length < 2) throw new Error('国际服卡池页无数据表格');
  const parseTable = (t) => {
    const rows = (t.children || []);
    const names = [];
    let time = null;
    for (const row of rows) {
      const cells = (row.children || []).map((c) => cellText(c.children || []).trim());
      const name = cells[1] || '';
      const timeRaw = cells[2] || '';
      if (name) names.push(name);
      if (timeRaw && !time) time = parseMonthDayTime(timeRaw, TIME_CONVENTION.in);
    }
    return time ? { raw: names.join('、'), ...time } : null;
  };
  const now = Date.now();
  let first = null;
  for (let i = 1; i < tables.length; i++) {
    const entry = parseTable(tables[i]);
    if (!entry) continue;
    if (!first) first = entry;
    const s = new Date(entry.start).getTime();
    const e = new Date(entry.end).getTime();
    if (now >= s && now <= e) return entry; // 进行中
  }
  if (first) return first;
  throw new Error('国际服卡池页未解析到时间');
}

// 日服：标题「日服当期卡池：{池名}【{起}~~{止}】」+ 正文短文本段为学生名
function parseJp(title, content) {
  const tm = title.match(/【\s*([^】]+?)\s*】/);
  if (!tm) throw new Error('日服卡池页标题未含时间');
  const time = parseMonthDayTime(tm[1], TIME_CONVENTION.jp);
  if (!time) throw new Error('日服卡池页时间解析失败: ' + tm[1]);
  // 正文文本：学生名是短文本（≤14字、无波浪号/标点说明），从配对结构中提取
  const texts = collectTexts(content);
  const names = [];
  for (const t of texts) {
    const clean = t.replace(/\s+/g, '');
    if (clean.length === 0 || clean.length > 14) continue;
    if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(clean)) continue; // emoji（点赞图标等）
    if (/[~～!！?？。．,.、/／【】\[\]()（）]/.test(clean) && !/[（(][^）)]+[）)]$/.test(clean)) continue;
    if (/校委会|攻略|更新|免费|点赞|宣宣|B站|欢迎|帮助|如果|点击/.test(clean)) continue; // 页面噪音
    names.push(t);
  }
  return { raw: names.join('、'), ...time };
}

// ---------- 主入口：爬取三服当前卡池 ----------

export async function fetchGachaPools() {
  const { idx, norm } = await buildNameIndex();
  const out = {};
  const warnings = [];

  // 名字匹配：文本按 、 和 【标记】 切分后逐个多级匹配
  const matchNames = (raw, server) => {
    const ids = [];
    const unmatched = [];
    const fes = /FES/i.test(raw);
    // 切分：先按【xx】保留标记信息，再按 、 切名字
    const tokens = String(raw)
      .replace(/【[^】]*】/g, '、')  // 【限定复刻】等标记替换为分隔符
      .split(/[、,，]/)
      .map((s) => norm(s))
      .filter(Boolean);
    for (const t of tokens) {
      const id = matchOne(t, idx);
      if (id !== null) {
        if (!ids.includes(id)) ids.push(id);
      } else {
        unmatched.push(t);
      }
    }
    return { ids, unmatched, fes };
  };

  // 国服
  try {
    const { raw, start, end } = await (async () => {
      const { content } = await fetchContent(PAGES.cn);
      const parsed = JSON.parse(content);
      return parseCn(collectTables(parsed));
    })();
    const m = matchNames(raw, 'cn');
    out.cn = { raw, start, end, ...m };
  } catch (e) {
    warnings.push(`国服: ${e.message}`);
  }

  // 国际服
  try {
    const { raw, start, end } = await (async () => {
      const { content } = await fetchContent(PAGES.in);
      const parsed = JSON.parse(content);
      return parseIn(collectTables(parsed));
    })();
    const m = matchNames(raw, 'in');
    out.in = { raw, start, end, ...m };
  } catch (e) {
    warnings.push(`国际服: ${e.message}`);
  }

  // 日服
  try {
    const { raw, start, end } = await (async () => {
      const { title, content } = await fetchContent(PAGES.jp);
      return parseJp(title, JSON.parse(content));
    })();
    const m = matchNames(raw, 'jp');
    out.jp = { raw, start, end, ...m };
  } catch (e) {
    warnings.push(`日服: ${e.message}`);
  }

  return { servers: out, warnings };
}
