// Vercel Serverless Function — /api/sheets.js
// Server-side proxy for Google Sheets CSV data
// Bypasses browser CORS and Google's "Host not in allowlist" restriction

const SHEET_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRkygCswWJqKnQPsVnj27ijDHwELm27oQpG7WRjGDzB5DcZqDjcTKUUp_7c3V_baAhb3U7YbInaJuQ_/pub';

const GIDS = {
  Scholarships:  '80687518',
  Jobs:          '488476366',
  Internships:   '1499327830',
  Exams:         '1358363099',
  Books:         '1087620474',
  Notifications: '76781237',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const sheet = req.query.sheet;

  if (!sheet || !GIDS[sheet]) {
    return res.status(400).json({ error: 'Missing or unknown ?sheet= param. Valid: ' + Object.keys(GIDS).join(', ') });
  }

  try {
    const url = `${SHEET_BASE}?output=csv&gid=${GIDS[sheet]}&single=true`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CareerHubBot/1.0)',
        'Accept': 'text/csv,text/plain,*/*',
      }
    });

    if (!response.ok) {
      return res.status(502).json({ error: `Google Sheets returned HTTP ${response.status}` });
    }

    const text = await response.text();
    if (text.trim().startsWith('<!') || text.includes('Host not in allowlist')) {
      return res.status(502).json({ error: 'Sheet not accessible — make sure it is published publicly in Google Sheets' });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.status(200).send(text);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
