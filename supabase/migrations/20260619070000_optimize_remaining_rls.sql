-- Preserve existing access semantics while avoiding per-row auth.uid() calls.

drop policy if exists "Users own transactions" on public.transactions;
create policy "Users own transactions" on public.transactions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own clicks" on public.affiliate_clicks;
create policy "Users can insert own clicks" on public.affiliate_clicks
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can view own clicks" on public.affiliate_clicks;
create policy "Users can view own clicks" on public.affiliate_clicks
  for select to authenticated
  using ((select auth.uid()) = user_id);
