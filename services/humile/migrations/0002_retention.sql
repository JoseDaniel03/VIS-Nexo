-- Opt-in RETENTION procedure for operators. Do not schedule until backups,
-- user warnings and export functionality are operational.
CREATE OR REPLACE FUNCTION humile_count_expired_messages()
RETURNS bigint LANGUAGE sql STABLE AS $$
    SELECT count(*) FROM humile_messages WHERE expires_at < now();
$$;
CREATE OR REPLACE FUNCTION humile_purge_expired_messages(batch_limit integer DEFAULT 500)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE deleted_count integer;
BEGIN
    IF batch_limit < 1 OR batch_limit > 5000 THEN
        RAISE EXCEPTION 'batch_limit must be between 1 and 5000';
    END IF;
    WITH victims AS (
        SELECT id FROM humile_messages
        WHERE expires_at < now()
        ORDER BY expires_at, id LIMIT batch_limit
        FOR UPDATE SKIP LOCKED
    )
    DELETE FROM humile_messages WHERE id IN (SELECT id FROM victims);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END $$;
-- DO NOT run this automatically from the desktop application.
-- Run in controlled batches from a trusted server after backup and advance notice.
