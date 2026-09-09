import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, '..');

export const config = {
  serverRoot,
  dataDir: path.join(serverRoot, 'data'),
  jsonDir: path.join(serverRoot, 'data', 'json'),
  imgDir: path.join(serverRoot, 'data', 'img'),
  port: 3000,

  // schaledb 数据源（与 ba-plugin 一致）
  sources: {
    students: {
      cn: 'https://schaledb.com/data/cn/students.min.json',
      jp: 'https://schaledb.com/data/jp/students.min.json',
      tw: 'https://schaledb.com/data/tw/students.min.json',
      kr: 'https://schaledb.com/data/kr/students.min.json',
      zh: 'https://schaledb.com/data/zh/students.min.json',
    },
    items: 'https://schaledb.com/data/cn/items.min.json',
  },

  // 头像源
  avatar: {
    icon: (id) => `https://schaledb.com/images/student/icon/${id}.webp`,
    collection: (id) => `https://schaledb.com/images/student/collection/${id}.webp`,
  },
};

export default config;
