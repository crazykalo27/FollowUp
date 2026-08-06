-- Refresh PostgREST schema cache (avoids transient 400s after column adds)
notify pgrst, 'reload schema';
