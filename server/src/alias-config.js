// 别名系统自定义配置：换皮类型匹配词 + 生成别名，可在前端增删改
import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';

const CONFIG_PATH = path.join(config.dataDir, 'alias-config.json');

// 默认配置（由 ba-plugin 的 o/type 清理而来：合并重复、去重、补"临战"组）
export const DEFAULT_GROUPS = [
  { match: ['泳装', '水着', '水'], alias: ['水', '水着', '泳装'] },
  { match: ['便服', '私服'], alias: ['私服', '便服'] },
  { match: ['兔女郎', '兔'], alias: ['兔', '兔女郎'] },
  { match: ['温泉'], alias: ['温泉'] },
  { match: ['新年', '春', '正月'], alias: ['新年', '春', '正月'] },
  { match: ['应援团', '应援', '拉拉', '啦啦'], alias: ['应援', '拉拉', '应援团', '啦啦'] },
  { match: ['圣诞节', '圣诞'], alias: ['圣诞', '圣诞节'] },
  { match: ['女仆', '妹抖'], alias: ['妹抖', '女仆'] },
  { match: ['运动服', '体操服', '体操', '运动', '体'], alias: ['体操服', '体操', '运动', '体', '运动服'] },
  { match: ['骑行', '单车'], alias: ['单车', '骑行'] },
  { match: ['露营', '野营'], alias: ['野营', '露营'] },
  { match: ['小', '幼', '铜'], alias: ['幼', '铜', '小'] },
  { match: ['礼服', '礼'], alias: ['礼', '礼服'] },
  { match: ['导游', '导'], alias: ['导游', '导'] },
  { match: ['乐队'], alias: ['乐队'] },
  { match: ['旗袍'], alias: ['旗袍'] },
  { match: ['偶像'], alias: ['偶像'] },
  { match: ['睡衣', '睡'], alias: ['睡衣', '睡'] },
  { match: ['制服', '校服'], alias: ['制服', '校服'] },
  { match: ['打工'], alias: ['打工'] },
  { match: ['魔法'], alias: ['魔法'] },
  { match: ['临战', '武装', '战'], alias: ['临战', '武装', '战'] },
];

export async function loadAliasConfig() {
  try {
    const raw = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
    if (Array.isArray(raw.groups) && raw.groups.length > 0) return raw.groups;
  } catch {}
  return DEFAULT_GROUPS.map((g) => JSON.parse(JSON.stringify(g)));
}

export async function saveAliasConfig(groups) {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify({ groups }, null, 2), 'utf8');
  return groups;
}
