# Data corrections log — FS audit prep

A running log of data issues found during PrimusGFS audit-readiness work, and
the fixes applied. Open issues live in `migration_issues_for_michael.md`;
this file is the **history** of corrections that have been completed.

Format per entry:
```
## YYYY-MM-DD — Short title
**Source:** sheet/tab or DB table
**Found by:** how it surfaced (which page / which check)
**Issue:** what was wrong
**Fix:** what was changed and where
**Affected rows:** how many / scope
```

---

## 2026-04-29 — `grow_spray_sched` row 634 — wrong PHIStopDateTime on 6/3/2025

**Source:** `grow` sheet → `grow_spray_sched` tab, row 634

**Found by:** spray-rei-phi.html flagged a 6/3/2025 Cuke 07 Nanocrop spray (PHI=0, REI=0) as a PHI violation against a 6/4/2025 12:30 harvest.

**Issue:** PHIStopDateTime was stored as `6/4/2025 14:37:00` when it should have been `6/3/2025 17:09:00` (matching the SprayingStopTime, since PHI=0). REIStop on this row was correct. Not a DMY flip — the date and time portions are both unrelated to the spray.

**Fix:** Lenny corrected the row in the sheet on 2026-04-29.

**Affected rows:** 1 row (this one). Row 636 on the same date also looked wrong (PHIStopDateTime before the spray stop) — status of that fix unknown.

---

## 2026-04-29 — `grow_spray_sched` row 816 — same day/month flip on 10/12/2025

**Source:** `grow` sheet → `grow_spray_sched` tab, row 816

**Found by:** spray-rei-phi.html flagged a 10/12/2025 Cuke 04 spray (Luna Experience + Succes + Oxidate 5.0, PHI=7, REI=12) as a PHI+REI violation against an 11/3/2025 harvest.

**Issue:** Same DMY/MDY parsing bug as the 4/28 corrections — writer interpreted `10/12/2025` as Dec 10 instead of Oct 12.
- `PHIStopDateTime` stored as `12/17/2025 16:30:00` (should be `10/19/2025 16:30:00`)
- `REIStopDateTime` stored as `12/11/2025 4:30:00` (should be `10/13/2025 4:30:00`)

**Fix:** Lenny corrected the row in the sheet on 2026-04-29.

**Affected rows:** 1 row (this one). 76 other rows still flagged in `spray_stop_mismatches.csv` from the same root cause.

---

## 2026-04-28 — Spray sheet PHIStopDateTime / REIStopDateTime day/month flip

**Source:** `grow` sheet → `grow_spray_sched` tab, columns `PHIStopDateTime` and `REIStopDateTime`

**Found by:** FS spray-rei-phi.html flagging a 1/6/2025 Vivando spray on Cuke 05 as a PHI+REI violation when the harvest happened a day later (within REI window per the sheet, well outside it per the actual values).

**Issue:** The two stop-time columns are stored as **static values, not formulas**. On a subset of rows where `day ≤ 12` (so the date is ambiguous between US `MM/DD` and EU `DD/MM`), the day and month were swapped — e.g. `SprayingDate = 1/6/2025` but `PHIStopDateTime = 6/1/2025`. Underlying serials confirmed the 146-day jump (45663 → 45809).

**Fix:** Lenny corrected the affected rows directly in the sheet on 2026-04-28.

**Affected rows:** subset of `grow_spray_sched` rows with `SprayingDate.day ≤ 12`. Exact count not measured at the time of fix.

**Follow-up still open:** the underlying writer (likely an Apps Script) still has the parsing bug. See `migration_issues_for_michael.md` §2.
