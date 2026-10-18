# Wedding Welcome

Ecranul de bun venit pentru invitați: mesajul video al mirilor pe categorii, „Găsește-ți masa” și Photo Booth.

## Cum se folosește

- Deschide adresa GitHub Pages a acestui repo în **Chrome** sau **Edge** pe laptop.
- Instalează aplicația: iconița de instalare din bara de adrese (sau meniul ⋮ → *Install Wedding Welcome*). Apare ca aplicație separată, cu iconiță proprie.
- După prima deschidere cu internet, aplicația merge și **fără internet**.
- Videoclipurile se încarcă din panoul de administrare și rămân pe laptop.

## Ce e în repo

| Fișier | Rol |
|---|---|
| `index.html` | Aplicația (administrare + ecranul invitaților) |
| `data.json` | Datele evenimentului: miri, categorii, mesaje, invitați, mese, PIN |
| `sw.js` | Funcționarea fără internet (crește `CACHE` la fiecare schimbare de cod) |
| `manifest.webmanifest`, `icons/` | Instalarea ca aplicație |

## Actualizări

Când `data.json` primește un `version` mai mare, panoul de administrare afișează **„Am primit o versiune nouă a datelor”** cu butonul **Aplică actualizarea**. Câmpul `note` apare ca descriere a schimbării.

Modificările făcute direct în aplicație rămân doar pe laptop; pentru a le aduce înapoi în repo, folosește **Exportă datele (.json)** din tab-ul *Eveniment și module*.
