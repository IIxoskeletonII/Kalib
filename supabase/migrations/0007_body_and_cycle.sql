-- Kalib — waist measurements (§14, core/body.ts). Run once in the SQL editor; safe to re-run.
--
-- Cycle starts and the diet-break schedule need no columns: both live in `settings`, the same
-- way `mode_schedule` does, and sync through the existing settings table.

alter table public.weigh_ins add column if not exists waist_cm numeric;

-- §8.2 — a recipe imported from a link keeps the page it came from, so credit stays with the
-- publisher. `source` gains 'imported' alongside 'own' and 'suggested' (it is free text here).
alter table public.recipes add column if not exists source_url text;
