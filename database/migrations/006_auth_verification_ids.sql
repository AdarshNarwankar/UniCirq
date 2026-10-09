-- Better Auth uses deterministic string IDs for first-writer-wins verification locks.
-- Preserve existing UUID values as strings; users, sessions and account IDs stay UUIDs.
ALTER TABLE verification ALTER COLUMN id TYPE text USING id::text;
