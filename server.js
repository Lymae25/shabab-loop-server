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
- Svar kort, venligt og praktisk på dansk (medmindre der spørges på et andet sprog).
- Du kender planen ovenfor, men du har IKKE adgang til live data som vejr, trafik, åbningstider eller aktuelle priser. Sig det ærligt, og foreslå at de tjekker Google Maps, officielle hjemmesider, eller ringer til stedet for opdateret info.
- Du kan hjælpe med at omregne tider, foreslå pauser, svare på praktiske spørgsmål om ruten, eller bare være en hjælpsom rejsefælle under turen.
- Hold svar korte og mobilvenlige, folk læser dette på telefonen i en bevæget bil.`;

app.post('/api/chat', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Serveren mangler en ANTHROPIC_API_KEY miljøvariabel. Sæt den i Railway under Variables.' });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Ingen beskeder modtaget.' });
  }

  // Basic guardrails: cap history length and message size so one bad request can't run up a huge bill.
  const trimmed = messages.slice(-20).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 4000),
  }));

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
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: trimmed,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'Kunne ikke få svar fra Claude lige nu. Prøv igen om lidt.' });
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    res.json({ reply: textBlock ? textBlock.text : 'Intet svar modtaget.' });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Der skete en fejl på serveren.' });
  }
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
});
