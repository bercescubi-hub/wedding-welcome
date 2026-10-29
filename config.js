/* Adresa scriptului Google (Apps Script → Implementare → Aplicație web → URL …/exec).
   O completează Claude în repo după ce publici scriptul; formularul public o folosește ca să trimită cererile în Google Sheets. */
window.WW_CONFIG = {
  contactEmail: 'bercescubi@gmail.com',
  responseTime: 'în maximum 24 de ore',  // apare în confirmare; pune '' dacă nu vrei o promisiune de timp
  // Promoția de final de an: după data „until”, prețurile, banda de 10% și fereastra cu 40% dispar singure de pe pagina de ofertă
  promo: { until: '2026-12-31', earlyPct: 10, prizePct: 40, prizeCount: 3 },
  contactPhones: ['0737376128', '0752425550'],   // apar ca „Sună” la zonele neacoperite; primul și pentru WhatsApp
  scriptUrl: 'https://script.google.com/macros/s/AKfycbw5kvBKzSTGsDuRs62AmajthTNmqCQnxqHZ6Y5iiugnWfJKstZqxJpkfX9Jr1R-p9dm/exec'
};
