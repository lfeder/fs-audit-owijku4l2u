# Schema questions for dev team — audit_pre_check view

These are columns we need for the 10 PrimusGFS audit-readiness checks where the column comment is missing or unclear. Goal: get column comments populated so we can write the SQL view confidently.

For each table, columns whose meaning is obvious (id, org_id, farm_id, created_at/by, updated_at/by, is_deleted, display_order, notes) are excluded.

---

## fsafe_lab
- description (text) — Is this the lab's display name, or a free-text descriptor? We want to surface it on the audit dashboard.

## fsafe_lab_test
- result_type (text NN) — Comment lists "enum, numeric" — please confirm those are the only two values (no boolean).
- test_description (text) — Is this the test's human-readable name (e.g. "ATP swab", "E. coli quant")? We need a label for audit reporting.

## fsafe_result
- fsafe_test_hold_id (uuid) — Confirm: non-null only when this row is a test-and-hold result; null for EMP/water? We use this to separate EMP from product test-and-hold for the failure follow-up check.
- fail_code (text) — Free-text or controlled enum? List of values? Needed to categorize EMP failures.
- initial_retest_vector (text) — Comment lists values; please confirm a retest row's `fsafe_result_id_original` always points to the failing initial. Critical for the "follow-up retest within 7d" check.
- status (text NN) — When does a row sit in `pending` vs `in_progress`? We treat anything not `completed` past sampled_at as overdue — confirm.
- verified_at / verified_by — Required for CCP signature check (#6). Is verification mandatory for EMP/lab results, or optional?

## fsafe_test_hold
- delivered_to_lab_on (date) — Is this the clock-start for the "lab follow-up within 7d" check, or do we use fsafe_result.sampled_at? Please clarify which timestamp is canonical.
- lab_test_id (text) — Differs from fsafe_result.fsafe_lab_test_id? Is this the planned test vs the actual? Need to know which to join on.

## grow_spray_compliance
- (all columns appear well-documented — no questions)

## grow_spray_input
- application_quantity (numeric NN) — Confirm the unit is `application_uom` on the same row, used to enforce `maximum_quantity_per_acre`. Needed to flag over-label applications.
- (no field captures the actual `applied_at` timestamp on the input row — we assume it's `ops_task_tracker.start_time` via ops_task_tracker_id. Please confirm this is the right way to date a spray for PHI/REI checks. If there's a separate application timestamp we're missing, point us to it.)
- (no field links the spray to the specific row/site/section being sprayed. We assume site coverage comes from `ops_task_tracker.site_id`. Confirm — for PHI/REI vs harvest we need to know which site the chemical was applied to so we can match it to `grow_harvest_weight.site_id`.)

## grow_harvest_weight
- grow_grade_id (text) — Optional/required at audit time? We may need to flag harvests with no grade assigned.

## hr_disciplinary_warning
- offense_type (text) — Free-text or enum? We want to filter to hygiene-related offenses for check #9. List of values?
- status (text NN) — Comment says "pending, reviewed". Is `reviewed` what we treat as "closed" for disciplinary closure? Or is `is_acknowledged = true` the closure signal? Please clarify which is canonical.
- warning_date vs reported_at — Which timestamp do we anchor "within X days of NC" against?

## hr_employee
- end_date (date) — Is non-null = terminated? We need to exclude terminated employees from training-currency check.
- start_date (date) — Used to determine "first 30 days" onboarding training window — confirm this is the hire date.

## maint_request
- equipment_id — How do we know an equipment item is food-contact or glass-break-relevant? `org_equipment.type` only lists vehicle/tool/machine/ppe/sprayer/fogger/tank — none of those map to "food-contact" or "glass". Is there a separate flag, category, or naming convention we should use? This is a blocker for check #10.
- recurring_frequency — When a recurring request is auto-recreated, does the new row reference the original? We need to detect "always-overdue" recurring PM.

## ops_corrective_action_taken
- is_resolved (boolean NN) — Is this the canonical "closed" signal, or do we also require `verified_at`? For the "open/overdue CA" check, what counts as closed?
- due_date (date) — Always populated when a CA is opened? Or nullable in practice?
- assigned_to (text) — References hr_employee.id?

## ops_task_tracker
- ops_task_id (text NN) — References ops_task (not in this schema dump). We need a way to filter to "pre-harvest inspection" / "pre-op sanitation" / "rodent station check" tasks. Is there a stable task code/key, or do we string-match on description? Please share the ops_task table.
- verified_at / verified_by — Same question as fsafe_result: is verification mandatory for CCP-class tasks?

## ops_template
- org_module_id (text) — Does this distinguish food-safety/CCP templates from operational checklists? We need a way to filter ops_template_result to CCP-only for check #6. List of module IDs?
- description (text) — Is this what we display to users? We may need to keyword-match "hygiene", "pre-op", "pre-harvest" — is there a more structured tag?

## ops_template_question
- response_type (text NN) — Comment lists boolean/numeric/enum. For check #6 (CCP gaps), which questions are CCP critical limits? Is there a flag we're missing (e.g. is_ccp, is_critical)?

## ops_template_result
- ops_template_question_id (uuid) — Comment says "null for ATP surface test results". Are there other null cases we should know about?
- (no `passed` boolean — we have to derive pass/fail by comparing the response_* columns against ops_template_question.boolean_pass_value / min/max / enum_pass_options. Confirm this is intentional, and that there's no materialized pass column anywhere.)

## ops_training
- training_date (date) — Nullable per schema; is a non-null value required before the training is "official"?
- verified_at / verified_by — Required, or optional?

## ops_training_attendee
- signed_at (timestamp) — Is this the attendee's signature timestamp = "they actually completed the training"? We want to use this (not ops_training.training_date) as the currency anchor. Confirm.
- certification_expires_on (date) — Populated only for certifications, not for general trainings? For training-currency we'd prefer a per-training-type "valid for N months" rule — does that exist on ops_training_type?

## ops_training_type
- description (text) — Need to identify which training types are mandatory annually (food safety, hygiene, GMP). Is there a `is_mandatory` / `recurrence_months` flag we're missing? Without it we can't compute "training is current" without hardcoding type IDs.

## org_equipment
- type (text) — Listed values: vehicle, tool, machine, ppe, bag_pack_sprayer, fogger, tank. None indicate food-contact vs non-food-contact. Add a `food_contact` boolean or a dedicated category? Needed for check #10.
- (no field for "glass / brittle plastic" classification — needed for glass-break monitoring check.)

## org_site
- zone (text) — Comment lists zone_1..zone_4, water. For pest-monitoring cadence (check #5) we need to know "interior vs exterior" of each pest_trap site. Is `zone` the right proxy? Or is there another field on pest-trap sites? Please document.
- monitoring_stations (jsonb NN) — Comment says rendered in `grow_monitoring_result.monitoring_station` — that table isn't in this dump. Is it relevant to pest monitoring or only to growing?

## pack_dryer_result
- dryer_temperature / moisture_after_dryer / belt_speed — Which of these are CCP critical limits with mandatory pass/fail thresholds? Where are the thresholds stored? We don't see a pass/fail column on this table — is that derived elsewhere? Blocker for check #6.
- (no `verified_at` / `verified_by` on this table — so CCP verifier-signature check can't run on dryer results. Is verification tracked elsewhere, or is this a gap?)

## pack_lot
- harvest_date (date) — Comment says optional. For traceability + REI/PHI check this is the link to harvest. Is it consistently populated in practice?
- (no link from pack_lot back to grow_harvest_weight or grow_cuke_seed_batch / grow_lettuce_seed_batch. We can only join on `harvest_date` + `farm_id`, which is fuzzy. Is there a more direct linkage we're missing? This is a partial blocker for traceability check #8.)

## pack_lot_item
- (no questions — well documented)

## sales_po_fulfillment
- pack_lot_id — Comment says "links fulfilled quantity to a specific production lot". Is this required at fulfillment time, or can it be null? For mock-recall traceability we treat null as an orphan — confirm.

---

## Tables/columns we expect to exist but didn't see in this dump

We probably need these to write the view. Please confirm whether they exist:

- `ops_task` — referenced by ops_task_tracker.ops_task_id and ops_task_template.ops_task_id. Need its columns (especially any task-type / category / is_pre_harvest / is_pre_op flag).
- `org_module` — referenced by ops_template.org_module_id. Need to know module IDs for CCP / food safety filtering.
- `sales_product` — referenced by sales_po_line.sales_product_id, pack_lot_item.sales_product_id. Need shelf_life_days for best_by validation, and potentially a food-contact / risk classification.
- `org_site_category` — referenced by org_site. We need the category names (food_safety, pest_trap, growing, etc) to filter sites in checks #4, #5.
- `invnt_item`, `invnt_lot` — referenced in spray and seed tables. Need at minimum the item description for chemical naming on the audit report.
- `grow_grade` — referenced by grow_harvest_weight.grow_grade_id.

If any of these are missing entirely, that's a blocker we need to flag separately.
