// 爬取脚本：独立爬取 schaledb → 生成与 FMPS 结构一致的 JSON
// 可命令行运行，也可被 API 调用（runCrawl）
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { fetchStudents, fetchItems, fetchJson, fetchBinary } from './crawler.js';
import {
  match_auto_update,
  sanae_match_refinement,
  local_update_liwu,
  get_stu_favo,
  cre_favor_list,
  init_gacha,
  writeJson,
  readJson,
} from './generator.js';
import { saveSnapshot } from './snapshot.js';
import { loadAliasConfig } from './alias-config.js';
import { config } from './config.js';
import { fetchCloudStudents, fetchCloudJson } from './cloud.js';

// 日志事件总线（SSE 订阅用）
export const crawlEvents = new EventEmitter();

function log(msg) {
  console.log(msg);
  crawlEvents.emit('log', msg);
}

async function readSkipList() {
  try {
    return JSON.parse(await fs.readFile(path.join(config.dataDir, 'skip-list.json'), 'utf8'));
  } catch {
    return [];
  }
}

export async function runCrawl() {
  // 1. 先备份当前数据（用于 diff）
  log('🟡 [1/7] 备份当前数据快照...');
  const snapshotTs = await saveSnapshot();
  log(`   ✅ 快照已保存：${snapshotTs}`);

  // 2. 下载 schaledb 数据
  log('🟡 [2/7] 下载 schaledb 学生数据（cn/jp/tw/kr/zh）...');
  const students = await fetchStudents();
  log('   ✅ 学生数据下载完成');
  log('🟡 [3/7] 下载 schaledb 道具数据...');
  const items = await fetchItems();
  log('   ✅ 道具数据下载完成');

  // 读取旧数据（保留历史昵称 + revisions + 手动维护的卡池）
  const localStudata = await readJson('sms_studata_main.json');
  const oldToaro = await readJson('sms_studata_toaro_stu.json');
  const oldFavorTap = await readJson('favor_stu_tap.json');
  const oldFavora = await readJson('favora_data.json');
  let revisions = await readJson('sms_to_arona_data_revisions.json');
  if (!revisions) {
    // 本地无 revisions，从 COS 拉取并保存（阿罗娜匹配名修正表）
    try {
      revisions = await fetchCloudJson('sms_to_arona_data_revisions.json');
      if (revisions) {
        await writeJson('sms_to_arona_data_revisions.json', revisions);
        log(`   ✅ 已从 COS 获取并保存 ${revisions.length} 条 Arona 匹配名修正`);
      }
    } catch {
      revisions = [];
    }
  }
  const oldGacha = await readJson('gacha_data.json');
  const aliasGroups = await loadAliasConfig();

  // 昵称种子：每次都从腾讯 COS 拉取（COS 上有完整昵称，参考 ba-plugin match_auto_update 的 nicname）
  let nicname = null;
  try {
    nicname = await fetchCloudStudents();
    log(`   ✅ 已从 COS 获取 ${nicname ? nicname.length : 0} 条昵称数据`);
  } catch (e) {
    log('   ⚠️ COS 拉取失败，昵称将只有别名+拼音');
  }
  // 昵称来源：直接用 COS 完整昵称；COS 拉取失败才退回本地
  const oldStudata = nicname || localStudata || [];

  // 生成各 JSON
  log('🟡 [4/7] 生成 sms_studata_main.json（学生名+别名）...');
  const studataAll = match_auto_update(students, oldStudata, aliasGroups);

  // 跳过爬取名单：完全跳过（不爬取该角色的任何东西，所有生成文件中直接排除）
  const skipList = await readSkipList();
  const skipSet = new Set(skipList.map(Number));
  const skipped = studataAll.filter((s) => skipSet.has(s.Id_db));
  const studata = studataAll.filter((s) => !skipSet.has(s.Id_db));
  if (skipped.length > 0) {
    log(`   ⏭️ 已跳过 ${skipped.length} 个配置角色（不写入任何生成文件）：${skipped.map((s) => `#${s.Id_db} ${s.Name_zh_cn || ''}`).join('、')}`);
  }

  await writeJson('sms_studata_main.json', studata);

  // 昵称统计
  const withNick = studata.filter((s) => s.NickName && s.NickName.length > 1).length;
  const onlyPinyin = studata.filter((s) => s.NickName && s.NickName.length === 1).length;
  log(`   ✅ 完成，共 ${studata.length} 条（含完整昵称 ${withNick} 条 / 仅拼音 ${onlyPinyin} 条）`);

  log('🟡 [5/7] 生成 sms_studata_toaro_stu.json + favor 系列...');
  let toaro = sanae_match_refinement(students.zh, revisions);
  // 跳过名单：toaro 中完全排除（Id_db 键）
  if (skipSet.size > 0) {
    toaro = toaro.filter((s) => !skipSet.has(s.Id_db));
  }
  await writeJson('sms_studata_toaro_stu.json', toaro);

  const liwu = local_update_liwu(items);
  await writeJson('liwu_list_rep.json', liwu);

  let favor_tap = get_stu_favo(students.cn);
  // 跳过名单：favor_stu_tap 中完全排除（id 键；在生成 favora 前过滤，favora 自然不含）
  if (skipSet.size > 0) {
    favor_tap = favor_tap.filter((s) => !skipSet.has(s.id));
  }
  await writeJson('favor_stu_tap.json', favor_tap);

  let favora = cre_favor_list(liwu, favor_tap);
  await writeJson('favora_data.json', favora);
  const giftTotal = favora.reduce((acc, f) => acc + (f.favorGifts?.length || 0), 0);
  log(`   ✅ 完成（toaro ${toaro.length} / 礼物 ${liwu.length} / 好感 ${favor_tap.length} / 礼物匹配 ${giftTotal} 条）`);

  log('🟡 [6/7] 生成 gacha_data.json...');
  const gacha = init_gacha(students.cn);
  if (oldGacha && Array.isArray(oldGacha[0]) && oldGacha[0].length > 0) {
    gacha[0] = oldGacha[0];
  }
  // 跳过名单：gacha_data[1] 中完全排除（id 键）
  if (skipSet.size > 0 && Array.isArray(gacha[1])) {
    gacha[1] = gacha[1].filter((s) => !skipSet.has(s.id));
  }
  await writeJson('gacha_data.json', gacha);
  log(`   ✅ 完成，共 ${gacha[1].length} 条`);

  log(`🟢 [7/7] 全部生成完毕！学生 ${studata.length} 条，礼物 ${liwu.length} 条`);

  // 8. 阿罗娜匹配名检测（并发，记录未精确匹配的学生）
  log('🟡 [8/8] 阿罗娜匹配名检测（并发 20，共 ' + toaro.length + ' 名，约 1-2 分钟）...');
  const mismatch = [];
  const concurrency = 20;
  let done = 0;
  for (let i = 0; i < toaro.length; i += concurrency) {
    const chunk = toaro.slice(i, i + concurrency);
    await Promise.all(chunk.map(async (s) => {
      try {
        const url = 'https://arona.diyigemt.com/api/v2/image?name=' + encodeURIComponent(s.MapName || '');
        const arona = await fetchJson(url);
        if (arona.code === 101) mismatch.push({ Id_db: s.Id_db, MapName: s.MapName });
      } catch {}
      done++;
    }));
    log(`   ⏳ 检测进度 ${done}/${toaro.length}（已发现 ${mismatch.length} 个未匹配）`);
  }
  await fs.writeFile(path.join(config.dataDir, 'arona-mismatch.json'), JSON.stringify(mismatch, null, 2), 'utf8');
  if (mismatch.length > 0) {
    log(`   ⚠️ 发现 ${mismatch.length} 个未精确匹配（详见 data/arona-mismatch.json）：`);
    mismatch.slice(0, 15).forEach((m) => log(`      #${m.Id_db} ${m.MapName}`));
    if (mismatch.length > 15) log(`      ... 共 ${mismatch.length} 个`);
  } else {
    log('   🟢 阿罗娜匹配名全部精确匹配');
  }

  // 9. 预下载所有头像 + 礼物图到本地（避免首次访问详情页时逐个联网下载）
  log('🟡 [9/9] 预下载头像 + 礼物图到本地（并发 20）...');
  const imgTasks = [];
  for (const s of studata) {
    imgTasks.push({ kind: 'avatar', key: s.Id_db, url: config.avatar.collection(s.Id_db) });
  }
  for (const g of liwu) {
    imgTasks.push({ kind: 'item', key: g.Icon, url: `https://schaledb.com/images/item/full/${g.Icon}.webp` });
  }
  let imgDone = 0;
  const concurrency2 = 20;
  for (let i = 0; i < imgTasks.length; i += concurrency2) {
    const chunk = imgTasks.slice(i, i + concurrency2);
    await Promise.all(chunk.map(async (t) => {
      const filePath = path.join(config.imgDir, t.kind, `${t.key}.webp`);
      try {
        await fs.access(filePath);
      } catch {
        try {
          const buf = await fetchBinary(t.url);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, buf);
        } catch {}
      }
      imgDone++;
    }));
    if (imgDone % 60 === 0 || imgDone === imgTasks.length) log(`   ⏳ 图片预下载 ${imgDone}/${imgTasks.length}`);
  }
  log(`   ✅ 图片预下载完成（共 ${imgTasks.length} 张）`);

  return { snapshotTs, studataCount: studata.length, giftCount: liwu.length, aronaMismatch: mismatch.length };
}

// 命令行直接运行时执行
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCrawl()
    .then(() => {
      console.log('输出目录: server/data/json');
    })
    .catch((e) => {
      console.error('❌ 爬取失败:', e);
      process.exit(1);
    });
}
