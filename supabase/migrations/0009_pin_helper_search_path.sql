-- 0009: pin the search_path of the remaining helper functions (Supabase linter 0011).
alter function app.touch_updated_at() set search_path = '';
alter function app.patients_guard() set search_path = '';
alter function app.b64url(bytea) set search_path = '';
alter function app.audit_immutable() set search_path = '';
