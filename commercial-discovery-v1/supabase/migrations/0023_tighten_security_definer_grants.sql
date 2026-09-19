-- Tighten callable surface area for SECURITY DEFINER helpers.
-- consume_ai_budget is invoked only by authenticated application requests.
-- handle_new_user is a trigger function and should not be directly callable by clients.

revoke all on function public.consume_ai_budget(uuid, text, integer) from public;
revoke all on function public.consume_ai_budget(uuid, text, integer) from anon;
grant execute on function public.consume_ai_budget(uuid, text, integer) to authenticated;
grant execute on function public.consume_ai_budget(uuid, text, integer) to service_role;

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;
grant execute on function public.handle_new_user() to service_role;

