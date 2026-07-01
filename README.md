# Shabab Loop Around Europa — server + chat

Dette er en lille Express-server, der gør to ting:
1. Server jeres roadtrip-side (`public/index.html`, samme side som lå på GitHub Pages).
2. Giver siden en sikker chat-funktion ("Shabab Assistant"), hvor Claude kender jeres rute, uden at API-nøglen nogensinde ligger i koden, som browseren kan se.

## Hvorfor en server og ikke bare en statisk side?

En API-nøgle skal ALDRIG ligge i kode, der sendes til en browser (det gælder også selvom repoet er privat, se forklaring i chatten). Her ligger nøglen i stedet som en miljøvariabel på selve Railway-serveren. Siden snakker med `/api/chat` på jeres egen server, og serveren snakker videre med Anthropic. Nøglen forlader aldrig serveren.

## Sådan deployer du på Railway

1. Opret et nyt projekt på [railway.app](https://railway.app), vælg **"Deploy from GitHub repo"** og peg på dette repository (upload det til et nyt GitHub-repo først, ligesom I gjorde med den oprindelige side).
2. Railway opdager automatisk at det er en Node-app (via `package.json`) og bruger `npm start` til at starte den (se `Procfile` for en ekstra sikkerhed).
3. Gå til jeres projekt → **Variables**-fanen, og tilføj:
   - `ANTHROPIC_API_KEY` = jeres rigtige nøgle fra [console.anthropic.com](https://console.anthropic.com) (opret en konto, tilføj betalingskort, generér en nøgle under "API Keys")
   - `ANTHROPIC_MODEL` = `claude-sonnet-5` (eller `claude-haiku-4-5-20251001` for en billigere/hurtigere model)
4. Railway giver jer automatisk en URL (noget i stil med `shabab-loop-server-production.up.railway.app`). Den URL er nu jeres nye side, med chat indbygget.
5. **Sæt aldrig den rigtige nøgle ind i `.env.example` eller nogen fil, der committes til git.** `.env` er allerede sat til at blive ignoreret af git (se `.gitignore`).

## Sådan tester du lokalt (valgfrit)

Kræver Node.js 18 eller nyere installeret på din maskine.

```bash
npm install
cp .env.example .env
# åbn .env og indsæt din rigtige nøgle
npm start
```

Åbn derefter `http://localhost:3000` i browseren.

## Filstruktur

```
server.js           → selve serveren (Express + chat-endpoint)
public/index.html   → roadtrip-siden, uændret bortset fra chat-widget'en
package.json         → afhængigheder og start-kommando
.env.example         → skabelon, IKKE den rigtige nøgle
Procfile              → fortæller Railway hvordan appen startes
```

## Opdatere turplanen i chatten

Hvis ruten, datoerne eller budgettet ændrer sig, skal du opdatere `SYSTEM_PROMPT`-teksten øverst i `server.js`, så Shabab Assistant kender de nye detaljer. Selve siden (`public/index.html`) opdateres som normalt.

## Omkostninger

Anthropic API'et koster penge per besked (både input og output), ikke et fast abonnement. For en lille gruppe der bruger chatten lejlighedsvis under en uges roadtrip, bliver det typisk nogle få dollars i alt, men hold øje med jeres forbrug på [console.anthropic.com](https://console.anthropic.com) hvis I er bekymrede for det.
