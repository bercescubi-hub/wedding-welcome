/**
 * Wedding Welcome — legătura cu Google Sheets
 *
 * Ce face:
 *  - primește cererile din formularul public (oferta.html) și le scrie în foaia „Cereri”;
 *  - dă aplicației lista de cereri și primește înapoi modificările (status, reduceri, km, note);
 *  - păstrează prețurile și șabloanele în foaia „Setari”, ca formularul să arate mereu prețurile tale;
 *  - trimite emailurile către clienți din contul Gmail care a publicat scriptul;
 *  - păstrează conturile aplicației în foaia „Conturi” (doar parole criptate), cu rolurile Administrator / Utilizator,
 *    ca să poți intra de pe orice dispozitiv și să dai acces colaboratorilor.
 *
 * Instalare (o singură dată):
 *  1. În Google Sheet: Extensii → Apps Script. Selectează tot (Ctrl+A), șterge, apoi lipește tot fișierul ăsta.
 *     Prima linie din editor trebuie să fie „/**”, nu „function myFunction() {”.
 *  2. Schimbă ADMIN_KEY de mai jos cu o parolă lungă, doar a ta, păstrând ghilimelele: const ADMIN_KEY = 'parola-ta';
 *  3. Salvează, apoi Implementare → Implementare nouă → tip „Aplicație web”:
 *       Execută ca: Eu · Cine are acces: Oricine. Autorizează când ți se cere.
 *  4. Copiază adresa „Aplicație web” (…/exec) și pune-o în aplicație, la Evenimente → Conectare.
 */
const ADMIN_KEY = 'SCHIMBA-ASTA-cu-o-parola-lunga';

const SHEET_ID = '1F0WKXYN48B0Q_L29el01QJZmqKDt6WRBOiRfSca79Hs';   // Google Sheet-ul „Weeding Welcome”
const SHEET = 'Cereri';
const SETTINGS_SHEET = 'Setari';
const FIELDS = [
  ['id','ID'], ['createdAt','Primit la'], ['status','Status'], ['name','Nume'], ['phone','Telefon'], ['email','Email'],
  ['eventType','Tip eveniment'], ['eventDate','Data eveniment'], ['startTime','Ora început'], ['county','Județ'], ['city','Localitate'],
  ['venue','Locație'], ['guests','Invitați'], ['package','Pachet'], ['outside','În afara București-Ilfov'], ['km','Km'],
  ['transport','Transport (lei)'], ['packagePrice','Preț pachet (lei)'], ['discountType','Reducere tip'], ['discountValue','Reducere valoare'],
  ['total','Total (lei)'], ['cost','Cost estimat (lei)'], ['profit','Profit estimat (lei)'], ['staffMenuByClient','Meniu staff de la client'],
  ['clientMessage','Mesaj client'], ['notes','Note interne'], ['lastEmail','Ultimul email'], ['source','Sursa'],
  ['album','Album foto']
];
const KEYS = FIELDS.map(f => f[0]);
const TEXT_COLS = ['id','createdAt','phone','eventDate','startTime','lastEmail'];
const CLIENT_KEYS = ['name','phone','email','eventType','eventDate','startTime','county','city','venue','guests','package','outside','km','transport','packagePrice','total','clientMessage','source'];
const ADMIN_KEYS = ['status','package','outside','km','transport','packagePrice','discountType','discountValue','total','cost','profit','staffMenuByClient','notes','name','phone','email','eventDate','startTime','county','city','venue','guests','eventType','album'];

/* ---------------- intrări web ----------------
   Aplicația vorbește cu scriptul prin fetch (GET/POST). Dacă browserul blochează citirea răspunsului,
   trece pe „JSONP”: același apel, trimis ca GET cu ?payload=…&callback=…, iar răspunsul vine ca script. */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const cb = /^[A-Za-z_$][\w$]{0,40}$/.test(p.callback || '') ? p.callback : '';
  let out;
  try {
    out = handle_(p.payload ? JSON.parse(p.payload) : Object.assign({}, p));
  } catch (err) { out = { ok: false, error: String(err) }; }
  return p.via === 'frame' ? frame_(out, p.nonce) : json(out, cb);
}

/* POST: fie JSON în corp (aplicația, pe calculator), fie un formular clasic trimis într-o fereastră invizibilă
   (iPhone/Safari, unde cererile din pagină sunt blocate): atunci răspunsul vine ca mesaj către pagină. */
function doPost(e) {
  const p = (e && e.parameter) || {};
  let d = {};
  try { d = p.payload ? JSON.parse(p.payload) : JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return p.via === 'frame' ? frame_({ ok: false, error: 'Date invalide' }, p.nonce) : json({ ok: false, error: 'Date invalide' }); }
  let out;
  try { out = handle_(d); } catch (err) { out = { ok: false, error: String(err) }; }
  return p.via === 'frame' ? frame_(out, p.nonce) : json(out);
}
/** Răspuns pentru fereastra invizibilă: o pagină care trimite rezultatul înapoi formularului (postMessage). */
function frame_(o, nonce) {
  // doar caractere ASCII în pagină: diacriticele ajung corect indiferent de codificarea ferestrei
  const msg = JSON.stringify({ __ww: String(nonce || '').slice(0, 40), data: o })
    .replace(/[<\u007f-\uffff]/g, c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));
  return HtmlService.createHtmlOutput('<!doctype html><script>window.top.postMessage(' + msg + ', "*");</script>')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function handle_(d) {
  if (d.action === 'submit') return submit(d.data || {});
  if (d.action === 'config') return { ok: true, config: publicConfig() };
  if (d.action === 'authSalt') return authSalt_(d.username);
  if (d.action === 'login') return login_(d.username, d.hash);
  if (d.action === 'recover') return recover_(d);
  /* de aici: doar cu ADMIN_KEY (proprietarul) sau cu sesiunea unui cont din foaia „Conturi” */
  const me = auth_(d);
  if (!me) return { ok: false, error: d.token ? 'Sesiunea a expirat sau contul nu mai există. Intră din nou în cont.' : 'Cheie greșită', auth: true };
  const admin = me.role === 'admin';
  const who = { role: me.role, account: Session.getEffectiveUser().getEmail() };
  if (d.action === 'list') return Object.assign({ ok: true, rows: listRows(), settings: getSettings() }, who);
  if (d.action === 'ping') return Object.assign({ ok: true }, who);
  if (d.action === 'update') return updateRow(d.id, d.fields || {});
  if (d.action === 'email') return sendEmail(d);
  if (d.action === 'accountsPut') return accountsPut_(d.users || [], me);
  if (d.action === 'lights') return lights_(d);
  if (d.action === 'files') return { ok: true, files: listFiles_() };
  if (d.action === 'lightsInfo') return Object.assign({ ok: true }, lightsInfo_());
  if (d.action === 'logout') { if (d.token) PropertiesService.getScriptProperties().deleteProperty('tok:' + d.token); return { ok: true }; }
  /* doar administratori */
  if (!admin) return { ok: false, error: 'Doar un administrator poate face asta.' };
  if (d.action === 'settings') { saveSettings(d.settings || {}); return { ok: true }; }
  if (d.action === 'accounts') return { ok: true, accounts: accRows_().map(a => ({ id: a.id, username: a.username, role: a.role, email: a.email, sheetAccess: a.sheetAccess || 'none', created: a.created })), me: me.id || null };
  if (d.action === 'accountMeta') return accountMeta_(d.id, d.role, d.email);
  if (d.action === 'shareSheet') return shareSheet_(d.id, d.access);
  if (d.action === 'accountDel') return accountDel_(d.id);
  if (d.action === 'deleteLead') return deleteLead_(d.id);
  if (d.action === 'lightsSetup') return lightsSetup_(d);
  if (d.action === 'uploadFile') return uploadFile_(d);
  if (d.action === 'fileDel') return fileDel_(d.id);
  return { ok: false, error: 'Acțiune necunoscută' };
}

/* ---------------- fișiere de atașat la emailuri (ex. oferta în PDF) ----------------
   Stau în Google Drive-ul contului care a publicat scriptul, în dosarul „WE WELCOME · atașamente”.
   Se pot atașa doar fișiere din acest dosar. */
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
function filesFolder_() {
  const p = PropertiesService.getScriptProperties(), id = p.getProperty('filesFolder');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  const f = DriveApp.createFolder('WE WELCOME · atașamente'); p.setProperty('filesFolder', f.getId()); return f;
}
function fileInfo_(f) { return { id: f.getId(), name: f.getName(), size: f.getSize(), type: f.getMimeType(), updated: f.getLastUpdated().toISOString() }; }
function listFiles_() {
  const it = filesFolder_().getFiles(), out = [];
  while (it.hasNext()) { const f = it.next(); if (!f.isTrashed()) out.push(fileInfo_(f)); }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
function uploadFile_(d) {
  const name = String(d.name || '').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 120), type = String(d.type || '');
  if (!name || !d.data) return { ok: false, error: 'Lipsește fișierul.' };
  if (FILE_TYPES.indexOf(type) < 0) return { ok: false, error: 'Poți încărca PDF, JPG, PNG sau Word (.docx).' };
  const bytes = Utilities.base64Decode(String(d.data));
  if (bytes.length > 15 * 1024 * 1024) return { ok: false, error: 'Fișierul e prea mare (cel mult 15 MB).' };
  const f = filesFolder_().createFile(Utilities.newBlob(bytes, type, name));
  return { ok: true, file: fileInfo_(f) };
}
function inFolder_(f) { const id = filesFolder_().getId(), ps = f.getParents(); while (ps.hasNext()) if (ps.next().getId() === id) return true; return false; }
function fileDel_(id) {
  try { const f = DriveApp.getFileById(String(id)); if (!inFolder_(f)) return { ok: false, error: 'Fișier necunoscut.' }; f.setTrashed(true); return { ok: true }; }
  catch (e) { return { ok: false, error: 'Fișierul nu mai există.' }; }
}
function attachmentBlobs_(ids) {
  const blobs = []; let total = 0;
  for (const id of (Array.isArray(ids) ? ids : []).slice(0, 10)) {
    let f; try { f = DriveApp.getFileById(String(id)); } catch (e) { return { blobs: [], error: 'Un fișier atașat nu mai există. Scoate-l din email și încearcă din nou.' }; }
    if (!inFolder_(f) || f.isTrashed()) return { blobs: [], error: 'Un fișier atașat nu mai există. Scoate-l din email și încearcă din nou.' };
    total += f.getSize(); if (total > 20 * 1024 * 1024) return { blobs: [], error: 'Atașamentele depășesc 20 MB.' };
    blobs.push(f.getBlob());
  }
  return { blobs: blobs };
}

/* ---------------- Cheamă invitații: beculețele, prin priza smart Shelly (Shelly Cloud) ----------------
   Datele prizei (server, cheie, ID) stau în proprietățile scriptului, nu în Sheet și nu ajung în pagina publică.
   Aplicația cere „aprinde 1 secundă” la fiecare 2 secunde, iar priza se stinge singură (toggle_after): așa clipesc. */
function lightsCfg_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('lights') || '{}'); } catch (e) { return {}; } }
function lightsInfo_() { const c = lightsCfg_(); return c.id ? { configured: true, host: c.host, deviceId: c.id } : { configured: false }; }
function lightsSetup_(d) {
  const host = String(d.host || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  const key = String(d.authKey || '').trim(), id = String(d.deviceId || '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.shelly\.cloud(:\d+)?$/.test(host)) return { ok: false, error: 'Serverul arată de obicei așa: shelly-123-eu.shelly.cloud' };
  if (key.length < 20) return { ok: false, error: 'Cheia de autorizare pare incompletă. Copiaz-o întreagă din aplicația Shelly.' };
  if (!/^[a-z0-9]{6,24}$/.test(id)) return { ok: false, error: 'ID-ul dispozitivului are doar litere și cifre (ex. b48a0a1cd978).' };
  PropertiesService.getScriptProperties().setProperty('lights', JSON.stringify({ host: host, key: key, id: id, channel: Number(d.channel) || 0 }));
  return Object.assign({ ok: true }, lightsInfo_());
}
function lights_(d) {
  const c = lightsCfg_();
  if (!c.id) return { ok: false, notConfigured: true, error: 'Priza pentru beculețe nu e configurată încă.' };
  const body = { id: c.id, channel: c.channel || 0, on: !!d.on };
  const pulse = Math.round(Number(d.pulse) || 0);
  if (d.on && pulse > 0) body.toggle_after = Math.min(Math.max(pulse, 1), 60);
  const r = UrlFetchApp.fetch('https://' + c.host + '/v2/devices/api/set/switch?auth_key=' + encodeURIComponent(c.key),
    { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
  const code = r.getResponseCode(), txt = String(r.getContentText() || '');
  if (code >= 200 && code < 300) return { ok: true };
  if (code === 429) return { ok: false, busy: true, error: 'Prea multe comenzi deodată' };
  if (/DEVICE_OFFLINE/.test(txt)) return { ok: false, offline: true, error: 'Priza nu e conectată la internet. Verifică Wi-Fi-ul de la locație.' };
  if (code === 401 || code === 403 || /UNAUTHORIZED|auth/i.test(txt)) return { ok: false, error: 'Cheia Shelly nu e corectă. Verific-o în aplicație → Cheamă invitații → Configurare.' };
  return { ok: false, error: 'Shelly a răspuns: ' + txt.slice(0, 160) };
}

/* ---------------- foi ---------------- */
function book_() { return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SHEET_ID); }
function sheet_() {
  const ss = book_();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET, 0);
    sh.getRange(1, 1, 1, FIELDS.length).setValues([FIELDS.map(f => f[1])]).setFontWeight('bold').setBackground('#6a2a5e').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    TEXT_COLS.forEach(k => sh.getRange(2, KEYS.indexOf(k) + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@'));
  }
  // coloane noi adăugate în versiuni mai noi (ex. „Album foto”): le punem la capătul foii existente
  if (sh.getMaxColumns() < FIELDS.length) sh.insertColumnsAfter(sh.getMaxColumns(), FIELDS.length - sh.getMaxColumns());
  if (sh.getRange(1, FIELDS.length).getValue() !== FIELDS[FIELDS.length - 1][1])
    sh.getRange(1, 1, 1, FIELDS.length).setValues([FIELDS.map(f => f[1])]).setFontWeight('bold').setBackground('#6a2a5e').setFontColor('#ffffff');
  return sh;
}
function settingsSheet_() {
  const ss = book_();
  let sh = ss.getSheetByName(SETTINGS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SETTINGS_SHEET);
    sh.getRange('A1').setValue('Setările aplicației (se modifică din aplicație, nu de aici)');
    sh.getRange('A2').setNumberFormat('@');
  }
  return sh;
}
/** Rulează o dată din editor dacă vrei să vezi foile create înainte de prima cerere. */
function setup() { sheet_(); settingsSheet_(); accSheet_(); autorizeaza(); }
/** Rulează-o o dată din editor după o actualizare: Google cere permisiunile noi (Drive pentru atașamente, servicii externe pentru beculețe). */
function autorizeaza() { DriveApp.getRootFolder(); UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true }); }

/* ---------------- cereri ---------------- */
function clean_(v, max) {
  let s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max || 500);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // nu lăsăm formule din formular
  return s;
}
/** Datele, orele și telefoanele rămân text (altfel Sheets le transformă: „0722…” își pierde zeroul). */
function asText_(k, v) { return TEXT_COLS.indexOf(k) >= 0 && v !== '' && String(v)[0] !== "'" ? "'" + v : v; }
function submit(data) {
  if (data.website) return { ok: true };            // capcană pentru roboți
  if (!data.name || !(data.email || data.phone)) return { ok: false, error: 'Lipsesc numele sau datele de contact' };
  const row = {};
  CLIENT_KEYS.forEach(k => { row[k] = clean_(data[k], k === 'clientMessage' ? 2000 : 200); });
  row.id = Utilities.getUuid().slice(0, 8);
  row.createdAt = new Date().toISOString();
  row.status = 'Nou';
  row.discountType = '%'; row.discountValue = '0';
  row.staffMenuByClient = 'nu';
  row.source = row.source || 'formular';
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    // aceeași cerere trimisă de două ori în 2 minute (de ex. browserul a reîncercat): păstrăm una singură
    const sh = sheet_(), n = Math.min(20, sh.getLastRow() - 1);
    if (n > 0) {
      const recent = sh.getRange(sh.getLastRow() - n + 1, 1, n, KEYS.length).getDisplayValues();
      const I = k => KEYS.indexOf(k), now = Date.now();
      const dup = recent.find(r => r[I('name')] === row.name && r[I('email')] === row.email && r[I('eventDate')] === row.eventDate && now - Date.parse(r[I('createdAt')]) < 120000);
      if (dup) return { ok: true, id: dup[0], duplicate: true };
    }
    sh.appendRow(KEYS.map(k => asText_(k, row[k] == null ? '' : row[k])));
  }
  finally { lock.releaseLock(); }
  return { ok: true, id: row.id };
}
function listRows() {
  const sh = sheet_(); const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const vals = sh.getRange(2, 1, n, KEYS.length).getDisplayValues();
  return vals.filter(r => r[0]).map(r => { const o = {}; KEYS.forEach((k, i) => o[k] = r[i]); return o; });
}
function findRow_(sh, id) {
  const n = sh.getLastRow() - 1; if (n < 1) return -1;
  const ids = sh.getRange(2, 1, n, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) if (ids[i][0] === String(id)) return i + 2;
  return -1;
}
function updateRow(id, fields) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = sheet_(); const r = findRow_(sh, id);
    if (r < 0) return { ok: false, error: 'Cererea nu mai există în Sheet' };
    const cur = sh.getRange(r, 1, 1, KEYS.length).getDisplayValues()[0].map((v, i) => asText_(KEYS[i], v));
    ADMIN_KEYS.forEach(k => { if (fields[k] !== undefined) cur[KEYS.indexOf(k)] = asText_(k, clean_(fields[k], k === 'notes' ? 2000 : 200)); });
    sh.getRange(r, 1, 1, KEYS.length).setValues([cur]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/** Șterge definitiv o cerere din foaia „Cereri” (doar administratori). */
function deleteLead_(id) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try { const sh = sheet_(), r = findRow_(sh, id); if (r > 0) sh.deleteRow(r); return { ok: true, deleted: r > 0 }; }
  finally { lock.releaseLock(); }
}

/* ---------------- setări ---------------- */
/* Setările se scriu în coloana A, începând cu A2, în bucăți de 40.000 de caractere (o celulă ține cel mult 50.000). */
function getSettings() {
  const sh = settingsSheet_(), n = Math.max(1, sh.getLastRow() - 1);
  const v = sh.getRange(2, 1, n, 1).getValues().map(r => String(r[0] || '')).join('');
  try { return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function saveSettings(s) {
  const sh = settingsSheet_(), txt = JSON.stringify(s), parts = [];
  for (let i = 0; i < txt.length; i += 40000) parts.push([txt.slice(i, i + 40000)]);
  const old = Math.max(0, sh.getLastRow() - 1);
  if (old > parts.length) sh.getRange(2 + parts.length, 1, old - parts.length, 1).clearContent();
  sh.getRange(2, 1, parts.length, 1).setNumberFormat('@').setValues(parts);
}
function publicConfig() {
  const s = getSettings(); if (!s) return null;
  return { packages: s.packages, pricing: s.pricing };   // fără costuri și șabloane
}

/* ---------------- conturi ----------------
   Foaia „Conturi” ține doar sarea și amprenta parolei (PBKDF2, calculată în aplicație), nu parola,
   plus rolul (admin / user), emailul Google și accesul la acest Sheet.
   La autentificare, contul primește o sesiune proprie (nu ADMIN_KEY); rolul se citește din foaie la fiecare cerere,
   așa că o schimbare de rol sau o ștergere are efect imediat. */
const ACC_SHEET = 'Conturi';
const ACC = ['id', 'username', 'salt', 'hash', 'rsalt', 'rhash', 'created', 'updated', 'role', 'email', 'sheetAccess'];
const ACC_HEAD = ['ID', 'Utilizator', 'Sare', 'Amprentă parolă', 'Sare recuperare', 'Amprentă cod recuperare', 'Creat', 'Modificat', 'Rol', 'Email Google', 'Acces la Sheet'];
const SESSION_DAYS = 180;
function accSheet_() {
  const ss = book_();
  let sh = ss.getSheetByName(ACC_SHEET);
  if (!sh) { sh = ss.insertSheet(ACC_SHEET); sh.setFrozenRows(1); sh.getRange(2, 1, sh.getMaxRows() - 1, ACC.length).setNumberFormat('@'); }
  if (sh.getLastColumn() < ACC.length || sh.getRange(1, 1).getValue() !== 'ID')
    sh.getRange(1, 1, 1, ACC.length).setValues([ACC_HEAD]).setFontWeight('bold').setBackground('#6a2a5e').setFontColor('#ffffff');
  return sh;
}
function accRows_() {
  const sh = accSheet_(), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const rows = sh.getRange(2, 1, n, ACC.length).getDisplayValues().map((r, i) => { const o = { _row: i + 2 }; ACC.forEach((k, j) => o[k] = r[j]); return o; }).filter(a => a.id);
  // trebuie să existe mereu un administrator: dacă nu e niciunul, primul cont devine administrator
  if (rows.length && !rows.some(a => a.role === 'admin')) { rows[0].role = 'admin'; writeAcc_(sh, rows[0]._row, rows[0]); }
  rows.forEach(a => { if (a.role !== 'admin') a.role = 'user'; });
  return rows;
}
const lc_ = s => String(s || '').trim().toLowerCase();
const b64ok_ = s => /^[A-Za-z0-9+/=]{8,128}$/.test(String(s || ''));
function findAcc_(username) { return accRows_().find(a => lc_(a.username) === lc_(username)) || null; }
function pub_(a) { const o = {}; ['id', 'username', 'salt', 'hash', 'rsalt', 'rhash', 'created', 'updated', 'role', 'email'].forEach(k => o[k] = a[k]); return o; }
function writeAcc_(sh, row, a) { sh.getRange(row, 1, 1, ACC.length).setValues([ACC.map(k => a[k] == null || a[k] === '' ? '' : "'" + String(a[k]))]); }
/** Sare falsă, dar mereu aceeași, pentru nume inexistente: nu se poate afla ce conturi există. */
function fakeSalt_(username, tag) {
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, tag + ':' + lc_(username) + ':' + ADMIN_KEY);
  return Utilities.base64Encode(b.slice(0, 16));
}
function authSalt_(username) {
  const a = findAcc_(username);
  return { ok: true, salt: a ? a.salt : fakeSalt_(username, 's'), rsalt: a ? a.rsalt : fakeSalt_(username, 'r') };
}
/* ---- sesiuni ---- */
function newSession_(id) {
  const t = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('tok:' + t, JSON.stringify({ id: id, exp: Date.now() + SESSION_DAYS * 864e5 }));
  return t;
}
/** Cine face cererea: proprietarul (ADMIN_KEY) sau un cont cu sesiune validă. */
function auth_(d) {
  if (d.key && d.key === ADMIN_KEY) return { role: 'admin', id: null };
  if (!d.token || !/^[a-f0-9]{32,80}$/.test(String(d.token))) return null;
  const props = PropertiesService.getScriptProperties(), raw = props.getProperty('tok:' + d.token);
  if (!raw) return null;
  let t; try { t = JSON.parse(raw); } catch (e) { return null; }
  if (!t || t.exp < Date.now()) { props.deleteProperty('tok:' + d.token); return null; }
  const a = accRows_().find(r => r.id === t.id);
  return a ? { role: a.role, id: a.id } : null;
}
/** Cel mult 8 încercări greșite la 15 minute pentru același utilizator. */
function tooMany_(username) { return Number(CacheService.getScriptCache().get('fail:' + lc_(username)) || 0) >= 8; }
function failed_(username) { const c = CacheService.getScriptCache(), k = 'fail:' + lc_(username); c.put(k, String(Number(c.get(k) || 0) + 1), 900); }
function login_(username, hash) {
  if (tooMany_(username)) return { ok: false, error: 'Prea multe încercări greșite. Așteaptă 15 minute.' };
  const a = findAcc_(username);
  if (!a || !hash || a.hash !== String(hash)) { failed_(username); return { ok: false, error: 'Utilizator sau parolă greșite.' }; }
  CacheService.getScriptCache().remove('fail:' + lc_(username));
  return { ok: true, user: pub_(a), role: a.role, token: newSession_(a.id) };
}
function recover_(d) {
  if (tooMany_(d.username)) return { ok: false, error: 'Prea multe încercări greșite. Așteaptă 15 minute.' };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const a = findAcc_(d.username);
    if (!a || !d.rhash || a.rhash !== String(d.rhash)) { failed_(d.username); return { ok: false, error: 'Utilizatorul sau codul de recuperare nu se potrivesc.' }; }
    if (!b64ok_(d.salt) || !b64ok_(d.hash)) return { ok: false, error: 'Date invalide' };
    a.salt = d.salt; a.hash = d.hash; a.updated = new Date().toISOString();
    writeAcc_(accSheet_(), a._row, a);
    return { ok: true, user: pub_(a), role: a.role, token: newSession_(a.id) };
  } finally { lock.releaseLock(); }
}
/** Urcă sau actualizează conturi. Un administrator urcă orice cont de pe dispozitivul lui; un utilizator doar contul propriu
    (de ex. după schimbarea parolei). Rolul, emailul și accesul la Sheet nu se schimbă de aici. */
function accountsPut_(users, me) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = accSheet_(), rows = accRows_(), conflicts = [];
    (users || []).slice(0, 50).forEach(u => {
      if (!u || !/^u[a-z0-9]{4,20}$/.test(String(u.id)) || !String(u.username || '').trim() || ![u.salt, u.hash, u.rsalt, u.rhash].every(b64ok_)) return;
      if (me.role !== 'admin' && u.id !== me.id) return;
      const byId = rows.find(r => r.id === u.id), byName = rows.find(r => lc_(r.username) === lc_(u.username));
      if (byName && byName.id !== u.id) { conflicts.push(String(u.username)); return; }
      const rec = Object.assign({}, byId || { role: rows.length ? 'user' : 'admin', email: '', sheetAccess: 'none' },
        { id: u.id, username: String(u.username).trim().slice(0, 60), salt: u.salt, hash: u.hash, rsalt: u.rsalt, rhash: u.rhash,
          created: clean_(u.created, 40), updated: clean_(u.updated || u.created, 40) });
      if (byId) { if (String(rec.updated) >= String(byId.updated)) { writeAcc_(sh, byId._row, rec); Object.assign(byId, rec); } }
      else if (me.role === 'admin') { sh.appendRow(ACC.map(k => rec[k] == null || rec[k] === '' ? '' : "'" + String(rec[k]))); rows.push(Object.assign({ _row: sh.getLastRow() }, rec)); }
    });
    return { ok: true, conflicts };
  } finally { lock.releaseLock(); }
}
/** Administratorul schimbă rolul și emailul unui cont. Trebuie să rămână mereu cel puțin un administrator. */
function accountMeta_(id, role, email) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const rows = accRows_(), a = rows.find(r => r.id === String(id));
    if (!a) return { ok: false, error: 'Contul nu există.' };
    if (role !== undefined) {
      if (role !== 'admin' && role !== 'user') return { ok: false, error: 'Rol necunoscut.' };
      if (a.role === 'admin' && role === 'user' && rows.filter(r => r.role === 'admin').length < 2) return { ok: false, error: 'Trebuie să rămână cel puțin un administrator.' };
      a.role = role;
    }
    if (email !== undefined) {
      email = String(email || '').trim().toLowerCase();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Emailul nu e valid.' };
      a.email = email;
    }
    writeAcc_(accSheet_(), a._row, a);
    return { ok: true, role: a.role, email: a.email };
  } finally { lock.releaseLock(); }
}
/** Dă sau ia accesul unui cont la acest Google Sheet (Google trimite singur invitația pe email). */
function shareSheet_(id, access) {
  if (['none', 'view', 'edit'].indexOf(access) < 0) return { ok: false, error: 'Acces necunoscut.' };
  const a = accRows_().find(r => r.id === String(id));
  if (!a) return { ok: false, error: 'Contul nu există.' };
  if (!a.email) return { ok: false, error: 'Adaugă întâi adresa Google (Gmail) a contului și salveaz-o.' };
  if (lc_(a.email) === lc_(Session.getEffectiveUser().getEmail())) return { ok: false, error: 'Acesta e contul care deține Sheet-ul; are deja acces complet.' };
  const ss = book_();
  try { ss.removeEditor(a.email); } catch (e) {}
  try { ss.removeViewer(a.email); } catch (e) {}
  if (access === 'edit') ss.addEditor(a.email);
  else if (access === 'view') ss.addViewer(a.email);
  a.sheetAccess = access; writeAcc_(accSheet_(), a._row, a);
  return { ok: true, sheetAccess: access };
}
function accountDel_(id) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const rows = accRows_(), a = rows.find(r => r.id === String(id));
    if (!a) return { ok: true };
    if (a.role === 'admin' && rows.filter(r => r.role === 'admin').length < 2) return { ok: false, error: 'Nu poți șterge ultimul administrator.' };
    if (a.email && a.sheetAccess && a.sheetAccess !== 'none') { const ss = book_(); try { ss.removeEditor(a.email); } catch (e) {} try { ss.removeViewer(a.email); } catch (e) {} }
    accSheet_().deleteRow(a._row);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ---------------- email ---------------- */
function esc_(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function sendEmail(d) {
  if (!d.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.to)) return { ok: false, error: 'Adresa de email a clientului nu e validă' };
  const me = Session.getEffectiveUser().getEmail();
  const opts = { name: d.fromName || 'WE WELCOME', replyTo: d.fromEmail || me,
    htmlBody: (typeof d.html === 'string' && d.html.length > 20 && d.html.length < 200000) ? d.html   // emailul cu logo, făcut de aplicație
      : '<div style="font-family:Georgia,serif;font-size:15px;line-height:1.6;color:#26182a">' + esc_(d.body || '').replace(/\n/g, '<br>') + '</div>' };
  if (d.fromEmail && d.fromEmail.toLowerCase() !== String(me).toLowerCase()) {
    const aliases = GmailApp.getAliases().map(a => a.toLowerCase());
    if (aliases.indexOf(d.fromEmail.toLowerCase()) < 0) return { ok: false, error: 'Adresa ' + d.fromEmail + ' nu e configurată ca alias în Gmail-ul contului ' + me + '. Folosește ' + me + ' sau adaug-o în Gmail → Setări → Conturi → Trimite mesaje ca.' };
    opts.from = d.fromEmail;
  }
  const att = attachmentBlobs_(d.attachments);
  if (att.error) return { ok: false, error: att.error };
  if (att.blobs.length) opts.attachments = att.blobs;
  GmailApp.sendEmail(d.to, d.subject || 'WE WELCOME', d.body || '', opts);
  const stamp = Utilities.formatDate(new Date(), 'Europe/Bucharest', 'yyyy-MM-dd HH:mm') + ' · ' + (d.template || 'email');
  const f = { lastEmail: stamp }; if (d.newStatus) f.status = d.newStatus;
  if (d.id) { const sh = sheet_(); const r = findRow_(sh, d.id);
    if (r > 0) { sh.getRange(r, KEYS.indexOf('lastEmail') + 1).setValue(stamp); if (d.newStatus) sh.getRange(r, KEYS.indexOf('status') + 1).setValue(d.newStatus); } }
  return { ok: true, lastEmail: stamp, sentFrom: opts.from || me, attached: att.blobs.length };
}

function json(o, callback) {
  if (callback) return ContentService.createTextOutput(callback + '(' + JSON.stringify(o) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
