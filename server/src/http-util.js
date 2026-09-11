// 带代理支持 / 重试 / 超时的抓取工具
//
// 为什么不用原生 fetch 直连？
//   wikiru（bluearchive.wikiru.jp）在部分网络环境下不可达，需要走本地代理。
//   Node 原生 fetch（undici）不认 http_proxy 环境变量，所以这里对需要代理的
//   请求做一层最小实现：CONNECT 隧道 + TLS，够用且零依赖。
import net from 'net';
import tls from 'tls';
import http from 'http';
import { URL } from 'url';

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 代理实现（仅 HTTP CONNECT，够覆盖 Clash / v2ray 的 http 端口） ----------

function connectViaProxy(proxyUrl, targetHost, targetPort, timeout) {
  return new Promise((resolve, reject) => {
    let proxy;
    try {
      proxy = new URL(proxyUrl);
    } catch {
      return reject(new Error(`代理地址格式错误: ${proxyUrl}`));
    }
    const proxyPort = Number(proxy.port) || 80;
    const socket = net.connect({ host: proxy.hostname, port: proxyPort });
    const fail = (e) => {
      socket.destroy();
      reject(e);
    };
    socket.setTimeout(timeout, () => fail(new Error('代理连接超时')));
    socket.once('error', fail);
    socket.once('connect', () => {
      const auth = proxy.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}\r\n`
        : '';
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}\r\n`
      );
    });
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('latin1');
      if (!buf.includes('\r\n\r\n')) return;
      socket.off('data', onData);
      const statusLine = buf.split('\r\n')[0];
      const code = Number((statusLine.match(/HTTP\/\d\.\d (\d+)/) || [])[1]);
      if (code !== 200) return fail(new Error(`代理隧道建立失败: ${statusLine}`));
      resolve(socket);
    };
    socket.on('data', onData);
  });
}

// 通过代理发一次 HTTP(S) 请求，返回 { status, headers, body(Buffer) }
async function requestViaProxy(proxyUrl, urlStr, { headers = {}, timeout = 60000 } = {}) {
  const u = new URL(urlStr);
  const isHttps = u.protocol === 'https:';
  const port = Number(u.port) || (isHttps ? 443 : 80);
  const rawSocket = await connectViaProxy(proxyUrl, u.hostname, port, timeout);
  const socket = isHttps
    ? tls.connect({ socket: rawSocket, servername: u.hostname })
    : rawSocket;
  if (isHttps) {
    await new Promise((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
    });
  }
  const path = u.pathname + (u.search || '');
  const headerLines = [
    `GET ${path} HTTP/1.1`,
    `Host: ${u.host}`,
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
    'Connection: close',
    'Accept-Encoding: identity',
    '',
    '',
  ].join('\r\n');
  socket.write(headerLines);

  const chunks = [];
  await new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };
    socket.setTimeout(timeout, () => done(reject, new Error('响应超时')));
    socket.on('data', (c) => chunks.push(c));
    socket.on('end', () => done(resolve));
    socket.on('error', (e) => done(reject, e));
  });
  socket.destroy();

  const raw = Buffer.concat(chunks);
  const sep = raw.indexOf('\r\n\r\n');
  if (sep < 0) throw new Error('响应格式异常（无 header 分隔符）');
  const headText = raw.slice(0, sep).toString('latin1');
  let body = raw.slice(sep + 4);
  const lines = headText.split('\r\n');
  const status = Number((lines[0].match(/HTTP\/\d\.\d (\d+)/) || [])[1]);
  const headersOut = {};
  for (const line of lines.slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) headersOut[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  // chunked 解码（有些站点不认 Accept-Encoding: identity 仍回 chunked）
  if ((headersOut['transfer-encoding'] || '').includes('chunked')) {
    body = decodeChunked(body);
  }
  return { status, headers: headersOut, body };
}

function decodeChunked(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    const lineEnd = buf.indexOf('\r\n', pos);
    if (lineEnd < 0) break;
    const size = parseInt(buf.slice(pos, lineEnd).toString('latin1'), 16);
    if (!size) break;
    out.push(buf.slice(lineEnd + 2, lineEnd + 2 + size));
    pos = lineEnd + 2 + size + 2;
  }
  return Buffer.concat(out);
}

// ---------- 统一入口 ----------

// 请求文本
// opts: { proxy, headers, timeout, retries, label }
export async function fetchText(url, opts = {}) {
  const {
    proxy = '',
    headers = {},
    timeout = 60000,
    retries = 3,
    label = 'fetchText',
  } = opts;
  const reqHeaders = { 'User-Agent': DEFAULT_UA, Accept: 'text/html,*/*', ...headers };
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try {
      if (proxy) {
        const r = await requestViaProxy(proxy, url, { headers: reqHeaders, timeout });
        if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status} for ${url}`);
        return r.body.toString('utf8');
      }
      const res = await fetch(url, { headers: reqHeaders, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      console.log(`[${label}] 第 ${i}/${retries} 次失败: ${url} (${e.message})`);
      if (i < retries) await sleep(500 * i);
    }
  }
  throw lastErr;
}

// 请求二进制
export async function fetchBuffer(url, opts = {}) {
  const {
    proxy = '',
    headers = {},
    timeout = 60000,
    retries = 3,
    label = 'fetchBuffer',
  } = opts;
  const reqHeaders = { 'User-Agent': DEFAULT_UA, ...headers };
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try {
      if (proxy) {
        const r = await requestViaProxy(proxy, url, { headers: reqHeaders, timeout });
        if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status} for ${url}`);
        return { buf: r.body, contentType: r.headers['content-type'] || '' };
      }
      const res = await fetch(url, { headers: reqHeaders, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return { buf: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || '' };
    } catch (e) {
      lastErr = e;
      console.log(`[${label}] 第 ${i}/${retries} 次失败: ${url} (${e.message})`);
      if (i < retries) await sleep(500 * i);
    }
  }
  throw lastErr;
}

// 探测：只判断可达 + 状态码，不读 body
export async function probeUrl(url, opts = {}) {
  const { proxy = '', headers = {}, timeout = 20000 } = opts;
  if (proxy) {
    try {
      const r = await requestViaProxy(proxy, url, {
        headers: { 'User-Agent': DEFAULT_UA, ...headers },
        timeout,
      });
      return { ok: r.status >= 200 && r.status < 300, status: r.status };
    } catch (e) {
      return { ok: false, status: 0, error: e.message };
    }
  }
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': DEFAULT_UA, ...headers },
      signal: AbortSignal.timeout(timeout),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}
