/**
 * Shared core for FS (Food Safety / PrimusGFS) audit pages.
 *
 * Exposes a global `FSAudit` with:
 *   - sb()                 supabase-js client (for current source: dev/prod)
 *   - getSource() / setSource(s)
 *   - getWindow() / setWindow(w)
 *   - renderHeaderBar(el)  injects source + window selector
 *   - fetchSheet(sheetKey, tabName)  → array of row objects (gviz JSONP)
 *   - MODES, SOURCES, SHEETS
 *   - fmtDate / todayISO / daysAgoISO / escapeHtml
 *
 * Sources: 'dev' (Supabase dev), 'prod' (Supabase prod), 'sheets' (Google Sheets gviz)
 * Persisted in localStorage('fsAuditSource'); URL ?src= overrides.
 *
 * Window: { mode, from, to } — see getWindow().
 */
(function (global) {
  'use strict';

  // =========================================================================
  // Configuration
  // =========================================================================

  const SUPABASE_PROJECTS = {
    dev:  { url: 'https://kfwqtaazdankxmdlqdak.supabase.co', anon: 'sb_publishable_AMRw7zq1xtPex_3-8wgvDA_A3QzWgHb' },
    prod: { url: 'https://zdvpqygiqavwpxljpvqw.supabase.co', anon: 'sb_publishable_HaoyPZbNIUxKPnwCh3iI3Q_1NIiWGgv' },
  };

  const SHEETS = {
    grow:  '1VtEecYn-W1pbnIU1hRHfxIpkH2DtK7hj0CpcpiLoziM',
    fsafe: '1MbHJoJmq0w8hWz8rl9VXezmK-63MFmuK19lz3pu0dfc',
    maint: '1e7AuQAOpKAHpmvizIgBNyUk42GscXNpz96hFX8C8uio',
    sales: '1lSWWLxyD0l83HfuiNI_iud6F9hopY4hoL0F_4P9nATc',
    invnt: '15ppDoDWLR1TIXCO5Gy3LIvEQ9KpJmtSqNY1Cao3E1Po',
    pack:  '1XEwjbU_NKNmoUED4w5iuaGV_ilovCJg4f2AkA9lB2cg',
    hr:    '13DUQTQyZf0CW07xv4FJ4ukP2x3Yoz8PyAw3Z2SwNsts',
  };

  const SOURCES = {
    dev:    { label: 'Supabase dev' },
    prod:   { label: 'Supabase prod' },
    sheets: { label: 'Google Sheets' },
  };

  const MODES = {
    audit:     { label: 'Audit period (May 2025–today)', days: null, fromFixed: '2025-05-01' },
    realtime:  { label: 'Real-time (last 7 days)',       days:   7 },
    monthly:   { label: 'Monthly check (last 30 days)',  days:  30 },
    quarterly: { label: 'Quarterly mock (last 90 days)', days:  90 },
    ytd:       { label: 'Year-to-date',                  days: null, ytd: true },
    annual:    { label: 'Annual prep (last 365 days)',   days: 365 },
    custom:    { label: 'Custom range',                  days: null },
  };

  // =========================================================================
  // Source
  // =========================================================================

  function getSource() {
    const url = new URLSearchParams(location.search);
    return url.get('src') || localStorage.getItem('fsAuditSource') || 'sheets';
  }
  function setSource(src) {
    localStorage.setItem('fsAuditSource', src);
    const u = new URL(location.href);
    u.searchParams.set('src', src);
    location.href = u.toString();
  }

  let _sbClients = {};
  function sb() {
    const src = getSource();
    if (src === 'sheets') throw new Error('sb() called in sheets mode — use fetchSheet() instead');
    if (_sbClients[src]) return _sbClients[src];
    if (!global.supabase) throw new Error('supabase-js not loaded');
    const cfg = SUPABASE_PROJECTS[src];
    if (!cfg) throw new Error('unknown source: ' + src);
    _sbClients[src] = global.supabase.createClient(cfg.url, cfg.anon);
    return _sbClients[src];
  }

  // =========================================================================
  // Window
  // =========================================================================

  function fmtDate(d) {
    if (typeof d === 'string') return d.slice(0, 10);
    return new Date(d).toISOString().slice(0, 10);
  }
  function todayISO() { return fmtDate(new Date()); }
  function daysAgoISO(n) { const d = new Date(); d.setDate(d.getDate() - n); return fmtDate(d); }

  function getWindow() {
    const url = new URLSearchParams(location.search);
    let mode = url.get('mode');
    let from = url.get('from');
    let to   = url.get('to');
    if (!mode && !from) {
      try {
        const stored = JSON.parse(localStorage.getItem('fsAuditWindow') || 'null');
        if (stored) { mode = stored.mode; from = stored.from; to = stored.to; }
      } catch (e) {}
    }
    if (!mode) mode = 'audit';
    const def = MODES[mode];
    if (mode === 'custom') {
      from = from || daysAgoISO(90);
      to   = to   || todayISO();
    } else if (def && def.fromFixed) {
      from = def.fromFixed;
      to   = todayISO();
    } else if (def && def.ytd) {
      from = new Date().getFullYear() + '-01-01';
      to   = todayISO();
    } else if (def) {
      from = daysAgoISO(def.days);
      to   = todayISO();
    }
    return { mode, from, to };
  }

  function setWindow(w) {
    localStorage.setItem('fsAuditWindow', JSON.stringify(w));
    const url = new URL(location.href);
    url.searchParams.set('mode', w.mode);
    if (w.mode === 'custom') {
      url.searchParams.set('from', w.from);
      url.searchParams.set('to', w.to);
    } else {
      url.searchParams.delete('from');
      url.searchParams.delete('to');
    }
    location.href = url.toString();
  }

  // =========================================================================
  // Header bar (source + window selectors + dataset URL)
  // =========================================================================

  function renderHeaderBar(el) {
    const src = getSource();
    const w   = getWindow();
    const srcOpts = Object.entries(SOURCES).map(([k, v]) =>
      `<option value="${k}" ${k === src ? 'selected' : ''}>${v.label}</option>`).join('');
    const modeOpts = Object.entries(MODES).map(([k, v]) =>
      `<option value="${k}" ${k === w.mode ? 'selected' : ''}>${v.label}</option>`).join('');
    el.innerHTML = `
      <label>Source: <select id="fs-src">${srcOpts}</select></label>
      <label>Window: <select id="fs-mode">${modeOpts}</select></label>
      <span id="fs-custom-range" style="${w.mode === 'custom' ? '' : 'display:none'}; display:inline-flex; gap:6px; align-items:center">
        <input type="date" id="fs-from" value="${w.from}">
        <span style="color:#aaa">→</span>
        <input type="date" id="fs-to" value="${w.to}">
      </span>
      <span class="fs-window-info">${w.from} → ${w.to}</span>
    `;
    el.querySelector('#fs-src').addEventListener('change', e => setSource(e.target.value));
    el.querySelector('#fs-mode').addEventListener('change', e => {
      const m = e.target.value;
      if (m === 'custom') { el.querySelector('#fs-custom-range').style.display = 'inline-flex'; return; }
      setWindow({ mode: m });
    });
    el.querySelector('#fs-from').addEventListener('change', () => applyCustom(el));
    el.querySelector('#fs-to').addEventListener('change',   () => applyCustom(el));
  }
  function applyCustom(el) {
    setWindow({
      mode: 'custom',
      from: el.querySelector('#fs-from').value,
      to:   el.querySelector('#fs-to').value,
    });
  }

  // =========================================================================
  // Google Sheets gviz fetch
  // =========================================================================

  let _gvizSeq = 0;
  /**
   * Fetch a sheet tab via gviz JSONP. Returns array of plain objects keyed by header.
   * @param {string} sheetKey  one of SHEETS keys (e.g. 'grow', 'fsafe')
   * @param {string} tabName   exact tab name or numeric gid (auto-detected)
   * @param {object} [opts]    { headers: 1, range: 'A1:Z100000' }
   *
   * Notes: gviz auto-detects the data range and can stop early at a blank row.
   * Pass an explicit `range` to force a wider read.
   */
  function fetchSheet(sheetKey, tabName, opts) {
    const sheetId = SHEETS[sheetKey];
    if (!sheetId) return Promise.reject(new Error('unknown sheet: ' + sheetKey));
    const isGid = /^\d+$/.test(String(tabName));
    const headers = (opts && opts.headers != null) ? opts.headers : 1;
    const range   = (opts && opts.range) || 'A1:ZZ100000';
    return new Promise((resolve, reject) => {
      const cbName = '__fsGviz' + (++_gvizSeq);
      const tq = encodeURIComponent('select *');
      const params = `tqx=out:json;responseHandler:${cbName}&tq=${tq}` +
        `&headers=${headers}&range=${encodeURIComponent(range)}` +
        (isGid ? `&gid=${tabName}` : `&sheet=${encodeURIComponent(tabName)}`);
      const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?${params}&_=${Date.now()}`;
      const tag = document.createElement('script');
      let done = false;
      const cleanup = () => {
        delete global[cbName];
        if (tag.parentNode) tag.parentNode.removeChild(tag);
      };
      global[cbName] = (resp) => {
        done = true;
        try {
          if (!resp || resp.status === 'error') {
            const msg = resp?.errors?.map(e => e.detailed_message || e.message).join('; ') || 'unknown gviz error';
            return reject(new Error('gviz: ' + msg));
          }
          const cols = resp.table.cols.map(c => c.label || c.id);
          const colTypes = resp.table.cols.map(c => c.type);
          const rows = resp.table.rows.map(r => {
            const o = {};
            (r.c || []).forEach((cell, i) => {
              if (!cell) { o[cols[i]] = null; return; }
              let v = cell.v;
              const t = colTypes[i];
              // gviz returns dates as "Date(2024,1,25,16,30,0)" — convert to ISO
              if (typeof v === 'string' && /^Date\(/.test(v)) {
                const m = v.match(/^Date\(([^)]+)\)$/);
                if (m) {
                  const p = m[1].split(',').map(Number);
                  // Sheet values are stored without a timezone — treat them as
                  // local (HST for Aloha) and emit a TZ-less ISO-like string so
                  // downstream slicing of date / time portions is faithful.
                  const pad = n => String(n).padStart(2, '0');
                  v = `${p[0]}-${pad((p[1]||0)+1)}-${pad(p[2]||1)}T` +
                      `${pad(p[3]||0)}:${pad(p[4]||0)}:${pad(p[5]||0)}`;
                }
              } else if ((t === 'date' || t === 'datetime' || t === 'timeofday') && cell.f) {
                // fall back to formatted string when v is unusual
                v = cell.f;
              }
              o[cols[i]] = v;
            });
            return o;
          });
          resolve(rows);
        } catch (e) {
          reject(e);
        } finally {
          cleanup();
        }
      };
      tag.src = url;
      tag.onerror = () => {
        if (!done) { reject(new Error('gviz network error')); cleanup(); }
      };
      document.head.appendChild(tag);
      setTimeout(() => { if (!done) { reject(new Error('gviz timeout')); cleanup(); } }, 30000);
    });
  }

  // =========================================================================
  // Misc
  // =========================================================================

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  global.FSAudit = {
    sb, getSource, setSource, SOURCES, SUPABASE_PROJECTS, SHEETS,
    getWindow, setWindow, renderHeaderBar, MODES,
    fetchSheet,
    fmtDate, todayISO, daysAgoISO, escapeHtml,
  };
})(window);
