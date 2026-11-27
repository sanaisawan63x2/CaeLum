/**
 * CaeLum -> Google Docs, one-way mirror of data/world.json on main.
 * Run setupCaeLumSync once from a standalone Google Apps Script project.
 * All Google documents are created in the executing user's Drive.
 */
const CAELUM = {
  source: 'https://raw.githubusercontent.com/sanaisawan63x2/CaeLum/main/data/world.json',
  sourcePage: 'https://github.com/sanaisawan63x2/CaeLum/blob/main/data/world.json',
  folder: 'CaeLum - NotebookLM Sources',
  intervalMinutes: 1,
  maxChars: 800000,
  docs: [
    ['world', '01 - CaeLum - World and Canon'],
    ['game', '02 - CaeLum - Gameplay and Systems'],
    ['author', '03 - CaeLum - Author-only Canon'],
    ['draft', '04 - CaeLum - Drafts and Open Questions'],
    ['story', '05 - CaeLum - Narrative'],
    ['index', '00 - CaeLum - Project Index']
  ]
};

function setupCaeLumSync() {
  syncCaeLum();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncCaeLum')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncCaeLum').timeBased()
    .everyMinutes(CAELUM.intervalMinutes).create();
  showCaeLumDocs();
}

function showCaeLumDocs() {
  const p = PropertiesService.getScriptProperties();
  const folder = p.getProperty('FOLDER_ID');
  if (folder) console.log('Folder: https://drive.google.com/drive/folders/' + folder);
  CAELUM.docs.forEach(([key, title]) => {
    const id = p.getProperty('DOC_' + key);
    if (id) console.log(title + ': https://docs.google.com/document/d/' + id + '/edit');
  });
  console.log('Last successful sync: ' + (p.getProperty('LAST_SUCCESS') || 'none'));
}

function stopCaeLumSync() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncCaeLum')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function syncCaeLum() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  const p = PropertiesService.getScriptProperties();
  try {
    const res = UrlFetchApp.fetch(CAELUM.source + '?ts=' + Date.now(), {
      headers: { 'Cache-Control': 'no-cache' }, muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) throw new Error('GitHub HTTP ' + res.getResponseCode());
    const raw = res.getContentText('UTF-8');
    const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8)
      .map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
    if (hash === p.getProperty('SYNC_HASH') && CAELUM.docs.every(([key]) => p.getProperty('DOC_' + key))) return;
    const db = JSON.parse(raw);
    const now = new Date().toISOString();
    const texts = buildCaeLumDocuments(db, hash, now);
    // Validate every document before creating/updating any of them.
    CAELUM.docs.forEach(([key]) => {
      if (typeof texts[key] !== 'string' || texts[key].length > CAELUM.maxChars)
        throw new Error('Document exceeds safe limit: ' + key + '. Split it before syncing.');
    });
    let folderId = p.getProperty('FOLDER_ID');
    if (!folderId) {
      folderId = DriveApp.createFolder(CAELUM.folder).getId();
      p.setProperty('FOLDER_ID', folderId);
    }
    const folder = DriveApp.getFolderById(folderId);
    // Index goes last, so mixed versions are identifiable if a write fails.
    CAELUM.docs.forEach(([key, title]) => {
      let id = p.getProperty('DOC_' + key);
      if (!id) {
        const doc = DocumentApp.create(title);
        id = doc.getId();
        doc.saveAndClose();
        p.setProperty('DOC_' + key, id);
        DriveApp.getFileById(id).moveTo(folder);
      }
      const doc = DocumentApp.openById(id);
      doc.getBody().setText(texts[key]);
      doc.saveAndClose();
    });
    p.setProperties({ SYNC_HASH: hash, LAST_SUCCESS: now, LAST_VERSION: String(db.version) });
    p.deleteProperty('LAST_ERROR');
    console.log('Synced CaeLum v' + db.version + ' / ' + hash);
  } catch (err) {
    p.setProperty('LAST_ERROR', new Date().toISOString() + ' ' + String(err));
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function buildCaeLumDocuments(db, hash, now) {
  if (!db || !Array.isArray(db.sections) || !Array.isArray(db.entries) ||
      !db.project || db.version == null) throw new Error('Unexpected world.json schema');
  const inactive = new Set(['archived', 'deprecated', 'deleted', 'retired', 'obsolete',
    'removed', 'superseded', 'quarantined', 'inactive', 'cancelled', 'canceled']);
  const isInactive = o => inactive.has(String(o.status || '').toLowerCase()) ||
    inactive.has(String(o.visibility || '').toLowerCase()) || o.archived === true || o.deleted === true;
  const sectionMap = new Map(db.sections.map(s => [s.id, s]));
  if (sectionMap.size !== db.sections.length) throw new Error('Duplicate section ID');
  function ancestry(id) {
    const out = [], seen = new Set();
    while (id) {
      if (seen.has(id)) throw new Error('Section parent cycle: ' + id);
      seen.add(id);
      const s = sectionMap.get(id);
      if (!s) break;
      out.unshift(s);
      id = s.parentId;
    }
    return out;
  }
  const formatValue = v => typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  const record = (item, label) => Object.entries(item).map(([k,v]) =>
    label + k + ':\n' + formatValue(v)).join('\n\n');
  const header = title => title + '\n' +
    'SOURCE: ' + CAELUM.sourcePage + '\nVERSION: ' + db.version +
    '\nSOURCE SHA-256: ' + hash + '\nSOURCE UPDATED: ' + (db.project.updatedAt || 'unspecified') +
    '\nSYNC UTC: ' + now + '\n\n' +
    'ใช้เฉพาะข้อมูลปัจจุบันจาก world.json; สถานะ draft หรือข้อมูลที่ยังไม่อนุมัติไม่ใช่ canon. ' +
    'ไม่ดึง Git history, ไฟล์นิยายแยก, revision หรือข้อมูลที่ถูกลบ. เอกสารนี้ถูกเขียนทับโดยระบบ.\n\n';
  const buckets = { world: [], game: [], author: [], draft: [] };
  const seenIds = new Set();
  let skipped = 0;
  db.entries.forEach(e => {
    if (!e.id || seenIds.has(e.id)) throw new Error('Missing or duplicate entry ID');
    seenIds.add(e.id);
    const chain = ancestry(e.sectionId);
    if (isInactive(e) || chain.some(isInactive)) { skipped++; return; }
    const category = chain.map(s => s.name || s.id).join(' / ') || e.sectionId || '(uncategorized)';
    const isGame = chain.some(s => s.group === 'dev' || String(s.id).startsWith('dev-'));
    const isPrivate = e.visibility === 'author-only' || chain.some(s => s.visibility === 'author-only');
    const key = e.status !== 'canon' ? 'draft' : isPrivate ? 'author' : isGame ? 'game' : 'world';
    buckets[key].push('=== ' + (e.title || e.id) + ' ===\nSECTION: ' + category +
      '\n' + record(e, '') + '\n\n');
  });
  const texts = {};
  CAELUM.docs.forEach(([key, title]) => { texts[key] = header(title); });
  Object.keys(buckets).forEach(key => {
    texts[key] += 'COUNT: ' + buckets[key].length + '\n\n' +
      (buckets[key].join('') || 'ยังไม่มีข้อมูลในหมวดนี้จากแหล่งต้นฉบับ');
  });
  // Only import narrative actually present in the current authoritative world.json.
  // Never read data/novel/* or revision history.
  if (db.novel && typeof db.novel === 'object') {
    const meta = Object.fromEntries(Object.entries(db.novel).filter(([k]) => k !== 'chapters'));
    const chapters = Array.isArray(db.novel.chapters) ? db.novel.chapters.filter(c => !isInactive(c)) : [];
    texts.story += 'CHAPTER COUNT: ' + chapters.length + '\n\n' + record(meta, '') + '\n\n' +
      chapters.map(c => '=== ' + (c.title || c.id || 'Chapter') + ' ===\n' + record(c, '')).join('\n\n') +
      '\n\nสถานะและ visibility ของแต่ละตอนเป็นไปตามข้อมูลต้นฉบับ; draft ไม่ใช่ canon.';
  } else {
    texts.story += 'ยังไม่มีข้อมูลนิยายใน world.json เวอร์ชันปัจจุบัน; ห้ามนำเนื้อเรื่องเก่ากลับมาเติมเอง';
  }
  const extra = Object.fromEntries(Object.entries(db).filter(([k]) =>
    !['schemaVersion','version','project','sections','entries','novel'].includes(k)));
  texts.index += 'SCHEMA VERSION: ' + db.schemaVersion + '\n' +
    'TOTAL ENTRIES: ' + db.entries.length + '\nEXCLUDED INACTIVE: ' + skipped + '\n' +
    Object.keys(buckets).map(k => k + ': ' + buckets[k].length).join('\n') +
    '\n\n=== PROJECT ===\n' + record(db.project, '') +
    '\n\n=== ACTIVE SECTION INDEX ===\n' +
    db.sections.filter(s => !ancestry(s.id).some(isInactive)).map(s => record(s, '')).join('\n\n') +
    '\n\n=== OTHER CURRENT ROOT FIELDS ===\n' +
    (Object.keys(extra).length ? record(extra, '') : '(none)') +
    '\n\nข้อจำกัด: ไฟล์รูปภาพและเนื้อหาของ URL ภายนอกไม่ได้ถูกคัดลอก มีเฉพาะข้อมูลและลิงก์ใน world.json.';
  return texts;
}
