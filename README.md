# Wedding Welcome

Ecranul de bun venit pentru invitați: mesajul video al mirilor pe categorii, „Găsește-ți masa” și Photo Booth.

**Adresa:** https://bercescubi-hub.github.io/wedding-welcome/

## Cum se folosește

1. Deschide adresa în **Chrome** sau **Edge** pe laptop și instalează aplicația (iconița din bara de adrese).
2. Creează un cont (utilizator + parolă). Notează **codul de recuperare**, e singura cale de a schimba parola uitată.
3. Pregătește evenimentul în tab-uri:
   - **Eveniment și module**: miri, dată, locație, ce module apar, PIN-ul de ieșire din LIVE.
   - **Aspect**: temă de culori, tip de scris, poză de fundal opțională.
   - **Videoclipuri**: alege un folder; fișierele denumite `familie.mp4`, `prieteni.mp4` etc. se potrivesc automat cu categoriile. Un nume nou devine o categorie nouă.
   - **Invitați**: import din Excel (`.xlsx` / `.csv`, coloanele *Nume* și *Masa*; vezi `sablon-invitati.xlsx`) sau adăugare manuală.
4. Verifică totul în **TEST MODE**.
5. **Publică și pornește LIVE**. Înainte vezi exact ce se schimbă față de versiunea LIVE.

## Versiunea în lucru și LIVE

Fiecare cont are două versiuni ale evenimentului:

- **În lucru**: ce editezi în administrare și vezi în TEST MODE.
- **LIVE**: ce văd invitații. Se schimbă doar când apeși *Publică*.

Poți oricând să *Renunți la modificări* și să revii la versiunea LIVE.

## Conturi

Conturile, videoclipurile și pozele sunt păstrate **pe laptopul pe care au fost create** (parolele criptate cu PBKDF2). Fiecare cont are evenimentul lui separat. Conturile în cloud, accesibile de pe orice dispozitiv, sunt o etapă următoare.

## Ce e în repo

| Fișier | Rol |
|---|---|
| `index.html` | Aplicația (conturi, administrare, ecranul invitaților) |
| `data.json` | Datele trimise de Claude (miri, categorii, mesaje, invitați, PIN, opțional temă) |
| `sablon-invitati.xlsx` | Șablonul Excel pentru invitați |
| `sw.js` | Funcționarea fără internet (crește `CACHE` la fiecare schimbare de cod) |
| `manifest.webmanifest`, `icons/` | Instalarea ca aplicație |

## Actualizări de la Claude

Când `data.json` primește un `version` mai mare, administrarea afișează **„Am primit o versiune nouă a datelor”**. *Aplică actualizarea* o pune în versiunea în lucru (videoclipurile și tema rămân), apoi o publici când ești gata.

Pentru a trimite înapoi ce ai modificat în aplicație: *Eveniment și module → Exportă datele (.json)*.
