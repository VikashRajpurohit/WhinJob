-- Trigger functions are invoked by the trigger, never over PostgREST. Leaving
-- EXECUTE granted exposes them as /rpc/ endpoints to anon (security advisor 0028/0029).
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
