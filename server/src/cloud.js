// 腾讯 COS 数据拉取与对比（更新模式）
import { fetchJson } from './crawler.js';

const COS_BASE = 'https://1145141919810-1317895529.cos.ap-chengdu.myqcloud.com';

export async function fetchCloudJson(fname) {
  return fetchJson(`${COS_BASE}/json%2F${fname}`);
}

export async function fetchCloudStudents() {
  return fetchCloudJson('sms_studata_main.json');
}

export async function fetchCloudHash() {
  return fetchJson(`${COS_BASE}/hash.json`);
}

// 对比两个学生对象的字段级差异
export function diffStudentFields(prev, curr) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(curr || {})]);
  const fields = [];
  for (const k of keys) {
    const p = JSON.stringify(prev?.[k]);
    const c = JSON.stringify(curr?.[k]);
    if (p !== c) fields.push({ key: k, prev: prev?.[k], curr: curr?.[k] });
  }
  return fields;
}

// 对比本地 vs 云端：返回"本地相较于云端的变更"
// added = 本地有、云端无（待上传的新增）
// removed = 云端有、本地无（待上传的删除）
// modified = 两边都有但内容不同（待上传的修改，含字段级 diff）
// unchanged = 两边一致（无变更）
export function diffCloud(local, cloud) {
  if (!cloud || !Array.isArray(cloud)) {
    return { added: local || [], removed: [], modified: [], unchanged: [], cloudAvailable: false };
  }
  const localMap = new Map(local.map((s) => [s.Id_db, s]));
  const cloudMap = new Map(cloud.map((s) => [s.Id_db, s]));
  const added = [];
  const removed = [];
  const modified = [];
  const unchanged = [];
  for (const [id, s] of localMap) {
    if (!cloudMap.has(id)) added.push(s);
    else if (JSON.stringify(cloudMap.get(id)) !== JSON.stringify(s)) {
      const cloudItem = cloudMap.get(id);
      modified.push({ id, cloud: cloudItem, local: s, fields: diffStudentFields(cloudItem, s) });
    } else {
      unchanged.push(s);
    }
  }
  for (const [id, s] of cloudMap) {
    if (!localMap.has(id)) removed.push(s);
  }
  return { added, removed, modified, unchanged, cloudAvailable: true };
}
