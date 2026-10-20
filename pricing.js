/* Wedding Welcome — prețuri, transport și calculul costurilor.
   Folosit și de formularul public (oferta.html), și de aplicație (Evenimente), ca să calculeze la fel.
   Valorile de mai jos sunt cele implicite (fictive); cele reale se modifică din aplicație → Evenimente → Prețuri și costuri. */
(function (g) {
  const DEFAULT_SETTINGS = {
    packages: [
      { id: 'esential', name: 'Esențial', hours: 3, price: 1500, modules: ['welcome', 'seating'], staffMenu: false,
        desc: 'Primirea invitaților: mesajul vostru de bun venit și găsirea mesei.' },
      { id: 'complet', name: 'Complet', hours: 5, price: 2500, modules: ['welcome', 'seating', 'booth'], staffMenu: false, recommended: true,
        desc: 'Toată experiența pentru primele ore ale petrecerii.' },
      { id: 'allnight', name: 'All Night', hours: 10, price: 3300, modules: ['welcome', 'seating', 'booth'], staffMenu: true, album: true,
        desc: 'Toată experiența, pe toată durata petrecerii.' }
    ],
    /* TVA stă la „pricing” ca să ajungă și în formularul public (prețul afișat clientului); restul taxelor sunt interne, la „costs”. */
    pricing: { kmRate: 2.5, roundTrip: true, maxKm: 300, vatPayer: true, vatRate: 21, pricesIncludeVat: true, albumPrice: 300 },
    costs: { staffCount: 2, staffRate: 60, setupHours: 1, menuCost: 250, fuelPerKm: 1, boothConsumables: 250, equipment: 100, albumCost: 0,
      incomeTax: 1, payFee: 0, invoiceFixed: 0 },
    email: { fromEmail: 'bercescubi@gmail.com', fromName: 'Wedding Welcome' },
    templates: [
      { id: 'oferta', name: 'Ofertă', status: 'Ofertă trimisă', subject: 'Oferta Wedding Welcome pentru {data_eveniment}',
        body: 'Bună, {prenume}!\n\nVă mulțumim pentru interesul arătat. Pentru evenimentul din {data_eveniment}, de la {locatie_completa}, vă propunem pachetul {pachet} ({ore}).\n\nPachet: {pret_pachet} lei\nTransport: {transport} lei\nReducere: {reducere} lei\nTotal: {total} lei\n\nOferta este valabilă 14 zile. Pentru rezervare, vă rugăm să ne confirmați pe email (răspunzând la acest mesaj) sau pe WhatsApp.\n\nCu drag,\n{expeditor}\nTelefon / WhatsApp: {telefoane}' },
      { id: 'confirmare', name: 'Confirmare rezervare', status: 'Confirmat', subject: 'Rezervarea pentru {data_eveniment} este confirmată',
        body: 'Bună, {prenume}!\n\nVă confirmăm rezervarea pachetului {pachet} pentru {data_eveniment}, la {locatie_completa}. Total: {total} lei.\n\nCu câteva săptămâni înainte vă vom cere lista invitaților cu mesele și videoclipurile pentru mesajul de bun venit.\n\nVă mulțumim!\n{expeditor}' },
      { id: 'revenire', name: 'Revenire', status: '', subject: 'Ați avut ocazia să vă uitați pe ofertă?',
        body: 'Bună, {prenume}!\n\nRevin cu privire la oferta pentru {data_eveniment}. Dacă aveți întrebări sau doriți să ajustăm pachetul, sunt aici.\n\nCu drag,\n{expeditor}' }
    ]
  };
  const STATUSES = ['Nou', 'Contactat', 'Ofertă trimisă', 'Confirmat', 'Refuzat'];
  const MODULE_NAMES = { welcome: 'Mesaj de bun venit', seating: 'Găsește-ți masa', booth: 'Photo Booth' };

  /* Reședințele de județ (aprox.), pentru estimarea distanței de la București. */
  const COUNTIES = {
    'București': [44.43, 26.10], 'Ilfov': [44.50, 26.10], 'Alba': [46.07, 23.58], 'Arad': [46.18, 21.31], 'Argeș': [44.86, 24.87],
    'Bacău': [46.57, 26.91], 'Bihor': [47.07, 21.92], 'Bistrița-Năsăud': [47.13, 24.49], 'Botoșani': [47.75, 26.67], 'Brașov': [45.65, 25.60],
    'Brăila': [45.27, 27.96], 'Buzău': [45.15, 26.82], 'Caraș-Severin': [45.30, 21.89], 'Călărași': [44.20, 27.33], 'Cluj': [46.77, 23.59],
    'Constanța': [44.18, 28.65], 'Covasna': [45.86, 25.79], 'Dâmbovița': [44.93, 25.46], 'Dolj': [44.32, 23.80], 'Galați': [45.44, 28.05],
    'Giurgiu': [43.90, 25.97], 'Gorj': [45.04, 23.27], 'Harghita': [46.36, 25.80], 'Hunedoara': [45.88, 22.90], 'Ialomița': [44.56, 27.37],
    'Iași': [47.16, 27.59], 'Maramureș': [47.66, 23.58], 'Mehedinți': [44.63, 22.66], 'Mureș': [46.54, 24.56], 'Neamț': [46.93, 26.37],
    'Olt': [44.43, 24.37], 'Prahova': [44.94, 26.03], 'Satu Mare': [47.79, 22.89], 'Sălaj': [47.19, 23.06], 'Sibiu': [45.80, 24.15],
    'Suceava': [47.65, 26.26], 'Teleorman': [43.97, 25.33], 'Timiș': [45.75, 21.23], 'Tulcea': [45.18, 28.80], 'Vaslui': [46.64, 27.73],
    'Vâlcea': [45.10, 24.37], 'Vrancea': [45.70, 27.18]
  };
  const isLocal = county => county === 'București' || county === 'Ilfov';
  /** Km pe șosea, estimați: distanța în linie dreaptă × 1,25, rotunjit la 5 km. */
  function estimateKm(county) {
    if (!county || isLocal(county) || !COUNTIES[county]) return 0;
    const [a, b] = [COUNTIES['București'], COUNTIES[county]], R = 6371, r = x => x * Math.PI / 180;
    const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.25 / 5) * 5;
  }
  /** Peste această distanță (km de la București) zona nu e acoperită: ofertă doar la cerere. 0 = fără limită. */
  const outOfArea = (km, S) => { const m = +((S && S.pricing && S.pricing.maxKm) || 0); return m > 0 && +km > m; };
  const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.').replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : 0; };
  const yes = v => v === true || /^(da|true|1|yes)$/i.test(String(v ?? '').trim());
  /** Albumul foto: inclus în pachetul marcat (implicit All Night); la celelalte pachete cu Photo Booth se adaugă la cerere. */
  const albumIncluded = p => !!p && p.modules.includes('booth') && (p.album === true || (p.album === undefined && p.id === 'allnight'));
  function pkgOf(S, id) { return S.packages.find(p => p.id === id) || S.packages.find(p => p.name === id) || null; }
  /** Prețul pentru client, costurile și profitul unei cereri. */
  function calc(lead, S) {
    const p = pkgOf(S, lead.package);
    const price = p ? num(p.price) : 0, hours = p ? num(p.hours) : 0;
    const outside = yes(lead.outside), km = num(lead.km);
    const billedKm = outside ? km * (S.pricing.roundTrip ? 2 : 1) : 0;
    const transport = Math.round(billedKm * num(S.pricing.kmRate));
    const hasBooth = !!(p && p.modules.includes('booth')), albumIncl = albumIncluded(p);
    const albumExtra = hasBooth && !albumIncl && yes(lead.album) ? Math.round(num(S.pricing.albumPrice)) : 0;
    const album = albumIncl ? 'inclus' : albumExtra ? 'extra' : 'nu';
    const subtotal = price + transport + albumExtra;
    const dv = num(lead.discountValue);
    const discount = Math.min(subtotal, Math.round(lead.discountType === 'lei' ? dv : subtotal * dv / 100));
    const base = subtotal - discount;
    /* TVA: dacă prețurile o includ, o scoatem din total; dacă nu, se adaugă peste. */
    const Pr = S.pricing, vr = Pr.vatPayer ? num(Pr.vatRate) : 0;
    const total = Pr.vatPayer && !Pr.pricesIncludeVat ? Math.round(base * (1 + vr / 100)) : base;
    const vat = Pr.vatPayer ? (Pr.pricesIncludeVat ? Math.round(base * vr / (100 + vr)) : total - base) : 0;
    const net = total - vat;
    const C = S.costs;
    const staff = Math.round(num(C.staffCount) * num(C.staffRate) * (hours + num(C.setupHours)));
    const menu = p && p.staffMenu && !yes(lead.staffMenuByClient) ? Math.round(num(C.staffCount) * num(C.menuCost)) : 0;
    const fuel = outside ? Math.round(km * 2 * num(C.fuelPerKm)) : 0;
    const consumables = p && p.modules.includes('booth') ? num(C.boothConsumables) : 0;
    const equipment = p ? num(C.equipment) : 0;
    const albumCost = album !== 'nu' ? num(C.albumCost) : 0;
    const cost = staff + menu + fuel + consumables + equipment + albumCost;
    /* taxe și costuri de facturare: impozit pe venit (fără TVA), comision la încasare, cost fix pe factură */
    const incomeTax = Math.round(net * num(C.incomeTax) / 100);
    const payFee = Math.round(total * num(C.payFee) / 100);
    const invoiceFee = p ? Math.round(num(C.invoiceFixed)) : 0;
    const taxes = vat + incomeTax + payFee + invoiceFee;
    const profit = total - cost - taxes;
    return { outOfArea: outOfArea(km, S), pkg: p, price, hours, outside, km, billedKm, transport, subtotal, discount, base, total, vat, vatRate: vr, vatIncluded: !!(Pr.vatPayer && Pr.pricesIncludeVat), net,
      album, albumExtra, albumCost, hasBooth, staff, menu, fuel, consumables, equipment, cost, incomeTax, payFee, invoiceFee, taxes, profit, margin: net ? profit / net : 0 };
  }
  const lei = n => Math.round(num(n)).toLocaleString('ro-RO') + ' lei';
  /** Tarif cu zecimale (ex. 2,5 lei), pentru lei/km. */
  const leiRate = n => num(n).toLocaleString('ro-RO', { maximumFractionDigits: 2 }) + ' lei';
  /** Apel JSONP către scriptul Google: ocolește blocările de tip CORS. */
  g.WWJsonp = function (url, payload) {
    return new Promise((resolve, reject) => {
      const cb = '__ww' + Date.now().toString(36) + Math.floor(Math.random() * 1e6);
      const src = url + (url.includes('?') ? '&' : '?') + 'payload=' + encodeURIComponent(JSON.stringify(payload)) + '&callback=' + cb;
      if (src.length > 14000) return reject(new Error('Mesajul e prea lung pentru conexiunea de rezervă. Scurtează textul.'));
      const s = document.createElement('script'); let done = false;
      const end = () => { done = true; clearTimeout(t); delete g[cb]; s.remove(); };
      const t = setTimeout(() => { if (!done) { end(); reject(new Error('Google nu a răspuns. Verifică internetul și dacă scriptul e publicat cu acces „Oricine”.')); } }, 15000);
      g[cb] = d => { end(); resolve(d); };
      s.onerror = () => { if (!done) { end(); reject(new Error('Google a răspuns cu o pagină de eroare în loc de date. De obicei scriptul cere o autorizare nouă: în Apps Script alege funcția „setup”, apasă Run și acceptă permisiunile, apoi Deploy → Manage deployments → creion → New version → Deploy.')); } };
      s.src = src; document.head.appendChild(s);
    });
  };
  /** Apel printr-o fereastră invizibilă: un formular clasic trimis către script, iar scriptul răspunde cu postMessage.
      Merge și pe iPhone/Safari, unde cererile din pagină către Google sunt blocate. */
  g.WWFrame = function (url, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      const nonce = 'f' + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36), name = 'wwf_' + nonce;
      const ifr = document.createElement('iframe'); ifr.name = name; ifr.title = 'conexiune'; ifr.setAttribute('aria-hidden', 'true');
      ifr.style.cssText = 'position:absolute;width:1px;height:1px;border:0;left:-9999px;top:0';
      const form = document.createElement('form'); form.method = 'POST'; form.action = url; form.target = name; form.style.display = 'none';
      form.acceptCharset = 'UTF-8';
      [['payload', JSON.stringify(payload)], ['via', 'frame'], ['nonce', nonce]].forEach(([k, v]) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; form.appendChild(i); });
      let done = false;
      const end = () => { done = true; clearTimeout(t); g.removeEventListener('message', onMsg); setTimeout(() => { ifr.remove(); form.remove(); }, 1500); };
      const onMsg = ev => {
        let host = ''; try { host = new URL(ev.origin).hostname; } catch (_) {}
        if (!/(^|\.)googleusercontent\.com$|^script\.google\.com$/.test(host)) return;
        const m = ev.data; if (!m || m.__ww !== nonce) return;
        end(); resolve(m.data);
      };
      const t = setTimeout(() => { if (!done) { end(); reject(new Error('fereastra: fără răspuns de la Google')); } }, timeoutMs || 12000);
      g.addEventListener('message', onMsg);
      document.body.appendChild(ifr); document.body.appendChild(form); form.submit();
    });
  };
  /** Canalul către scriptul Google. Află o singură dată (cu o citire inofensivă) ce cale merge pe acest dispozitiv:
      cerere directă, JSONP sau fereastră invizibilă, și o folosește apoi pentru tot, ca nimic să nu se trimită de două ori. */
  g.WWNet = {
    mode: null, url: '', tried: [],
    async via(m, url, payload, write) {
      if (m === 'fetch') {
        const r = write ? await fetch(url, { method: 'POST', body: JSON.stringify(payload) })
                        : await fetch(url + (url.includes('?') ? '&' : '?') + 'payload=' + encodeURIComponent(JSON.stringify(payload)));
        const t = await r.text(); try { return JSON.parse(t); } catch (_) { throw new Error('răspuns ' + r.status + ' fără date'); }
      }
      if (m === 'jsonp') return g.WWJsonp(url, payload);
      return g.WWFrame(url, payload);
    },
    /** O singură verificare odată; dacă tocmai a eșuat (în ultimele 20 de secunde), nu o repetăm imediat. */
    probe(url) {
      if (this._p && this.url === url) return this._p;
      if (this.url === url && !this.mode && this.failedAt && Date.now() - this.failedAt < 20000) return Promise.resolve(null);
      this.url = url; this.tried = [];
      this._p = (async () => {
        for (const m of ['fetch', 'jsonp', 'frame']) {
          try { const d = await this.via(m, url, { action: 'config' }, false); if (d && d.ok) { this.mode = m; this.failedAt = 0; return m; } this.tried.push(m + ': ' + ((d && d.error) || 'fără date')); }
          catch (e) { this.tried.push(m + ': ' + String(e && e.message || e).slice(0, 80)); }
        }
        this.mode = null; this.failedAt = Date.now(); return null;
      })().finally(() => { this._p = null; });
      return this._p;
    },
    /** write = acțiune care schimbă ceva (cerere nouă, salvare, email): nu se repetă pe altă cale dacă prima a eșuat. */
    async call(url, payload, write) {
      if (!this.mode || this.url !== url) await this.probe(url);
      if (!this.mode) throw new Error('Google nu poate fi contactat de pe acest dispozitiv (' + this.tried.join(' · ') + ')');
      try { return await this.via(this.mode, url, payload, write); }
      catch (e) {
        if (write) throw e;
        const m = this.mode; await this.probe(url);           // de exemplu s-a schimbat rețeaua: căutăm din nou calea
        if (!this.mode || this.mode === m) throw e;
        return this.via(this.mode, url, payload, false);
      }
    }
  };
  g.WWPricing = { outOfArea, DEFAULT_SETTINGS, STATUSES, MODULE_NAMES, COUNTIES, isLocal, estimateKm, calc, pkgOf, albumIncluded, num, yes, lei, leiRate };
})(typeof window !== 'undefined' ? window : globalThis);
