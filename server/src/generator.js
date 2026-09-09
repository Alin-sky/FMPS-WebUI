// 数据生成器：移植 ba-plugin 的生成逻辑，输出与 FMPS 结构一致的 JSON
import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import { config } from './config.js';

// 过滤 zh_cn / chinese-s2t-pro 老包加载时的联网噪音日志（不影响功能，持续过滤）
const _origLog = console.log;
const _origError = console.error;
const _isNoise = (s) => /testapi|liaolunling|getaddrinfo|ENOTFOUND|排除库|简体转繁体|请求错误/.test(s);
console.log = (...a) => { const s = a.map(String).join(' '); if (!_isNoise(s)) _origLog(...a); };
console.error = (...a) => { const s = a.map(String).join(' '); if (!_isNoise(s)) _origError(...a); };

const require = createRequire(import.meta.url);
// zh_cn（拼音）、chinese-s2t-pro（繁简）都是 CommonJS 老包。
// 拼音必须用 zh_cn：FMPS 的匹配系统依赖 zh_cn 的拼音，换库会导致拼音不一致。

// ⚠️ 关键补丁：chinese-s2t-pro 的 heartbeat.js 会对「每一个汉字」向已失效的统计域名
// testapi.liaolunling.top 发 HTTPS 请求。跑一次爬取会触发 3000+ 个挂起连接，
// 耗尽进程 socket/句柄，导致后端整体无响应（图片接口全部 500）。
// 在加载该库之前，向 require 缓存注入空实现，彻底掐掉心跳。
try {
  const heartbeatPath = require.resolve('chinese-s2t-pro/heartbeat.js');
  require.cache[heartbeatPath] = {
    id: heartbeatPath,
    filename: heartbeatPath,
    loaded: true,
    exports: { heartbeat: () => {} },
  };
} catch {}

const zhPkg = require('zh_cn');
const zh = zhPkg.default || zhPkg;
const { simpleLine2TL } = require('chinese-s2t-pro');

// 拼音转换（复刻 zh_cn 的 STYLE_NORMAL：无音调、逐字、返回数组）
function toPinyin(text) {
  if (!text) return [];
  return zh(text, { style: zh.STYLE_NORMAL });
}

// ============ 别名补全（配置驱动，可前端自定义） ============
function complete_alias(text, groups) {
  function conversions_pinyin(input) {
    input = input.replace(/（/g, '(').replace(/）/g, ')');
    const parts = input.split(/(\([^)]+\))/g);
    let result = '';
    parts.forEach((part) => {
      if (part.startsWith('(') && part.endsWith(')')) {
        const content = part.slice(1, -1);
        result += '(' + toPinyin(content).join('') + ')';
      } else {
        result += toPinyin(part).join('');
      }
    });
    return result;
  }

  const regex = /\(([^)]+)\)/g;
  const matches = text.match(regex);
  const names = text.split(/\([^)]+\)/);
  const output = [conversions_pinyin(text)];

  if (matches) {
    // 遍历所有括号（修复原版"只取最后一个括号"的问题）
    for (const match of matches) {
      const extractedText = match.slice(1, -1);
      const group = groups.find((g) => g.match.includes(extractedText));
      if (group) {
        for (const alias of group.alias) {
          output.push(names[0] + alias);
          output.push(alias + names[0]);
        }
      }
    }
  }
  return output;
}

// 按 Id_db 升序排序的 key 列表（复刻 for-in 对整数 key 的遍历顺序）
function sortedKeys(obj) {
  return Object.keys(obj).sort((a, b) => Number(a) - Number(b));
}

// ============ sms_studata_main.json ============
export function match_auto_update(students, oldNicname = null, aliasGroups = null) {
  const { cn, jp, tw, kr, zh } = students;
  const groups = aliasGroups || [];
  const arry = [];
  let i = 0;
  for (const k of sortedKeys(cn)) {
    const nic = [];
    let twtxt;
    const alias_cn = complete_alias(cn[k].Name.replace(/（/g, '(').replace(/）/g, ')'), groups);
    let nameEn = cn[k].PathName;

    if (jp[k].Name === tw[k].Name || tw[k].Name === '') {
      twtxt = simpleLine2TL(cn[k].Name).replace(/（/g, '(').replace(/）/g, ')');
    } else {
      twtxt = tw[k].Name.replace(/（/g, '(').replace(/）/g, ')');
    }
    if (nameEn.includes('_')) {
      nameEn = nameEn.replace(/_(.+)/, ' ($1)');
    }

    const nici = oldNicname ? oldNicname.findIndex((item) => item.Id_db == k) : -1;
    if (nici === -1) {
      for (const a of alias_cn) nic.push(a);
    } else {
      nic.push(...oldNicname[nici].NickName);
      for (const a of alias_cn) {
        if (!nic.includes(a)) nic.push(a);
      }
    }

    arry.push({
      'Id': String(10000 + i),
      'Id_db': cn[k].Id,
      'FirstName_jp': jp[k].FamilyName,
      'FirstName_zh': cn[k].FamilyName,
      'Name_jp': jp[k].Name.replace(/（/g, '(').replace(/）/g, ')'),
      'Name_en': nameEn,
      'Name_zh_tw': twtxt,
      'Name_kr': kr[k].Name,
      'Name_zh_cn': cn[k].Name.replace(/（/g, '(').replace(/）/g, ')'),
      'Name_zh_ft': zh[k].Name.replace(/（/g, '(').replace(/）/g, ')'),
      'NickName': nic,
    });
    i++;
  }
  return arry;
}

// ============ sms_studata_toaro_stu.json ============
export function sanae_match_refinement(studata_zh, revisions = []) {
  const arrys = [];
  const type = [
    '泳装', '便服', '兔女郎',
    '温泉', '新年', '应援团',
    '圣诞节', '女仆', '运动服',
    '骑行', '露营', '小',
    '礼服', '正月', '导游',
    '乐队', '旗袍', '偶像',
    '睡衣', '制服', '打工',
    '魔法',
  ];
  const regex = /\(([^)]+)\)/g;
  let ss = 0;
  let i = 0;
  for (const k of sortedKeys(studata_zh)) {
    const db_name = studata_zh[k].Name.replace(/（/g, '(').replace(/）/g, ')');
    const matches = db_name.match(regex);
    const names = db_name.split(/\([^)]+\)/);
    let to_arona_name;
    if (matches) {
      let extractedText = '';
      for (const match of matches) {
        extractedText = match.slice(1, -1);
      }
      const ti = type.indexOf(extractedText);
      // 修复：括号内容不在 type 里时（ti=-1），直接用名字主体，避免 "undefined" 前缀
      to_arona_name = ti >= 0 ? type[ti] + names[0] : names[0];
    } else {
      to_arona_name = names[0];
    }
    if (revisions[ss] && revisions[ss].Id_db == k) {
      to_arona_name = revisions[ss].MapName;
      ss = ss === revisions.length - 1 ? revisions.length - 1 : ss + 1;
    }
    arrys.push({
      'Id': String(10000 + i),
      'Id_db': studata_zh[k].Id,
      'MapName': to_arona_name,
    });
    i++;
  }
  return arrys;
}

// ============ liwu_list_rep.json（礼物，筛选 Id 5000-6000） ============
export function local_update_liwu(items) {
  return Object.keys(items)
    .filter((key) => items[key].Id >= 5000 && items[key].Id <= 6000)
    .map((key) => items[key]);
}

// ============ favor_stu_tap.json ============
export function get_stu_favo(studata_cn) {
  return sortedKeys(studata_cn).map((k) => ({
    'id': studata_cn[k].Id,
    'name': studata_cn[k].Name,
    'FavorItemTags': studata_cn[k].FavorItemTags,
    'FavorItemUniqueTags': studata_cn[k].FavorItemUniqueTags,
  }));
}

// ============ favora_data.json（礼物匹配计算） ============
export function cre_favor_list(liwu, favor_tap) {
  return favor_tap.map((character) => {
    const allFavorTags = [...character.FavorItemTags, ...character.FavorItemUniqueTags];
    const favorGifts = liwu
      .map((gift) => {
        const matchedTagsCount = gift.Tags.reduce(
          (count, tag) => (allFavorTags.includes(tag) ? count + 1 : count),
          0
        );
        return { giftId: gift.Id, matchCount: matchedTagsCount, Rarity: gift.Rarity, Icon: gift.Icon };
      })
      .filter((gift) => gift.matchCount > 0)
      .map((gift) => ({
        'preId': gift.giftId,
        'matchCount': gift.matchCount,
        'Rarity': gift.Rarity,
        'Icon': gift.Icon,
      }));
    return { 'stuid': character.id, 'favorGifts': favorGifts };
  });
}

// ============ gacha_data.json（[1] 学生星级/限定；[0] 卡池手动维护占位） ============
export function init_gacha(studata_cn) {
  const students = [];
  for (const k of sortedKeys(studata_cn)) {
    students.push({
      'id': studata_cn[k].Id,
      'IsReleased': studata_cn[k].IsReleased,
      'StarGrade': studata_cn[k].StarGrade,
      'IsLimited': studata_cn[k].IsLimited[1],
    });
  }
  return [[], students];
}

// ============ 文件写入 ============
export async function writeJson(fname, data) {
  await fs.mkdir(config.jsonDir, { recursive: true });
  const filePath = path.join(config.jsonDir, fname);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

// ============ 读取系统已有的旧数据（用于昵称/种子保留） ============
export async function readJson(fname, fallback = null) {
  const filePath = path.join(config.jsonDir, fname);
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}
