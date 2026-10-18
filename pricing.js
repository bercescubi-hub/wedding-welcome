/* Wedding Welcome — prețuri, transport și calculul costurilor.
   Folosit și de formularul public (oferta.html), și de aplicație (Evenimente), ca să calculeze la fel.
   Valorile de mai jos sunt cele implicite (fictive); cele reale se modifică din aplicație → Evenimente → Prețuri și costuri. */
(function (g) {
  const DEFAULT_SETTINGS = {
    packages: [
      { id: 'esential', name: 'Esențial', hours: 3, price: 1500, modules: ['welcome', 'seating'], staffMenu: false,
        desc: 'Mesajul de bun venit al mirilor și găsirea mesei, 3 ore' },
      { id: 'complet', name: 'Complet', hours: 5, price: 2500, modules: ['welcome', 'seating', 'booth'], staffMenu: false,
        desc: 'Bun venit, găsirea mesei și Photo Booth, 5 ore' },
      { id: 'allnight', name: 'All Night', hours: 10, price: 3300, modules: ['welcome', 'seating', 'booth'], staffMenu: true,
        desc: 'Toate cele trei, toată noaptea' }
    ],
    /* TVA stă la „pricing” ca să ajungă și în formularul public (prețul afișat clientului); restul taxelor sunt interne, la „costs”. */
    pricing: { kmRate: 10, roundTrip: false, vatPayer: true, vatRate: 21, pricesIncludeVat: true },
    costs: { staffCount: 2, staffRate: 60, setupHours: 1, menuCost: 250, fuelPerKm: 1.2, boothConsumables: 250, equipment: 100,
      incomeTax: 1, payFee: 0, invoiceFixed: 0 },
    email: { fromEmail: 'bercescubi@gmail.com', fromName: 'Wedding Welcome' },
    templates: [
      { id: 'oferta', name: 'Ofertă', status: 'Ofertă trimisă', subject: 'Oferta Wedding Welcome pentru {data_eveniment}',
        body: 'Bună, {prenume}!\n\nVă mulțumim pentru interesul arătat. Pentru evenimentul din {data_eveniment}, de la {locatie_completa}, vă propunem pachetul {pachet} ({ore}).\n\nPachet: {pret_pachet} lei\nTransport: {transport} lei\nReducere: {reducere} lei\nTotal: {total} lei\n\nOferta este valabilă 14 zile. Pentru rezervare, răspundeți la acest email sau sunați-ne.\n\nCu drag,\n{expeditor}' },
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
  const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.').replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : 0; };
  const yes = v => v === true || /^(da|true|1|yes)$/i.test(String(v ?? '').trim());
  function pkgOf(S, id) { return S.packages.find(p => p.id === id) || S.packages.find(p => p.name === id) || null; }
  /** Prețul pentru client, costurile și profitul unei cereri. */
  function calc(lead, S) {
    const p = pkgOf(S, lead.package);
    const price = p ? num(p.price) : 0, hours = p ? num(p.hours) : 0;
    const outside = yes(lead.outside), km = num(lead.km);
    const billedKm = outside ? km * (S.pricing.roundTrip ? 2 : 1) : 0;
    const transport = Math.round(billedKm * num(S.pricing.kmRate));
    const subtotal = price + transport;
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
    const cost = staff + menu + fuel + consumables + equipment;
    /* taxe și costuri de facturare: impozit pe venit (fără TVA), comision la încasare, cost fix pe factură */
    const incomeTax = Math.round(net * num(C.incomeTax) / 100);
    const payFee = Math.round(total * num(C.payFee) / 100);
    const invoiceFee = p ? Math.round(num(C.invoiceFixed)) : 0;
    const taxes = vat + incomeTax + payFee + invoiceFee;
    const profit = total - cost - taxes;
    return { pkg: p, price, hours, outside, km, billedKm, transport, subtotal, discount, base, total, vat, vatRate: vr, vatIncluded: !!(Pr.vatPayer && Pr.pricesIncludeVat), net,
      staff, menu, fuel, consumables, equipment, cost, incomeTax, payFee, invoiceFee, taxes, profit, margin: net ? profit / net : 0 };
  }
  const lei = n => Math.round(num(n)).toLocaleString('ro-RO') + ' lei';
  /** Apel JSONP către scriptul Google: ocolește blocările de tip CORS. */
  g.WWJsonp = function (url, payload) {
    return new Promise((resolve, reject) => {
      const cb = '__ww' + Date.now().toString(36) + Math.floor(Math.random() * 1e6);
      const src = url + (url.includes('?') ? '&' : '?') + 'payload=' + encodeURIComponent(JSON.stringify(payload)) + '&callback=' + cb;
      if (src.length > 14000) return reject(new Error('Mesajul e prea lung pentru conexiunea de rezervă. Scurtează textul.'));
      const s = document.createElement('script'); let done = false;
      const end = () => { done = true; clearTimeout(t); delete g[cb]; s.remove(); };
      const t = setTimeout(() => { if (!done) { end(); reject(new Error('Google nu a răspuns. Verifică internetul și dacă scriptul e publicat cu acces „Oricine”.')); } }, 25000);
      g[cb] = d => { end(); resolve(d); };
      s.onerror = () => { if (!done) { end(); reject(new Error('Google a răspuns cu o pagină de eroare în loc de date. De obicei scriptul cere o autorizare nouă: în Apps Script alege funcția „setup”, apasă Run și acceptă permisiunile, apoi Deploy → Manage deployments → creion → New version → Deploy.')); } };
      s.src = src; document.head.appendChild(s);
    });
  };
  g.WWPricing = { DEFAULT_SETTINGS, STATUSES, MODULE_NAMES, COUNTIES, isLocal, estimateKm, calc, pkgOf, num, yes, lei };
})(typeof window !== 'undefined' ? window : globalThis);
