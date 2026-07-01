import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const CHAT_PASSCODE = process.env.CHAT_PASSCODE; // delt adgangskode, kun I fire kender den

// ---- Simpel rate limiting (ingen ekstra pakke nødvendig) ----
// Begrænser hvor mange chat-requests én IP-adresse kan sende, uafhængigt af adgangskoden.
// Beskytter mod at nogen (selv med koden) spammer den i stykker og løber prisen op.
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutter
const RATE_LIMIT_MAX = 30; // max 30 requests per IP per vindue
const rateLimitStore = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  rateLimitStore.set(ip, entry);
  return entry.count > RATE_LIMIT_MAX;
}

// Ryd gamle IP'er op en gang i mellem, så hukommelsen ikke vokser uendeligt
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitStore.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS);

// Trip context so the assistant actually knows what it's talking about.
// Edit this if the route, dates, or plan changes.
const SYSTEM_PROMPT = `Du er "Shabab Assistant", en hjælpsom roadtrip-assistent for turen "Shabab Loop Around Europa".

Fakta om turen:
- Deltagere: LJ, Youssef, Musti, Joshua. Fire mand, én autocamper (Comfort Space Select, Indie Campers).
- Afhentning: Hamburg, fredag 24. juli 2026 kl. 16:00. Aflevering: Hamburg, fredag 31. juli 2026 kl. 10:00.
- To ruteforslag er under overvejelse:
  1) "LJs Rute" (Byer & Bjerge): Hamburg → Berlin → Prag → Interlaken (Schweiz, Harder Kulm-udsigt) → Paris → Amsterdam → Hamburg. ~3.010 km. Dag 3 er en meget lang køredag (Prag→Interlaken→Paris, ca. 15 timer), efterfulgt af en fridag i Paris og flere dage i Amsterdam inkl. en bufferdag.
  2) "Youssefs Rute" (Riviera Run): Hamburg → Amsterdam → Paris → Nice (+Monaco og Cannes) → Hamburg. ~3.330 km. Dag 4 er en lang køredag (Paris→Nice, ca. 9 timer), en bufferdag og en Monaco/Cannes-dagstur i Nice, og en meget lang natkørsel hjem fra Nice (ca. 14,5 timer).
- Alle fire skiftes til at køre, altid mindst 2 oppe (1 fører, 1 co-pilot), resten hviler.
- Budget er ca. €4.100-4.150 for hele gruppen (~1.020-1.035 € per person), inkl. camperleje (reel checkout-pris €2.107,74), brændstof, overnatning, vejafgifter, mad og oplevelser.

Din rolle:
- Du snakker som en ægte shabab fra gaden, ikke som en stiv assistent. Brug naturligt slang som "eow", "wallah/wallahi", "sårn", "cwala", "min bror/g", "ej hva", og lignende, der hvor det passer naturligt ind i sætningen. Ikke tvunget i hver eneste sætning, men det skal føles ægte.
- Du kender planen ovenfor. Du har nu også adgang til at søge på nettet, brug det til spørgsmål om vejr, åbningstider, aktuelle priser, eller andet der kan have ændret sig. Sig fra hvis du er i tvivl om noget, selv efter en søgning.
- Du kan hjælpe med at omregne tider, foreslå pauser, svare på praktiske spørgsmål om ruten, eller bare være en hjælpsom rejsefælle under turen.
- VIGTIGT: Selvom du snakker med slang, skal konkrete facts (tider, km, priser, datoer) altid være klare og korrekte. Slang på stilen, ikke på substansen.
- Hold svar korte og mobilvenlige, folk læser dette på telefonen i en bevæget bil.`;

app.post('/api/chat', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Serveren mangler en ANTHROPIC_API_KEY miljøvariabel. Sæt den i Railway under Variables.' });
  }

  // Adgangskode-tjek: kun til for dem der kender koden
  if (CHAT_PASSCODE) {
    const providedPasscode = req.headers['x-chat-passcode'];
    if (providedPasscode !== CHAT_PASSCODE) {
      return res.status(401).json({ error: 'Forkert adgangskode.' });
    }
  }

  // Rate limiting: beskyt mod spam, selv med korrekt adgangskode
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'For mange beskeder for hurtigt. Vent lidt og prøv igen.' });
  }

  const { messages, scheduleStatus } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Ingen beskeder modtaget.' });
  }

  // Basic guardrails: cap history length and message size so one bad request can't run up a huge bill.
  const trimmed = messages.slice(-20).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 4000),
  }));

  // Dynamisk system-prompt: dagens dato/tid + jeres egne indtastede tider fra Skema-sektionen (hvis nogen)
  const now = new Date();
  const nowStr = now.toLocaleString('da-DK', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  });
  let dynamicSystem = SYSTEM_PROMPT + `\n\nDags dato og tid lige nu: ${nowStr} (Hamborg-tid). Brug det til at regne dage/timer til afgang, forsinkelser osv.`;

  if (typeof scheduleStatus === 'string' && scheduleStatus.trim()) {
    dynamicSystem += `\n\nStatus fra deres eget "Skema & beregner"-værktøj (faktiske indtastede afgangstider, kan være ufuldstændigt):\n${scheduleStatus.slice(0, 2000)}`;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1536,
        system: dynamicSystem,
        messages: trimmed,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'Kunne ikke få svar fra Claude lige nu. Prøv igen om lidt.' });
    }

    const data = await response.json();
    // Med web-søgning kan svaret bestå af flere tekst-blokke, saml dem alle.
    const reply = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    res.json({ reply: reply || 'Intet svar modtaget.' });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Der skete en fejl på serveren.' });
  }
});

// Fortæl frontend'en om der kræves en adgangskode, uden at afsløre selve koden
app.get('/api/chat-config', (req, res) => {
  res.json({ passcodeRequired: Boolean(CHAT_PASSCODE) });
});

// Simple health check, useful for Railway
app.get('/health', (req, res) => res.json({ ok: true }));

// Anything else -> serve the site (keeps deep links / refreshes working)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Shabab Loop server kører på port ${PORT}`);
  if (!ANTHROPIC_API_KEY) {
    console.warn('ADVARSEL: ANTHROPIC_API_KEY er ikke sat, chat-funktionen virker ikke endnu.');
  }
  if (!CHAT_PASSCODE) {
    console.warn('ADVARSEL: CHAT_PASSCODE er ikke sat, chatten er åben for alle der finder linket.');
  }
});
