-- 0005_merge_archived_into_closed.sql
-- A deal is now either active or closed. "archived" is gone.
--
-- Closed and Archived behaved identically: both left the deal editable,
-- generatable and downloadable, kept its answers and its PDFs, and differed
-- only in which dashboard tab listed them. The only rule the app enforced was
-- that Archive had to come after Close — one extra click that changed nothing.
-- Collapsing them removes a choice that looked meaningful and was not.
--
-- If a second tier comes back it should come back with a real behaviour (for
-- example, dropping the regenerable PDFs and keeping the answers), not as a
-- second name for the same state. See ISSUES.md, retention policy.

begin;

update public.deals
   set status = 'closed'
 where status = 'archived';

alter table public.deals drop constraint deals_status_check;
alter table public.deals
  add constraint deals_status_check check (status in ('active', 'closed'));

commit;
