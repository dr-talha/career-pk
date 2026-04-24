// ============================================================
// CareerHub Pakistan — google-sheet-loader.js  (v7 — Vercel proxy)
// ============================================================
// Fetches data via /api/sheets (Vercel serverless proxy).
// This bypasses Google's "Host not in allowlist" browser block.
// Falls back to direct Google Sheets URL as secondary attempt.
// ============================================================

// Our own Vercel API proxy endpoint
const PROXY_ENDPOINT = '/api/sheets';

// Direct Google Sheets URL (fallback)
const SHEET_CSV_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRkygCswWJqKnQPsVnj27ijDHwELm27oQpG7WRjGDzB5DcZqDjcTKUUp_7c3V_baAhb3U7YbInaJuQ_/pub';

const TAB_DEFINITIONS = [
  { name: 'Scholarships',  gid: '80687518', mapper: mapScholarship  },
  { name: 'Jobs',          gid: '488476366', mapper: mapJob          },
  { name: 'Internships',   gid: '1499327830', mapper: mapInternship   },
  { name: 'Exams',         gid: '1358363099', mapper: mapExam         },
  { name: 'Books',         gid: '1087620474', mapper: mapBook         },
  { name: 'Notifications', gid: '76781237', mapper: mapNotification },
];

// ── Global data object ────────────────────────────────────────
window.CMS_DATA = { Scholarships: [], Jobs: [], Internships: [], Exams: [], Books: [], Notifications: [] };
window._CMS_READY             = false;
window._CMS_CALLBACKS         = [];
window._CMS_REFRESH_LISTENERS = [];
window._CMS_REFRESH_CONFIG    = { interval: 2 * 60 * 1000, enabled: true };

window.onCMSReady = function(fn) {
  if (window._CMS_READY) { fn(window.CMS_DATA); return; }
  window._CMS_CALLBACKS.push(fn);
};
window.onCMSRefresh = function(fn) {
  window._CMS_REFRESH_LISTENERS.push(fn);
};
function _fireReady() {
  window._CMS_READY = true;
  window._CMS_CALLBACKS.forEach(fn => { try { fn(window.CMS_DATA); } catch(e) { console.error('[CMS]', e); } });
  window._CMS_CALLBACKS = [];
  document.dispatchEvent(new CustomEvent('cmsReady', { detail: window.CMS_DATA }));
}
function _fireRefresh(changedTabs) {
  window._CMS_REFRESH_LISTENERS.forEach(fn => {
    try { fn(window.CMS_DATA, changedTabs); } catch(e) { console.error('[CMS]', e); }
  });
  document.dispatchEvent(new CustomEvent('cmsRefresh', { detail: { data: window.CMS_DATA, changed: changedTabs } }));
}

// ── Loading banner ────────────────────────────────────────────
function _showBanner(msg, color) {
  let b = document.getElementById('ch-loading-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'ch-loading-banner';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;color:#fff;text-align:center;padding:9px 16px;font-family:"DM Sans",sans-serif;font-size:14px;transition:opacity .5s;';
    document.body.prepend(b);
  }
  b.style.background = color || 'linear-gradient(90deg,#0f766e,#0d9488)';
  b.style.opacity = '1';
  b.innerHTML = msg;
}
function _hideBanner() {
  const b = document.getElementById('ch-loading-banner');
  if (b) { b.style.opacity = '0'; setTimeout(() => b.remove(), 600); }
}

// ── Fetch CSV text from a URL ─────────────────────────────────
async function _getText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  if (text.trim().startsWith('{') && text.includes('error')) throw new Error(JSON.parse(text).error || 'proxy error');
  if (text.trim().startsWith('<!')) throw new Error('HTML response');
  if (text.includes('Host not in allowlist')) throw new Error('Host not in allowlist');
  return text;
}

// ── Fetch one tab: try proxy first, then direct ───────────────
async function _fetchCSV(tab) {
  // Strategy 1: Our Vercel proxy (server-side, bypasses browser blocks)
  try {
    const url = PROXY_ENDPOINT + '?sheet=' + tab.name + '&_t=' + Date.now();
    return await _getText(url);
  } catch (e1) {
    console.warn('[CMS] Proxy failed for', tab.name, '—', e1.message, '— trying direct…');
  }

  // Strategy 2: Direct Google Sheets URL
  try {
    const url = SHEET_CSV_BASE + '?output=csv&gid=' + tab.gid + '&single=true&_t=' + Date.now();
    return await _getText(url);
  } catch (e2) {
    console.warn('[CMS] Direct also failed for', tab.name, '—', e2.message);
    return '';
  }
}

// ── CSV parser ────────────────────────────────────────────────
function _parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { field += ch; }
    } else {
      if      (ch === '"')  { inQ = true; }
      else if (ch === ',')  { row.push(field.trim()); field = ''; }
      else if (ch === '\r') {}
      else if (ch === '\n') {
        row.push(field.trim()); field = '';
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
      } else { field += ch; }
    }
  }
  if (field || row.length) { row.push(field.trim()); if (row.some(c => c !== '')) rows.push(row); }
  return rows;
}

function _csvToObjects(text) {
  if (!text || !text.trim()) return [];
  const rows = _parseCSV(text);
  if (rows.length < 2) return [];
  let hIdx = -1;
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    if (rows[r].some(c => c.trim().toUpperCase() === 'ID')) { hIdx = r; break; }
  }
  if (hIdx === -1) return [];
  const headers = rows[hIdx].map(h => h.trim());
  const out = [];
  for (let r = hIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row[0] || isNaN(Number(row[0]))) continue;
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (row[i] || '').trim(); });
    out.push(obj);
  }
  return out;
}

function _bool(v) { return /yes|true|✅/i.test(v || ''); }

// ── Mappers ───────────────────────────────────────────────────
function mapScholarship(r) {
  return {
    id: Number(r['ID']) || 0, title: r['Title'] || '',
    description: r['Description'] || '', country: r['Country'] || '',
    type: r['Type'] || '', funding: r['Funding'] || '',
    deadline: r['Deadline'] || '', posted_date: r['Posted'] || '',
    apply_link: r['Apply Link'] || '', tags: r['Tags'] || '',
    is_featured: _bool(r['Featured?']), image_url: r['Image URL'] || '',
    location: r['Location'] || '', level: r['Level'] || '',
    host_organization: r['Host Organization'] || '',
  };
}
function mapJob(r) {
  return {
    id: Number(r['ID']) || 0, title: r['Title'] || '',
    description: r['Description'] || '', category: r['Category'] || '',
    country: r['Country'] || '', type: r['Type'] || '',
    deadline: r['Deadline'] || '', posted_date: r['Posted'] || '',
    apply_link: r['Apply Link'] || '', tags: r['Tags'] || '',
    is_featured: _bool(r['Featured?']), image_url: r['Image URL'] || '',
    location: r['Location'] || '', salary: r['Salary'] || '',
    experience: r['Experience'] || '',
  };
}
function mapInternship(r) {
  return {
    id: Number(r['ID']) || 0, title: r['Title'] || '',
    description: r['Description'] || '', organization: r['Organization'] || '',
    country: r['Country'] || '', stipend: r['Stipend'] || '',
    deadline: r['Deadline'] || '', posted_date: r['Posted'] || '',
    apply_link: r['Apply Link'] || '', tags: r['Tags'] || '',
    is_featured: _bool(r['Featured?']), image_url: r['Image URL'] || '',
    location: r['Location'] || '', duration: r['Duration'] || '',
    type: r['Type'] || '',
  };
}
function mapExam(r) {
  return {
    id: Number(r['ID']) || 0, title: r['Title'] || '',
    exam_type: r['Exam Type'] || '', syllabus_link: r['Syllabus Link'] || '',
    test_date: r['Test Date'] || '', results_link: r['Results Link'] || '',
    past_papers_link: r['Past Papers Link'] || '', fee: r['Fee'] || '',
    tags: r['Tags'] || '', image_url: r['Image URL'] || '',
    registration_link: r['Registration Link'] || '',
    eligibility: r['Eligibility'] || '', conducting_body: r['Conducting Body'] || '',
  };
}
function mapBook(r) {
  return {
    id: Number(r['ID']) || 0, title: r['Title'] || '',
    category: r['Category'] || '', exam_type: r['Exam Type'] || '',
    author: r['Author'] || '', download_link: r['Download Link'] || '',
    buy_link: r['Buy Link'] || '', is_free: _bool(r['Free?']),
    tags: r['Tags'] || '', image_url: r['Image URL'] || '',
    edition: r['Edition'] || '', language: r['Language'] || '',
  };
}
function mapNotification(r) {
  const expiry = r['Expiry Date'] || '';
  const expired = expiry ? new Date(expiry) < new Date() : false;
  return {
    id: Number(r['ID']) || 0, message: r['Message'] || '',
    type: r['Type'] || '', expiry_date: expiry,
    is_active: _bool(r['Active?']) && !expired, link: r['Link'] || '',
  };
}

// ── Load all sheets ───────────────────────────────────────────
async function _loadAllSheets(silent) {
  if (!silent) _showBanner('⏳ Loading live data…');
  const texts = await Promise.all(TAB_DEFINITIONS.map(t => _fetchCSV(t)));
  const changedTabs = [];
  let loaded = 0;
  TAB_DEFINITIONS.forEach((tab, i) => {
    const text = texts[i];
    if (!text) { window.CMS_DATA[tab.name] = []; return; }
    try {
      const mapped = _csvToObjects(text).map(tab.mapper).filter(x => {
        const primaryText = (x.title || x.message || '').trim();
        return x.id > 0 && primaryText.length > 0;
      });
      const prev = JSON.stringify(window.CMS_DATA[tab.name]);
      window.CMS_DATA[tab.name] = mapped;
      if (prev !== JSON.stringify(mapped)) changedTabs.push(tab.name);
      loaded++;
      console.info('[CMS] ✅ ' + tab.name + ': ' + mapped.length + ' items');
    } catch (err) {
      console.error('[CMS] Parse error:', tab.name, err);
    }
  });
  if (loaded > 0) {
    _hideBanner();
  } else {
    _showBanner('⚠️ Data load failed. Check your Google Sheet is published publicly.', '#b45309');
    setTimeout(_hideBanner, 6000);
  }
  return changedTabs;
}

window.refreshCMSData = async function() {
  _showBanner('🔄 Refreshing…');
  const changed = await _loadAllSheets(true);
  _hideBanner();
  if (changed.length) _fireRefresh(changed);
};
window.startAutoRefresh = function() {
  clearInterval(window._CMS_AUTO_REFRESH_TIMER);
  window._CMS_AUTO_REFRESH_TIMER = setInterval(() => {
    if (window._CMS_REFRESH_CONFIG.enabled) window.refreshCMSData();
  }, window._CMS_REFRESH_CONFIG.interval);
};
window.stopAutoRefresh = function() { clearInterval(window._CMS_AUTO_REFRESH_TIMER); };

(async function() {
  await _loadAllSheets(false);
  _fireReady();
  window.startAutoRefresh();
})();
