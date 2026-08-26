# Changelog

All notable changes to BusinessVault are recorded here. This file is kept in
sync with `package.json` on every PR — see feedback_1_to_7.md §19 and the
per-PR-version-bump policy.

## 0.11.0 — 2026-08-26

### Round Off (feedback_1_to_7.md §1)

- Invoices, Purchases, and Sales Returns now persist an explicit
  `round_off_mode` (`auto` | `none` | `manual`) alongside the existing
  `round_off_paise` so the shopkeeper's rounding choice survives edits,
  restores, and reports.
- New `pre_round_total_paise` field on the same three tables records the
  taxable + GST + cess sum before rounding is applied. Together with
  `round_off_paise`, this makes the header self-describing.
- Invoice form: added a compact "Round off" control in the totals block —
  Auto (nearest ₹1, banker's rounding), None, or Manual (± rupees) — plus a
  "Subtotal" row shown when rounding is active so the pre-round total is
  visible at a glance.
- Journal entries continue to post the rounding difference to the existing
  `4900 Round Off` (other income) account, so the trial balance stays
  balanced to the paise regardless of the mode chosen.
- Dexie schema bumped to **v6**. Upgrade backfills existing rows with
  `round_off_mode = 'auto'` and `pre_round_total_paise = total_paise -
  round_off_paise`, preserving the invariant `pre_round + round_off =
  total`.
