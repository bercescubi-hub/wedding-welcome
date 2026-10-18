/**
 * Wedding Welcome — legătura cu Google Sheets
 *
 * Ce face:
 *  - primește cererile din formularul public (oferta.html) și le scrie în foaia „Cereri”;
 *  - dă aplicației lista de cereri și primește înapoi modificările (status, reduceri, km, note);
 *  - păstrează prețurile și șabloanele în foaia „Setari”, ca formularul să arate mereu prețurile tale;
 *  - trimite emailurile către clienți din contul Gmail care a publicat scriptul.
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
  ['clientMessage','Mesaj client'], ['notes','Note interne'], ['lastEmail','Ultimul email'], ['source','Sursa']
];
const KEYS = FIELDS.map(f => f[0]);
const TEXT_COLS = ['id','createdAt','phone','eventDate','startTime','lastEmail'];
const CLIENT_KEYS = ['name','phone','email','eventType','eventDate','startTime','county','city','venue','guests','package','outside','km','transport','packagePrice','total','clientMessage','source'];
const ADMIN_KEYS = ['status','package','outside','km','transport','packagePrice','discountType','discountValue','total','cost','profit','staffMenuByClient','notes','name','phone','email','eventDate','startTime','county','city','venue','guests','eventType'];

/* ---------------- intrări web ---------------- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'config') return json({ ok: true, config: publicConfig() });
    if (p.key !== ADMIN_KEY) return json({ ok: false, error: 'Cheie greșită' });
    if (p.action === 'list') return json({ ok: true, rows: listRows(), settings: getSettings(), account: Session.getEffectiveUser().getEmail() });
    if (p.action === 'ping') return json({ ok: true, account: Session.getEffectiveUser().getEmail() });
    return json({ ok: false, error: 'Acțiune necunoscută' });
  } catch (err) { return json({ ok: false, error: String(err) }); }
}

function doPost(e) {
  let d = {};
  try { d = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json({ ok: false, error: 'Date invalide' }); }
  try {
    if (d.action === 'submit') return json(submit(d.data || {}));
    if (d.key !== ADMIN_KEY) return json({ ok: false, error: 'Cheie greșită' });
    if (d.action === 'update') return json(updateRow(d.id, d.fields || {}));
    if (d.action === 'email') return json(sendEmail(d));
    if (d.action === 'settings') { saveSettings(d.settings || {}); return json({ ok: true }); }
    return json({ ok: false, error: 'Acțiune necunoscută' });
  } catch (err) { return json({ ok: false, error: String(err) }); }
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
function setup() { sheet_(); settingsSheet_(); }

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
  try { sheet_().appendRow(KEYS.map(k => asText_(k, row[k] == null ? '' : row[k]))); }
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

/* ---------------- setări ---------------- */
function getSettings() {
  const v = settingsSheet_().getRange('A2').getValue();
  try { return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function saveSettings(s) { settingsSheet_().getRange('A2').setValue(JSON.stringify(s)); }
function publicConfig() {
  const s = getSettings(); if (!s) return null;
  return { packages: s.packages, pricing: s.pricing };   // fără costuri și șabloane
}

/* ---------------- email ---------------- */
function esc_(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function sendEmail(d) {
  if (!d.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.to)) return { ok: false, error: 'Adresa de email a clientului nu e validă' };
  const me = Session.getEffectiveUser().getEmail();
  const opts = { name: d.fromName || 'Wedding Welcome', replyTo: d.fromEmail || me,
    htmlBody: '<div style="font-family:Georgia,serif;font-size:15px;line-height:1.6;color:#26182a">' + esc_(d.body || '').replace(/\n/g, '<br>') + '</div>' };
  if (d.fromEmail && d.fromEmail.toLowerCase() !== String(me).toLowerCase()) {
    const aliases = GmailApp.getAliases().map(a => a.toLowerCase());
    if (aliases.indexOf(d.fromEmail.toLowerCase()) < 0) return { ok: false, error: 'Adresa ' + d.fromEmail + ' nu e configurată ca alias în Gmail-ul contului ' + me + '. Folosește ' + me + ' sau adaug-o în Gmail → Setări → Conturi → Trimite mesaje ca.' };
    opts.from = d.fromEmail;
  }
  GmailApp.sendEmail(d.to, d.subject || 'Wedding Welcome', d.body || '', opts);
  const stamp = Utilities.formatDate(new Date(), 'Europe/Bucharest', 'yyyy-MM-dd HH:mm') + ' · ' + (d.template || 'email');
  const f = { lastEmail: stamp }; if (d.newStatus) f.status = d.newStatus;
  if (d.id) { const sh = sheet_(); const r = findRow_(sh, d.id);
    if (r > 0) { sh.getRange(r, KEYS.indexOf('lastEmail') + 1).setValue(stamp); if (d.newStatus) sh.getRange(r, KEYS.indexOf('status') + 1).setValue(d.newStatus); } }
  return { ok: true, lastEmail: stamp, sentFrom: opts.from || me };
}

function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
