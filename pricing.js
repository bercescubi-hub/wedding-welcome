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
    pricing: { kmRate: 10, roundTrip: false },
    costs: { staffCount: 2, staffRate: 60, setupHours: 1, menuCost: 250, fuelPerKm: 1.2, boothConsumables: 250, equipment: 100 },
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
    const total = subtotal - discount;
    const C = S.costs;
    const staff = Math.round(num(C.staffCount) * num(C.staffRate) * (hours + num(C.setupHours)));
    const menu = p && p.staffMenu && !yes(lead.staffMenuByClient) ? Math.round(num(C.staffCount) * num(C.menuCost)) : 0;
    const fuel = outside ? Math.round(km * 2 * num(C.fuelPerKm)) : 0;
    const consumables = p && p.modules.includes('booth') ? num(C.boothConsumables) : 0;
    const equipment = p ? num(C.equipment) : 0;
    const cost = staff + menu + fuel + consumables + equipment;
    return { pkg: p, price, hours, outside, km, billedKm, transport, subtotal, discount, total,
      staff, menu, fuel, consumables, equipment, cost, profit: total - cost, margin: total ? (total - cost) / total : 0 };
  }
  const lei = n => Math.round(num(n)).toLocaleString('ro-RO') + ' lei';
  g.WWPricing = { DEFAULT_SETTINGS, STATUSES, MODULE_NAMES, COUNTIES, isLocal, estimateKm, calc, pkgOf, num, yes, lei };
})(typeof window !== 'undefined' ? window : globalThis);
