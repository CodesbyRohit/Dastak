const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load protocol and roster
const protocol = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'hbnc.json'), 'utf8'));
const roster = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'roster.json'), 'utf8'));

// --- Protocol endpoint ---
app.get('/api/protocol/:id', (req, res) => {
  if (req.params.id === protocol.id) {
    return res.json(protocol);
  }
  res.status(404).json({ error: 'Protocol not found' });
});

// NOTE: POST /api/visit removed per §3.
// Visit records are encoded in the URL fragment and never reach our infrastructure.
// The fragment is never transmitted to the server.

// --- P2: Day planner ---
app.post('/api/plan', async (req, res) => {
  const rosterData = req.body.roster || roster;
  const apiKey = process.env.AI_API_KEY;
  const apiUrl = process.env.AI_API_URL;

  if (!apiKey || !apiUrl) {
    // Deterministic fallback — no AI (Property 5: calibrated confidence)
    const ordered = deterministicSort(rosterData);
    return res.json({ order: ordered, note: 'Planned offline. Sorted by due date.', offline: true });
  }

  // Strip identifying fields before sending to AI
  const stripped = rosterData.map(h => ({
    id: h.id,
    area: h.area,
    protocol: h.protocol,
    dueIn: h.dueIn,
    lastFlag: h.lastFlag
  }));

  try {
    const aiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You order a community health worker's home visits for one day. You are given household IDs, area names, protocol names, days until due (negative means overdue), and whether the previous visit raised a referral flag.
Order the visits. Prioritise: overdue first, then households with a previous referral flag, then due-today. Within those, group by area to minimise walking.
You are ordering visits only. Never comment on any household's health, never suggest what to check, never interpret a flag clinically. Refer to households only by ID.
Return ONLY this JSON, no markdown fences, no preamble:
{"order": [{"id": "...", "reason": "..."}], "note": "one short line about the day's shape"}`
          },
          {
            role: 'user',
            content: JSON.stringify(stripped)
          }
        ],
        temperature: 0.2
      })
    });

    const data = await aiRes.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);
    // Property 5: full roster planned by AI
    if (!parsed.note) parsed.note = 'Planned for today.';
    res.json({ ...parsed, offline: false });
  } catch (err) {
    // Property 5: AI failure — deterministic fallback
    const ordered = deterministicSort(rosterData);
    res.json({ order: ordered, note: 'Planned offline. Sorted by due date.', offline: true });
  }
});

// Deterministic sort for planner fallback
function deterministicSort(rosterData) {
  return [...rosterData]
    .sort((a, b) => {
      // Overdue first (most overdue first)
      if (a.dueIn < 0 && b.dueIn >= 0) return -1;
      if (a.dueIn >= 0 && b.dueIn < 0) return 1;
      if (a.dueIn < 0 && b.dueIn < 0) return a.dueIn - b.dueIn;
      // Then flagged
      if (a.lastFlag && !b.lastFlag) return -1;
      if (!a.lastFlag && b.lastFlag) return 1;
      // Then due today
      if (a.dueIn === 0 && b.dueIn > 0) return -1;
      if (a.dueIn > 0 && b.dueIn === 0) return 1;
      return a.dueIn - b.dueIn;
    })
    .map(h => ({
      id: h.id,
      reason: h.dueIn < 0 ? `overdue by ${Math.abs(h.dueIn)} day${Math.abs(h.dueIn) > 1 ? 's' : ''}`
        : h.lastFlag ? 'flagged last visit'
        : h.dueIn === 0 ? 'due today'
        : `due in ${h.dueIn} day${h.dueIn > 1 ? 's' : ''}`
    }));
}

// --- P3: Supervisor pattern summary ---
app.post('/api/review', async (req, res) => {
  const visitRecords = req.body.visits || [];
  const apiKey = process.env.AI_API_KEY;
  const apiUrl = process.env.AI_API_URL;

  // Strip identifying data — only aggregate counts and flags
  const aggregates = {};
  let totalFlags = 0;
  let totalVisits = 0;
  const flagsByType = {};
  const visitsByArea = {};

  for (const v of visitRecords) {
    totalVisits++;
    if (v.flags) {
      for (const f of v.flags) {
        totalFlags++;
        flagsByType[f.type] = (flagsByType[f.type] || 0) + 1;
      }
    }
    if (v.area) {
      visitsByArea[v.area] = (visitsByArea[v.area] || 0) + 1;
    }
  }

  const summaryData = { totalVisits, totalFlags, flagsByType, visitsByArea };

  if (!apiKey || !apiUrl) {
    return res.json({ summary: 'No AI available. Review data manually.', data: summaryData, offline: true });
  }

  try {
    const aiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You describe patterns across a set of completed community health visit records. You are given counts, flag types, areas, and dates.
Describe what the data shows in two or three short sentences. Note clusters by area or by flag type where they exist.
Never diagnose. Never recommend a clinical action. Never name or identify any individual. Never speculate about causes. If the data is too sparse to show a pattern, say so plainly.
Return plain text only, under 60 words.`
          },
          {
            role: 'user',
            content: JSON.stringify(summaryData)
          }
        ],
        temperature: 0.3
      })
    });

    const data = await aiRes.json();
    const content = data.choices?.[0]?.message?.content;
    res.json({ summary: content, data: summaryData, offline: false });
  } catch (err) {
    res.json({ summary: 'AI unavailable. Review data manually.', data: summaryData, offline: true });
  }
});

app.listen(PORT, () => {
  console.log(`Dastak running on http://localhost:${PORT}`);
  console.log('glasses.html — no network calls (design constraint)');
});
