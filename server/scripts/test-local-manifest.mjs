import { localManifest } from '../src/release-cloud.js';

const m = await localManifest({ note: '（演练，不写入 COS）' });
console.log('ts            =', m.ts);
console.log('releasedAt    =', m.releasedAt);
console.log('source        =', JSON.stringify(m.source));
console.log('totals        =', JSON.stringify(m.totals));
console.log('学生指纹条数  =', m.students?.count);
console.log('');
console.log('文件清单（应只含 11 个 json + 白名单里的 data，绝不含 publish-config.json）：');
for (const f of m.files) console.log('  ' + f.key.padEnd(42) + String(f.size).padStart(8) + 'B  ' + f.md5.slice(0, 12));
const bad = m.files.filter((f) => /publish-config|icons-meta|backend|_safety/.test(f.key));
console.log('');
console.log(bad.length ? '❌ 危险：清单里混入不该外传的文件 ' + JSON.stringify(bad) : '✅ 白名单正确，没有敏感/无关文件');
