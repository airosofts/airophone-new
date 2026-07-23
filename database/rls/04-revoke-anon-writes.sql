-- Immediate containment: strip write privileges from the public key's role.
-- Reversible with GRANT. `authenticated` (Path A logged-in browser) keeps its
-- grants, so the "delete conversation" browser action still works post-Path A.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;
