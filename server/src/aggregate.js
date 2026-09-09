// 聚合模块：按 Id_db 归一化聚合学生数据（处理 Id_db / id / stuid 三种键名 + 字符串类型）
import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';

async function readJson(fname) {
  try {
    return JSON.parse(await fs.readFile(path.join(config.jsonDir, fname), 'utf8'));
  } catch {
    return null;
  }
}

// 读取所有学生相关 JSON
export async function loadAllData() {
  const [studata, toaro, favor_tap, gacha, favora, satellite, revisions, liwu, manga, others] =
    await Promise.all([
      readJson('sms_studata_main.json'),
      readJson('sms_studata_toaro_stu.json'),
      readJson('favor_stu_tap.json'),
      readJson('gacha_data.json'),
      readJson('favora_data.json'),
      readJson('khrtalk_satellite.json'),
      readJson('sms_to_arona_data_revisions.json'),
      readJson('liwu_list_rep.json'),
      readJson('manga_main.json'),
      readJson('sms_othersmatchlib.json'),
    ]);
  return { studata, toaro, favor_tap, gacha, favora, satellite, revisions, liwu, manga, others };
}

// 归一化键名 → Id_db（数字）
const toNum = (v) => Number(v);

// 聚合学生（按 Id_db）
export function aggregateStudents(data) {
  const { studata, toaro, favor_tap, gacha, favora, satellite, revisions } = data;

  const map = new Map(); // Id_db -> student

  const get = (id) => {
    if (!map.has(id)) map.set(id, { Id_db: id, missing: [] });
    return map.get(id);
  };

  // 1. studata_main（名字、昵称）
  if (studata) {
    for (const s of studata) {
      const st = get(toNum(s.Id_db));
      Object.assign(st, s);
    }
  }

  // 2. toaro_stu（MapName）
  if (toaro) {
    for (const t of toaro) {
      const st = get(toNum(t.Id_db));
      st.MapName = t.MapName;
    }
  }

  // 3. favor_stu_tap（好感标签，键名 id）
  if (favor_tap) {
    for (const f of favor_tap) {
      const st = get(toNum(f.id));
      st.FavorItemTags = f.FavorItemTags;
      st.FavorItemUniqueTags = f.FavorItemUniqueTags;
    }
  }

  // 4. gacha_data[1]（星级/限定，键名 id）
  if (gacha && Array.isArray(gacha[1])) {
    for (const g of gacha[1]) {
      const st = get(toNum(g.id));
      st.IsReleased = g.IsReleased;
      st.StarGrade = g.StarGrade;
      st.IsLimited = g.IsLimited;
    }
  }

  // 5. favora_data（礼物，键名 stuid），附加礼物名称
  const giftMap = new Map();
  if (data.liwu) {
    for (const g of data.liwu) giftMap.set(g.Id, g);
  }
  if (favora) {
    for (const f of favora) {
      const st = get(toNum(f.stuid));
      st.favorGifts = (f.favorGifts || []).map((g) => ({
        ...g,
        giftId: g.preId,
        giftName: giftMap.get(g.preId)?.Name || '',
      }));
    }
  }

  // 6. revisions 覆盖 MapName（Id_db 是字符串）
  if (revisions) {
    for (const r of revisions) {
      const st = get(toNum(r.Id_db));
      st.MapName = r.MapName;
      st.MapNameRevised = true;
    }
  }

  // 7. 卫星角色标记（khrtalk_satellite 已不再需要：不为其单独创建学生条目，
  //    避免产生大量「缺失」幽灵数据；仅当角色已存在于其他数据文件时标记 isSatellite）
  if (satellite) {
    for (const s of satellite) {
      const id = toNum(s.Id_db);
      if (map.has(id)) {
        map.get(id).isSatellite = true;
      }
    }
  }

  // 计算缺失字段
  const students = [...map.values()];
  for (const st of students) {
    if (st.Name_zh_cn === undefined) st.missing.push('studata_main');
    if (st.MapName === undefined) st.missing.push('toaro_stu');
    if (st.FavorItemTags === undefined) st.missing.push('favor_stu_tap');
    if (st.StarGrade === undefined) st.missing.push('gacha_data');
    if (st.favorGifts === undefined) st.missing.push('favora_data');
    st.complete = st.missing.length === 0;
  }

  students.sort((a, b) => a.Id_db - b.Id_db);
  return students;
}

// 统计概览
export function stats(data, students) {
  return {
    studentCount: students.length,
    completeCount: students.filter((s) => s.complete).length,
    incompleteCount: students.filter((s) => !s.complete).length,
    satelliteCount: students.filter((s) => s.isSatellite).length,
    giftCount: data.liwu ? data.liwu.length : 0,
    mangaCount: data.manga ? data.manga.length : 0,
    missingFieldCounts: students.reduce((acc, s) => {
      for (const m of s.missing) acc[m] = (acc[m] || 0) + 1;
      return acc;
    }, {}),
  };
}
