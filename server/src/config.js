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

  // 头像管理
  icons: {
    // 三类头像子目录名（与 COS key 一致）
    types: ['stu_icon_db_png', 'stu_icon_db', 'gacha-img'],
    // wikiru 图源（日文 wiki 的星级页面；文件名规则见 icons-wikiru.js）
    wikiru: {
      base: 'https://bluearchive.wikiru.jp/',
      pages: ['?★1', '?★2', '?★3'],
      // 代理地址，留空 = 直连。例：'http://127.0.0.1:7890'
      proxy: process.env.WIKIRU_PROXY || '',
    },
    // 单张图下载重试与超时
    fetchTimeout: 60000,
    fetchRetries: 3,
  },
};

export default config;
