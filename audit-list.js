/**
 * Shared issue-list page renderer for FS audit detail pages.
 *
 * Usage in a detail HTML:
 *   <body>
 *     <div id="root"></div>
 *     <script>
 *       FSAudit.renderIssueList({
 *         title: 'Open / overdue corrective actions',
 *         backHref: 'index.html',
 *         fetchRows: async (window) => [{ ... }, ...],
 *         columns: [
 *           { key: 'reported_date', label: 'Reported' },
 *           { key: 'site',          label: 'Site'     },
 *           { key: 'days_open',     label: 'Days open', num: true },
 *           ...
 *         ],
 *         defaultSort: { key: 'days_open', dir: -1 },
 *       });
 *     </script>
 */
(function (global) {
  'use strict';

  function render(opts) {
    const root = document.getElementById('root');
    const esc = FSAudit.escapeHtml;
    const win = FSAudit.getWindow();
    const cols = opts.columns;

    root.innerHTML = `
<div id="header">
  <a href="${opts.backHref || 'index.html'}" class="back">← FS audit</a>
  <h1>${esc(opts.title)}</h1>
  <div class="controls" id="window-bar"></div>
  <div id="version">${opts.version || ''}</div>
</div>
<div id="summary"></div>
<div id="loading">Loading…</div>
<div id="error" style="display:none"></div>
<div id="table-wrap" style="display:none">
  <table>
    <thead><tr>${cols.map(c =>
      `<th data-key="${esc(c.key)}" class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`
    ).join('')}</tr></thead>
    <tbody id="tbody"></tbody>
  </table>
</div>`;

    FSAudit.renderHeaderBar(document.getElementById('window-bar'));

    let allRows = [];
    let sortKey = (opts.defaultSort && opts.defaultSort.key) || cols[0].key;
    let sortDir = (opts.defaultSort && opts.defaultSort.dir) || 1;

    function paint() {
      const rows = allRows.slice().sort((a, b) => {
        const x = a[sortKey], y = b[sortKey];
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * sortDir;
      });
      document.getElementById('summary').innerHTML =
        `<div class="stat"><div class="label">Issues</div><div class="value">${rows.length}</div></div>`;
      document.getElementById('tbody').innerHTML = rows.map(r =>
        `<tr>${cols.map(c => {
          const v = c.render ? c.render(r) : (r[c.key] != null ? r[c.key] : '');
          return `<td class="${c.num ? 'num' : ''}">${c.render ? v : esc(v)}</td>`;
        }).join('')}</tr>`
      ).join('');
    }

    document.querySelectorAll('th[data-key]').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.key;
        if (sortKey === k) sortDir = -sortDir;
        else { sortKey = k; sortDir = 1; }
        paint();
      });
    });

    (async () => {
      try {
        allRows = await opts.fetchRows(win);
        document.getElementById('loading').style.display = 'none';
        document.getElementById('table-wrap').style.display = 'block';
        paint();
      } catch (e) {
        document.getElementById('loading').style.display = 'none';
        const err = document.getElementById('error');
        err.style.display = 'block';
        const msg = String(e.message || e);
        if (/gviz/i.test(msg)) {
          err.innerHTML = `<div style="font-weight:600">Can't read the underlying Google Sheet</div>
            <div style="margin-top:8px; color:#d4a44a">${FSAudit.escapeHtml(msg)}</div>
            <div style="margin-top:12px; color:#aaa; font-size:0.9em">
              Most likely the sheet isn't link-shareable. Open it in Sheets → Share → "Anyone with the link → Viewer".
              Then reload this page.
            </div>`;
        } else {
          err.textContent = 'Error: ' + msg;
        }
        console.error(e);
      }
    })();
  }

  global.FSAudit = global.FSAudit || {};
  global.FSAudit.renderIssueList = render;
})(window);
