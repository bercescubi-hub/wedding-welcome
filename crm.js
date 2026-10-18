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
      templates: Array.isArray(s.templates) && s.templates.length ? s.templates : clone(def.templates)
    };
  }
  function load() {
    C = LS.get(K()) || {};
    C.url = C.url || (window.WW_CONFIG || {}).scriptUrl || '';
    C.key = C.key || '';
    C.settings = merge(P.DEFAULT_SETTINGS, C.settings);
    C.leads = Array.isArray(C.leads) ? C.leads : [];
  }
  const save = () => LS.set(K(), C);
  const configured = () => !!(C.url && C.key);
  const formUrl = () => new URL('oferta.html', location.href).href;

  async function api(method, params) {
    let r;
    if (method === 'GET') r = await fetch(C.url + (C.url.includes('?') ? '&' : '?') + new URLSearchParams(Object.assign({}, params, { key: C.key })));
    else r = await fetch(C.url, { method: 'POST', body: JSON.stringify(Object.assign({}, params, { key: C.key })) });
    let d; try { d = await r.json(); } catch (e) { throw new Error('Răspuns neașteptat de la Google. Verifică adresa scriptului.'); }
    if (!d.ok) throw new Error(d.error || 'Eroare necunoscută');
    return d;
  }
  async function sync(quiet) {
    if (!configured()) return;
    busy = 'Se încarcă cererile din Google Sheets…'; if (!quiet) rerender();
    try {
      const d = await api('GET', { action: 'list' });
      C.leads = d.rows || []; C.account = d.account || C.account;
      if (d.settings) C.settings = merge(P.DEFAULT_SETTINGS, d.settings);
      else await api('POST', { action: 'settings', settings: C.settings });   // prima conectare: urcă prețurile implicite
      C.lastSync = new Date().toISOString(); save(); note = ''; setDirty = false;
    } catch (e) { note = navigator.onLine ? 'Nu am putut citi din Google Sheets: ' + e.message : 'Ești offline. Vezi ultimele cereri salvate pe laptop.'; noteOk = false; }
    busy = ''; rerender();
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
    const html = area === 'conturi' ? conturiView() : area === 'evenimente' ? eventsView() : hubView();
    $('#admin').innerHTML = `<div class="wrap">${html}</div>`;
  }
  function header(title, eyebrow, back) {
    return `<header class="top">
      <div>${back ? `<button type="button" class="crumb" data-act="area" data-k="home">‹ Administrare</button>` : ''}<p class="eyebrow-a">${eyebrow}</p><h1>${title}</h1></div>
      <div class="top-r"><span class="state-pill"><span class="dot${navigator.onLine ? '' : ' no'}"></span>${navigator.onLine ? 'Online' : 'Offline'}</span>
        <button type="button" class="state-pill" data-act="area" data-k="conturi">${esc(USER.username)}</button></div></header>`;
  }

  function hubView() {
    const leads = C.leads, nNew = leads.filter(l => (l.status || 'Nou') === 'Nou').length;
    const live = W.live && W.published ? 'LIVE acum' : W.published ? (JSON.stringify(W.draft) === JSON.stringify(W.published) ? 'Publicat' : 'Modificări nepublicate') : 'Nepublicat';
    return `${header('Bună, ' + esc(USER.username) + '!', 'Wedding Welcome · Administrare', false)}
      <div class="hub">
        <button type="button" class="hcard" data-act="area" data-k="evenimente">
          <span class="hic">${ICON.cal}</span><b>Evenimente</b>
          <span>${configured() ? `${leads.length} ${leads.length === 1 ? 'cerere' : 'cereri'}${nNew ? ` · <em>${nNew} ${nNew === 1 ? 'nouă' : 'noi'}</em>` : ''}` : 'Conectează Google Sheets'}</span>
          <small>Cereri de ofertă, prețuri, profit, emailuri</small></button>
        <button type="button" class="hcard" data-act="area" data-k="tool">
          <span class="hic">${ICON.screen}</span><b>Wedding Welcome</b>
          <span>${esc(W.draft.couple || 'Evenimentul tău')} · ${live}</span>
          <small>Ecranul invitaților: bun venit, mese, Photo Booth</small></button>
        <button type="button" class="hcard" data-act="area" data-k="conturi">
          <span class="hic">${ICON.user}</span><b>Conturi</b>
          <span>Contul tău</span>
          <small>Conturile clienților vin într-o versiune următoare</small></button>
      </div>
      <section class="panel">
        <h2>Linkul pentru clienți</h2>
        <p class="hint">Pune-l în anunțurile de pe Facebook și OLX. Cererile ajung în Google Sheets și le vezi în Evenimente.</p>
        ${linkBox()}
      </section>`;
  }
  function linkBox() {
    return `<div class="linkbox"><code>${esc(formUrl())}</code>
      <div class="btns"><button type="button" class="btn small" data-act="crm-copy" data-v="${esc(formUrl())}">Copiază</button>
      <a class="btn small" href="oferta.html" target="_blank" rel="noopener">Deschide</a></div></div>
      ${!(window.WW_CONFIG || {}).scriptUrl ? `<p class="hint warn-msg">Formularul se activează după conectarea la Google Sheets (Evenimente → Conectare).</p>` : ''}`;
  }

  function conturiView() {
    return `${header('Conturi', 'Administrare', true)}
      <section class="panel"><h2>Conturile clienților</h2>
        <p class="hint">Aici vor apărea conturile pe care le creezi pentru miri, ca să-și pregătească singuri invitații și videoclipurile. Vine într-o versiune următoare.</p></section>
      ${adminAccount()}`;
  }

  function eventsView() {
    const tabs = [['cereri', 'Cereri'], ['preturi', 'Prețuri și costuri'], ['sabloane', 'Șabloane email'], ['conectare', 'Conectare']];
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
    const rows = C.leads.map(l => ({ l, c: P.calc(l, S), st: l.status || 'Nou' }));
    const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
    const conf = rows.filter(r => r.st === 'Confirmat'), open = rows.filter(r => !['Confirmat', 'Refuzat'].includes(r.st));
    const qq = norm(q);
    const shown = rows.filter(r => (filter === 'Toate' || r.st === filter) && (!qq || norm([r.l.name, r.l.city, r.l.venue, r.l.email, r.l.phone].join(' ')).includes(qq)))
      .sort((a, b) => String(b.l.createdAt).localeCompare(String(a.l.createdAt)));
    const counts = {}; rows.forEach(r => counts[r.st] = (counts[r.st] || 0) + 1);
    return `<section class="kpis">
        <div class="kpi"><span>Cereri</span><b>${rows.length}</b><small>${counts['Nou'] || 0} noi</small></div>
        <div class="kpi"><span>În discuție</span><b>${lei(sum(open, r => r.c.total))}</b><small>${open.length} ${open.length === 1 ? 'eveniment' : 'evenimente'}</small></div>
        <div class="kpi"><span>Confirmate</span><b>${lei(sum(conf, r => r.c.total))}</b><small>${conf.length} ${conf.length === 1 ? 'eveniment' : 'evenimente'}</small></div>
        <div class="kpi"><span>Profit confirmat</span><b>${lei(sum(conf, r => r.c.profit))}</b><small>estimat, după costuri</small></div>
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
          : `<p class="hint" style="padding:18px 0">${rows.length ? 'Nicio cerere pentru filtrul ales.' : 'Nicio cerere încă. Trimite linkul pentru clienți și cererile vor apărea aici.'}</p>`}
      </section>
      <section class="panel"><h2>Linkul pentru clienți</h2>${linkBox()}</section>`;
  }

  /* ---------- fișa unei cereri ---------- */
  function openLead(id) {
    const l = C.leads.find(x => x.id === id); if (!l) return;
    L = clone(l); L.status = L.status || 'Nou'; L.discountType = L.discountType === 'lei' ? 'lei' : '%';
    L.outside = P.yes(L.outside) ? 'da' : 'nu'; L.staffMenuByClient = P.yes(L.staffMenuByClient) ? 'da' : 'nu';
    compose = null; renderLead();
  }
  function breakdown() {
    const S = C.settings, c = P.calc(L, S);
    const row = (a, b, cls) => `<div class="${cls || ''}"><span>${a}</span><b>${b}</b></div>`;
    return `<div class="calc">
      <div class="sum">
        ${row('Pachet ' + esc(c.pkg ? c.pkg.name : '—') + (c.pkg ? ` · ${c.hours >= 8 ? 'toată noaptea' : c.hours + ' ore'}` : ''), lei(c.price))}
        ${row(c.outside ? `Transport · ${c.billedKm} km × ${lei(S.pricing.kmRate)}` : 'Transport (București-Ilfov)', lei(c.transport))}
        ${c.discount ? row('Reducere' + (L.discountType === '%' ? ` ${num(L.discountValue)}%` : ''), '− ' + lei(c.discount)) : ''}
        ${row('Total client', lei(c.total), 'tot')}
      </div>
      <div class="sum">
        ${row(`Staff · ${num(S.costs.staffCount)} pers. × ${c.hours + num(S.costs.setupHours)} h × ${lei(S.costs.staffRate)}`, lei(c.staff))}
        ${c.pkg && c.pkg.staffMenu ? row(P.yes(L.staffMenuByClient) ? 'Meniu staff · oferit de client' : `Meniu staff · ${num(S.costs.staffCount)} × ${lei(S.costs.menuCost)}`, lei(c.menu)) : ''}
        ${c.outside ? row(`Combustibil · ${c.km * 2} km dus-întors`, lei(c.fuel)) : ''}
        ${c.consumables ? row('Consumabile Photo Booth', lei(c.consumables)) : ''}
        ${row('Echipament (uzură)', lei(c.equipment))}
        ${row('Profit estimat' + (c.total ? ` · ${Math.round(c.margin * 100)}%` : ''), lei(c.profit), 'tot ' + (c.profit < 0 ? 'neg' : 'pos'))}
      </div></div>`;
  }
  function renderLead() {
    const S = C.settings;
    if (compose) return renderCompose();
    $('#modal').innerHTML = `<div class="sheet wide" role="dialog" aria-modal="true" aria-labelledby="ldT">
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
      ${L.clientMessage ? `<p class="note" style="border-style:solid">„${esc(L.clientMessage)}”</p>` : ''}
      <div class="row2">
        <div class="field"><label for="l-st">Status</label><select class="inp" id="l-st" data-l="status">${P.STATUSES.map(s => `<option ${s === L.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label for="l-pk">Pachet</label><select class="inp" id="l-pk" data-l="package">${S.packages.map(p => `<option value="${esc(p.id)}" ${P.pkgOf(S, L.package) === p ? 'selected' : ''}>${esc(p.name)} · ${lei(p.price)}</option>`).join('')}</select></div>
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
      <div id="calcBox">${breakdown()}</div>
      <div class="field"><label for="l-notes">Note interne (nu le vede clientul)</label><textarea class="inp" id="l-notes" data-l="notes" rows="3" style="min-height:70px">${esc(L.notes || '')}</textarea></div>
      <p class="hint" id="ldMsg">${esc(L._msg || '')}</p>
      <div class="btns" style="justify-content:flex-end">
        <button type="button" class="btn" data-act="crm-compose" ${L.email ? '' : 'disabled title="Cererea nu are email"'}>Trimite email</button>
        <button type="button" class="btn primary" data-act="crm-save">Salvează în Google Sheets</button></div>
    </div>`;
    $('#modal').hidden = false;
  }
  function leadFields() {
    const c = P.calc(L, C.settings);
    return { status: L.status, package: c.pkg ? c.pkg.id : L.package, outside: L.outside, km: String(num(L.km)), transport: String(c.transport), packagePrice: String(c.price),
      discountType: L.discountType, discountValue: String(num(L.discountValue)), total: String(c.total), cost: String(c.cost), profit: String(c.profit),
      staffMenuByClient: L.staffMenuByClient, notes: L.notes || '' };
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
  function fill(t, l) {
    const S = C.settings, c = P.calc(l, S);
    const n0 = v => Math.round(num(v)).toLocaleString('ro-RO');
    const map = {
      prenume: String(l.name || '').trim().split(/\s+/)[0] || '', nume_complet: l.name || '', data_eveniment: fmtDLong(l.eventDate),
      localitate: l.city || '', locatie: l.venue || l.city || '', locatie_completa: place(l) || l.city || '',
      pachet: c.pkg ? c.pkg.name : '', ore: c.hours >= 8 ? 'toată noaptea' : c.hours + ' ore',
      pret_pachet: n0(c.price), transport: n0(c.transport), km: String(c.billedKm), reducere: n0(c.discount), total: n0(c.total),
      expeditor: S.email.fromName || '', invitati: l.guests || ''
    };
    return String(t || '').replace(/\{(\w+)\}/g, (m, k) => k in map ? map[k] : m);
  }
  function startCompose(tplId) {
    const S = C.settings, t = S.templates.find(x => x.id === tplId) || S.templates[0];
    compose = { tpl: t ? t.id : '', to: L.email || '', subject: fill(t && t.subject, L), body: fill(t && t.body, L), newStatus: t ? t.status : '', sending: false, err: '' };
    renderCompose();
  }
  function renderCompose() {
    const S = C.settings;
    $('#modal').innerHTML = `<div class="sheet wide" role="dialog" aria-modal="true" aria-labelledby="cpT">
      <div class="shead"><div><p class="eyebrow-a">Email către ${esc(L.name)}</p><h2 id="cpT">Trimite email</h2></div>
        <button type="button" class="x" data-act="crm-close" aria-label="Închide">×</button></div>
      <div class="row2">
        <div class="field"><label for="cp-t">Șablon</label><select class="inp" id="cp-t">${S.templates.map(t => `<option value="${esc(t.id)}" ${t.id === compose.tpl ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
        <div class="field"><label>De la</label><p class="from">${esc(S.email.fromName)} &lt;${esc(S.email.fromEmail)}&gt;</p></div>
      </div>
      <div class="field"><label for="cp-to">Către</label><input class="inp" id="cp-to" value="${esc(compose.to)}"></div>
      <div class="field"><label for="cp-s">Subiect</label><input class="inp" id="cp-s" value="${esc(compose.subject)}"></div>
      <div class="field"><label for="cp-b">Mesaj</label><textarea class="inp" id="cp-b" rows="12" style="min-height:260px">${esc(compose.body)}</textarea></div>
      ${compose.newStatus ? `<p class="hint">După trimitere, statusul devine <b>${esc(compose.newStatus)}</b>.</p>` : ''}
      ${compose.err ? `<p class="hint err-msg">${esc(compose.err)}</p>` : ''}
      <div class="btns" style="justify-content:flex-end"><button type="button" class="btn" data-act="crm-compose-back" ${compose.sending ? 'disabled' : ''}>Înapoi la cerere</button>
        <button type="button" class="btn primary" data-act="crm-send" ${compose.sending ? 'disabled' : ''}>${compose.sending ? 'Se trimite…' : 'Trimite'}</button></div>
    </div>`;
    $('#modal').hidden = false;
  }
  async function send() {
    compose.to = $('#cp-to').value.trim(); compose.subject = $('#cp-s').value; compose.body = $('#cp-b').value;
    compose.sending = true; compose.err = ''; renderCompose();
    const S = C.settings, t = S.templates.find(x => x.id === compose.tpl);
    try {
      // salvăm întâi prețul calculat, ca Sheet-ul să conțină exact ce i-am trimis clientului
      const f = leadFields(); await api('POST', { action: 'update', id: L.id, fields: f });
      const d = await api('POST', { action: 'email', id: L.id, to: compose.to, subject: compose.subject, body: compose.body,
        fromEmail: S.email.fromEmail, fromName: S.email.fromName, template: t ? t.name : 'email', newStatus: compose.newStatus || '' });
      const i = C.leads.findIndex(x => x.id === L.id);
      if (i >= 0) { Object.assign(C.leads[i], f, { lastEmail: d.lastEmail }); if (compose.newStatus) C.leads[i].status = compose.newStatus; }
      Object.assign(L, f, { lastEmail: d.lastEmail }); if (compose.newStatus) L.status = compose.newStatus;
      save(); compose = null; L._msg = `Email trimis de la ${d.sentFrom || S.email.fromEmail}.`; renderLead(); rerender();
    } catch (e) { compose.sending = false; compose.err = 'Nu am putut trimite: ' + e.message; renderCompose(); }
  }

  /* ---------- Prețuri și costuri ---------- */
  function pricesView() {
    const S = C.settings;
    const f = (path, label, val, suf, type) => `<div class="field"><label>${label}</label><div class="suf"><input class="inp" data-s="${path}" data-num="1" inputmode="decimal" value="${esc(val)}">${suf ? `<span>${suf}</span>` : ''}</div></div>`;
    return `<section class="panel">
        <h2>Pachete</h2><p class="hint">Apar în formularul public, în această ordine. Prețurile sunt fictive până le schimbi.</p>
        ${S.packages.map((p, i) => `<div class="cat">
          <div class="cat-head"><input class="inp" data-s="packages.${i}.name" value="${esc(p.name)}" aria-label="Numele pachetului">
            ${S.packages.length > 1 ? `<button type="button" class="x" data-act="crm-delpkg" data-i="${i}" aria-label="Șterge pachetul">×</button>` : ''}</div>
          <div class="row3">${f(`packages.${i}.price`, 'Preț', p.price, 'lei')}${f(`packages.${i}.hours`, 'Durată', p.hours, 'ore')}
            <div class="field"><label>Include</label><div class="mods-in">${Object.entries(P.MODULE_NAMES).map(([k, n]) => `<label class="tog"><input type="checkbox" data-s="packages.${i}.modules" data-m="${k}" ${p.modules.includes(k) ? 'checked' : ''}> ${n}</label>`).join('')}</div></div></div>
          <label class="tog"><input type="checkbox" data-s="packages.${i}.staffMenu" ${p.staffMenu ? 'checked' : ''}> Stăm toată noaptea (se socotește meniu pentru staff)</label>
        </div>`).join('')}
        <div class="btns"><button type="button" class="btn" data-act="crm-addpkg">+ Adaugă pachet</button></div>
      </section>
      <section class="panel"><h2>Transport</h2>
        <div class="row3">${f('pricing.kmRate', 'Tarif pentru client', S.pricing.kmRate, 'lei/km')}
          <div class="field"><label>&nbsp;</label><label class="tog"><input type="checkbox" data-s="pricing.roundTrip" ${S.pricing.roundTrip ? 'checked' : ''}> Facturez dus-întors</label></div></div>
        <p class="hint">Se aplică doar în afara Bucureștiului și Ilfovului. Formularul estimează km de la București până la reședința județului; corectezi distanța exactă în fiecare cerere.</p>
      </section>
      <section class="panel"><h2>Costuri (pentru calculul profitului)</h2>
        <div class="row3">${f('costs.staffCount', 'Staff', S.costs.staffCount, 'persoane')}${f('costs.staffRate', 'Plată staff', S.costs.staffRate, 'lei/oră/pers.')}${f('costs.setupHours', 'Montaj + demontaj', S.costs.setupHours, 'ore')}</div>
        <div class="row3">${f('costs.menuCost', 'Meniu staff (toată noaptea)', S.costs.menuCost, 'lei/pers.')}${f('costs.fuelPerKm', 'Combustibil', S.costs.fuelPerKm, 'lei/km')}${f('costs.boothConsumables', 'Consumabile Photo Booth', S.costs.boothConsumables, 'lei/ev.')}</div>
        <div class="row3">${f('costs.equipment', 'Uzură echipament', S.costs.equipment, 'lei/ev.')}</div>
        <p class="hint">Costurile nu apar în formularul public și nici în emailuri.</p>
      </section>
      ${saveBar()}`;
  }
  function saveBar() {
    return `<section class="panel savebar"><p class="hint" id="setMsg">${setDirty ? 'Ai modificări nesalvate în Google Sheets.' : (configured() ? 'Totul e salvat.' : 'Se păstrează pe acest laptop. Conectează Google Sheets ca să ajungă și în formularul public.')}</p>
      <div class="btns">${configured() ? `<button type="button" class="btn primary" data-act="crm-savesettings">Salvează în Google Sheets</button>` : ''}
      <button type="button" class="btn danger small" data-act="crm-resetsettings">Revino la valorile implicite</button></div></section>`;
  }

  /* ---------- Șabloane ---------- */
  function templatesView() {
    const S = C.settings;
    const ph = ['prenume', 'nume_complet', 'data_eveniment', 'locatie_completa', 'localitate', 'pachet', 'ore', 'pret_pachet', 'transport', 'km', 'reducere', 'total', 'invitati', 'expeditor'];
    return `<section class="panel"><h2>Expeditor</h2>
        <div class="row2"><div class="field"><label>Emailul din care pleacă mesajele</label><input class="inp" type="email" data-s="email.fromEmail" value="${esc(S.email.fromEmail)}"></div>
          <div class="field"><label>Numele afișat</label><input class="inp" data-s="email.fromName" value="${esc(S.email.fromName)}"></div></div>
        <p class="hint">Emailurile pleacă din contul Google care a publicat scriptul${C.account ? ` (<b>${esc(C.account)}</b>)` : ''}. O altă adresă merge doar dacă e adăugată în acel Gmail la „Trimite mesaje ca”. Gmail permite cam 100 de emailuri pe zi din script.</p>
        ${C.account && S.email.fromEmail && C.account.toLowerCase() !== S.email.fromEmail.toLowerCase() ? `<p class="hint warn-msg">Atenție: scriptul rulează pe ${esc(C.account)}, dar expeditorul ales e ${esc(S.email.fromEmail)}.</p>` : ''}
      </section>
      <section class="panel"><h2>Șabloane</h2>
        <p class="hint">Câmpuri pe care le completez automat: ${ph.map(p => `<code>{${p}}</code>`).join(' ')}</p>
        ${S.templates.map((t, i) => `<div class="cat">
          <div class="cat-head"><input class="inp" data-s="templates.${i}.name" value="${esc(t.name)}" aria-label="Numele șablonului">
            ${S.templates.length > 1 ? `<button type="button" class="x" data-act="crm-deltpl" data-i="${i}" aria-label="Șterge șablonul">×</button>` : ''}</div>
          <div class="field"><label>Subiect</label><input class="inp" data-s="templates.${i}.subject" value="${esc(t.subject)}"></div>
          <div class="field"><label>Mesaj</label><textarea class="inp" data-s="templates.${i}.body" rows="8" style="min-height:180px">${esc(t.body)}</textarea></div>
          <div class="field" style="max-width:320px"><label>După trimitere, statusul devine</label><select class="inp" data-s="templates.${i}.status">
            <option value="" ${!t.status ? 'selected' : ''}>(nu se schimbă)</option>${P.STATUSES.map(s => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        </div>`).join('')}
        <div class="btns"><button type="button" class="btn" data-act="crm-addtpl">+ Adaugă șablon</button></div>
      </section>
      ${saveBar()}`;
  }

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
  async function saveSettingsRemote() {
    const m = $('#setMsg'); if (m) m.textContent = 'Se salvează…';
    try { await api('POST', { action: 'settings', settings: C.settings }); setDirty = false; save(); if (m) { m.textContent = 'Salvat. Formularul public folosește acum aceste prețuri.'; m.className = 'hint ok-msg'; } }
    catch (e) { if (m) { m.textContent = 'Nu am putut salva: ' + e.message; m.className = 'hint err-msg'; } }
  }
  Object.assign(A, {
    'crm-view'(el) { view = el.dataset.k; note = ''; render(); window.scrollTo(0, 0); },
    'crm-filter'(el) { filter = el.dataset.k; render(); },
    'crm-sync'() { sync(); },
    'crm-open'(el) { openLead(el.dataset.id); },
    'crm-close'() { $('#modal').hidden = true; L = null; compose = null; },
    'crm-save'() { saveLead(); },
    'crm-compose'() { startCompose((C.settings.templates[0] || {}).id); },
    'crm-compose-back'() { compose = null; renderLead(); },
    'crm-send'() { send(); },
    async 'crm-copy'(el) { try { await navigator.clipboard.writeText(el.dataset.v); el.textContent = 'Copiat!'; } catch (e) { el.textContent = 'Selectează și copiază'; } setTimeout(() => { el.textContent = 'Copiază'; }, 1800); },
    async 'crm-copyscript'(el) { try { const t = await (await fetch('google-apps-script/Code.gs', { cache: 'no-cache' })).text(); await navigator.clipboard.writeText(t); el.textContent = 'Copiat!'; } catch (e) { el.textContent = 'Deschide „Vezi scriptul”'; } },
    async 'crm-connect'() {
      C.url = $('#cn-url').value.trim(); C.key = $('#cn-key').value; save();
      const m = $('#cnMsg'); m.className = 'hint'; m.textContent = 'Se testează…';
      if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(C.url)) { m.className = 'hint err-msg'; m.textContent = 'Adresa trebuie să înceapă cu https://script.google.com/…'; return; }
      try { const d = await api('GET', { action: 'ping' }); C.account = d.account; save(); m.className = 'hint ok-msg'; m.innerHTML = `Conectat la contul Google <b>${esc(d.account || '')}</b>. Se încarcă cererile…`; await sync(true); view = 'cereri'; render(); }
      catch (e) { m.className = 'hint err-msg'; m.textContent = 'Nu merge: ' + e.message; }
    },
    'crm-savesettings'() { saveSettingsRemote(); },
    'crm-resetsettings'() { C.settings = merge(P.DEFAULT_SETTINGS, null); setDirty = true; save(); render(); },
    'crm-addpkg'() { C.settings.packages.push({ id: 'p' + Date.now().toString(36), name: 'Pachet nou', hours: 4, price: 2000, modules: ['welcome', 'seating'], staffMenu: false, desc: '' }); setDirty = true; save(); render(); },
    'crm-delpkg'(el) { C.settings.packages.splice(+el.dataset.i, 1); setDirty = true; save(); render(); },
    'crm-addtpl'() { C.settings.templates.push({ id: 't' + Date.now().toString(36), name: 'Șablon nou', status: '', subject: '', body: 'Bună, {prenume}!\n\n\n\n{expeditor}' }); setDirty = true; save(); render(); },
    'crm-deltpl'(el) { C.settings.templates.splice(+el.dataset.i, 1); setDirty = true; save(); render(); }
  });

  /* câmpuri: setări (data-s), cererea deschisă (data-l), căutare, șablon */
  function onField(e) {
    const t = e.target;
    if (t.dataset.s !== undefined) {
      const path = t.dataset.s;
      if (t.dataset.m) { const arr = getPath(C.settings, path); const i = arr.indexOf(t.dataset.m); if (t.checked && i < 0) arr.push(t.dataset.m); if (!t.checked && i >= 0) arr.splice(i, 1); }
      else if (t.type === 'checkbox') setPath(C.settings, path, t.checked);
      else setPath(C.settings, path, t.dataset.num ? P.num(t.value) : t.value);
      setDirty = true; save();
      const m = $('#setMsg'); if (m && configured()) { m.textContent = 'Ai modificări nesalvate în Google Sheets.'; m.className = 'hint'; }
      return;
    }
    if (t.dataset.l !== undefined && L) {
      const k = t.dataset.l;
      L[k] = t.type === 'checkbox' ? (t.checked ? 'da' : 'nu') : t.value;
      if (k === 'outside') { const km = $('#l-km'); km.disabled = !t.checked; if (t.checked && !num(L.km)) { L.km = String(P.estimateKm(L.county)); km.value = L.km || ''; } }
      const b = $('#calcBox'); if (b) b.innerHTML = breakdown();
      return;
    }
    if (t.id === 'crmQ' && e.type === 'input') { q = t.value; const pos = t.selectionStart; render(); const n = $('#crmQ'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} } }
    if (t.id === 'cp-t' && e.type === 'change' && compose) { const tpl = C.settings.templates.find(x => x.id === t.value); compose.tpl = t.value; compose.subject = fill(tpl.subject, L); compose.body = fill(tpl.body, L); compose.newStatus = tpl.status; compose.to = $('#cp-to').value; renderCompose(); }
  }
  document.addEventListener('input', onField);
  document.addEventListener('change', e => { if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') onField(e); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden && L) A['crm-close'](); });

  const ICON = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="7" y="2.5" width="10" height="16" rx="1.5"/><path d="M12 18.5v3M8.5 21.5h7"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4.1-5.4 7.5-5.4s6.3 1.8 7.5 5.4"/></svg>'
  };

  window.CRM = {
    onLogin() { load(); view = 'cereri'; filter = 'Toate'; q = ''; note = ''; L = null; compose = null; if (configured() && navigator.onLine) sync(true); },
    render() { if (!C) load(); renderArea(); if (area === 'evenimente' && view === 'cereri' && configured() && !C.lastSync && !busy) sync(); }
  };
})();
