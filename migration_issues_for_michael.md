# Migration data issues — for Michael

Issues surfaced while building PrimusGFS audit-readiness queries against Supabase dev (`kfwqtaazdankxmdlqdak`). These are data-quality / migration-fidelity findings, separate from the schema-comment questions in `schema_questions_for_dev.md`.

---

## 1. Dipel DF — REI/PHI mismatch with source sheet

**What we see**

- Source sheet for spray on **2026-04-22** at site **WA** (applicator Rogélio):
  - Product: **Dipel DF**
  - REI: **12 hr**
  - PHI: **0 days**
- Supabase row for that same event (`grow_spray_input.id = 5e3c9778-40b4-45ba-9c7d-b51e14f5f31a`):
  - Linked compliance row (`grow_spray_compliance.id = f88787d1-d4b4-43fa-95fd-8918c7051cd5`):
    - REI: **4 hr**
    - PHI: **1 day**
  - There is **no Dipel DF compliance row** with REI=12 in the DB, so the sheet value cannot be matched.

**Two underlying problems**

1. **Duplicate Dipel DF compliance records.** Two rows in `grow_spray_compliance` for `invnt_item_id = 'Dipel Df'`:
   - `f88787d1-d4b4-43fa-95fd-8918c7051cd5` — REI 4, PHI 1
   - `d3b066ac-861b-4908-8825-d151f9f9353b` — REI 4, PHI 0

   Both have `epa_registration = 'LEGACY_UNKNOWN'` and `effective_date = 2026-04-28`. Sprays can be linked to either one, which makes audit reporting non-deterministic.

2. **Per-event REI/PHI values from the sheet are not preserved.** The DB design stores REI/PHI on the `grow_spray_compliance` master record (one row per chemical EPA label), not on the spray event. So if a sheet entry recorded a non-standard REI/PHI for a specific application, that information is lost on migration.

**Asks**

- Dedupe the Dipel DF compliance rows.
- Replace `LEGACY_UNKNOWN` with real EPA registration numbers (priority for chemicals actively used in 2026).
- Decide policy: are per-event REI/PHI overrides allowed, and if so where are they stored? If not, audit the sheet history to confirm the REI/PHI master values match what was actually applied.
- Audit script: count any other product where the sheet's REI/PHI columns disagree with the linked compliance record. (Happy to write this once we agree on direction.)

---

## 2. `grow_spray_sched` — `PHIStopDateTime` / `REIStopDateTime` are static (not formulas) and a subset have day/month flipped

The pre-computed stop columns are stored as **static values**, not formulas (i.e. they were written in once, presumably by an Apps Script or manual entry, and don't recompute when other fields change).

A subset of rows has the day and month swapped — only on dates where `day ≤ 12` (so the date is ambiguous between US `MM/DD` and EU `DD/MM`). Example:

| Field | Value |
|---|---|
| SprayingDate | 1/6/2025 (Jan 6) |
| SprayingStopTime | 5:00:00 PM |
| PHIDays | 0 |
| REIlHours | 12 |
| **PHIStopDateTime** | **6/1/2025 17:00:00** (should be `1/6/2025 17:00:00`) |
| **REIStopDateTime** | **6/2/2025 5:00:00** (should be `1/7/2025 5:00:00`) |

Underlying serial numbers confirm a 146-day jump (`45663` → `45809`) — consistent with a parser that read `1/6` as `6/1`.

**Workaround in the audit page:** the spray-rei-phi page ignores the sheet's PHIStopDateTime / REIStopDateTime columns and recomputes them client-side from PHIDays + REIlHours + SprayingStopTime. Counts of affected rows are not catastrophic (most rows look fine) but the bug is silent in the sheet itself, so any other downstream consumer is at risk.

**Ask:** find the source of the writes (Apps Script?), fix the date parsing, and re-run a one-time backfill to correct existing rows. Or, better, replace these columns with live formulas: `=SprayingDate + SprayingStopTime + PHIDays` / `+ REIlHours/24`.

---

## 3. `fsafe_log_emp` — `FailCode` not populated on most failed initials

Of 121 EMP rows with `Pass=FALSE` and `TestType=Initial`, only 30 have a `FailCode` populated. The remaining 91 have no fail code. Without it, the 214 retest/vector rows (which reference `TestFromFailCode`) can't be linked back to their originating initial — only 24 retest/vector rows actually match an initial's FailCode.

**Audit impact:** when an auditor asks "show me the follow-up for this 2024-08-22 Listeria fail", we have no programmatic link, even though the retest was likely performed.

**Workaround in the audit page:** the EMP failure check now treats a failure as having a follow-up if EITHER (a) any row references its FailCode, OR (b) any Retest/Vector with the same TestName exists within 14 days. The loose match catches the actual workflow but masks the bug.

**Ask:** populate `FailCode` consistently on every failed initial (e.g. via Apps Script when a row's Pass is set to FALSE), then backfill historical rows. Same for the converse — every Retest/Vector should reference a real FailCode.

---

*Add new migration findings below as we discover them.*
