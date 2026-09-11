// 验证：云端与本地的字节差异是不是纯粹的换行符（CRLF vs LF）
import fs from 'fs/promises';
import path from 'path';
import { config } from '../src/config.js';
import { cosClient } from '../src/icons-cos.js';

const TS = '2026-09-10T10-51-17-000Z';
const cos = await cosClient();
const manifest = JSON.parse((await cos.get(`releases/${TS}.json`)).toString('utf8'));

const count = (buf, sub) => buf.toString('latin1').split(sub).length - 1;

console.log('文件'.padEnd(40) + '云端CRLF'.padStart(9) + '本地CRLF'.padStart(9) + '云端LF'.padStart(8) + '本地LF'.padStart(8) + '  结论');
for (const f of manifest.files) {
  const name = f.key.replace(/^(json|data)\//, '');
  const dir = f.key.startsWith('json/') ? config.jsonDir : config.dataDir;
  let cloudBuf, localBuf;
  try {
    cloudBuf = await cos.get(f.key);
  } catch {
    continue;
  }
  try {
    localBuf = await fs.readFile(path.join(dir, name));
  } catch {
    console.log(`${f.key.padEnd(40)} 本地缺失`);
    continue;
  }
  const cCRLF = count(cloudBuf, '\r\n');
  const lCRLF = count(localBuf, '\r\n');
  const cLF = count(cloudBuf, '\n');
  const lLF = count(localBuf, '\n');
  const sizeDiff = cloudBuf.length - localBuf.length;
  // 去掉 \r 之后内容是否完全一致？
  const cNorm = cloudBuf.toString('utf8').replace(/\r\n/g, '\n');
  const lNorm = localBuf.toString('utf8').replace(/\r\n/g, '\n');
  const sameAfterNorm = cNorm === lNorm;
  console.log(
    f.key.padEnd(40) +
      String(cCRLF).padStart(9) +
      String(lCRLF).padStart(9) +
      String(cLF).padStart(8) +
      String(lLF).padStart(8) +
      `  体积差=${sizeDiff}  去CR后${sameAfterNorm ? '完全一致 ✓' : '仍不同 ✗'}`
  );
}
