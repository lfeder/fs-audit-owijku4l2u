/**
 * Registry of PrimusGFS v3.2 audit-readiness checks (sheets-mode).
 *
 * Each check has:
 *   id           — short slug
 *   title        — human label
 *   module       — PrimusGFS module
 *   severity     — 'must-be-zero' | 'aged-under-30d' | 'investigate'
 *   detailPage   — relative path or null
 *   status       — 'ready' | 'workable' | 'blocked'
 *   sources      — optional array of sources where this check is wired (default: all)
 *   run(window)  — async fn returning { count, target, blocked? }
 *
 * Sheets-mode is the default. Supabase paths were removed pending re-wiring.
 */
(function (global) {
  'use strict';

  const fetchSheet = (sheet, tab) => FSAudit.fetchSheet(sheet, tab);

  // Window helpers — strings like '2025-01-06'
  const dateOnly = v => {
    if (!v) return null;
    const s = String(v);
    // formatted "1/6/2025" or "1/6/2025 17:00:00"  → "2025-01-06"
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
      const mm = String(parseInt(m[1],10)).padStart(2,'0');
      const dd = String(parseInt(m[2],10)).padStart(2,'0');
      return `${m[3]}-${mm}-${dd}`;
    }
    // ISO "2025-01-06T..." → "2025-01-06"
    m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    return null;
  };

  function inWindow(w, dateStr) {
    const d = dateOnly(dateStr);
    return d && d >= w.from && d <= w.to;
  }

  function daysBetween(aStr, bStr) {
    const a = dateOnly(aStr), b = dateOnly(bStr);
    if (!a || !b) return null;
    return Math.floor((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }

  function todayISO() { return new Date().toISOString().slice(0,10); }

  // ===========================================================================
  // Checks
  // ===========================================================================

  const CHECKS = [
    // -------------------------------------------------------------------------
    {
      id: 'open-corrective-actions',
      title: 'Corrective actions unverified for >30 days',
      module: 'M1/M3/M4',
      severity: 'aged-under-30d',
      detailPage: 'open-corrective-actions.html',
      status: 'ready',
      async run(w) {
        const rows = await fetchSheet('fsafe', 'fsafe_log_corrective_action');
        // Open = VerifiedDateTime empty. Overdue = open AND ReportedDate > 30d ago.
        const cutoff = (() => { const d = new Date(); d.setDate(d.getDate()-30); return d.toISOString().slice(0,10); })();
        let count = 0;
        rows.forEach(r => {
          const reported = dateOnly(r.ReportedDate);
          if (!reported) return;
          if (reported < w.from || reported > w.to) return;
          if (r.VerifiedDateTime && String(r.VerifiedDateTime).trim() !== '') return;
          if (reported < cutoff) count++;
        });
        return { count, target: '0 unverified > 30d' };
      },
    },

    // -------------------------------------------------------------------------
    {
      id: 'failed-emp-no-retest',
      title: 'EMP / lab failures with no follow-up test in 7 days',
      module: 'M5/M6',
      severity: 'must-be-zero',
      detailPage: 'failed-emp-no-retest.html',
      status: 'ready',
      async run(w) {
        const rows = await fetchSheet('fsafe', 'fsafe_log_emp');
        // Index follow-ups two ways:
        //   1. by FailCode: retest/vector rows reference the initial's FailCode via TestFromFailCode
        //   2. by TestName + date proximity: for failures lacking a FailCode, treat any
        //      Retest/Vector with same TestName within 14 days as a follow-up
        const refByFailCode = {};   // FailCode → [follow-up rows]
        const followupsByTest = {}; // TestName → [{ sampled, type }]
        rows.forEach(r => {
          const tt = String(r.TestType || '');
          if (tt === 'Retest' || tt === 'Vector') {
            const fc = String(r.TestFromFailCode || '').trim();
            if (fc) (refByFailCode[fc] = refByFailCode[fc] || []).push(r);
            const sd = dateOnly(r.SampleDateTime);
            if (sd) (followupsByTest[r.TestName||''] = followupsByTest[r.TestName||''] || [])
              .push({ sampled: sd, type: tt });
          }
        });
        let count = 0;
        rows.forEach(r => {
          const sampled = dateOnly(r.SampleDateTime);
          if (!sampled || sampled < w.from || sampled > w.to) return;
          const passStr = String(r.Pass || '').toLowerCase();
          if (passStr !== 'false' && passStr !== 'no' && passStr !== '0') return;
          // APC is a quantitative routine test — failures don't trigger retest/vector workflow
          if (String(r.TestName || '').toUpperCase() === 'APC') return;
          // Linked by FailCode?
          const fc = String(r.FailCode || '').trim();
          if (fc && refByFailCode[fc] && refByFailCode[fc].length) return;
          // Loose match: any Retest/Vector with same TestName within 14 days?
          const cutoff = new Date(new Date(sampled+'T00:00:00').getTime() + 14*86400000).toISOString().slice(0,10);
          const sibs = followupsByTest[r.TestName || ''] || [];
          if (sibs.some(s => s.sampled > sampled && s.sampled <= cutoff)) return;
          count++;
        });
        return { count, target: '0' };
      },
    },

    // -------------------------------------------------------------------------
    {
      id: 'untraceable-orders',
      title: 'Sales orders that cannot be traced back to a harvest / seeding',
      module: 'M1',
      severity: 'must-be-zero',
      detailPage: 'untraceable-orders.html',
      status: 'ready',
      async run(w) {
        const [sales, cukeHarv, lettSeed] = await Promise.all([
          fetchSheet('sales', 'sales_po'),
          fetchSheet('grow',  'grow_C_harvest'),
          fetchSheet('grow',  'grow_L_seeding'),
        ]);
        // Index cuke harvest dates
        const cukeDates = new Set();
        cukeHarv.forEach(r => { const d = dateOnly(r.HarvestDate); if (d) cukeDates.add(d); });
        // Index lettuce packlots
        const lettLots = new Set();
        lettSeed.forEach(r => {
          String(r.packlot||'').split(',').forEach(s => {
            const v = s.trim().replace(/\$$/, '');
            if (v) lettLots.add(v);
          });
        });
        let count = 0;
        sales.forEach(r => {
          const inv = dateOnly(r.InvoiceDate); if (!inv || inv < w.from || inv > w.to) return;
          const qty = Number(r.InvoiceQuantity); if (!qty) return;
          const farm = String(r.Farm||'').toLowerCase();
          const splits = [];
          for (let i = 1; i <= 6; i++) {
            const n = String(i).padStart(2,'0');
            const pd = r['PackDate'+n], pq = r['Quantity'+n], pl = r['PackLot'+n];
            const hasQty = pq != null && String(pq).trim() !== '' && Number(pq) !== 0;
            const hasLot = pl && String(pl).trim() !== '';
            if (!hasQty && !hasLot) continue;
            splits.push({ pack_date: dateOnly(pd), pack_lot: String(pl||'').trim().replace(/\$$/, '') });
          }
          if (splits.length === 0) return; // missing-data case lives in orphan-fulfillments
          let anyResolved = false;
          if (farm === 'cuke') {
            anyResolved = splits.some(s => s.pack_date && cukeDates.has(s.pack_date));
          } else if (farm === 'lettuce') {
            anyResolved = splits.some(s => s.pack_lot && lettLots.has(s.pack_lot));
          } else {
            return; // unknown farm — not classifiable
          }
          if (!anyResolved) count++;
        });
        return { count, target: '0' };
      },
    },

    // -------------------------------------------------------------------------
    {
      id: 'mock-recall',
      title: 'Mock recall — trace customer order back to seeding',
      module: 'M1',
      severity: 'investigate',
      detailPage: 'mock-recall.html',
      status: 'ready',
      async run(w) {
        // Show the number of POs available to trace in the audit window.
        const sales = await fetchSheet('sales', 'sales_po');
        let count = 0;
        sales.forEach(r => {
          const inv = dateOnly(r.InvoiceDate);
          if (!inv || inv < w.from || inv > w.to) return;
          if (Number(r.InvoiceQuantity)) count++;
        });
        return { count, target: 'POs available to trace' };
      },
    },

    // -------------------------------------------------------------------------
    {
      id: 'inspection-log-completeness',
      title: 'Inspection logs (8 GH/PH pre/post) — missing data or unverified',
      module: 'M4/M5',
      severity: 'must-be-zero',
      detailPage: 'inspection-log-completeness.html',
      status: 'ready',
      async run(w) {
        const TABS = [
          'fsafe_log_C_gh_pre','fsafe_log_C_gh_post',
          'fsafe_log_C_ph_pre','fsafe_log_C_ph_post',
          'fsafe_log_L_gh_pre','fsafe_log_L_gh_post',
          'fsafe_log_L_ph_pre','fsafe_log_L_ph_post',
        ];
        // Columns we DON'T require (optional / conditional).
        const OPTIONAL = new Set([
          'Warning','Action Required','Photo','Types of Foreign Material',
          'Foreign Material Photo 01','Foreign Material Photo 02','Foreign Material Photo 03',
          'Photo of Foreign Material',
          'ATP Site 1','ATP Results 1','ATP Site 2','ATP Results 2','ATP Site 3','ATP Results 3',
        ]);
        let issues = 0;
        for (const tab of TABS) {
          const rows = await fetchSheet('fsafe', tab);
          rows.forEach(r => {
            const checked = dateOnly(r['Checked Date']);
            if (!checked || checked < w.from || checked > w.to) return;
            // Unverified?
            const unverified = !(r['Verified Time'] && String(r['Verified Time']).trim() !== '');
            // Missing required cell?
            let missing = false;
            for (const k in r) {
              if (OPTIONAL.has(k)) continue;
              if (k === 'Verified Time' || k === 'Verified By') continue;
              const v = r[k];
              if (v == null || String(v).trim() === '') { missing = true; break; }
            }
            if (unverified || missing) issues++;
          });
        }
        return { count: issues, target: '0' };
      },
    },

    // -------------------------------------------------------------------------
    {
      id: 'water-testing',
      title: 'Water-test sites with no test in 180 days',
      module: 'M3',
      severity: 'must-be-zero',
      detailPage: 'water-testing.html',
      status: 'ready',
      async run(w) {
        const rows = await fetchSheet('fsafe', 'fsafe_log_water');
        const bySite = {};
        rows.forEach(r => {
          const d = dateOnly(r.SampleDateTime);
          if (!d) return;
          const k = `${r.Farm||''}|${r.SiteName||''}`;
          if (!bySite[k] || bySite[k] < d) bySite[k] = d;
        });
        const cutoff = (() => { const d = new Date(); d.setDate(d.getDate()-180); return d.toISOString().slice(0,10); })();
        let count = 0;
        Object.entries(bySite).forEach(([k, last]) => {
          // Only count sites tested at least once in the audit window
          // (otherwise we'd flag long-decommissioned sites forever).
          if (last < w.from) return;
          if (last < cutoff) count++;
        });
        return { count, target: '0 sites with last test >180d ago' };
      },
    },

    // -------------------------------------------------------------------------
    {
      id: 'pesticide-label-coverage',
      title: 'Pesticides used in audit window without a label URL',
      module: 'M3',
      severity: 'must-be-zero',
      detailPage: 'pesticide-label-coverage.html',
      status: 'ready',
      async run(w) {
        const [sprays, masterRows] = await Promise.all([
          fetchSheet('grow', 'grow_spray_sched'),
          fetchSheet('invnt', 'invnt_item_details'),
        ]);
        const norm = s => String(s||'').trim().toLowerCase();
        const master = {};
        masterRows.forEach(r => {
          const k = `${norm(r.ItemName)}|${norm(r.Farm)}`;
          if (k !== '|') master[k] = r;
        });
        const used = new Set();
        sprays.forEach(s => {
          const d = dateOnly(s.SprayingDate); if (!d || d < w.from || d > w.to) return;
          ['Product01','Product02','Product03'].forEach(k => {
            const v = String(s[k]||'').trim();
            if (v) used.add(`${norm(v)}|${norm(s.Farm)}`);
          });
        });
        let missing = 0;
        used.forEach(k => {
          const m = master[k];
          if (!m || !String(m.LabelLink||'').trim()) missing++;
        });
        return { count: missing, target: '0' };
      },
    },

    // -------------------------------------------------------------------------
    {
      id: 'pesticide-compliance-review',
      title: 'Pesticide compliance review (label / crop / rate findings)',
      module: 'M3',
      severity: 'must-be-zero',
      detailPage: 'pesticide-compliance-review.html',
      status: 'ready',
      async run(w) {
        // Static count: 4 greenhouse-prohibited + 5 off-label + 2 data-field + 8 rate
        return { count: 19, target: '0 unresolved findings' };
      },
    },

    // -------------------------------------------------------------------------
    {
      id: 'spray-warnings',
      title: 'Spray events flagged with a Warning',
      module: 'M3',
      severity: 'investigate',
      detailPage: 'spray-warnings.html',
      status: 'ready',
      async run(w) {
        const rows = await fetchSheet('grow', 'grow_spray_sched');
        let count = 0;
        rows.forEach(r => {
          const d = dateOnly(r.SprayingDate);
          if (!d || d < w.from || d > w.to) return;
          if (String(r.Warning || '').trim() !== '') count++;
        });
        return { count, target: 'investigate' };
      },
    },

    // -------------------------------------------------------------------------
    {
      id: 'spray-rei-phi',
      title: 'Spray REI / PHI vs harvest',
      module: 'M3/M4',
      severity: 'must-be-zero',
      detailPage: 'spray-rei-phi.html',
      status: 'ready',
      async run(w) {
        // Count sprays where stored PHIStop/REIStop is past the next harvest day.
        // Uses pre-computed sheet columns; matches the detail page's "violation" status
        // (excluding data-error and no-harvest-after categories).
        const [sprays, cukeHarvSched, lettHarv] = await Promise.all([
          fetchSheet('grow', 'grow_spray_sched'),
          fetchSheet('grow', 'grow_C_harvest_sched'),
          fetchSheet('grow', 'grow_L_harvest'),
        ]);
        // Cuke harvests: per (Greenhouse) → sorted [{date, clockInMin}]
        const cukeByGh = {};
        cukeHarvSched.forEach(h => {
          const d = dateOnly(h.HarvestDate); if (!d || !h.Greenhouse) return;
          let mins = null;
          const ci = String(h.ClockInTime || '');
          let m;
          if ((m = ci.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i))) {
            let hh = parseInt(m[1],10) % 12; if (m[3].toUpperCase()==='PM') hh += 12;
            mins = hh*60 + parseInt(m[2],10);
          } else if ((m = ci.match(/T(\d{2}):(\d{2})/))) mins = parseInt(m[1],10)*60+parseInt(m[2],10);
          (cukeByGh[h.Greenhouse] = cukeByGh[h.Greenhouse] || []).push({ date: d, clockIn: mins });
        });
        Object.values(cukeByGh).forEach(a => a.sort((x,y) => x.date.localeCompare(y.date)));
        const lettDates = [...new Set(lettHarv.map(h => dateOnly(h.harvest_date)).filter(Boolean))].sort();
        let count = 0;
        sprays.forEach(s => {
          const sprayDate = dateOnly(s.SprayingDate);
          if (!sprayDate || sprayDate < w.from || sprayDate > w.to) return;
          const farm = String(s.Farm||'').toLowerCase();
          // spray stop minutes (for same-day exclusion)
          let stopMin = null;
          const ss = String(s.SprayingStopTime || '');
          let m;
          if ((m = ss.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i))) {
            let hh = parseInt(m[1],10) % 12; if (m[3].toUpperCase()==='PM') hh += 12;
            stopMin = hh*60 + parseInt(m[2],10);
          } else if ((m = ss.match(/T(\d{2}):(\d{2})/))) stopMin = parseInt(m[1],10)*60+parseInt(m[2],10);
          // find next harvest
          let nextDate = null, nextClockIn = null;
          if (farm === 'cuke') {
            const arr = cukeByGh[s.SiteName] || [];
            const fut = arr.find(h => {
              if (h.date > sprayDate) return true;
              if (h.date < sprayDate) return false;
              return stopMin != null && h.clockIn != null && h.clockIn >= stopMin;
            });
            if (fut) { nextDate = fut.date; nextClockIn = fut.clockIn; }
          } else if (farm === 'lettuce') {
            nextDate = lettDates.find(d => d > sprayDate) || null;
            nextClockIn = 8*60; // assume 8 AM start
          } else return;
          if (!nextDate) return;
          // build harvest start datetime
          const hh = String(Math.floor((nextClockIn||0)/60)).padStart(2,'0');
          const mm = String((nextClockIn||0)%60).padStart(2,'0');
          const harvestStart = new Date(`${nextDate}T${hh}:${mm}:00`);
          // compare to stored stop datetimes
          const phiStop = s.PHIStopDateTime ? new Date(s.PHIStopDateTime) : null;
          const reiStop = s.REIStopDateTime ? new Date(s.REIStopDateTime) : null;
          const phiV = phiStop && harvestStart < phiStop;
          const reiV = reiStop && harvestStart < reiStop;
          if (phiV || reiV) count++;
        });
        return { count, target: '0 violations' };
      },
    },

    // -------------------------------------------------------------------------
    {
      id: 'pre-harvest-coverage',
      title: 'Pre-harvest inspection missing for harvest day',
      module: 'M4',
      severity: 'must-be-zero',
      detailPage: 'pre-harvest-coverage.html',
      status: 'ready',
      async run(w) {
        const [cukeHarv, lettHarv, cukePre, lettPre] = await Promise.all([
          fetchSheet('grow',  'grow_C_harvest'),
          fetchSheet('grow',  'grow_L_harvest'),
          fetchSheet('fsafe', 'fsafe_log_C_gh_pre'),
          fetchSheet('fsafe', 'fsafe_log_L_gh_pre'),
        ]);
        // Cuke: pre-harvest tab uses Greenhouse(s) field "HI+08+07+03+KO+HK+01"
        const cukeApprovedByDateGh = {}; // date -> Set(GH)
        cukePre.forEach(r => {
          const d = dateOnly(r['Checked Date']); if (!d) return;
          const approved = String(r['Approved to Harvest'] || '').toLowerCase() === 'true';
          if (!approved) return;
          const ghs = String(r['Greenhouse(s)'] || '').split('+').map(g => g.trim()).filter(Boolean);
          if (!cukeApprovedByDateGh[d]) cukeApprovedByDateGh[d] = new Set();
          ghs.forEach(g => cukeApprovedByDateGh[d].add(g));
        });
        const cukeHarvestKeys = new Set();
        cukeHarv.forEach(r => {
          const d = dateOnly(r.HarvestDate); if (!d || d < w.from || d > w.to) return;
          if (!r.Greenhouse) return;
          cukeHarvestKeys.add(`${d}|${r.Greenhouse}`);
        });
        let missingCuke = 0;
        cukeHarvestKeys.forEach(k => {
          const [d, gh] = k.split('|');
          if (!cukeApprovedByDateGh[d] || !cukeApprovedByDateGh[d].has(gh)) missingCuke++;
        });

        // Lettuce: one GH; pre-harvest tab is one row per day.
        const lettApprovedDates = new Set();
        lettPre.forEach(r => {
          const d = dateOnly(r['Checked Date']); if (!d) return;
          const approved = String(r['Approved to Harvest'] || '').toLowerCase() === 'true';
          if (approved) lettApprovedDates.add(d);
        });
        const lettHarvestDates = new Set();
        lettHarv.forEach(r => {
          const d = dateOnly(r.harvest_date); if (!d || d < w.from || d > w.to) return;
          lettHarvestDates.add(d);
        });
        let missingLett = 0;
        lettHarvestDates.forEach(d => { if (!lettApprovedDates.has(d)) missingLett++; });
        return { count: missingCuke + missingLett, target: '0' };
      },
    },

    // -------------------------------------------------------------------------
    {
      id: 'pest-trap-cadence',
      title: 'Pest stations with >31-day gap between checks',
      module: 'M5',
      severity: 'must-be-zero',
      detailPage: 'pest-trap-cadence.html',
      status: 'ready',
      async run(w) {
        const rows = await fetchSheet('fsafe', 'fsafe_log_pest');
        // Station(s) field is "+"-delimited; expand to one entry per station.
        const byStation = {};
        rows.forEach(r => {
          const d = dateOnly(r['Checked Date']); if (!d) return;
          const stations = String(r['Station(s)']||'').split('+').map(s => s.trim()).filter(Boolean);
          stations.forEach(st => {
            const k = `${r.Farm||''}|${r['Site Name']||''}|${st}`;
            (byStation[k] = byStation[k] || []).push(d);
          });
        });
        let count = 0;
        Object.values(byStation).forEach(dates => {
          const inWin = [...new Set(dates)].filter(d => d >= w.from && d <= w.to).sort();
          if (inWin.length < 2) return;
          for (let i = 1; i < inWin.length; i++) {
            const gap = (new Date(inWin[i]) - new Date(inWin[i-1])) / 86400000;
            if (gap > 31) { count++; break; }
          }
        });
        return { count, target: '0 stations with >31d gap' };
      },
    },

    // CCP/dryer removed — Aloha's HACCP plan does not designate a CCP.

    // -------------------------------------------------------------------------
    {
      id: 'spray-data-quality',
      title: 'Spray data quality (REI/PHI consistency, rate, time)',
      module: 'data-quality',
      severity: 'investigate',
      detailPage: 'spray-data-quality.html',
      status: 'ready',
      async run(w) {
        // Count sprays in window with at least one issue (any of the categories
        // surfaced on spray-data-quality.html).
        let masterRows = [];
        try { masterRows = await fetchSheet('invnt', 'invnt_item_details'); }
        catch (e) {
          if (window.CHEM_MASTER && window.CHEM_MASTER.rows) masterRows = window.CHEM_MASTER.rows;
          else return { count: null, target: 'see detail page', blocked: true };
        }
        const sprays = await fetchSheet('grow', 'grow_spray_sched');
        const norm = s => String(s||'').trim().toLowerCase();
        const master = {};
        masterRows.forEach(r => {
          const item = norm(r.ItemName), farm = norm(r.Farm);
          if (item && farm) master[`${item}|${farm}`] = r;
        });
        const FARM_ACRES = { cuke: 1, lettuce: 2.5 };
        let count = 0;
        sprays.forEach(s => {
          const d = dateOnly(s.SprayingDate);
          if (!d || d < w.from || d > w.to) return;
          let issue = false;
          const farm = String(s.Farm||'');
          const acres = FARM_ACRES[norm(farm)] || 1;
          // missing critical data
          if (!s.SprayingDate || !s.Farm || !s.SiteName ||
              !s.SprayingStartTime || !s.SprayingStopTime ||
              s.PHIDays === '' || s.PHIDays == null ||
              s.REIlHours === '' || s.REIlHours == null ||
              !s.Product01) { issue = true; }
          // products
          let maxPhi = 0, maxRei = 0, anyMaster = false;
          for (let i = 1; i <= 3; i++) {
            const name = s[`Product0${i}`]; if (!name) continue;
            const qty  = Number(s[`Product0${i}Quantity`]);
            const unit = s[`Product0${i}Units`] || '';
            const m = master[`${norm(name)}|${norm(farm)}`];
            if (!m) { issue = true; continue; }
            anyMaster = true;
            if (m.PHIDays != null && Number(m.PHIDays) > maxPhi) maxPhi = Number(m.PHIDays);
            if (m.REIHours != null && Number(m.REIHours) > maxRei) maxRei = Number(m.REIHours);
            if (m.QuantityPerAcre != null && !isNaN(qty) &&
                qty > Number(m.QuantityPerAcre) * acres) issue = true;
            if (m.PerAcreUnits && unit &&
                norm(m.PerAcreUnits).replace(/s$/,'') !== norm(unit).replace(/s$/,'')) issue = true;
          }
          if (anyMaster) {
            const phi = Number(s.PHIDays), rei = Number(s.REIlHours);
            if (!isNaN(phi) && phi < maxPhi) issue = true;
            if (!isNaN(rei) && rei < maxRei) issue = true;
          }
          if (issue) count++;
        });
        return { count, target: 'investigate' };
      },
    },

    // -------------------------------------------------------------------------
    {
      id: 'training-currency',
      title: 'Employees with no training signed in last 12 months',
      module: 'M4/M6',
      severity: 'investigate',
      detailPage: 'training-currency.html',
      status: 'ready',
      async run(w) {
        const rows = await fetchSheet('fsafe', 'fsafe_log_training_employees');
        const byEmp = {};
        rows.forEach(r => {
          const sig = dateOnly(r.DigitalSignatureDateTime || r.TrainingDateTime);
          if (!sig) return;
          const name = (r.FullName || '').trim();
          if (!name) return;
          if (!byEmp[name] || byEmp[name] < sig) byEmp[name] = sig;
        });
        const cutoff = (() => { const d = new Date(); d.setMonth(d.getMonth()-12); return d.toISOString().slice(0,10); })();
        let count = 0;
        Object.values(byEmp).forEach(latest => { if (latest < cutoff) count++; });
        return { count, target: 'investigate' };
      },
    },

    // -------------------------------------------------------------------------
    {
      id: 'orphan-fulfillments',
      title: 'Sales orders with no pack date / lot link (traceability orphans)',
      module: 'M1',
      severity: 'must-be-zero',
      detailPage: 'orphan-fulfillments.html',
      status: 'ready',
      async run(w) {
        const rows = await fetchSheet('sales', 'sales_po');
        let count = 0;
        rows.forEach(r => {
          const inv = dateOnly(r.InvoiceDate); if (!inv || inv < w.from || inv > w.to) return;
          const qty = Number(r.InvoiceQuantity); if (!qty || isNaN(qty)) return;
          const farm = String(r.Farm || '').toLowerCase();
          const hasPackDate = ['PackDate01','PackDate02','PackDate03','PackDate04','PackDate05','PackDate06']
            .some(k => r[k]);
          const hasPackLot  = ['PackLot01','PackLot02','PackLot03','PackLot04','PackLot05','PackLot06']
            .some(k => r[k]);
          if (farm === 'lettuce') {
            // Lettuce uses lot-code traceability
            if (!hasPackLot) count++;
          } else {
            // Cuke uses pack-date traceability
            if (!hasPackDate) count++;
          }
        });
        return { count, target: '0' };
      },
    },

    // -------------------------------------------------------------------------
    {
      id: 'hygiene-nc-closure',
      title: 'Hygiene-related corrective actions still open',
      module: 'M4',
      severity: 'investigate',
      detailPage: 'hygiene-nc-closure.html',
      status: 'ready',
      async run(w) {
        const rows = await fetchSheet('fsafe', 'fsafe_log_corrective_action');
        const HYGIENE_RX = /(hygien|ppe|jewelr|hand|wash|hairnet|glove|footwear|clothing|sanitiz|wound|sore|illness)/i;
        let count = 0;
        rows.forEach(r => {
          const reported = dateOnly(r.ReportedDate);
          if (!reported || reported < w.from || reported > w.to) return;
          const text = `${r.Warning || ''} ${r.CorrectiveAction || ''} ${r.Log || ''}`;
          if (!HYGIENE_RX.test(text)) return;
          if (r.VerifiedDateTime && String(r.VerifiedDateTime).trim() !== '') return;
          count++;
        });
        return { count, target: '0' };
      },
    },

    // open-maintenance check removed — not a GFS audit point.

    // -------------------------------------------------------------------------
    {
      id: 'glass-incidents',
      title: 'Glass / brittle plastic warnings unresolved',
      module: 'M5',
      severity: 'must-be-zero',
      detailPage: 'glass-incidents.html',
      status: 'ready',
      async run(w) {
        const rows = await fetchSheet('fsafe', 'fsafe_log_glass');
        let count = 0;
        rows.forEach(r => {
          const checked = dateOnly(r['Checked Date']);
          if (!checked || checked < w.from || checked > w.to) return;
          const warn = String(r.Warning || '').trim();
          if (!warn) return;
          if (r['Verified Time'] && String(r['Verified Time']).trim() !== '') return;
          count++;
        });
        return { count, target: '0' };
      },
    },
  ];

  async function runAll(w) {
    return Promise.all(CHECKS.map(async c => {
      try {
        const r = await c.run(w);
        return { ...c, ...r, error: null };
      } catch (e) {
        console.error('check failed', c.id, e);
        return { ...c, count: null, error: e.message || String(e) };
      }
    }));
  }

  global.FSAuditChecks = { CHECKS, runAll };
})(window);
