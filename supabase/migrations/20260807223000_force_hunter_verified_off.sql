-- Force Hunter / verified-email off for existing accounts (old schema defaulted true)

update public.search_filters
set
  filters = filters
    || jsonb_build_object(
      'enable_hunter', false,
      'require_verified_email', false
    ),
  updated_at = now()
where coalesce((filters->>'enable_hunter')::boolean, false) = true
   or coalesce((filters->>'require_verified_email')::boolean, false) = true;
