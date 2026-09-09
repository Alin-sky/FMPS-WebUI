const BASE = '/api';

async function req(path, options) {
  const res = await fetch(`${BASE}${path}`, {
    cache: 'no-store',
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const getStudents = () => req('/students');
export const getStudent = (id) => req(`/students/${id}`);
export const getStudentRaw = (id) => req(`/students/${id}/raw`);
export const updateStudentRaw = (id, fileName, data) =>
  req(`/students/${id}/raw`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, data }),
  });
export const getStats = () => req('/stats');
export const avatarUrl = (id) => `${BASE}/avatar/${id}?v=col2`;
export const itemUrl = (icon) => `${BASE}/item/${icon}`;

export const crawl = () => req('/crawl', { method: 'POST' });
export const crawlCloud = () => req('/crawl/cloud', { method: 'POST' });
export const revertAll = () => req('/revert/all', { method: 'POST' });
export const revertExceptId = () => req('/revert/except-id', { method: 'POST' });
export const revertStudentAll = (id) => req(`/revert/student/${id}/all`, { method: 'POST' });
export const revertStudentExceptId = (id) => req(`/revert/student/${id}/except-id`, { method: 'POST' });
export const getVersions = () => req('/versions');
export const restoreVersion = (ts) => req(`/versions/${encodeURIComponent(ts)}/restore`, { method: 'POST' });
export const getDiff = () => req('/diff');
export const getStudentDiff = (id) => req(`/diff/student/${id}`);
export const getSnapshots = () => req('/snapshots');

export const getCloudDiff = () => req('/cloud/diff');
export const getRawJson = (fname) => req(`/raw/${fname}`);
export const importJson = (fname, data) =>
  req('/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fname, data }),
  });
export const publish = (password) =>
  req('/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
export const previewPublish = (password) =>
  req('/publish/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
export const getSkipList = () => req('/skip-list');
export const saveSkipList = (skipIds) =>
  req('/skip-list', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skipIds }),
  });
export const toggleSkip = (idDb) =>
  req(`/skip/${idDb}`, { method: 'PUT' });
export const testMatch = (text) =>
  req(`/match-test?text=${encodeURIComponent(text)}`);

export const updateStudent = (id, changes) =>
  req(`/students/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes }),
  });

export const getAliasConfig = () => req('/alias-config');
export const saveAliasConfig = (groups) =>
  req('/alias-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groups }),
  });

export const exportJson = () => req('/export', { method: 'POST' });

// 漫画
export const getManga = () => req('/manga');
export const getMangaTree = () => req('/manga/tree');
export const fetchCosManga = () => req('/manga/cos', { method: 'POST' });
export const crawlManga = (entryIds) =>
  req('/manga/crawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entryIds }),
  });
export const retryManga = () => req('/manga/retry', { method: 'POST' });
export const checkMangaDuplicates = (withMd5 = true) =>
  req(`/manga/duplicates?md5=${withMd5 ? 1 : 0}`);
export const dedupManga = () => req('/manga/dedup', { method: 'POST' });
export const fixMangaImages = () => req('/manga/fix-images', { method: 'POST' });
export const getJsonFiles = () => req('/json-files');
export const getMangaExclude = () => req('/manga/exclude');
export const setMangaExclude = (series) =>
  req('/manga/exclude', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ series }),
  });
export const deleteMangaSeries = (series) =>
  req('/manga/delete-series', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ series }),
  });
export const manualMangaEpisode = (contentId) =>
  req('/manga/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentId }),
  });
export const mangaImageUrl = (url) => `${BASE}/manga/image?url=${encodeURIComponent(url)}`;

// JSON 对比
export const getRawJsonFile = (fname) => req(`/raw/${fname}`);
export const getCloudJsonFile = (fname) => req(`/cloud/raw/${fname}`);

// 卡池管理
export const getGacha = () => req('/gacha');
export const saveGacha = (pools) =>
  req('/gacha', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pools }),
  });
export const autoGacha = () => req('/gacha/auto');
export const getRevisions = () => req('/revisions');
export const saveRevisions = (revisions) =>
  req('/revisions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revisions }),
  });
