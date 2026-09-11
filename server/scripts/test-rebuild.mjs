import { listCloudReleases, diffCloudReleaseVsLocal, diffReleaseStudents } from '../src/release-cloud.js';

const list = await listCloudReleases();
const latest = list[0];
console.log('云端最新发布记录:', latest.ts, '(', latest.releasedAt, ')');
console.log('');

const d = await diffCloudReleaseVsLocal(latest.ts);
console.log('=== 学生级差异（本地 相对 云端该版本）===');
console.log('可比对:', d.students.available, d.students.reason || '');
console.log(`  本地有、云端无（待上传新增）: ${d.students.added.length}`);
for (const s of d.students.added.slice(0, 15)) console.log(`      #${s.Id_db} ${s.Name}`);
console.log(`  云端有、本地无（待上传删除）: ${d.students.removed.length}`);
for (const s of d.students.removed.slice(0, 15)) console.log(`      #${s.Id_db} ${s.Name}`);
console.log(`  两边都有但内容不同（待上传修改）: ${d.students.modified.length}`);
for (const s of d.students.modified.slice(0, 20)) console.log(`      #${s.Id_db} ${s.Name}`);

console.log('');
console.log('=== 文件级差异 ===');
console.log(`  md5 相同: ${d.files.same}`);
console.log(`  仅本地有 (${d.files.added.length}):`, d.files.added.join(', ') || '-');
console.log(`  仅云端有 (${d.files.removed.length}):`, d.files.removed.join(', ') || '-');
console.log(`  两边都有但不同 (${d.files.modified.length}):`);
for (const f of d.files.modified) console.log(`      ${f.key}  本地 ${f.size}B / 云端 ${f.prevSize}B`);
