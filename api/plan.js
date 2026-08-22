// api/plan.js — Vercel serverless function
// AI day planner with deterministic offline fallback.
// Reads AI_API_KEY from process.env. Works without it.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rosterData = req.body.roster || [];
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
    if (!parsed.note) parsed.note = 'Planned for today.';
    res.json({ ...parsed, offline: false });
  } catch (err) {
    // Property 5: AI failure — deterministic fallback
    const ordered = deterministicSort(rosterData);
    res.json({ order: ordered, note: 'Planned offline. Sorted by due date.', offline: true });
  }
}

function deterministicSort(rosterData) {
  return [...rosterData]
    .sort((a, b) => {
      if (a.dueIn < 0 && b.dueIn >= 0) return -1;
      if (a.dueIn >= 0 && b.dueIn < 0) return 1;
      if (a.dueIn < 0 && b.dueIn < 0) return a.dueIn - b.dueIn;
      if (a.lastFlag && !b.lastFlag) return -1;
      if (!a.lastFlag && b.lastFlag) return 1;
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
