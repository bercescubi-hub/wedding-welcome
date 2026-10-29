/* ============================================================
   Wedding Welcome — Administrare: Conturi · Evenimente · Wedding Welcome
   Evenimente = cererile de ofertă din Google Sheets (prin scriptul din google-apps-script/Code.gs),
   cu calcul de preț, costuri, profit, reduceri, status și emailuri din șabloane.
   Folosește din index.html: $, esc, LS, USER, W, mode, area, render(), adminAccount(), fmtDate().
   ============================================================ */
(function () {
  const P = window.WWPricing;
  const K = () => 'ww-crm-' + USER.id;
  let C = null;                       // { url, key, settings, leads, lastSync, account }
  let view = 'cereri';                // cereri | preturi | sabloane | conectare
  let filter = 'Toate', q = '', busy = '', note = '', noteOk = false;
  let fYear = 'Toate', fMonth = 'Toate';   // perioada, după data evenimentului
  let L = null;                       // cererea deschisă (copie de lucru)
  let compose = null;                 // { tpl, to, subject, body, sending, err }
  let setDirty = false;

  const clone = o => JSON.parse(JSON.stringify(o));
  function merge(def, s) {
    s = s || {};
    return {
      packages: Array.isArray(s.packages) && s.packages.length ? s.packages : clone(def.packages),
      pricing: Object.assign({}, def.pricing, s.pricing || {}),
      costs: Object.assign({}, def.costs, s.costs || {}),
      email: Object.assign({}, def.email, s.email || {}),
      templates: Array.isArray(s.templates) && s.templates.length ? s.templates : clone(def.templates),
      fields: Array.isArray(s.fields) ? s.fields : clone(def.fields || []),
      extras: Array.isArray(s.extras) ? s.extras : clone(def.extras || [])
    };
  }
  function load() {
    C = LS.get(K()) || {};
    C.url = C.url || (window.WW_CONFIG || {}).scriptUrl || '';
    C.key = C.key || ''; C.token = C.token || '';
    C.role = C.role || (C.key ? 'admin' : '');
    C.settings = merge(P.DEFAULT_SETTINGS, C.settings);
    C.leads = Array.isArray(C.leads) ? C.leads : [];
  }
  const save = () => LS.set(K(), C);
  const configured = () => !!(C.url && (C.key || C.token));
  /** Administrator: proprietarul (cu ADMIN_KEY), un cont cu rol de administrator sau orice cont încă neconectat (pe dispozitivul lui). */
  const isAdmin = () => !configured() || !!C.key || C.role === 'admin';
  const formUrl = () => new URL('oferta.html', location.href).href;

  /* Apelul către scriptul Google. Întâi fetch; dacă browserul blochează răspunsul (extensii, setări de securitate),
     trimitem același apel prin JSONP (un <script> cu ?payload=…&callback=…), pe care scriptul îl înțelege. */
  const WRITES = ['update', 'email', 'settings', 'uploadFile', 'fileDel', 'accountsPut', 'accountMeta', 'shareSheet', 'accountDel', 'deleteLead', 'logout'];
  /** Apelul către scriptul Google, prin canalul comun (WWNet), care alege calea ce merge pe dispozitiv (și pe iPhone). */
  async function api(method, params) {
    const body = Object.assign({}, params, C.key ? { key: C.key } : { token: C.token });
    const d = await window.WWNet.call(C.url, body, WRITES.includes(params.action));
    if (!d) throw new Error('Răspuns gol de la Google');
    if (d.role && (d.role === 'admin' || d.role === 'user') && !C.key) { if (C.role !== d.role) { C.role = d.role; save(); } }
    if (!d.ok) {
      if (d.auth && C.key) d.error = 'Parola salvată în aplicație nu se potrivește cu ADMIN_KEY din scriptul Google. Pune aceeași parolă în ambele locuri: în script (linia const ADMIN_KEY, apoi Deploy → New version) sau în aplicație (Evenimente → Conectare).';
      if (d.auth) { note = d.error; noteOk = false; }
      throw new Error(d.error || 'Eroare necunoscută');
    }
    return d;
  }
  async function sync(quiet) {
    if (!configured()) return;
    busy = 'Se încarcă cererile din Google Sheets…'; if (!quiet) rerender();
    try {
      const d = await api('GET', { action: 'list' });
      C.leads = d.rows || []; C.scriptOld = !!(C.leads.length && !('album' in C.leads[0])); C.account = d.account || C.account; if (d.role) C.role = d.role;
      if (d.settings) { C.settings = merge(P.DEFAULT_SETTINGS, d.settings); const m1 = migrateTemplates(C.settings), m2 = migratePackages(C.settings); if ((m1 || m2 || (!d.settings.autoAck && C.settings.templates.some(t => t.autoSubmit))) && isAdmin()) saveSettingsRemote(); }
      else { C.settings.autoAck = buildAutoAck(C.settings); await api('POST', { action: 'settings', settings: C.settings }); }   // prima conectare: urcă prețurile implicite
      C.lastSync = new Date().toISOString(); save(); note = ''; setDirty = false;
      await pushAccounts(true);
    } catch (e) { note = navigator.onLine ? 'Nu am putut citi din Google Sheets: ' + e.message : 'Ești offline. Vezi ultimele cereri salvate pe laptop.'; noteOk = false; }
    busy = ''; rerender();
  }
  /* Lista se reîncarcă singură din Sheets la fiecare intrare în Evenimente (dacă e mai veche de 20 s),
     când revii în aplicație și la fiecare minut cât stă deschisă — ca telefonul și laptopul să arate același lucru. */
  let lastTry = 0;
  function autoSync(force) {
    if (!C || !USER || mode !== 'admin' || area !== 'evenimente' || view !== 'cereri' || !configured() || busy || !navigator.onLine) return;
    if (document.visibilityState === 'hidden') return;
    const age = Date.now() - (Date.parse(C.lastSync || '') || 0);
    if (!force && age < 20000) return;
    if (Date.now() - lastTry < 15000) return;
    lastTry = Date.now(); sync(true);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoSync(true); });
  window.addEventListener('focus', () => autoSync(true));
  window.addEventListener('online', () => autoSync(true));
  setInterval(() => autoSync(), 60000);
  /** Urcă în foaia „Conturi” conturile de pe acest dispozitiv (doar sarea și amprenta parolei), ca să meargă și de pe alte dispozitive. */
  async function pushAccounts(quiet) {
    if (!C || !configured()) return;
    try {
      const users = accounts().users.filter(u => isAdmin() || u.id === USER.id).map(u => ({ id: u.id, username: u.username, salt: u.salt, hash: u.hash, rsalt: u.rsalt, rhash: u.rhash, created: u.created, updated: u.updated || u.created }));
      const d = await api('POST', { action: 'accountsPut', users });
      C.accountsAt = new Date().toISOString(); C.accountConflicts = d.conflicts || []; save();
      if (!quiet) rerender();
    } catch (e) { /* încercăm din nou la următoarea sincronizare */ }
  }
  function rerender() { if (mode === 'admin' && area !== 'tool') render(); }

  /* ---------------- formatare ---------------- */
  const lei = P.lei, num = P.num;
  const fmtD = s => { if (!s) return '—'; const d = new Date(String(s).slice(0, 10) + 'T12:00:00'); return isNaN(d) ? esc(s) : d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const fmtDLong = s => { const d = new Date(String(s).slice(0, 10) + 'T12:00:00'); return isNaN(d) ? String(s || '') : d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' }); };
  const stCls = s => ({ 'Nou': 'st-new', 'Contactat': 'st-c', 'Ofertă trimisă': 'st-o', 'Confirmat': 'st-ok', 'Refuzat': 'st-no' })[s] || 'st-c';
  const pill = s => `<span class="stp ${stCls(s)}">${esc(s || 'Nou')}</span>`;
  const place = l => [l.venue, l.city, l.county && l.county !== 'București' ? 'jud. ' + l.county : ''].filter(Boolean).join(', ');

  /* ---------------- randare ---------------- */
  function renderArea() {
    const html = area === 'conturi' ? conturiView() : area === 'evenimente' ? eventsView() : area === 'lumini' ? lightsView() : hubView();
    $('#admin').innerHTML = `<div class="wrap${area === 'evenimente' && view === 'sabloane' ? ' wide' : ''}">${html}</div>`;
    if (area === 'evenimente' && view === 'sabloane') updateTplPreview();
  }
  function header(title, eyebrow, back) {
    return `<header class="top">
      <div>${back ? `<button type="button" class="crumb" data-act="area" data-k="home">‹ Administrare</button>` : ''}<p class="eyebrow-a">${eyebrow}</p><h1>${title}</h1></div>
      <div class="top-r"><span class="state-pill"><span class="dot${navigator.onLine ? '' : ' no'}"></span>${navigator.onLine ? 'Online' : 'Offline'}</span>
        <button type="button" class="state-pill" data-act="area" data-k="conturi">${esc(USER.username)}</button></div></header>`;
  }

  function hubView() {
    const leads = C.leads.filter(l => l.status !== 'Șters'), nNew = leads.filter(l => (l.status || 'Nou') === 'Nou').length;
    const live = W.live && W.published ? 'LIVE acum' : W.published ? (JSON.stringify(W.draft) === JSON.stringify(W.published) ? 'Publicat' : 'Modificări nepublicate') : 'Nepublicat';
    return `${header('Bună, ' + esc(USER.username) + '!', 'WE WELCOME · Administrare', false)}
      <div class="hub">
        <button type="button" class="hcard" data-act="area" data-k="evenimente">
          <span class="hic">${ICON.cal}</span><b>Evenimente</b>
          <span>${configured() ? `${leads.length} ${leads.length === 1 ? 'cerere' : 'cereri'}${nNew ? ` · <em>${nNew} ${nNew === 1 ? 'nouă' : 'noi'}</em>` : ''}` : 'Conectează Google Sheets'}</span>
          <small>Cereri de ofertă, prețuri, profit, emailuri</small></button>
        <button type="button" class="hcard" data-act="area" data-k="tool">
          <span class="hic">${ICON.screen}</span><b>Ecran de bun venit</b>
          <span>${esc(W.draft.couple || 'Evenimentul tău')} · ${live}</span>
          <small>Ecranul invitaților: bun venit, mese, Photo Booth</small></button>
        <button type="button" class="hcard${LT.on ? ' hot' : ''}" data-act="area" data-k="lumini">
          <span class="hic">${ICON.bulb}</span><b>Cheamă invitații</b>
          <span>${LT.on ? '<em>Beculețele clipesc acum</em>' : LT.info && LT.info.configured ? 'Priza e configurată' : 'Beculețe prin priză smart'}</span>
          <small>Un buton ON / OFF care face beculețele să clipească</small></button>
        <button type="button" class="hcard" data-act="area" data-k="conturi">
          <span class="hic">${ICON.user}</span><b>Conturi</b>
          <span>${isAdmin() ? 'Administrator' : 'Utilizator'}</span>
          <small>${isAdmin() ? 'Toate conturile, roluri, acces la Google Sheet' : 'Contul tău'}</small></button>
      </div>
      <section class="panel">
        <h2>Linkul pentru clienți</h2>
        <p class="hint">Pune-l în anunțurile de pe Facebook și OLX. Cererile ajung în Google Sheets și le vezi în Evenimente.</p>
        ${linkBox()}
      </section>
      <div class="hub-logo"><img src="img/logo-dark.png" alt="WE WELCOME … You celebrate." width="900" height="527"></div>`;
  }
  function linkBox() {
    return `<div class="linkbox"><code>${esc(formUrl())}</code>
      <div class="btns"><button type="button" class="btn small" data-act="crm-copy" data-v="${esc(formUrl())}">Copiază</button>
      <a class="btn small" href="oferta.html" target="_blank" rel="noopener">Deschide</a></div></div>
      ${!(window.WW_CONFIG || {}).scriptUrl ? `<p class="hint warn-msg">Formularul se activează după conectarea la Google Sheets (Evenimente → Conectare).</p>` : ''}`;
  }

  let accList = null, accBusy = false, accMsg = {};
  async function loadAccounts() {
    if (accBusy || !configured() || !isAdmin()) return;
    accBusy = true;
    try { const d = await api('POST', { action: 'accounts' }); accList = d.accounts || []; C.meId = d.me; }
    catch (e) { accList = accList || []; accMsg._ = e.message; }
    accBusy = false; refreshAccPanel();
  }
  /** Redesenează doar lista de conturi, ca să nu se piardă ce scrii în restul paginii (de ex. parola nouă). */
  function refreshAccPanel() {
    const el = document.getElementById('accPanel');
    if (el && area === 'conturi') el.innerHTML = accountsPanel(); else if (area === 'conturi') render();
  }
  const ROLE = { admin: 'Administrator', user: 'Utilizator' };
  const ACCESS = { none: 'Fără acces', view: 'Poate vedea', edit: 'Poate edita' };
  function accountsPanel() {
    if (!configured()) return `<section class="panel"><h2>Toate conturile</h2><p class="hint">Conectează întâi Evenimentele la Google Sheets (Evenimente → Conectare). Apoi aici vezi toate conturile, le alegi rolul și le poți da acces la Sheet.</p></section>`;
    if (!isAdmin()) return `<section class="panel"><h2>Rolul tău: Utilizator</h2>
      <p class="hint">Vezi și lucrezi cu cererile din Evenimente și cu ecranul Wedding Welcome. Prețurile, taxele, șabloanele și conturile le gestionează un administrator.</p></section>`;
    if (!accList) { loadAccounts(); return `<section class="panel"><h2>Toate conturile</h2><p class="hint">Se încarcă…</p></section>`; }
    const sheetUrl = 'https://docs.google.com/spreadsheets/d/1F0WKXYN48B0Q_L29el01QJZmqKDt6WRBOiRfSca79Hs/edit';
    return `<section class="panel"><h2>Toate conturile <span class="hint" style="font-weight:400">· ${accList.length}</span></h2>
      <p class="hint"><b>Administrator</b>: vede și schimbă tot (prețuri, taxe, șabloane, conturi). <b>Utilizator</b>: lucrează cu cererile și cu ecranul Wedding Welcome, fără setări și conturi. Rolul se aplică imediat, pe toate dispozitivele.</p>
      ${accMsg._ ? `<p class="hint err-msg">${esc(accMsg._)}</p>` : ''}
      ${accList.map(a => { const mine = a.id === USER.id; return `<div class="cat acc" data-accid="${esc(a.id)}">
        <div class="cat-head" style="justify-content:space-between"><div><b>${esc(a.username)}</b>${mine ? ' <span class="stp st-ok">tu</span>' : ''} <span class="stp ${a.role === 'admin' ? 'st-new' : 'st-c'}">${ROLE[a.role] || 'Utilizator'}</span>
          <br><small class="hint">creat ${esc(fmtDate(a.created))}${a.sheetAccess && a.sheetAccess !== 'none' ? ' · ' + ACCESS[a.sheetAccess].toLowerCase() + ' Sheet-ul' : ''}</small></div>
          ${mine ? '' : `<button type="button" class="x" data-act="crm-acc-del" data-id="${esc(a.id)}" aria-label="Șterge contul ${esc(a.username)}">×</button>`}</div>
        <div class="row3">
          <div class="field"><label>Rol</label><select class="inp" data-acc="role">${Object.entries(ROLE).map(([k, n]) => `<option value="${k}" ${a.role === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="field"><label>Email Google (Gmail)</label><input class="inp" type="email" data-acc="email" value="${esc(a.email || '')}" placeholder="nume@gmail.com"></div>
          <div class="field"><label>Acces la Google Sheet</label><select class="inp" data-acc="sheetAccess">${Object.entries(ACCESS).map(([k, n]) => `<option value="${k}" ${(a.sheetAccess || 'none') === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        </div>
        ${accMsg.del === a.id ? `<div class="btns"><span class="hint">Ștergi contul ${esc(a.username)}? Nu va mai putea intra, iar accesul la Sheet i se retrage.</span><button type="button" class="btn danger small" data-act="crm-acc-del-yes" data-id="${esc(a.id)}">Da, șterge</button><button type="button" class="btn small" data-act="crm-acc-del-no">Anulează</button></div>` : ''}
        <div class="btns"><button type="button" class="btn small primary" data-act="crm-acc-save" data-id="${esc(a.id)}">Aplică</button><span class="hint" id="am-${esc(a.id)}">${accMsg[a.id] || ''}</span></div>
        <div class="row3" style="align-items:end">
          <div class="field"><label>Parolă nouă (pentru toate dispozitivele)</label><input class="inp" type="text" data-acc="newpw" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="minim 6 caractere"></div>
          <div class="field"><button type="button" class="btn small" data-act="crm-acc-pw" data-id="${esc(a.id)}">Setează parola</button></div>
        </div>
        ${accMsg['pw' + a.id] ? `<p class="hint" id="apw-${esc(a.id)}">${accMsg['pw' + a.id]}</p>` : ''}
      </div>`; }).join('')}
      <p class="hint">Accesul la Sheet trimite colaboratorului o invitație Google pe email. „Poate vedea” e suficient ca să urmărească cererile; „Poate edita” îi permite să modifice direct tabelul. Pentru lucrul în aplicație nu e nevoie de acces la Sheet. <a href="${sheetUrl}" target="_blank" rel="noopener">Deschide Sheet-ul</a></p>
    </section>`;
  }
  function conturiView() {
    return `${header('Conturi', 'Administrare', true)}
      <div id="accPanel">${accountsPanel()}</div>
      ${adminAccount()}`;
  }

  function eventsView() {
    const tabs = isAdmin() ? [['cereri', 'Cereri'], ['preturi', 'Prețuri și costuri'], ['sabloane', 'Șabloane email'], ['conectare', 'Conectare']] : [['cereri', 'Cereri']];
    if (!isAdmin() && view !== 'cereri') view = 'cereri';
    const body = { cereri: leadsView, preturi: pricesView, sabloane: templatesView, conectare: connectView }[view]();
    return `${header('Evenimente', 'Administrare', true)}
      ${note ? `<div class="draft ${noteOk ? '' : 'dirty'}"><p>${esc(note)}</p></div>` : ''}
      <nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${view === k}" data-act="crm-view" data-k="${k}">${l}${k === 'conectare' && !configured() ? ' ●' : ''}</button>`).join('')}</nav>
      ${body}`;
  }

  /* ---------- Cereri ---------- */
  function leadsView() {
    if (!configured()) return `<section class="panel"><h2>Conectează Google Sheets</h2>
      <p class="hint">Cererile din formularul public ajung în Google Sheet-ul tău. Ca să le vezi aici, conectează aplicația o singură dată.</p>
      <div class="btns"><button type="button" class="btn primary" data-act="crm-view" data-k="conectare">Mergi la Conectare</button></div></section>`;
    const S = C.settings;
    const MONTHS = ['Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie', 'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'];
    const ym = l => { const m = /^(\d{4})-(\d{2})/.exec(String(l.eventDate || '')); return m ? [m[1], +m[2]] : ['', 0]; };
    const years = [...new Set(C.leads.filter(l => l.status !== 'Șters').map(l => ym(l)[0]).filter(Boolean).concat(String(new Date().getFullYear())))].sort();
    const inPeriod = l => { const [y, m] = ym(l); return (fYear === 'Toate' || y === fYear) && (fMonth === 'Toate' || m === +fMonth); };
    const all = C.leads.filter(l => l.status !== 'Șters').map(l => ({ l, c: P.calc(l, S), st: l.status || 'Nou' }));
    const rows = all.filter(r => inPeriod(r.l));
    const period = fYear === 'Toate' && fMonth === 'Toate' ? 'toată perioada' : [fMonth === 'Toate' ? '' : MONTHS[+fMonth - 1], fYear === 'Toate' ? '' : fYear].filter(Boolean).join(' ');
    const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
    const conf = rows.filter(r => r.st === 'Confirmat'), open = rows.filter(r => !['Confirmat', 'Refuzat'].includes(r.st));
    const qq = norm(q);
    const shown = rows.filter(r => (filter === 'Toate' || r.st === filter) && (!qq || norm([r.l.name, r.l.city, r.l.venue, r.l.email, r.l.phone].join(' ')).includes(qq)))
      .sort((a, b) => String(b.l.createdAt).localeCompare(String(a.l.createdAt)));
    const counts = {}; rows.forEach(r => counts[r.st] = (counts[r.st] || 0) + 1);
    return `<section class="panel period">
        <div class="lhead"><div><h2>Perioada</h2><p class="hint">După data evenimentului · ${esc(period)} · ${rows.length} din ${all.length} ${all.length === 1 ? 'cerere' : 'cereri'}</p></div>
          <div class="btns">
            <select class="inp" id="crmMonth" aria-label="Luna" style="width:auto"><option value="Toate">Toate lunile</option>${MONTHS.map((n, i) => `<option value="${i + 1}" ${String(i + 1) === String(fMonth) ? 'selected' : ''}>${n}</option>`).join('')}</select>
            <select class="inp" id="crmYear" aria-label="Anul" style="width:auto"><option value="Toate">Toți anii</option>${years.map(y => `<option ${y === fYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
            ${fYear !== 'Toate' || fMonth !== 'Toate' ? `<button type="button" class="btn small" data-act="crm-period-reset">Toată perioada</button>` : ''}
          </div></div>
      </section>
      <section class="kpis">
        <div class="kpi"><span>Cereri</span><b>${rows.length}</b><small>${counts['Nou'] || 0} noi</small></div>
        <div class="kpi"><span>În discuție</span><b>${lei(sum(open, r => r.c.total))}</b><small>${open.length} ${open.length === 1 ? 'eveniment' : 'evenimente'}</small></div>
        <div class="kpi"><span>Confirmate</span><b>${lei(sum(conf, r => r.c.total))}</b><small>${conf.length} ${conf.length === 1 ? 'eveniment' : 'evenimente'}</small></div>
        <div class="kpi"><span>Profit net confirmat</span><b>${lei(sum(conf, r => r.c.profit))}</b><small>după costuri, TVA și taxe</small></div>
      </section>
      <section class="panel">
        <div class="lhead">
          <div class="chips">${['Toate'].concat(P.STATUSES).map(s => `<button type="button" class="chip" aria-pressed="${filter === s}" data-act="crm-filter" data-k="${esc(s)}">${esc(s)}${s !== 'Toate' && counts[s] ? ` <i>${counts[s]}</i>` : ''}</button>`).join('')}</div>
          <div class="btns"><input class="inp" id="crmQ" placeholder="Caută nume, oraș, email" value="${esc(q)}" aria-label="Caută în cereri" style="max-width:240px">
            <button type="button" class="btn" data-act="crm-sync" ${busy ? 'disabled' : ''}>${busy ? 'Se încarcă…' : 'Reîmprospătează'}</button></div>
        </div>
        <p class="hint">${C.lastSync ? `Sincronizat cu Google Sheets la ${esc(fmtDate(C.lastSync))}.` : 'Încă nesincronizat.'}</p>
        ${shown.length ? `<div class="leads" role="list">${shown.map(({ l, c, st }) => `<button type="button" class="lrow" role="listitem" data-act="crm-open" data-id="${esc(l.id)}">
            <span class="ld"><b>${fmtD(l.eventDate)}</b><small>${esc(l.eventType || 'Eveniment')}</small></span>
            <span class="ln"><b>${esc(l.name)}</b><small>${esc(place(l) || '—')}</small></span>
            <span class="lp"><small>${esc(c.pkg ? c.pkg.name : l.package || '—')}</small><b>${lei(c.total)}</b></span>
            <span class="lpr ${c.profit < 0 ? 'neg' : ''}"><small>profit</small><b>${lei(c.profit)}</b></span>
            <span class="ls">${pill(st)}</span></button>`).join('')}</div>`
          : `<p class="hint" style="padding:18px 0">${rows.length ? 'Nicio cerere pentru filtrul ales.' : all.length ? `Nicio cerere cu evenimentul în ${esc(period)}.` : 'Nicio cerere încă. Trimite linkul pentru clienți și cererile vor apărea aici.'}</p>`}
      </section>
      <section class="panel"><h2>Linkul pentru clienți</h2>${linkBox()}</section>`;
  }

  /* ---------- fișa unei cereri ---------- */
  function openLead(id) {
    const l = C.leads.find(x => x.id === id); if (!l) return;
    L = clone(l); L.status = L.status || 'Nou'; L.discountType = L.discountType === 'lei' ? 'lei' : '%';
    L.outside = P.yes(L.outside) ? 'da' : 'nu'; L.staffMenuByClient = P.yes(L.staffMenuByClient) ? 'da' : 'nu';
    L.album = P.yes(L.album) ? 'da' : 'nu';
    L._promo = applyEarlyPromo(L);
    compose = null; renderLead();
  }
  /** Promoția de final de an: cererile primite până la data din config.js (promo.until) vin cu reducerea (10%) completată,
      dacă cererea e încă nouă și n-a fost salvată sau trimisă din aplicație. O poți schimba înainte de salvare. */
  function applyEarlyPromo(l) {
    const pr = (window.WW_CONFIG || {}).promo; if (!pr || !pr.until || !num(pr.earlyPct)) return false;
    const got = Date.parse(l.createdAt || ''), end = Date.parse(pr.until + 'T23:59:59');
    if (!got || got > end || (l.status || 'Nou') !== 'Nou' || (l.lastEmail && !/automat/.test(l.lastEmail)) || num(l.discountValue) || String(l.cost || '') !== '') return false;   // cost completat = cererea a fost deja salvată din aplicație
    l.discountType = '%'; l.discountValue = String(num(pr.earlyPct)); return true;
  }
  function breakdown() {
    const S = C.settings, c = P.calc(L, S);
    const row = (a, b, cls) => `<div class="${cls || ''}"><span>${a}</span><b>${b}</b></div>`;
    return `<div class="calc">
      <div class="sum">
        ${row('Pachet ' + esc(c.pkg ? c.pkg.name : '—') + (c.pkg ? ` · ${c.hours >= 8 ? 'toată noaptea' : c.hours + ' ore'}` : ''), lei(c.price))}
        ${c.album === 'inclus' ? row('Album foto · inclus în pachet', '—') : c.albumExtra ? row('Album foto', lei(c.albumExtra)) : ''}
        ${(c.extras || []).map(x => row('Extra · ' + esc(x.name), num(x.price) ? lei(x.price) : 'preț la cerere')).join('')}
        ${row(c.outside ? `Transport · ${c.billedKm} km × ${P.leiRate(S.pricing.kmRate)}` : 'Transport (București-Ilfov)', lei(c.transport))}
        ${c.discount ? row('Reducere' + (L.discountType === '%' ? ` ${num(L.discountValue)}%` : ''), '− ' + lei(c.discount)) : ''}
        ${c.vat && !c.vatIncluded ? row(`TVA ${c.vatRate}%`, '+ ' + lei(c.vat)) : ''}
        ${row('Total client', lei(c.total), 'tot')}
        ${c.vat && c.vatIncluded ? row(`din care TVA ${c.vatRate}%`, lei(c.vat)) : ''}
        ${c.vat ? row('Venit fără TVA', lei(c.net)) : ''}
      </div>
      <div class="sum">
        ${row(`Staff · ${num(S.costs.staffCount)} pers. × ${c.hours + num(S.costs.setupHours)} h × ${lei(S.costs.staffRate)}`, lei(c.staff))}
        ${c.pkg && c.pkg.staffMenu ? row(P.yes(L.staffMenuByClient) ? 'Meniu staff · oferit de client' : `Meniu staff · ${num(S.costs.staffCount)} × ${lei(S.costs.menuCost)}`, lei(c.menu)) : ''}
        ${c.outside ? row(`Combustibil · ${c.km * 2} km dus-întors`, lei(c.fuel)) : ''}
        ${c.consumables ? row('Consumabile Photo Booth', lei(c.consumables)) : ''}
        ${c.albumCost ? row('Album foto (cost)', lei(c.albumCost)) : ''}
        ${c.extrasCost ? row('Servicii extra (cost)', lei(c.extrasCost)) : ''}
        ${row('Echipament (uzură)', lei(c.equipment))}
        ${c.vat ? row(`TVA de plată ${c.vatRate}%`, lei(c.vat)) : ''}
        ${c.incomeTax ? row(`Impozit pe venit ${num(S.costs.incomeTax)}%`, lei(c.incomeTax)) : ''}
        ${c.payFee ? row(`Comision încasare ${num(S.costs.payFee)}%`, lei(c.payFee)) : ''}
        ${c.invoiceFee ? row('Cost facturare', lei(c.invoiceFee)) : ''}
        ${row('Profit net estimat' + (c.net ? ` · ${Math.round(c.margin * 100)}%` : ''), lei(c.profit), 'tot ' + (c.profit < 0 ? 'neg' : 'pos'))}
      </div></div>`;
  }
  /** Butonul „Album foto”: la pachetul cu album inclus apare ca inclus; la celelalte cu Photo Booth îl adaugi (+ prețul albumului). */
  function albumField() {
    const S = C.settings, p = P.pkgOf(S, L.package);
    if (!p || !p.modules.includes('booth')) return `<p class="hint">Album foto: doar la pachetele cu Photo Booth.</p>`;
    if (P.albumIncluded(p)) return `<p class="hint"><b>Album foto inclus</b> în pachetul ${esc(p.name)} (plus stick cu pozele).</p>`;
    const on = P.yes(L.album);
    const old = C.scriptOld ? `<p class="hint err-msg">Scriptul Google e o versiune veche și nu salvează încă albumul în Sheet. Actualizează-l (Code.gs → Implementare → Gestionează implementările → Versiune nouă).</p>` : '';
    return `<div class="btns" style="align-items:center"><button type="button" class="btn ${on ? 'danger' : 'primary'} small" data-act="crm-album">${on ? 'Scoate albumul foto' : '+ Adaugă album foto · ' + lei(S.pricing.albumPrice)}</button>
      <span class="hint">${on ? `Album adăugat: +${lei(S.pricing.albumPrice)} la total.` : 'Pachetul include stick cu pozele; albumul se adaugă la cerere.'}</span></div>${old}`;
  }
  function renderLead() {
    const S = C.settings;
    if (compose) return renderCompose();
    const anim = $('#modal').hidden ? '' : ' still';
    $('#modal').innerHTML = `<div class="sheet wide${anim}" role="dialog" aria-modal="true" aria-labelledby="ldT">
      <div class="shead"><div><p class="eyebrow-a">${fmtD(L.eventDate)} · ${esc(L.eventType || 'Eveniment')}</p><h2 id="ldT">${esc(L.name)}</h2></div>
        <button type="button" class="x" data-act="crm-close" aria-label="Închide">×</button></div>
      <div class="info">
        <div><span>Telefon</span>${L.phone ? `<a href="tel:${esc(L.phone.replace(/\s/g, ''))}">${esc(L.phone)}</a>` : '—'}</div>
        <div><span>Email</span>${L.email ? `<a href="mailto:${esc(L.email)}">${esc(L.email)}</a>` : '—'}</div>
        <div><span>Locație</span>${esc(place(L) || '—')}</div>
        <div><span>Ora · invitați</span>${esc(L.startTime || '—')} · ${esc(L.guests || '—')}</div>
        <div><span>Primit</span>${esc(fmtDate(L.createdAt))}</div>
        <div><span>Ultimul email</span>${esc(L.lastEmail || '—')}</div>
      </div>
      ${P.outOfArea(L.km, S) ? `<p class="note" style="border-style:solid;color:var(--danger)"><b>Zonă neacoperită</b> · ~${esc(num(L.km))} km (limita e ${esc(S.pricing.maxKm)} km). Cerere de ofertă specială.</p>` : ''}
      ${L.clientMessage ? `<p class="note" style="border-style:solid">„${esc(L.clientMessage)}”</p>` : ''}
      ${emailStrip()}
      <div class="row2">
        <div class="field"><label for="l-st">Status</label><select class="inp" id="l-st" data-l="status">${P.STATUSES.map(s => `<option ${s === L.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label for="l-pk">Pachet</label><select class="inp" id="l-pk" data-l="package">${P.pkgOf(S, L.package) ? '' : '<option value="" selected>Alege pachetul</option>'}${S.packages.map(p => `<option value="${esc(p.id)}" ${P.pkgOf(S, L.package) === p ? 'selected' : ''}>${esc(p.name)} · ${lei(p.price)}</option>`).join('')}</select></div>
      </div>
      <div class="row2">
        <div class="field"><label for="l-km">Km de la București${S.pricing.roundTrip ? ' (sens unic; se facturează dus-întors)' : ''}</label>
          <input class="inp" id="l-km" data-l="km" inputmode="numeric" value="${esc(num(L.km) || '')}" ${L.outside === 'da' ? '' : 'disabled'}></div>
        <div class="field"><label>&nbsp;</label><label class="tog"><input type="checkbox" data-l="outside" ${L.outside === 'da' ? 'checked' : ''}> În afara București-Ilfov (se taxează transportul)</label></div>
      </div>
      <div class="row2">
        <div class="field"><label for="l-dv">Reducere</label><div class="dgroup"><input class="inp" id="l-dv" data-l="discountValue" inputmode="decimal" value="${esc(num(L.discountValue) || '')}" placeholder="0">
          <select class="inp" data-l="discountType" aria-label="Tipul reducerii"><option value="%" ${L.discountType === '%' ? 'selected' : ''}>%</option><option value="lei" ${L.discountType === 'lei' ? 'selected' : ''}>lei</option></select></div></div>
        <div class="field"><label>&nbsp;</label><label class="tog"><input type="checkbox" data-l="staffMenuByClient" ${L.staffMenuByClient === 'da' ? 'checked' : ''}> Clientul asigură meniul pentru staff</label></div>
      </div>
      ${L._promo ? `<p class="hint ok-msg">Reducerea de ${esc(L.discountValue)}% din promoția de final de an e completată automat (cerere primită până la 31 decembrie). Se salvează când apeși „Salvează” sau trimiți oferta.</p>` : ''}
      <div id="albumBox">${albumField()}</div>
      ${(C.settings.extras || []).length ? `<div class="extrasBox"><span class="ms-l">Servicii extra</span>${C.settings.extras.map(x => `<label class="tog"><input type="checkbox" data-x="${esc(x.id)}" ${String(L.extras || '').split(',').includes(x.id) ? 'checked' : ''}> ${esc(x.name)} <span class="hint">${num(x.price) ? lei(x.price) : 'preț la cerere'}</span></label>`).join('')}</div>` : ''}
      <div id="calcBox">${breakdown()}</div>
      <div class="field"><label for="l-notes">Note interne (nu le vede clientul)</label><textarea class="inp" id="l-notes" data-l="notes" rows="3" style="min-height:70px">${esc(L.notes || '')}</textarea></div>
      <p class="hint" id="ldMsg">${esc(L._msg || '')}</p>
      ${L._del ? `<div class="draft dirty"><p>Ștergi definitiv cererea lui <b>${esc(L.name)}</b>? Dispare din aplicație și din Google Sheet și nu poate fi recuperată.</p>
        <div class="btns"><button type="button" class="btn danger" data-act="crm-del-yes">Da, șterge</button><button type="button" class="btn" data-act="crm-del-no">Anulează</button></div></div>` : ''}
      <div class="btns" style="justify-content:flex-end">
        ${isAdmin() && !L._del ? `<button type="button" class="btn danger" data-act="crm-del" style="margin-right:auto">Șterge cererea</button>` : ''}
        <button type="button" class="btn primary" data-act="crm-save">Salvează în Google Sheets</button></div>
    </div>`;
    $('#modal').hidden = false;
  }
  function leadFields() {
    const c = P.calc(L, C.settings);
    return { status: L.status, package: c.pkg ? c.pkg.id : L.package, outside: L.outside, km: String(num(L.km)), transport: String(c.transport), packagePrice: String(c.price),
      discountType: L.discountType, discountValue: String(num(L.discountValue)), total: String(c.total), cost: String(c.cost), profit: String(c.profit),
      staffMenuByClient: L.staffMenuByClient, notes: L.notes || '', extras: String(L.extras || ''), album: c.album === 'extra' ? 'da' : c.album === 'inclus' ? 'inclus' : 'nu' };
  }
  async function saveLead() {
    const m = $('#ldMsg'); if (m) { m.textContent = 'Se salvează…'; m.className = 'hint'; }
    try {
      const f = leadFields(); await api('POST', { action: 'update', id: L.id, fields: f });
      const i = C.leads.findIndex(x => x.id === L.id); if (i >= 0) Object.assign(C.leads[i], f); save();
      if (m) { m.textContent = 'Salvat în Google Sheets.'; m.className = 'hint ok-msg'; }
      rerender();
    } catch (e) { if (m) { m.textContent = 'Nu am putut salva: ' + e.message; m.className = 'hint err-msg'; } }
  }

  /* ---------- email ---------- */
  /** Numerele de contact din config.js, ca „0737 376 128 / 0752 425 550”. */
  const phones = () => ((window.WW_CONFIG || {}).contactPhones || []).map(t => String(t).replace(/\D/g, '').replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3')).join(' / ');
  /** Oferta „scrisă frumos”: ce include pachetul + tabelul cu prețurile (marcaje pe care emailul le transformă în listă și tabel). */
  /** Toate pachetele, cu pachetul ales pentru client evidențiat și cu reducerea lui (dacă are), ca să le poată compara. */
  /** Serviciile extra bifate de client: disponibilitatea și prețul estimativ (apar doar dacă a ales ceva). */
  function extrasBlock(c) {
    if (!(c.extras || []).length) return '';
    const n0 = v => Math.round(num(v)).toLocaleString('ro-RO');
    return '## Servicii extra\nAm verificat disponibilitatea pentru data evenimentului tău:\n' + c.extras.map(x => `- **${x.name}**: disponibil, preț estimativ ${num(x.price) ? n0(x.price) + ' lei' : '[COMPLETEAZĂ prețul]'}`).join('\n');
  }
  function packagesTable(l, S, c) {
    const n0 = v => Math.round(num(v)).toLocaleString('ro-RO');
    const pct = l.discountType === '%' ? num(l.discountValue) : 0;
    const rows = (S.packages || []).filter(p => num(p.price)).map(p => {
      const mine = c.pkg && c.pkg.id === p.id, after = Math.round(num(p.price) * (1 - pct / 100));
      const name = (mine ? '**' + p.name + '** (ales pentru tine)' : p.name) + ' · ' + (num(p.hours) >= 8 ? 'toată noaptea' : num(p.hours) + ' ore') + (p.desc ? ' — ' + p.desc : '');
      const price = pct ? `~~${n0(p.price)} lei~~ ${mine ? '**' : ''}${n0(after)} lei${mine ? '**' : ''}` : `${mine ? '**' : ''}${n0(p.price)} lei${mine ? '**' : ''}`;
      return `| ${name} | ${price} |`;
    });
    return rows.join('\n') + (pct ? `\n\nPrețurile includ reducerea de ${pct}%. Transportul, dacă e cazul, se adaugă separat.` : '');
  }
  function offerTable(l, S, c) {
    if (!c.pkg) return '';
    const n0 = v => Math.round(num(v)).toLocaleString('ro-RO');
    const NAMES = { welcome: 'Mesaje video de bun venit, filmate de noi', seating: 'Fiecare invitat își găsește masa pe ecran', booth: 'Photo Booth pentru amintiri memorabile' };
    const inc = (c.pkg.modules || []).map(m => NAMES[m] || P.MODULE_NAMES[m] || m);
    if (c.hasBooth) { inc.push('Stick cu pozele de la eveniment'); if (c.album !== 'nu') inc.push('Albumul foto al serii'); }
    const rows = [`| Pachet **${c.pkg.name}** · ${c.hours >= 8 ? 'toată noaptea' : c.hours + ' ore'} | ${n0(c.price)} lei |`];
    if (c.albumExtra) rows.push(`| Album foto | ${n0(c.albumExtra)} lei |`);
    (c.extras || []).forEach(x => rows.push(`| ${x.name} | ${num(x.price) ? n0(x.price) + ' lei' : 'la cerere'} |`));
    if (c.transport) rows.push(`| Transport · ${c.billedKm} km | ${n0(c.transport)} lei |`);
    if (c.discount) rows.push(`| Reducere${l.discountType === '%' ? ' ' + num(l.discountValue) + '%' : ''} | − ${n0(c.discount)} lei |`);
    if (c.vat && !c.vatIncluded) rows.push(`| TVA ${c.vatRate}% | ${n0(c.vat)} lei |`);
    rows.push(`| **Total${c.vat && c.vatIncluded ? ' (TVA inclus)' : ''}** | **${n0(c.total)} lei** |`);
    return 'Ce include:\n' + inc.map(x => '- ' + x).join('\n') + '\n\n' + rows.join('\n');
  }
  function fill(t, l) {
    const S = C.settings, c = P.calc(l, S);
    // rândurile cu {reducere} apar doar dacă oferta are o reducere
    t = String(t || '').split('\n').filter(line => c.discount || !line.includes('{reducere}')).join('\n');
    const n0 = v => Math.round(num(v)).toLocaleString('ro-RO');
    const map = {
      prenume: String(l.name || '').trim().split(/\s+/)[0] || '', nume_complet: l.name || '', data_eveniment: fmtDLong(l.eventDate),
      localitate: l.city || '', locatie: l.venue || l.city || '', locatie_completa: place(l) || l.city || '',
      pachet: c.pkg ? c.pkg.name : '', ore: c.hours >= 8 ? 'toată noaptea' : c.hours + ' ore',
      pret_pachet: n0(c.price), transport: n0(c.transport), km: String(c.billedKm), reducere: n0(c.discount), total: n0(c.total),
      tva: n0(c.vat), total_fara_tva: n0(c.net), cota_tva: String(c.vatRate),
      expeditor: S.email.fromName || '', invitati: l.guests || '', telefoane: phones(), tabel_oferta: offerTable(l, S, c), tabel_pachete: packagesTable(l, S, c), servicii_extra: extrasBlock(c),
      nume: String(l.name || '').trim().split(/\s+/)[0] || '',
      procent_avans: String(num(S.pricing.advancePct)), zile_plata: String(num(S.pricing.payDays || 10)), avans: n0(c.total * num(S.pricing.advancePct) / 100),
      termen_plata: new Date(Date.now() + num(S.pricing.payDays || 10) * 864e5).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' }),
      album: c.album === 'inclus' ? 'inclus în pachet' : c.albumExtra ? n0(c.albumExtra) + ' lei' : 'nu'
    };
    // câmpurile tale: cele „fixe” se completează mereu; cele „la trimitere” rămân {cheie} până le completezi în email
    (S.fields || []).forEach(f => { if (f.key && f.kind !== 'ask' && !(f.key in map)) map[f.key] = f.value || ''; });
    return String(t || '').replace(/\{(\w+)\}/g, (m, k) => k in map ? map[k] : m);
  }
  function startCompose(tplId) {
    const S = C.settings, t = S.templates.find(x => x.id === tplId) || S.templates[0];
    compose = { tpl: t ? t.id : '', to: L.email || '', subject: fill(t && t.subject, L), body: fill(t && t.body, L), newStatus: t ? t.status : '', sending: false, err: '',
      att: ((t && t.attachments) || []).map(a => ({ id: a.id, name: a.name })), vals: {} };
    if (!FILES) loadFiles();
    renderCompose();
  }
  /** Șablonul potrivit pentru etapa în care e cererea (îl marcăm „Recomandat”). */
  function recommendedTpl(l) {
    const st = l.status || 'Nou', T = C.settings.templates, has = id => T.some(t => t.id === id);
    const id = st === 'Confirmat' ? 'reconfirmare' : st === 'Ofertă trimisă' ? 'confirmare' : (st === 'Refuzat' ? '' : 'oferta');
    return has(id) ? id : '';
  }
  /** Rândul cu șabloane din fișa cererii: un clic deschide emailul gata completat. */
  function emailStrip() {
    const T = C.settings.templates, rec = recommendedTpl(L);
    if (!L.email) return `<div class="mailstrip"><span class="ms-l">Email</span><span class="hint">Cererea nu are adresă de email.</span></div>`;
    return `<div class="mailstrip"><span class="ms-l">Trimite email</span><div class="ms-row">${T.map(t => `<button type="button" class="ms-b${t.id === rec ? ' rec' : ''}" data-act="crm-compose" data-k="${esc(t.id)}">${esc(t.name)}${t.id === rec ? '<i>recomandat</i>' : ''}</button>`).join('')}</div>
      ${L.lastEmail ? `<span class="hint">Ultimul: ${esc(L.lastEmail)}</span>` : ''}</div>`;
  }
  function renderCompose() {
    const S = C.settings, rec = recommendedTpl(L);
    const anim = $('#modal').hidden ? '' : ' still';
    const view = compose.view || 'write';
    $('#modal').innerHTML = `<div class="sheet compose${anim}" role="dialog" aria-modal="true" aria-labelledby="cpT">
      <div class="shead"><div><p class="eyebrow-a">${esc(L.name)} · ${esc(L.status || 'Nou')}${L.lastEmail ? ' · ultimul email: ' + esc(L.lastEmail) : ''}</p><h2 id="cpT">Email către ${esc(L.name)}</h2></div>
        <button type="button" class="x" data-act="crm-close" aria-label="Închide">×</button></div>
      <div class="tpl-cards" role="radiogroup" aria-label="Șablon">${S.templates.map(t => `<button type="button" role="radio" aria-checked="${t.id === compose.tpl}" class="tpl-card${t.id === compose.tpl ? ' on' : ''}" data-act="crm-tpl" data-k="${esc(t.id)}">
          <b>${esc(t.name)}</b><span>${t.status ? 'status → ' + esc(t.status) : 'fără schimbare de status'}</span>${t.id === rec ? '<i>recomandat acum</i>' : ''}</button>`).join('')}</div>
      <div class="cp-tabs" role="tablist"><button type="button" role="tab" aria-selected="${view === 'write'}" data-act="crm-cpview" data-k="write">Scrie</button><button type="button" role="tab" aria-selected="${view === 'prev'}" data-act="crm-cpview" data-k="prev">Cum arată</button></div>
      <div class="cp-grid v-${view}">
        <div class="cp-edit">
          <div class="row2">
            <div class="field"><label for="cp-to">Către</label><input class="inp" id="cp-to" value="${esc(compose.to)}"></div>
            <div class="field"><label>De la</label><p class="from">${esc(S.email.fromName)} &lt;${esc(S.email.fromEmail)}&gt;</p></div>
          </div>
          <div class="field"><label for="cp-s">Subiect</label><input class="inp" id="cp-s" value="${esc(compose.subject)}"></div>
          ${askFieldsHtml()}
          <div class="field cp-body"><label for="cp-b">Mesaj</label><textarea class="inp" id="cp-b">${esc(compose.body)}</textarea></div>
          ${attachHtml()}
          <details class="hint"><summary>Marcaje pentru formatare</summary><code># Titlu mare</code> · <code>## Titlu</code> · <code>- listă</code> · <code>| text | sumă |</code> rând de tabel · <code>**îngroșat**</code></details>
        </div>
        <div class="cp-prev"><iframe id="cp-prev" title="Previzualizare email"></iframe></div>
      </div>
      <div class="cp-foot">
        <p class="hint">${compose.err ? `<span class="err-msg">${esc(compose.err)}</span>` : compose.newStatus ? `După trimitere, statusul devine <b>${esc(compose.newStatus)}</b>.` : 'Statusul cererii rămâne neschimbat.'}</p>
        <div class="btns"><button type="button" class="btn" data-act="crm-compose-back" ${compose.sending ? 'disabled' : ''}>Înapoi la cerere</button>
          <button type="button" class="btn primary" data-act="crm-send" ${compose.sending ? 'disabled' : ''}>${compose.sending ? 'Se trimite…' : 'Trimite emailul'}</button></div>
      </div>
    </div>`;
    $('#modal').hidden = false;
    updatePreview();
  }
  function updatePreview() { const f = $('#cp-prev'), b = $('#cp-b'); if (f && b) f.srcdoc = '<!doctype html><meta charset="utf-8"><body style="margin:0">' + P.emailHtml(applyVals(b.value, true), { preview: true }) + '</body>'; }
  /** Câmpurile „la trimitere” folosite în emailul curent. */
  function askFields(text) { return (C.settings.fields || []).filter(f => f.kind === 'ask' && f.key && String(text).includes('{' + f.key + '}')); }
  function applyVals(text, preview) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => { const f = (C.settings.fields || []).find(x => x.key === k && x.kind === 'ask'); if (!f) return m;
      const v = (compose && compose.vals[k]) || ''; return v || (preview ? '[' + f.label + ']' : m); });
  }
  function askFieldsHtml() {
    const fs = askFields(compose.subject + '\n' + compose.body); if (!fs.length) return '';
    return `<div class="askbox"><p class="ms-l">Completează pentru acest email</p>${fs.map(f => `<div class="field"><label for="cv-${esc(f.key)}">${esc(f.label)}</label><input class="inp" id="cv-${esc(f.key)}" data-cpv="${esc(f.key)}" value="${esc(compose.vals[f.key] || '')}"></div>`).join('')}</div>`;
  }
  function attachHtml() {
    const have = compose.att || [], avail = (FILES || []).filter(f => !have.some(a => a.id === f.id));
    return `<div class="attbox"><p class="ms-l">Atașamente</p><div class="ms-row">${have.map(a => `<span class="attchip">📎 ${esc(a.name)} <button type="button" data-act="crm-attrm" data-k="${esc(a.id)}" aria-label="Scoate ${esc(a.name)}">×</button></span>`).join('') || '<span class="hint">Niciun fișier atașat.</span>'}</div>
      ${avail.length ? `<select class="inp" id="cp-addatt" aria-label="Atașează un fișier"><option value="">+ Atașează un fișier încărcat…</option>${avail.map(f => `<option value="${esc(f.id)}">${esc(f.name)} · ${fmtSize(f.size)}</option>`).join('')}</select>` : FILES === null ? '<span class="hint">Se încarcă lista de fișiere…</span>' : '<span class="hint">Încarci fișiere (de ex. oferta în PDF) din Evenimente → Șabloane email.</span>'}</div>`;
  }
  const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  let FILES = null, filesErr = '';
  async function loadFiles() {
    if (!configured()) return;
    try { const d = await api('POST', { action: 'files' }); FILES = d.files || []; filesErr = ''; }
    catch (e) { FILES = []; filesErr = /necunoscut/i.test(e.message) ? 'Scriptul Google e o versiune veche: actualizează-l (Code.gs) ca să poți încărca și atașa fișiere.' : e.message; }
    if (compose) { keepCompose(); renderCompose(); } else if (area === 'evenimente' && view === 'sabloane') render();
  }
  function keepCompose() { const a = $('#cp-to'), b = $('#cp-s'), c = $('#cp-b'); if (a) compose.to = a.value; if (b) compose.subject = b.value; if (c) compose.body = c.value; }
  async function send() {
    compose.to = $('#cp-to').value.trim(); compose.subject = $('#cp-s').value; compose.body = $('#cp-b').value;
    if (/\[COMPLETEAZĂ/i.test(compose.subject + compose.body)) { compose.err = 'Emailul are încă un loc de completat ([COMPLETEAZĂ…]). Completează-l aici sau în Șabloane email, apoi trimite.'; return renderCompose(); }
    const miss = askFields(compose.subject + '\n' + compose.body).filter(f => !String(compose.vals[f.key] || '').trim());
    if (miss.length) { compose.err = 'Completează: ' + miss.map(f => f.label).join(', ') + '.'; return renderCompose(); }
    const tRaw = C.settings.templates.find(x => x.id === compose.tpl) || {};
    const emptyFix = (C.settings.fields || []).filter(f => f.kind !== 'ask' && f.key && !String(f.value || '').trim() && String((tRaw.subject || '') + (tRaw.body || '')).includes('{' + f.key + '}'));
    if (emptyFix.length) { compose.err = 'Câmpul „' + emptyFix[0].label + '” e gol. Completează-l în Evenimente → Șabloane email → Câmpurile tale.'; return renderCompose(); }
    compose.subject = applyVals(compose.subject); compose.body = applyVals(compose.body);
    compose.sending = true; compose.err = ''; renderCompose();
    const S = C.settings, t = S.templates.find(x => x.id === compose.tpl);
    try {
      // salvăm întâi prețul calculat, ca Sheet-ul să conțină exact ce i-am trimis clientului
      const f = leadFields(); await api('POST', { action: 'update', id: L.id, fields: f });
      const msg = { action: 'email', id: L.id, to: compose.to, subject: compose.subject, body: P.emailText(compose.body), html: P.emailHtml(compose.body),
        fromEmail: S.email.fromEmail, fromName: S.email.fromName, template: t ? t.name : 'email', newStatus: compose.newStatus || '',
        attachments: (compose.att || []).map(a => a.id) };
      let d;
      try { d = await api('POST', msg); }
      catch (e) { if (!/prea lung/i.test(e.message)) throw e; delete msg.html; d = await api('POST', msg); }   // conexiunea de rezervă are limită de lungime: trimitem varianta simplă
      const i = C.leads.findIndex(x => x.id === L.id);
      if (i >= 0) { Object.assign(C.leads[i], f, { lastEmail: d.lastEmail }); if (compose.newStatus) C.leads[i].status = compose.newStatus; }
      Object.assign(L, f, { lastEmail: d.lastEmail }); if (compose.newStatus) L.status = compose.newStatus;
      const natt = (msg.attachments || []).length;
      save(); compose = null; L._msg = `Email trimis de la ${d.sentFrom || S.email.fromEmail}` + (natt ? (d.attached === natt ? `, cu ${natt} ${natt === 1 ? 'atașament' : 'atașamente'}.` : '. Atenție: atașamentele nu au plecat — actualizează scriptul Google (Code.gs).') : '.'); renderLead(); rerender();
    } catch (e) { compose.sending = false; compose.err = 'Nu am putut trimite: ' + e.message; renderCompose(); }
  }

  /* ---------- Prețuri și costuri ---------- */
  function pricesView() {
    const S = C.settings;
    const f = (path, label, val, suf, type) => `<div class="field"><label>${label}</label><div class="suf"><input class="inp" data-s="${path}" data-num="1" inputmode="decimal" value="${esc(val)}">${suf ? `<span>${suf}</span>` : ''}</div></div>`;
    return `<section class="panel">
        <h2>Pachete</h2><p class="hint">Apar în formularul public, în această ordine, fără preț: clientul vede numele, durata, ce include și descrierea. Pachetul recomandat primește eticheta „Pachet recomandat” și e ales implicit. Prețurile le folosește aplicația pentru ofertă și profit.</p>
        ${S.packages.map((p, i) => `<div class="cat">
          <div class="cat-head"><input class="inp" data-s="packages.${i}.name" value="${esc(p.name)}" aria-label="Numele pachetului">
            ${S.packages.length > 1 ? `<button type="button" class="x" data-act="crm-delpkg" data-i="${i}" aria-label="Șterge pachetul">×</button>` : ''}</div>
          <div class="row3">${f(`packages.${i}.price`, 'Preț', p.price, 'lei')}${f(`packages.${i}.hours`, 'Durată', p.hours, 'ore')}
            <div class="field"><label>Include</label><div class="mods-in">${Object.entries(P.MODULE_NAMES).map(([k, n]) => `<label class="tog"><input type="checkbox" data-s="packages.${i}.modules" data-m="${k}" ${p.modules.includes(k) ? 'checked' : ''}> ${n}</label>`).join('')}</div></div></div>
          <div class="field"><label>Descriere scurtă (apare în formularul pentru clienți)</label><input class="inp" data-s="packages.${i}.desc" value="${esc(p.desc || '')}" placeholder="ex. Toată experiența pentru primele ore ale petrecerii."></div>
          <label class="tog"><input type="checkbox" data-s="packages.${i}.album" ${P.albumIncluded(p) ? 'checked' : ''}> Album foto inclus în pachet (nebifat: se poate adăuga la cerere, contra cost)</label>
          <label class="tog"><input type="checkbox" data-s="packages.${i}.staffMenu" ${p.staffMenu ? 'checked' : ''}> Stăm toată noaptea (se socotește meniu pentru staff)</label>
          <label class="tog"><input type="radio" name="recPkg" data-rec="${i}" ${p.recommended ? 'checked' : ''}> Pachet recomandat în formular</label>
        </div>`).join('')}
        <div class="btns"><button type="button" class="btn" data-act="crm-addpkg">+ Adaugă pachet</button></div>
      </section>
      <section class="panel"><h2>Servicii extra</h2>
        <p class="hint">Apar pe pagina de ofertă, sub pachete, ca opțiuni pe care clientul le poate bifa, <b>fără preț</b>, cu mențiunea că verificați disponibilitatea și reveniți în emailul cu oferta. Prețul de aici e cel estimativ pus în ofertă (câmpul {servicii_extra}) și adunat la total; dacă e 0, emailul îți cere să-l completezi. Costul tău intră la calculul profitului.</p>
        ${(S.extras || []).map((x, k) => `<div class="cat"><div class="cat-head"><input class="inp" data-s="extras.${k}.name" value="${esc(x.name)}" aria-label="Numele serviciului"><button type="button" class="x" data-act="crm-delextra" data-i="${k}" aria-label="Șterge serviciul">×</button></div>
          <div class="field"><label>Descriere scurtă (apare pe pagina de ofertă)</label><input class="inp" data-s="extras.${k}.desc" value="${esc(x.desc || '')}"></div>
          <div class="row3">${f(`extras.${k}.price`, 'Preț pentru client (0 = la cerere)', x.price, 'lei')}${f(`extras.${k}.cost`, 'Costul tău', x.cost, 'lei')}</div></div>`).join('')}
        <div class="btns"><button type="button" class="btn" data-act="crm-addextra">+ Adaugă serviciu extra</button></div>
      </section>
      <section class="panel"><h2>Album foto</h2>
        <div class="row3">${f('pricing.albumPrice', 'Preț album (când se adaugă la cerere)', S.pricing.albumPrice, 'lei')}${f('costs.albumCost', 'Costul tău pe album', S.costs.albumCost, 'lei')}</div>
        <p class="hint">Stick-ul cu pozele e inclus la pachetele cu Photo Booth. Albumul e inclus la pachetele bifate mai sus; la celelalte îl adaugi din cerere cu butonul „+ Adaugă album foto”. Pune costul albumului ca profitul să fie corect. În emailuri poți folosi {album}.</p>
      </section>
      <section class="panel"><h2>Transport</h2>
        <div class="row3">${f('pricing.kmRate', 'Tarif pentru client', S.pricing.kmRate, 'lei/km')}
          <div class="field"><label>&nbsp;</label><label class="tog"><input type="checkbox" data-s="pricing.roundTrip" ${S.pricing.roundTrip ? 'checked' : ''}> Facturez dus-întors</label></div>
          ${f('pricing.maxKm', 'Zonă acoperită: până la', S.pricing.maxKm, 'km (0 = fără limită)')}</div>
        <p class="hint">Se aplică doar în afara Bucureștiului și Ilfovului. Formularul estimează km de la București până la reședința județului; corectezi distanța exactă în fiecare cerere. Peste limita zonei acoperite, formularul nu mai arată un preț și le spune clienților că zona nu e acoperită momentan, cu varianta de ofertă specială.</p>
      </section>
      <section class="panel"><h2>TVA, taxe și facturare</h2>
        <div class="row3">
          <div class="field"><label>&nbsp;</label><label class="tog"><input type="checkbox" data-s="pricing.vatPayer" ${S.pricing.vatPayer ? 'checked' : ''}> Firma e plătitoare de TVA</label></div>
          ${f('pricing.vatRate', 'Cota TVA', S.pricing.vatRate, '%')}
          <div class="field"><label>&nbsp;</label><label class="tog"><input type="checkbox" data-s="pricing.pricesIncludeVat" ${S.pricing.pricesIncludeVat ? 'checked' : ''}> Prețurile pachetelor includ TVA</label></div>
        </div>
        <div class="row3">${f('costs.incomeTax', 'Impozit pe venit (fără TVA)', S.costs.incomeTax, '%')}${f('costs.payFee', 'Comision la încasare (card, POS)', S.costs.payFee, '%')}${f('costs.invoiceFixed', 'Cost fix pe factură', S.costs.invoiceFixed, 'lei')}</div>
        <p class="hint">Implicit: TVA 21% (cota standard din 2026) inclus în prețuri și impozit de microîntreprindere 1%. Dacă nu ești plătitor de TVA (sub plafonul de 395.000 lei pe an), debifează prima căsuță. „Cost fix pe factură” e pentru program de facturare, contabilitate sau alte costuri pe fiecare eveniment. Verifică cotele cu contabilul tău.</p>
        <p class="hint">Dacă prețurile <b>nu</b> includ TVA, formularul public și emailurile arată totalul cu TVA adăugat.</p>
      </section>
      <section class="panel"><h2>Costuri (pentru calculul profitului)</h2>
        <div class="row3">${f('costs.staffCount', 'Staff', S.costs.staffCount, 'persoane')}${f('costs.staffRate', 'Plată staff', S.costs.staffRate, 'lei/oră/pers.')}${f('costs.setupHours', 'Montaj + demontaj', S.costs.setupHours, 'ore')}</div>
        <div class="row3">${f('costs.menuCost', 'Meniu staff (toată noaptea)', S.costs.menuCost, 'lei/pers.')}${f('costs.fuelPerKm', 'Combustibil + uzură mașină', S.costs.fuelPerKm, 'lei/km condus')}${f('costs.boothConsumables', 'Consumabile Photo Booth', S.costs.boothConsumables, 'lei/ev.')}</div>
        <div class="row3">${f('costs.equipment', 'Uzură echipament', S.costs.equipment, 'lei/ev.')}</div>
        <p class="hint">Costurile nu apar în formularul public și nici în emailuri.</p>
      </section>
      ${saveBar()}`;
  }
  function saveBar() {
    return `<section class="panel savebar"><p class="hint" id="setMsg">${configured() ? (setDirty ? 'Ai modificări încă nesalvate în Google Sheets.' : 'Modificările se salvează automat în Google Sheets.') : 'Se păstrează pe acest dispozitiv. Conectează Google Sheets ca să ajungă și în formularul public.'}</p>
      <div class="btns">${configured() && setDirty ? `<button type="button" class="btn primary" data-act="crm-savesettings">Salvează acum</button>` : ''}
      <button type="button" class="btn danger small" data-act="crm-resetsettings">Revino la valorile implicite</button></div></section>`;
  }

  /* ---------- Șabloane ---------- */
  /* ---------- Șabloane email: listă · editor · previzualizare, câmpurile tale, fișiere de atașat ---------- */
  let tplSel = 0, tplLead = '', tplFocus = 'body', tplMsg = '', fileMsg = '', tplDelAsk = -1, tplResetAsk = -1, fileDelAsk = '';
  const FIELD_GROUPS = [
    ['Client', [['prenume', 'Prenume'], ['nume_complet', 'Nume complet'], ['data_eveniment', 'Data evenimentului'], ['locatie_completa', 'Locația completă'], ['localitate', 'Localitatea'], ['invitati', 'Nr. invitați']]],
    ['Ofertă', [['tabel_oferta', 'Tabelul ofertei'], ['tabel_pachete', 'Toate pachetele'], ['servicii_extra', 'Servicii extra alese'], ['pachet', 'Pachet'], ['ore', 'Durată'], ['pret_pachet', 'Preț pachet'], ['transport', 'Transport'], ['km', 'Km'], ['reducere', 'Reducere'], ['total', 'Total'], ['tva', 'TVA'], ['total_fara_tva', 'Total fără TVA'], ['album', 'Album']]],
    ['Plată', [['avans', 'Avans (lei)'], ['procent_avans', 'Avans (%)'], ['termen_plata', 'Termen plată'], ['zile_plata', 'Zile plată']]],
    ['Contact', [['telefoane', 'Telefoane'], ['expeditor', 'Expeditor']]]
  ];
  const BUILTIN = FIELD_GROUPS.flatMap(g => g[1].map(x => x[0])).concat(['locatie', 'cota_tva', 'nume']);
  const FORMATS = [['# ', 'Titlu mare'], ['## ', 'Subtitlu'], ['**', 'Îngroșat'], ['- ', 'Listă'], ['| text | sumă |', 'Rând de tabel']];
  function sampleLead() {
    const real = C.leads.find(l => l.id === tplLead);
    if (real) return real;
    const y = new Date().getFullYear() + 1;
    return { id: '', name: 'Andreea Popescu', email: 'exemplu@email.ro', eventType: 'Nuntă', eventDate: y + '-06-12', county: 'București', city: 'București', venue: 'Restaurantul Exemplu', guests: '150',
      package: (C.settings.packages.find(p => p.recommended) || C.settings.packages[0] || {}).id, outside: 'nu', km: '0', discountType: '%', discountValue: '10', status: 'Nou' };
  }
  function tplPreviewDoc(t) {
    const l = sampleLead(), body = fill(t.body, l).replace(/\{(\w+)\}/g, (m, k) => { const f = (C.settings.fields || []).find(x => x.key === k); return f ? '[' + f.label + ']' : m; });
    return '<!doctype html><meta charset="utf-8"><body style="margin:0">' + P.emailHtml(body, { preview: true }) + '</body>';
  }
  function updateTplPreview() {
    const S = C.settings, t = S.templates[tplSel]; if (!t) return;
    const f = $('#tp-prev'); if (f) f.srcdoc = tplPreviewDoc(t);
    const s = $('#tp-subj'); if (s) s.textContent = fill(t.subject, sampleLead());
  }
  function templatesView() {
    const S = C.settings;
    if (tplSel >= S.templates.length) tplSel = 0;
    const t = S.templates[tplSel], i = tplSel, def = P.DEFAULT_SETTINGS.templates.find(x => x.id === t.id);
    if (FILES === null && configured()) loadFiles();
    const mine = (S.fields || []).filter(f => f.key);
    const atts = t.attachments || [], avail = (FILES || []).filter(f => !atts.some(a => a.id === f.id));
    return `<section class="panel tstudio">
        <div class="ts-list"><p class="ms-l">Șabloane</p>
          ${S.templates.map((x, k) => `<button type="button" class="ts-item${k === i ? ' on' : ''}" data-act="crm-tsel" data-i="${k}"><b>${esc(x.name || 'Fără nume')}</b><span>${x.autoSubmit ? '⚡ automat · ' : ''}${x.status ? '→ ' + esc(x.status) : 'fără status'}${(x.attachments || []).length ? ' · 📎 ' + x.attachments.length : ''}</span></button>`).join('')}
          <button type="button" class="ts-item add" data-act="crm-addtpl">+ Șablon nou</button></div>
        <div class="ts-edit">
          <div class="row2">
            <div class="field"><label for="tp-name">Numele șablonului</label><input class="inp" id="tp-name" data-s="templates.${i}.name" value="${esc(t.name)}"></div>
            <div class="field"><label for="tp-st">După trimitere, statusul devine</label><select class="inp" id="tp-st" data-s="templates.${i}.status"><option value="" ${!t.status ? 'selected' : ''}>(nu se schimbă)</option>${P.STATUSES.map(x => `<option ${x === t.status ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          </div>
          <label class="tog autosub"><input type="checkbox" data-s="templates.${i}.autoSubmit" ${t.autoSubmit ? 'checked' : ''}> <span><b>Trimite automat</b> imediat ce clientul trimite cererea din formular (de ex. confirmarea că am primit cererea)</span></label>
          <div class="field"><label for="tp-s">Subiect</label><input class="inp" id="tp-s" data-s="templates.${i}.subject" data-tf="subject" value="${esc(t.subject)}"></div>
          <div class="ins"><p class="ms-l" title="Clic pe un câmp: îl pune unde e cursorul și se completează singur la trimitere.">Inserează în ${tplFocus === 'subject' ? 'subiect' : 'mesaj'} </p>
            ${FIELD_GROUPS.map(([g, xs]) => `<div class="ins-g"><span>${g}</span>${xs.map(([k, n]) => `<button type="button" class="ins-b" data-act="crm-ins" data-k="{${k}}" title="{${k}}">${n}</button>`).join('')}</div>`).join('')}
            ${mine.length ? `<div class="ins-g"><span>Câmpurile tale</span>${mine.map(f => `<button type="button" class="ins-b mine" data-act="crm-ins" data-k="{${esc(f.key)}}" title="{${esc(f.key)}}">${esc(f.label)}</button>`).join('')}</div>` : ''}
            ${(FILES || []).some(f => /^image\//.test(f.type)) ? `<div class="ins-g"><span>Imagini (apar în corpul emailului)</span>${FILES.filter(f => /^image\//.test(f.type)).map(f => `<button type="button" class="ins-b img" data-act="crm-ins" data-k="[[imagine:${esc(f.id)}|${esc(f.name)}]]">🖼 ${esc(f.name)}</button>`).join('')}</div>` : ''}
            <div class="ins-g"><span>Formatare</span>${FORMATS.map(([k, n]) => `<button type="button" class="ins-b fmt" data-act="crm-fmt" data-k="${esc(k)}">${n}</button>`).join('')}</div>
          </div>
          <div class="field"><label for="tp-b">Mesaj</label><textarea class="inp" id="tp-b" data-s="templates.${i}.body" data-tf="body" rows="16">${esc(t.body)}</textarea></div>
          <div class="attbox"><p class="ms-l">Atașamente trimise automat cu acest șablon</p>
            <div class="ms-row">${atts.map(a => `<span class="attchip">📎 ${esc(a.name)} <button type="button" data-act="crm-tattrm" data-k="${esc(a.id)}" aria-label="Scoate ${esc(a.name)}">×</button></span>`).join('') || '<span class="hint">Niciunul.</span>'}</div>
            ${avail.length ? `<select class="inp" id="tp-addatt" aria-label="Atașează la șablon"><option value="">+ Atașează un fișier încărcat…</option>${avail.map(f => `<option value="${esc(f.id)}">${esc(f.name)} · ${fmtSize(f.size)}</option>`).join('')}</select>` : ''}
            <span class="hint">Fișierele noi le încarci mai jos, la „Fișiere de atașat”.</span></div>
          <div class="btns">
            <button type="button" class="btn" data-act="crm-tdup">Duplică</button>
            <button type="button" class="btn" data-act="crm-ttest">Trimite-mi un test</button>
            ${def ? `<button type="button" class="btn" data-act="crm-treset">Textul inițial</button>` : ''}
            ${S.templates.length > 1 ? `<button type="button" class="btn danger" data-act="crm-deltpl" data-i="${i}">Șterge</button>` : ''}
            <span class="hint" id="tpMsg">${tplMsg}</span></div>
        </div>
        <div class="ts-prev">
          <div class="field"><label for="tp-lead">Previzualizare cu</label><select class="inp" id="tp-lead"><option value="">o cerere de exemplu</option>${C.leads.filter(l => l.status !== 'Șters').slice(0, 40).map(l => `<option value="${esc(l.id)}" ${l.id === tplLead ? 'selected' : ''}>${esc(l.name)} · ${esc(fmtD(l.eventDate))}</option>`).join('')}</select></div>
          <p class="ts-subj"><span>Subiect:</span> <b id="tp-subj">${esc(fill(t.subject, sampleLead()))}</b></p>
          <iframe id="tp-prev" title="Previzualizare șablon"></iframe>
        </div>
      </section>
      <section class="panel"><h2>Câmpurile tale</h2>
        <p class="hint">Adaugă informații pe care le pui des în emailuri. <b>Același text mereu</b> (ex. IBAN-ul, linkul de Instagram) se completează singur. <b>Îl completez la trimitere</b> (ex. ora filmării) îți apare ca un câmp de completat când trimiți emailul. În șabloane le pui cu butoanele de la „Câmpurile tale”.</p>
        ${(S.fields || []).map((f, k) => `<div class="fieldrow">
          <div class="field"><label>Nume</label><input class="inp" data-s="fields.${k}.label" value="${esc(f.label)}" placeholder="ex. Link Instagram"></div>
          <div class="field"><label>Cod în șablon</label><input class="inp" data-fkey="${k}" value="${esc(f.key)}" placeholder="ex. instagram" autocapitalize="none" spellcheck="false"></div>
          <div class="field"><label>Cum se completează</label><select class="inp" data-s="fields.${k}.kind"><option value="fix" ${f.kind !== 'ask' ? 'selected' : ''}>Același text mereu</option><option value="ask" ${f.kind === 'ask' ? 'selected' : ''}>Îl completez la trimitere</option></select></div>
          ${f.kind !== 'ask' ? `<div class="field fr-val"><label>Text</label><textarea class="inp" rows="2" data-s="fields.${k}.value" placeholder="ce apare în email">${esc(f.value || '')}</textarea></div>` : '<div class="field fr-val"><label>Text</label><p class="hint">Îl scrii la fiecare email.</p></div>'}
          <button type="button" class="x" data-act="crm-delfield" data-i="${k}" aria-label="Șterge câmpul">×</button></div>`).join('')}
        <div class="btns"><button type="button" class="btn" data-act="crm-addfield">+ Câmp nou</button><span class="hint" id="fkMsg"></span></div>
      </section>
      <section class="panel"><h2>Fișiere de atașat</h2>
        <p class="hint">De exemplu oferta sau prezentarea în PDF. Se păstrează în Google Drive-ul tău, în dosarul „WE WELCOME · atașamente”. Le atașezi la un șablon (se trimit automat) sau la un singur email. PDF, JPG, PNG sau Word, cel mult 15 MB fiecare.</p>
        ${filesErr ? `<p class="hint err-msg">${esc(filesErr)}</p>` : ''}
        <div class="files">${FILES === null ? '<p class="hint">Se încarcă…</p>' : FILES.length ? FILES.map(f => `<div class="file"><span>📎 <b>${esc(f.name)}</b> <span class="hint">${fmtSize(f.size)}</span></span><button type="button" class="btn small danger" data-act="crm-fdel" data-k="${esc(f.id)}">Șterge</button></div>`).join('') : '<p class="hint">Niciun fișier încă.</p>'}</div>
        <div class="btns"><label class="btn primary upl">Încarcă un fișier<input type="file" id="tp-file" accept="application/pdf,image/jpeg,image/png,.docx" hidden></label><span class="hint" id="flMsg">${fileMsg}</span></div>
      </section>
      <section class="panel"><h2>Expeditor și avans</h2>
        <div class="row2"><div class="field"><label>Emailul din care pleacă mesajele</label><input class="inp" type="email" data-s="email.fromEmail" value="${esc(S.email.fromEmail)}"></div>
          <div class="field"><label>Numele afișat</label><input class="inp" data-s="email.fromName" value="${esc(S.email.fromName)}"></div></div>
        <p class="hint">Emailurile pleacă din contul Google care a publicat scriptul${C.account ? ` (<b>${esc(C.account)}</b>)` : ''}. O altă adresă merge doar dacă e adăugată în acel Gmail la „Trimite mesaje ca”. Gmail permite cam 100 de emailuri pe zi din script.</p>
        ${C.account && S.email.fromEmail && C.account.toLowerCase() !== S.email.fromEmail.toLowerCase() ? `<p class="hint warn-msg">Atenție: scriptul rulează pe ${esc(C.account)}, dar expeditorul ales e ${esc(S.email.fromEmail)}.</p>` : ''}
        <div class="row3">${[['pricing.advancePct', 'Avans la reconfirmare', S.pricing.advancePct, '% din total'], ['pricing.payDays', 'Termen de plată a avansului', S.pricing.payDays, 'zile de la email']].map(([pa, la, v, su]) => `<div class="field"><label>${la}</label><div class="suf"><input class="inp" data-s="${pa}" data-num="1" inputmode="decimal" value="${esc(v)}"><span>${su}</span></div></div>`).join('')}</div>
      </section>
      ${saveBar()}`;
  }
  function insertAtCursor(txt) {
    const el = tplFocus === 'subject' ? $('#tp-s') : $('#tp-b'); if (!el) return;
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a, sel = el.value.slice(a, b);
    let ins = txt;
    if (txt === '**') ins = '**' + (sel || 'text îngroșat') + '**';
    else if (/^(#|##|-) $/.test(txt)) ins = (a && el.value[a - 1] !== '\n' ? '\n' : '') + txt + (sel || '');
    else if (txt.startsWith('|')) ins = (a && el.value[a - 1] !== '\n' ? '\n' : '') + txt;
    else if (txt.startsWith('[[imagine:')) ins = (a && el.value[a - 1] !== '\n' ? '\n' : '') + txt + '\n';
    el.value = el.value.slice(0, a) + ins + el.value.slice(b);
    el.focus(); const pos = a + ins.length; try { el.setSelectionRange(pos, pos); } catch (e) {}
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  async function readB64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('Nu am putut citi fișierul.')); r.readAsDataURL(file); }); }

  /* ---------- Conectare ---------- */
  function connectView() {
    const raw = new URL('google-apps-script/Code.gs', location.href).href;
    return `<section class="panel"><h2>Conectarea la Google Sheets</h2>
        <ol class="steps">
          <li>Deschide <a href="https://docs.google.com/spreadsheets/d/1F0WKXYN48B0Q_L29el01QJZmqKDt6WRBOiRfSca79Hs/edit" target="_blank" rel="noopener">Google Sheet-ul tău</a> → <b>Extensii → Apps Script</b>.</li>
          <li>Șterge ce e în editor și lipește scriptul: <button type="button" class="btn small" data-act="crm-copyscript">Copiază scriptul</button> <a class="btn small" href="${esc(raw)}" target="_blank" rel="noopener">Vezi scriptul</a></li>
          <li>Pe linia <code>const ADMIN_KEY = '…'</code> pune o parolă lungă, doar a ta. Salvează (Ctrl+S).</li>
          <li><b>Implementare → Implementare nouă</b> → tip <b>Aplicație web</b>. Execută ca: <b>Eu</b>. Cine are acces: <b>Oricine</b>. Apasă Implementare și autorizează (la „Google hasn't verified this app”: Advanced → Go to… → Allow).</li>
          <li>Copiază adresa <b>Aplicație web</b> (se termină cu <code>/exec</code>) și pune-o mai jos, împreună cu parola de la pasul 3.</li>
        </ol>
        <div class="row2"><div class="field"><label for="cn-url">Adresa scriptului (…/exec)</label><input class="inp" id="cn-url" value="${esc(C.url)}" placeholder="https://script.google.com/macros/s/…/exec"></div>
          <div class="field"><label for="cn-key">Parola (ADMIN_KEY)</label><input class="inp" id="cn-key" type="password" value="${esc(C.key)}"></div></div>
        <div class="btns"><button type="button" class="btn primary" data-act="crm-connect">Conectează și testează</button><span class="hint" id="cnMsg">${C.account ? `Conectat la contul Google <b>${esc(C.account)}</b>.` : ''}</span></div>
        <p class="note">Parola rămâne pe acest laptop și în script; formularul public nu o folosește. Ca formularul să trimită cererile, trimite-i lui Claude adresa scriptului (doar adresa, fără parolă) ca s-o pună în site.</p>
      </section>`;
  }

  /* ---------------- acțiuni ---------------- */
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function setPath(obj, path, val) { const ks = path.split('.'); let o = obj; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = val; }
  function getPath(obj, path) { return path.split('.').reduce((o, k) => o && o[k], obj); }
  /** Setările se salvează singure în Google Sheets la o secundă după ultima modificare. */
  let autoT = null;
  function autoSave() {
    const m = $('#setMsg');
    if (!configured() || !isAdmin()) { if (m) { m.textContent = 'Salvat pe acest dispozitiv.'; m.className = 'hint'; } return; }
    if (m) { m.textContent = 'Se salvează…'; m.className = 'hint'; }
    clearTimeout(autoT); autoT = setTimeout(saveSettingsRemote, 1000);
  }
  /** O singură dată: pachetele cu numele și prețurile vechi implicite primesc numele și prețurile noi (Welcome 1.300, Celebrate 2.600, All Night 4.200). */
  function migratePackages(S) {
    const NEW = { esential: ['Esențial', 1500, 'Welcome', 1300], complet: ['Complet', 2500, 'Celebrate', 2600], allnight: ['All Night', 3300, 'All Night', 4200] };
    let changed = false;
    const DESC = { 'Bun venit, găsirea mesei și Photo Booth, 5 ore': 'complet', 'Avatar digital pentru primirea invitaților, așezarea acestora la masă și alertă pentru momentele speciale': 'esential', 'Toată experiența pentru primele ore ale petrecerii.': 'complet', 'Toată experiența, pe toată durata petrecerii.': 'allnight' };
    (S.packages || []).forEach(p => {
      const d = String(p.desc || '').trim(), id = /^Mesajul de bun venit al mirilor și găsirea mesei/i.test(d) ? 'esential' : DESC[d];
      const nd = id && (P.DEFAULT_SETTINGS.packages.find(x => x.id === id) || {}).desc;
      if (nd && nd !== d) { p.desc = nd; changed = true; }
    });
    (S.packages || []).forEach(p => { const n = NEW[p.id]; if (n && p.name === n[0] && num(p.price) === n[1]) { p.name = n[2]; p.price = n[3]; changed = true; } });
    return changed;
  }
  /** O singură dată: șablonul „Ofertă” vechi primește textul nou de rezervare (email sau WhatsApp) și telefoanele la final. */
  function migrateTemplates(S) {
    const t = (S.templates || []).find(x => x.id === 'oferta'); if (!t) return false;
    const old = 'Pentru rezervare, răspundeți la acest email sau sunați-ne.';
    let changed = false;
    if (t.body.includes(old)) { t.body = t.body.replace(old, 'Pentru rezervare, vă rugăm să ne confirmați pe email (răspunzând la acest mesaj) sau pe WhatsApp.'); changed = true; }
    if (changed && !t.body.includes('{telefoane}')) t.body = t.body.replace(/\{expeditor\}\s*$/, '{expeditor}\nTelefon / WhatsApp: {telefoane}');
    if (S.email && S.email.fromName === 'Wedding Welcome') { S.email.fromName = 'WE WELCOME'; changed = true; }
    if (/^Oferta (Wedding Welcome|WE WELCOME) pentru \{data_eveniment\}$/.test(t.subject)) { t.subject = 'Propunerea noastră pentru evenimentul tău 🎉'; changed = true; }
    if ((t.body.includes('Pachet: {pret_pachet} lei') && t.body.includes('Vă mulțumim pentru interesul arătat')) || t.body === P.OFFER_BODY_V2 || t.body === P.OFFER_BODY_V3 || t.body === P.OFFER_BODY_V4 || t.body === P.OFFER_BODY_V5) { t.body = P.OFFER_BODY; changed = true; }
    if (!(S.templates || []).some(x => x.id === 'primire')) { S.templates.unshift(clone(P.DEFAULT_SETTINGS.templates.find(x => x.id === 'primire'))); changed = true; }
    const rc = (S.templates || []).find(x => x.id === 'reconfirmare');
    if (rc && rc.body === P.RECONFIRM_BODY_V1) { rc.body = P.RECONFIRM_BODY; changed = true; }
    const conf = (S.templates || []).find(x => x.id === 'confirmare');
    if (conf && conf.body.includes('vă vom cere lista invitaților cu mesele și videoclipurile')) { conf.body = P.CONFIRM_BODY; changed = true; }
    if (!(S.templates || []).some(x => x.id === 'reconfirmare')) {
      const def = P.DEFAULT_SETTINGS.templates.find(x => x.id === 'reconfirmare');
      const i = S.templates.findIndex(x => x.id === 'confirmare');
      S.templates.splice(i < 0 ? S.templates.length : i + 1, 0, clone(def)); changed = true;
    }
    return changed;
  }
  /** Emailul trimis automat de scriptul Google când un client trimite cererea: îl pregătim aici, cu logo și formatare,
      lăsând doar datele clientului ({nume}, {data_eveniment}…) pe care le completează scriptul. */
  const LEAD_KEYS = ['nume', 'prenume', 'nume_complet', 'data_eveniment', 'localitate', 'locatie', 'locatie_completa', 'pachet', 'invitati'];
  function buildAutoAck(S) {
    const t = (S.templates || []).find(x => x.autoSubmit); if (!t) return null;
    const stat = { expeditor: S.email.fromName || '', telefoane: phones() };
    (S.fields || []).forEach(f => { if (f.key && f.kind !== 'ask') stat[f.key] = f.value || ''; });
    const fillS = x => String(x || '').replace(/\{(\w+)\}/g, (m, k) => LEAD_KEYS.includes(k) ? m : (k in stat ? stat[k] : ''));
    const body = fillS(t.body);
    return { id: t.id, name: t.name, subject: fillS(t.subject), html: P.emailHtml(body), text: P.emailText(body), attachments: (t.attachments || []).map(a => a.id),
      fromEmail: S.email.fromEmail, fromName: S.email.fromName };
  }
  async function saveSettingsRemote() {
    const m = $('#setMsg'); if (m) m.textContent = 'Se salvează…';
    try { C.settings.autoAck = buildAutoAck(C.settings); await api('POST', { action: 'settings', settings: C.settings }); setDirty = false; save(); const n = $('#setMsg'); if (n) { n.textContent = 'Salvat automat în Google Sheets. Formularul public folosește aceste valori.'; n.className = 'hint ok-msg'; } }
    catch (e) { if (m) { m.textContent = 'Nu am putut salva: ' + e.message; m.className = 'hint err-msg'; } }
  }
  /** Administratorul setează direct în Google Sheet parola unui cont (de ex. când pe telefon nu merge, deși pe laptop merge). */
  async function setAccountPassword(id) {
    const box = document.querySelector(`[data-accid="${CSS.escape(id)}"]`); if (!box) return;
    const a = accList.find(x => x.id === id), pw = box.querySelector('[data-acc="newpw"]').value;
    const k = 'pw' + id, say = (t) => { accMsg[k] = t; refreshAccPanel(); };
    if (pw.length < 6) return say('<span class="err-msg">Parola trebuie să aibă cel puțin 6 caractere.</span>');
    say('Se salvează…');
    try {
      const now = new Date().toISOString(), salt = newSalt(), rsalt = newSalt(), code = recoveryCode();
      const u = { id: a.id, username: a.username, salt, hash: await hashPw(pw, salt), rsalt, rhash: await hashPw(code.replace(/-/g, ''), rsalt), created: a.created || now, updated: now };
      const d = await api('POST', { action: 'accountsPut', users: [u] });
      if (d.conflicts && d.conflicts.length) throw new Error('Google Sheet nu a acceptat schimbarea.');
      // verificăm că din Sheet se poate intra acum cu parola nouă
      const s2 = await window.WWNet.call(C.url, { action: 'authSalt', username: a.username }, false);
      const r = await window.WWNet.call(C.url, { action: 'login', username: a.username, hash: await hashPw(pw, s2.salt) }, false);
      if (r && !r.ok && /Prea multe/.test(r.error || '')) return say(`<span class="ok-msg">Parola nouă e salvată în Google Sheet.</span> Contul e blocat temporar după prea multe încercări greșite: pe telefon încearcă din nou peste 15 minute. Cod nou de recuperare: <b>${esc(code)}</b>`);
      if (!r || !r.ok) throw new Error('Parola s-a trimis, dar verificarea a eșuat: ' + ((r && r.error) || 'fără răspuns'));
      // dacă e și pe acest dispozitiv (același cont), îl actualizăm și aici
      const acc = accounts(), loc = acc.users.find(x => x.id === a.id);
      if (loc) { Object.assign(loc, { salt: u.salt, hash: u.hash, rsalt: u.rsalt, rhash: u.rhash, updated: now }); LS.set(K_ACC, acc); }
      say(`<span class="ok-msg">Gata: ${esc(a.username)} intră acum cu parola nouă de pe orice dispozitiv (verificat în Google Sheet).</span> Cod nou de recuperare: <b>${esc(code)}</b> — păstrează-l.`);
    } catch (e) { say(`<span class="err-msg">${esc(e.message || e)}</span>`); }
  }
  async function saveAccount(id) {
    const box = document.querySelector(`[data-accid="${CSS.escape(id)}"]`); if (!box) return;
    const a = accList.find(x => x.id === id); const val = k => box.querySelector(`[data-acc="${k}"]`).value;
    const role = val('role'), email = val('email').trim().toLowerCase(), access = val('sheetAccess');
    const msg = t => { accMsg[id] = t; const el = document.getElementById('am-' + id); if (el) el.innerHTML = t; };
    msg('Se aplică…');
    try {
      if (role !== a.role || email !== (a.email || '')) { const d = await api('POST', { action: 'accountMeta', id, role, email }); a.role = d.role; a.email = d.email; }
      if (access !== (a.sheetAccess || 'none')) { await api('POST', { action: 'shareSheet', id, access }); a.sheetAccess = access; }
      accMsg[id] = '<span class="ok-msg">Aplicat.</span>';
      if (id === USER.id && role === 'user') { C.role = 'user'; save(); return render(); }
    } catch (e) { accMsg[id] = `<span class="err-msg">${esc(e.message)}</span>`; }
    refreshAccPanel();
  }
  async function deleteLead() {
    const id = L.id, m = $('#ldMsg');
    if (m) { m.textContent = 'Se șterge…'; m.className = 'hint'; }
    try {
      try { await api('POST', { action: 'deleteLead', id }); }
      catch (e) {
        // scriptul publicat e încă versiunea fără ștergere: o marcăm „Șters”, ca să dispară din aplicație
        if (!/necunoscut/i.test(e.message)) throw e;
        await api('POST', { action: 'update', id, fields: { status: 'Șters' } });
      }
      C.leads = C.leads.filter(x => x.id !== id); save();
      $('#modal').hidden = true; L = null; compose = null; note = 'Cererea a fost ștearsă.'; noteOk = true; rerender();
    } catch (e) { L._del = false; renderLead(); const n = $('#ldMsg'); if (n) { n.textContent = 'Nu am putut șterge: ' + e.message; n.className = 'hint err-msg'; } }
  }
  Object.assign(A, {
    'crm-del'() { L._del = true; renderLead(); },
    'crm-del-no'() { L._del = false; renderLead(); },
    'crm-del-yes'() { deleteLead(); },
    'crm-acc-save'(el) { saveAccount(el.dataset.id); },
    'lt-toggle'() { if (LT.on) lightsStop(); else lightsStart(); },
    async 'lt-save'() {
      const host = $('#lt-host').value.trim(), deviceId = $('#lt-id').value.trim(), authKey = $('#lt-key').value.trim();
      const m = $('#ltMsg'); m.className = 'hint'; m.textContent = 'Se salvează…';
      if (!authKey && LT.info && LT.info.configured) { m.className = 'hint err-msg'; m.textContent = 'Completează și cheia (din motive de siguranță nu o afișăm).'; return; }
      try { const d = await api('POST', { action: 'lightsSetup', host, deviceId, authKey }); LT.info = d; LT.setupMsg = '<span class="ok-msg">Salvat. Apasă „Test” ca să verifici.</span>'; render(); }
      catch (e) { m.className = 'hint err-msg'; m.textContent = /necunoscut/i.test(e.message) ? 'Scriptul Google e o versiune veche: actualizează-l (Code.gs) ca să poți folosi beculețele.' : e.message; }
    },
    async 'lt-test'() {
      const m = $('#ltMsg'); m.className = 'hint'; m.textContent = 'Se trimite…';
      try { await api('POST', { action: 'lights', on: true, pulse: 3 }); m.className = 'hint ok-msg'; m.textContent = 'Comandă trimisă: beculețele ar trebui să stea aprinse 3 secunde.'; }
      catch (e) { m.className = 'hint err-msg'; m.textContent = e.message; }
    },
    'crm-album'() { if (!L) return; L.album = P.yes(L.album) ? 'nu' : 'da'; const a = $('#albumBox'); if (a) a.innerHTML = albumField(); const b = $('#calcBox'); if (b) b.innerHTML = breakdown(); },
    'crm-acc-pw'(el) { setAccountPassword(el.dataset.id); },
    'crm-acc-del'(el) { accMsg.del = el.dataset.id; refreshAccPanel(); },
    'crm-acc-del-no'() { accMsg.del = null; refreshAccPanel(); },
    async 'crm-acc-del-yes'(el) {
      const id = el.dataset.id; accMsg.del = null;
      try { await api('POST', { action: 'accountDel', id }); accList = accList.filter(a => a.id !== id); }
      catch (e) { accMsg[id] = `<span class="err-msg">${esc(e.message)}</span>`; }
      refreshAccPanel();
    },
    'crm-view'(el) { view = el.dataset.k; note = ''; render(); window.scrollTo(0, 0); },
    'crm-filter'(el) { filter = el.dataset.k; render(); },
    'crm-period-reset'() { fYear = 'Toate'; fMonth = 'Toate'; render(); },
    'crm-sync'() { sync(); },
    'crm-open'(el) { openLead(el.dataset.id); },
    'crm-close'() { $('#modal').hidden = true; L = null; compose = null; },
    'crm-save'() { saveLead(); },
    'crm-compose'(el) { startCompose(el.dataset.k || recommendedTpl(L) || (C.settings.templates[0] || {}).id); },
    'crm-tpl'(el) { if (!compose) return; const tpl = C.settings.templates.find(x => x.id === el.dataset.k); if (!tpl) return;
      compose.to = $('#cp-to').value; compose.tpl = tpl.id; compose.subject = fill(tpl.subject, L); compose.body = fill(tpl.body, L); compose.newStatus = tpl.status; compose.err = '';
      compose.att = (tpl.attachments || []).map(a => ({ id: a.id, name: a.name })); renderCompose(); },
    'crm-cpview'(el) { if (!compose) return; compose.to = $('#cp-to').value; compose.subject = $('#cp-s').value; compose.body = $('#cp-b').value; compose.view = el.dataset.k; renderCompose(); },
    'crm-compose-back'() { compose = null; renderLead(); },
    'crm-send'() { send(); },
    async 'crm-copy'(el) { try { await navigator.clipboard.writeText(el.dataset.v); el.textContent = 'Copiat!'; } catch (e) { el.textContent = 'Selectează și copiază'; } setTimeout(() => { el.textContent = 'Copiază'; }, 1800); },
    async 'crm-copyscript'(el) { try { const t = await (await fetch('google-apps-script/Code.gs', { cache: 'no-cache' })).text(); await navigator.clipboard.writeText(t); el.textContent = 'Copiat!'; } catch (e) { el.textContent = 'Deschide „Vezi scriptul”'; } },
    async 'crm-connect'() {
      C.url = $('#cn-url').value.trim(); C.key = $('#cn-key').value; save(); window.WWNet.mode = null;
      const m = $('#cnMsg'); m.className = 'hint'; m.textContent = 'Se testează…';
      if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(C.url)) { m.className = 'hint err-msg'; m.textContent = 'Adresa trebuie să înceapă cu https://script.google.com/…'; return; }
      try { const d = await api('GET', { action: 'ping' }); C.account = d.account; save(); m.className = 'hint ok-msg'; m.innerHTML = `Conectat la contul Google <b>${esc(d.account || '')}</b>. Se încarcă cererile…`; await sync(true); await pushAccounts(true); view = 'cereri'; render(); }
      catch (e) {
        m.className = 'hint err-msg';
        if (/nu poate fi contactat/.test(e.message)) m.innerHTML = `Google n-a răspuns cu date. Deschide <a href="${esc(C.url)}?action=config" target="_blank" rel="noopener">acest link</a>: dacă nu vezi <code>{"ok":true…}</code>, implementarea folosește încă o versiune veche a scriptului sau accesul nu e „Oricine” (Deploy → Manage deployments → creion → New version → Deploy).`;
        else m.textContent = 'Nu merge: ' + e.message;
      }
    },
    'crm-savesettings'() { saveSettingsRemote(); },
    'crm-resetsettings'() { C.settings = merge(P.DEFAULT_SETTINGS, null); setDirty = true; save(); render(); autoSave(); },
    'crm-addpkg'() { C.settings.packages.push({ id: 'p' + Date.now().toString(36), name: 'Pachet nou', hours: 4, price: 2000, modules: ['welcome', 'seating'], staffMenu: false, desc: '' }); setDirty = true; save(); render(); autoSave(); },
    'crm-delpkg'(el) { C.settings.packages.splice(+el.dataset.i, 1); setDirty = true; save(); render(); autoSave(); },
    'crm-addtpl'() { C.settings.templates.push({ id: 't' + Date.now().toString(36), name: 'Șablon nou', status: '', subject: '', body: 'Bună, {prenume}!\n\n\n\nCu drag,\n{expeditor}\nTelefon / WhatsApp: {telefoane}' }); tplSel = C.settings.templates.length - 1; tplMsg = ''; setDirty = true; save(); render(); autoSave(); },
    'crm-deltpl'(el) { const k = +el.dataset.i; if (tplDelAsk !== k) { tplDelAsk = k; tplMsg = '<span class="err-msg">Apasă încă o dată „Șterge” ca să confirmi.</span>'; return render(); }
      tplDelAsk = -1; C.settings.templates.splice(k, 1); tplSel = 0; tplMsg = ''; setDirty = true; save(); render(); autoSave(); },
    'crm-tsel'(el) { tplSel = +el.dataset.i; tplMsg = ''; tplDelAsk = -1; tplResetAsk = -1; render(); },
    'crm-tdup'() { const S = C.settings, t = clone(S.templates[tplSel]); t.id = 't' + Date.now().toString(36); t.name = t.name + ' (copie)'; S.templates.splice(tplSel + 1, 0, t); tplSel++; tplMsg = '<span class="ok-msg">Copie creată.</span>'; setDirty = true; save(); render(); autoSave(); },
    'crm-treset'() { const t = C.settings.templates[tplSel], def = P.DEFAULT_SETTINGS.templates.find(x => x.id === t.id); if (!def) return;
      if (tplResetAsk !== tplSel) { tplResetAsk = tplSel; tplMsg = '<span class="err-msg">Textul tău se înlocuiește cu cel inițial. Apasă încă o dată ca să confirmi.</span>'; return render(); }
      tplResetAsk = -1; t.subject = def.subject; t.body = def.body; tplMsg = '<span class="ok-msg">Textul inițial a fost pus înapoi.</span>'; setDirty = true; save(); render(); autoSave(); },
    async 'crm-ttest'() {
      const S = C.settings, t = S.templates[tplSel], l = sampleLead(), to = S.email.fromEmail || C.account; const m = $('#tpMsg');
      const lab = x => x.replace(/\{(\w+)\}/g, (mm, k) => { const f = (S.fields || []).find(y => y.key === k); return f ? '[' + f.label + ']' : mm; });
      const body = lab(fill(t.body, l)), atts = (t.attachments || []).map(a => a.id);
      if (m) { m.className = 'hint'; m.textContent = 'Se trimite testul la ' + to + '…'; }
      try { const d = await api('POST', { action: 'email', to, subject: '[TEST] ' + lab(fill(t.subject, l)), body: P.emailText(body), html: P.emailHtml(body), fromEmail: S.email.fromEmail, fromName: S.email.fromName, template: 'test', attachments: atts });
        tplMsg = `<span class="ok-msg">Test trimis la ${esc(to)}${atts.length ? (d.attached === atts.length ? `, cu ${atts.length} atașament${atts.length > 1 ? 'e' : ''}` : ' (fără atașamente: actualizează scriptul Google)') : ''}.</span>`; }
      catch (e) { tplMsg = `<span class="err-msg">${esc(e.message)}</span>`; }
      render();
    },
    'crm-ins'(el) { insertAtCursor(el.dataset.k); },
    'crm-fmt'(el) { insertAtCursor(el.dataset.k); },
    'crm-tattrm'(el) { const t = C.settings.templates[tplSel]; t.attachments = (t.attachments || []).filter(a => a.id !== el.dataset.k); setDirty = true; save(); render(); autoSave(); },
    'crm-attrm'(el) { if (!compose) return; keepCompose(); compose.att = compose.att.filter(a => a.id !== el.dataset.k); renderCompose(); },
    'crm-addextra'() { const xs = C.settings.extras = C.settings.extras || []; xs.push({ id: 'x' + Date.now().toString(36), name: 'Serviciu nou', desc: '', price: 0, cost: 0 }); setDirty = true; save(); render(); autoSave(); },
    'crm-delextra'(el) { C.settings.extras.splice(+el.dataset.i, 1); setDirty = true; save(); render(); autoSave(); },
    'crm-addfield'() { const fs = C.settings.fields = C.settings.fields || []; let n = fs.length + 1; while (fs.some(f => f.key === 'camp' + n)) n++; fs.push({ key: 'camp' + n, label: 'Câmp nou', kind: 'fix', value: '' }); setDirty = true; save(); render(); autoSave(); },
    'crm-delfield'(el) { C.settings.fields.splice(+el.dataset.i, 1); setDirty = true; save(); render(); autoSave(); },
    async 'crm-fdel'(el) {
      const id = el.dataset.k; if (fileDelAsk !== id) { fileDelAsk = id; fileMsg = '<span class="err-msg">Apasă încă o dată „Șterge” ca să confirmi. Fișierul ajunge în coșul din Google Drive.</span>'; return render(); }
      fileDelAsk = '';
      try { await api('POST', { action: 'fileDel', id }); FILES = (FILES || []).filter(f => f.id !== id); C.settings.templates.forEach(t => { if (t.attachments) t.attachments = t.attachments.filter(a => a.id !== id); }); setDirty = true; save(); autoSave(); fileMsg = '<span class="ok-msg">Fișier șters.</span>'; }
      catch (e) { fileMsg = `<span class="err-msg">${esc(e.message)}</span>`; }
      render();
    }
  });

  /* câmpuri: setări (data-s), cererea deschisă (data-l), căutare, șablon */
  function onField(e) {
    const t = e.target;
    if (t.dataset.s !== undefined) {
      const path = t.dataset.s;
      if (t.dataset.m) { const arr = getPath(C.settings, path); const i = arr.indexOf(t.dataset.m); if (t.checked && i < 0) arr.push(t.dataset.m); if (!t.checked && i >= 0) arr.splice(i, 1); }
      else if (t.type === 'checkbox') setPath(C.settings, path, t.checked);
      else setPath(C.settings, path, t.dataset.num ? P.num(t.value) : t.value);
      setDirty = true; save(); autoSave();
      if (/^(templates|fields)\./.test(path)) { clearTimeout(onField._tp); onField._tp = setTimeout(updateTplPreview, 200); }
      if (/^fields\.\d+\.kind$/.test(path) && e.type === 'change') render();
      if (/^templates\.\d+\.(name|status)$/.test(path) && e.type === 'change') render();
      if (/^templates\.(\d+)\.autoSubmit$/.test(path) && e.type === 'change') { const k = +path.split('.')[1]; if (t.checked) C.settings.templates.forEach((x, j) => { if (j !== k) x.autoSubmit = false; }); render(); }
      return;
    }
    if (t.dataset.rec !== undefined) {
      C.settings.packages.forEach((p, i) => { p.recommended = i === +t.dataset.rec; });
      setDirty = true; save(); autoSave(); return;
    }
    if (t.dataset.x !== undefined && L && e.type === 'change') {
      const set = String(L.extras || '').split(',').filter(Boolean).filter(x => x !== t.dataset.x); if (t.checked) set.push(t.dataset.x);
      L.extras = set.join(','); const b = $('#calcBox'); if (b) b.innerHTML = breakdown(); return;
    }
    if (t.dataset.l !== undefined && L) {
      const k = t.dataset.l;
      L[k] = t.type === 'checkbox' ? (t.checked ? 'da' : 'nu') : t.value;
      if (k === 'package') { const a = $('#albumBox'); if (a) a.innerHTML = albumField(); }
      if (k === 'outside') { const km = $('#l-km'); km.disabled = !t.checked; if (t.checked && !num(L.km)) { L.km = String(P.estimateKm(L.county)); km.value = L.km || ''; } }
      const b = $('#calcBox'); if (b) b.innerHTML = breakdown();
      return;
    }
    if ((t.id === 'crmYear' || t.id === 'crmMonth') && e.type === 'change') { if (t.id === 'crmYear') fYear = t.value; else fMonth = t.value; render(); return; }
    if (t.id === 'crmQ' && e.type === 'input') { q = t.value; const pos = t.selectionStart; render(); const n = $('#crmQ'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} } }
    if (t.id === 'cp-b' && e.type === 'input') { clearTimeout(onField._pv); onField._pv = setTimeout(updatePreview, 250); }
    if (t.dataset.cpv !== undefined && compose) { compose.vals[t.dataset.cpv] = t.value; clearTimeout(onField._pv); onField._pv = setTimeout(updatePreview, 250); }
    if (t.id === 'cp-addatt' && e.type === 'change' && compose && t.value) { const f = (FILES || []).find(x => x.id === t.value); if (f) { keepCompose(); compose.att.push({ id: f.id, name: f.name }); renderCompose(); } }
    if (t.id === 'tp-lead' && e.type === 'change') { tplLead = t.value; updateTplPreview(); }
    if (t.id === 'tp-addatt' && e.type === 'change' && t.value) { const f = (FILES || []).find(x => x.id === t.value), tp = C.settings.templates[tplSel]; if (f && tp) { tp.attachments = (tp.attachments || []).concat({ id: f.id, name: f.name }); setDirty = true; save(); autoSave(); render(); } }
    if (t.dataset.fkey !== undefined) {
      const k = +t.dataset.fkey, fs = C.settings.fields, key = t.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+/, '').slice(0, 30);
      const m = $('#fkMsg');
      if (BUILTIN.includes(key) || fs.some((f, x) => x !== k && f.key === key)) { if (m) { m.className = 'hint err-msg'; m.textContent = `Codul „${key}” e deja folosit. Alege altul.`; } return; }
      if (m) { m.className = 'hint'; m.textContent = key ? `În șablon se scrie {${key}}.` : ''; }
      fs[k].key = key; setDirty = true; save(); autoSave();
    }
  }
  document.addEventListener('focusin', e => { const tf = e.target.dataset && e.target.dataset.tf; if (tf) { tplFocus = tf; const p = document.querySelector('.ins .ms-l'); if (p && p.firstChild) p.firstChild.nodeValue = 'Inserează în ' + (tf === 'subject' ? 'subiect' : 'mesaj') + ' '; } });
  document.addEventListener('change', async e => {
    if (e.target.id !== 'tp-file' || !e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0], m = $('#flMsg'); if (m) { m.className = 'hint'; m.textContent = 'Se încarcă ' + file.name + '…'; }
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('Fișierul e prea mare (cel mult 15 MB).');
      const type = file.type || (/\.docx$/i.test(file.name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : '');
      const d = await api('POST', { action: 'uploadFile', name: file.name, type, data: await readB64(file) });
      FILES = (FILES || []).concat(d.file).sort((a, b) => a.name.localeCompare(b.name)); fileMsg = `<span class="ok-msg">Încărcat: ${esc(d.file.name)}. Îl poți atașa la un șablon.</span>`;
    } catch (err) { fileMsg = `<span class="err-msg">${esc(/necunoscut/i.test(err.message) ? 'Scriptul Google e o versiune veche: actualizează-l (Code.gs) ca să poți încărca fișiere.' : /prea lung/i.test(err.message) ? 'Fișierul e prea mare pentru conexiunea de rezervă a acestui browser. Încearcă de pe laptop, din Chrome.' : err.message)}</span>`; }
    render();
  });
  document.addEventListener('input', onField);
  document.addEventListener('change', e => { if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') onField(e); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden && L) A['crm-close'](); });

  const ICON = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="7" y="2.5" width="10" height="16" rx="1.5"/><path d="M12 18.5v3M8.5 21.5h7"/></svg>',
    bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 17.5h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4.1-5.4 7.5-5.4s6.3 1.8 7.5 5.4"/></svg>'
  };

  /* ---------- Cheamă invitații: beculețele clipesc prin priza smart Shelly ----------
     Cât e pornit: la fiecare 2 s cerem „aprinde 1 secundă”; priza se stinge singură după o secundă.
     Dacă telefonul se blochează sau pierde netul, beculețele rămân stinse (nu rămân aprinse din greșeală). */
  const LT = { on: false, timer: null, err: '', info: null, busy: false, sent: 0, since: 0, lock: null, setupMsg: '' };
  async function lightsLoad() {
    if (!configured()) return;
    try { const d = await api('POST', { action: 'lightsInfo' }); LT.info = d; } catch (e) { LT.info = { configured: false, err: e.message }; }
    if (area === 'lumini' || area === 'home') rerender();
  }
  async function lightsTick() {
    if (!LT.on) return;
    const t0 = Date.now();
    try {
      const d = await window.WWNet.call(C.url, Object.assign({ action: 'lights', on: true, pulse: 1 }, C.key ? { key: C.key } : { token: C.token }), true);
      if (d && d.ok) { LT.sent++; LT.err = ''; }
      else if (d && d.busy) { /* trecem peste o clipire */ }
      else { LT.err = (d && d.error) || 'Comanda nu a ajuns la priză.'; if (d && (d.notConfigured || d.auth)) return lightsStop(true); }
    } catch (e) { LT.err = navigator.onLine ? 'Nu am putut trimite comanda: ' + e.message : 'Telefonul nu are internet.'; }
    if (area === 'lumini') lightsPaint();
    if (LT.on) LT.timer = setTimeout(lightsTick, Math.max(300, 2000 - (Date.now() - t0)));
  }
  async function lightsStart() {
    if (LT.on) return;
    LT.on = true; LT.err = ''; LT.sent = 0; LT.since = Date.now();
    try { if ('wakeLock' in navigator) LT.lock = await navigator.wakeLock.request('screen'); } catch (e) {}
    lightsPaint(); lightsTick();
  }
  async function lightsStop(keepErr) {
    LT.on = false; clearTimeout(LT.timer); LT.timer = null;
    try { LT.lock && LT.lock.release(); } catch (e) {} LT.lock = null;
    if (!keepErr) LT.err = '';
    lightsPaint();
    try { await api('POST', { action: 'lights', on: false }); } catch (e) {}
  }
  function lightsPaint() { const el = document.getElementById('ltBox'); if (el) el.innerHTML = lightsButton(); else if (area === 'home') rerender(); }
  function lightsButton() {
    const ready = LT.info && LT.info.configured;
    return `<button type="button" class="lt-btn${LT.on ? ' on' : ''}" data-act="lt-toggle" ${ready || LT.on ? '' : 'disabled'} aria-pressed="${LT.on}">
        <span class="lt-state">${LT.on ? 'ON' : 'OFF'}</span><span class="lt-sub">${LT.on ? 'Beculețele clipesc · apasă ca să oprești' : 'Apasă ca să chemi invitații'}</span></button>
      <p class="hint" style="text-align:center">${LT.on ? 'Ține ecranul deschis cât clipesc. Dacă închizi aplicația sau se blochează telefonul, beculețele se sting singure.' : ready ? 'Beculețele clipesc până apeși din nou.' : LT.info ? 'Configurează întâi priza (mai jos).' : 'Se verifică priza…'}</p>
      ${LT.err ? `<p class="hint err-msg" style="text-align:center">${esc(LT.err)}</p>` : ''}
      ${LT.info && LT.info.err ? `<p class="hint err-msg" style="text-align:center">${/necunoscut/i.test(LT.info.err) ? 'Scriptul Google e o versiune veche: actualizează-l (Code.gs) ca să poți folosi beculețele.' : esc(LT.info.err)}</p>` : ''}`;
  }
  function lightsView() {
    if (!LT.info) lightsLoad();
    const i = LT.info || {};
    return `${header('Cheamă invitații', 'WE WELCOME · Beculețe', true)}
      ${!configured() ? `<section class="panel"><p class="hint">Conectează întâi Evenimentele la Google Sheets (Evenimente → Conectare). Comanda pentru beculețe trece prin același script Google.</p></section>` : `
      <section class="panel lt-panel"><div id="ltBox">${lightsButton()}</div></section>
      ${isAdmin() ? `<section class="panel"><h2>Configurare priză</h2>
        <p class="hint">${i.configured ? `Priza e configurată: <b>${esc(i.deviceId)}</b> pe <b>${esc(i.host)}</b>. Completează din nou doar dacă schimbi priza sau cheia.` : 'Încă nu e configurată nicio priză.'}</p>
        <div class="row3">
          <div class="field"><label for="lt-host">Server Shelly</label><input class="inp" id="lt-host" placeholder="shelly-123-eu.shelly.cloud" value="${esc(i.host || '')}" autocapitalize="none" spellcheck="false"></div>
          <div class="field"><label for="lt-id">ID dispozitiv</label><input class="inp" id="lt-id" placeholder="ex. b48a0a1cd978" value="${esc(i.deviceId || '')}" autocapitalize="none" spellcheck="false"></div>
          <div class="field"><label for="lt-key">Cheie de autorizare (cloud)</label><input class="inp" id="lt-key" type="password" placeholder="${i.configured ? 'salvată · completează doar ca s-o schimbi' : 'cheia lungă din aplicația Shelly'}" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
        </div>
        <div class="btns"><button type="button" class="btn primary" data-act="lt-save">Salvează</button>
          <button type="button" class="btn" data-act="lt-test" ${i.configured ? '' : 'disabled'}>Test: aprinde 3 secunde</button>
          <span class="hint" id="ltMsg">${LT.setupMsg || ''}</span></div>
        <details class="hint" style="margin-top:14px"><summary><b>Cum pregătești priza (o singură dată)</b></summary>
          <ol style="margin:10px 0 0;padding-left:20px;display:grid;gap:6px">
            <li>Cumpără o priză <b>Shelly Plug S Gen3</b> (sau orice priză Shelly cu Wi-Fi) și un set de beculețe LED care se aprind direct când primesc curent (fără să trebuiască apăsat un buton).</li>
            <li>Instalează aplicația <b>Shelly Smart Control</b>, fă-ți cont și adaugă priza în rețeaua Wi-Fi.</li>
            <li>În aplicația Shelly: <b>Setări utilizator → Cheie de autorizare cloud</b> (Authorization cloud key). Copiază <b>cheia</b> și <b>serverul</b> afișat (de forma shelly-XXX-eu.shelly.cloud).</li>
            <li>La priză: <b>Setări → Informații dispozitiv → Device ID</b>. Copiază ID-ul.</li>
            <li>Pune-le aici, apasă <b>Salvează</b>, apoi <b>Test</b>: beculețele trebuie să se aprindă 3 secunde.</li>
            <li>La eveniment, priza trebuie să aibă internet: conecteaz-o la Wi-Fi-ul locației sau la hotspotul unui telefon (îl adaugi din aplicația Shelly înainte).</li>
          </ol></details>
      </section>` : ''}`}`;
  }

  window.CRM = {
    isAdmin() { if (!C) load(); return isAdmin(); },
    reloadAccounts() { accList = null; if (area === 'conturi') { const el = document.getElementById('accPanel'); if (el) { el.innerHTML = accountsPanel(); } } },
    pushAccounts() { if (!C) load(); return pushAccounts(false); },
    async deleteCloudAccount(id) { if (!C) load(); if (configured()) { try { await api('POST', { action: 'accountDel', id }); } catch (e) {} } },
    cloudStatus() {
      if (!C) load();
      if (!configured()) return 'Deocamdată contul merge doar pe acest dispozitiv. Conectează Evenimentele la Google Sheets (Evenimente → Conectare) și conturile de aici vor putea fi folosite de pe orice dispozitiv.';
      const cf = (C.accountConflicts || []);
      return (C.accountsAt ? `Conturile de pe acest dispozitiv sunt salvate în Google Sheet (ultima dată la ${esc(fmtDate(C.accountsAt))}): poți intra cu ele de pe orice telefon sau laptop.` : 'Conturile se salvează în Google Sheet la următoarea sincronizare.')
        + (cf.length ? ` <span class="warn-msg">Numele ${cf.map(esc).join(', ')} există deja în Google Sheet pentru alt cont; pe alte dispozitive se folosește acela.</span>` : '');
    },
    onLogin() { load(); view = 'cereri'; filter = 'Toate'; q = ''; note = ''; L = null; compose = null; if (configured() && navigator.onLine) sync(true); },
    render() { if (!C) load(); if (area !== 'conturi') accList = null; renderArea(); autoSync(); }
  };
})();
