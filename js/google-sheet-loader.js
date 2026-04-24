// ============================================================
// CareerHub Pakistan — google-sheet-loader.js  (v5 — Vercel/Render ready)
// ============================================================
// • Fetches ALL data from the published Google Sheet CSV.
// • Uses multiple fetch strategies with CORS proxy fallback.
// • window.CMS_DATA is ALWAYS the single source of truth.
// • Auto-refreshes every 2 minutes — no page reload needed.
// ============================================================

const SHEET_CSV_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRkygCswWJqKnQPsVnj27ijDHwELm27oQpG7WRjGDzB5DcZqDjcTKUUp_7c3V_baAhb3U7YbInaJuQ_/pub';

// CORS proxy — used as fallback if direct fetch fails
const CORS_PROXY = 'https://corsproxy.io/?';

const TAB_DEFINITIONS = [
  { name: 'Scholarships',  sheetName: '🎓 Scholarships',  mapper: mapScholarship  },
  { name: 'Jobs',          sheetName: '💼 Jobs',          mapper: mapJob          },
  { name: 'Internships',   sheetName: '🚀 Internships',   mapper: mapInternship   },
  { name: 'Exams',         sheetName: '📋 Exams',         mapper: mapExam         },
  { name: 'Books',         sheetName: '📚 Books',         mapper: mapBook         },
  { name: 'Notifications', sheetName: '🔔 Notifications', mapper: mapNotification },
];

// ── Single global data object — NEVER cache a local reference ─
window.CMS_DATA = { Scholarships: [], Jobs: [], Internships: [], Exams: [], Books: [], Notifications: [] };

// ── Ready / Refresh event system ─────────────────────────────
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

// ── Loading banner ─────────────────────────────────────────────
function _showBanner(msg, color) {
  let b = document.getElementById('ch-loading-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'ch-loading-banner';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;color:#fff;text-align:center;padding:9px 16px;font-family:"DM Sans",sans-serif;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.2);transition:opacity .5s;';
    document.body.prepend(b);
  }
  b.style.background = color || 'linear-gradient(90deg,#0f766e,#0d9488)';
  b.style.opacity    = '1';
  b.innerHTML = msg;
}
function _hideBanner() {
  const b = document.getElementById('ch-loading-banner');
  if (b) { b.style.opacity = '0'; setTimeout(() => b.remove(), 600); }
}

// ── CSV fetcher with multi-strategy (direct → cors-proxy) ─────
async function _fetchCSVOnce(url) {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
    mode: 'cors'
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  if (text.trim().startsWith('<!')) throw new Error('HTML response — sheet may not be published');
  return text;
}

async function _fetchCSV(sheetName) {
  const directUrl = SHEET_CSV_BASE + '?output=csv&sheet=' + encodeURIComponent(sheetName) + '&_t=' + Date.now();

  // Strategy 1: Direct fetch (works in most environments)
  try {
    return await _fetchCSVOnce(directUrl);
  } catch (err1) {
    console.warn('[CMS] Direct fetch failed for', sheetName, '—', err1.message, '— trying proxy…');
  }

  // Strategy 2: CORS proxy fallback
  try {
    const proxyUrl = CORS_PROXY + encodeURIComponent(directUrl);
    return await _fetchCSVOnce(proxyUrl);
  } catch (err2) {
    console.warn('[CMS] Proxy fetch also failed for', sheetName, '—', err2.message);
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
      else if (ch === '\r') { /* skip */ }
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

// ── Field mappers ─────────────────────────────────────────────
function mapScholarship(r) {
  return {
    id:                Number(r['ID'])         || 0,
    title:             r['Title']              || '',
    description:       r['Description']        || '',
    country:           r['Country']            || '',
    type:              r['Type']               || '',
    funding:           r['Funding']            || '',
    deadline:          r['Deadline']           || '',
    posted_date:       r['Posted']             || '',
    apply_link:        r['Apply Link']         || '',
    tags:              r['Tags']               || '',
    is_featured:       _bool(r['Featured?']),
    image_url:         r['Image URL']          || '',
    location:          r['Location']           || '',
    level:             r['Level']              || '',
    host_organization: r['Host Organization']  || '',
  };
}
function mapJob(r) {
  return {
    id:          Number(r['ID'])  || 0,
    title:       r['Title']       || '',
    description: r['Description'] || '',
    category:    r['Category']    || '',
    country:     r['Country']     || '',
    type:        r['Type']        || '',
    deadline:    r['Deadline']    || '',
    posted_date: r['Posted']      || '',
    apply_link:  r['Apply Link']  || '',
    tags:        r['Tags']        || '',
    is_featured: _bool(r['Featured?']),
    image_url:   r['Image URL']   || '',
    location:    r['Location']    || '',
    salary:      r['Salary']      || '',
    experience:  r['Experience']  || '',
  };
}
function mapInternship(r) {
  return {
    id:           Number(r['ID'])    || 0,
    title:        r['Title']         || '',
    description:  r['Description']   || '',
    organization: r['Organization']  || '',
    country:      r['Country']       || '',
    stipend:      r['Stipend']       || '',
    deadline:     r['Deadline']      || '',
    posted_date:  r['Posted']        || '',
    apply_link:   r['Apply Link']    || '',
    tags:         r['Tags']          || '',
    is_featured:  _bool(r['Featured?']),
    image_url:    r['Image URL']     || '',
    location:     r['Location']      || '',
    duration:     r['Duration']      || '',
    type:         r['Type']          || '',
  };
}
function mapExam(r) {
  return {
    id:                Number(r['ID'])         || 0,
    title:             r['Title']              || '',
    exam_type:         r['Exam Type']          || '',
    syllabus_link:     r['Syllabus Link']      || '',
    test_date:         r['Test Date']          || '',
    results_link:      r['Results Link']       || '',
    past_papers_link:  r['Past Papers Link']   || '',
    fee:               r['Fee']                || '',
    tags:              r['Tags']               || '',
    image_url:         r['Image URL']          || '',
    registration_link: r['Registration Link']  || '',
    eligibility:       r['Eligibility']        || '',
    conducting_body:   r['Conducting Body']    || '',
  };
}
function mapBook(r) {
  return {
    id:            Number(r['ID'])    || 0,
    title:         r['Title']         || '',
    category:      r['Category']      || '',
    exam_type:     r['Exam Type']     || '',
    author:        r['Author']        || '',
    download_link: r['Download Link'] || '',
    buy_link:      r['Buy Link']      || '',
    is_free:       _bool(r['Free?']),
    tags:          r['Tags']          || '',
    image_url:     r['Image URL']     || '',
    edition:       r['Edition']       || '',
    language:      r['Language']      || '',
  };
}
function mapNotification(r) {
  const expiry  = r['Expiry Date'] || '';
  const expired = expiry ? new Date(expiry) < new Date() : false;
  return {
    id:          Number(r['ID']) || 0,
    message:     r['Message']    || '',
    type:        r['Type']       || '',
    expiry_date: expiry,
    is_active:   _bool(r['Active?']) && !expired,
    link:        r['Link']       || '',
  };
}

// ── Core fetch + parse all tabs ───────────────────────────────
async function _loadAllSheets(silent) {
  if (!silent) _showBanner('⏳ Loading live data…');
  const texts = await Promise.all(TAB_DEFINITIONS.map(t => _fetchCSV(t.sheetName)));
  const changedTabs = [];
  let loaded = 0;
  TAB_DEFINITIONS.forEach((tab, i) => {
    const text = texts[i];
    if (!text) {
      if (!silent) window.CMS_DATA[tab.name] = [];
      return;
    }
    try {
      const mapped = _csvToObjects(text)
        .map(tab.mapper)
        .filter(x => x.id > 0 && x.title && x.title.trim() !== '');
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
    _showBanner('⚠️ Could not load data — retrying soon', '#b45309');
    setTimeout(_hideBanner, 5000);
  }
  return changedTabs;
}

// ── Public: manual refresh ────────────────────────────────────
window.refreshCMSData = async function() {
  _showBanner('🔄 Refreshing live data…');
  const changed = await _loadAllSheets(true);
  _hideBanner();
  if (changed.length) _fireRefresh(changed);
  console.info('[CMS] Refresh done. Changed:', changed.join(', ') || 'none');
};

// ── Auto-refresh timer ────────────────────────────────────────
window.startAutoRefresh = function() {
  clearInterval(window._CMS_AUTO_REFRESH_TIMER);
  window._CMS_AUTO_REFRESH_TIMER = setInterval(() => {
    if (window._CMS_REFRESH_CONFIG.enabled) window.refreshCMSData();
  }, window._CMS_REFRESH_CONFIG.interval);
};
window.stopAutoRefresh = function() { clearInterval(window._CMS_AUTO_REFRESH_TIMER); };

// ── Bootstrap ─────────────────────────────────────────────────
(async function() {
  await _loadAllSheets(false);
  _fireReady();
  window.startAutoRefresh();
})();
