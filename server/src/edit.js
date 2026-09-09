// 编辑学生数据：按字段映射写回对应 JSON 文件
import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';

// 字段 → [文件名, 键名, 数组索引(可选)]
const FIELD_MAP = {
  // sms_studata_main.json（键 Id_db）
  FirstName_jp: ['sms_studata_main.json', 'Id_db'],
  FirstName_zh: ['sms_studata_main.json', 'Id_db'],
  Name_jp: ['sms_studata_main.json', 'Id_db'],
  Name_en: ['sms_studata_main.json', 'Id_db'],
  Name_zh_tw: ['sms_studata_main.json', 'Id_db'],
  Name_kr: ['sms_studata_main.json', 'Id_db'],
  Name_zh_cn: ['sms_studata_main.json', 'Id_db'],
  Name_zh_ft: ['sms_studata_main.json', 'Id_db'],
  NickName: ['sms_studata_main.json', 'Id_db'],
  // sms_studata_toaro_stu.json（键 Id_db）
  MapName: ['sms_studata_toaro_stu.json', 'Id_db'],
  // favor_stu_tap.json（键 id）
  FavorItemTags: ['favor_stu_tap.json', 'id'],
  FavorItemUniqueTags: ['favor_stu_tap.json', 'id'],
  // gacha_data.json[1]（键 id）
  IsReleased: ['gacha_data.json', 'id', 1],
  StarGrade: ['gacha_data.json', 'id', 1],
  IsLimited: ['gacha_data.json', 'id', 1],
};

export async function editStudent(idDb, changes) {
  // 按文件分组
  const byFile = {};
  for (const [field, value] of Object.entries(changes)) {
    const mapping = FIELD_MAP[field];
    if (!mapping) continue;
    const [file, key, arrIndex] = mapping;
    if (!byFile[file]) byFile[file] = [];
    byFile[file].push({ field, value, key, arrIndex });
  }

  const updated = [];

  for (const [file, fields] of Object.entries(byFile)) {
    const filePath = path.join(config.jsonDir, file);
    let data;
    try {
      data = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch {
      continue;
    }

    const key = fields[0].key;

    if (file === 'gacha_data.json') {
      // gacha_data 是 [[卡池], [学生]]
      const arr = data[fields[0].arrIndex ?? 1];
      const item = arr?.find((s) => s.id === idDb);
      if (item) {
        for (const f of fields) item[f.field] = f.value;
        updated.push(file);
      }
    } else {
      const item = data.find((s) => s[key] === idDb);
      if (item) {
        for (const f of fields) item[f.field] = f.value;
        updated.push(file);
      }
    }

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  return { ok: true, updated };
}
