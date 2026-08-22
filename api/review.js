// api/review.js — Vercel serverless function
// Supervisor pattern summary with offline fallback.
// Reads AI_API_KEY from process.env. Works without it.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const visitRecords = req.body.visits || [];
  const apiKey = process.env.AI_API_KEY;
  const apiUrl = process.env.AI_API_URL;

  // Strip identifying data — only aggregate counts and flags
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
}
