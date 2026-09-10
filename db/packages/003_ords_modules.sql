-- Daily Office Calendar — ORDS REST module
--
-- IMPORTANT: this script calls the ORDS.* PL/SQL API, which only exists in a
-- schema AFTER `ords install` (or the `ords` Docker profile) has enabled REST
-- for it at least once. It therefore lives in its own changelog file
-- (db/changelog/2026-09-10-02-ords-rest.yaml), NOT included by
-- db.changelog-master.yaml, and is applied separately once ORDS is up:
--
--   liquibase --changelog-file=db/changelog/2026-09-10-02-ords-rest.yaml update
--
-- Endpoints:
--   GET  /ords/daily-office/availability?from=...&to=...    -> busy intervals only (STAFF-safe, public)
--   POST /ords/daily-office/requests                        -> submit_request (STAFF-facing, used by vercel-demo)
--   POST /ords/daily-office/sync-queue/next                 -> claim_next_sync_item (sync-worker only — restrict via ORDS privilege group, see docker/README.md)
--   GET  /ords/daily-office/sync-queue/event/:event_id       -> event snapshot for the sync-worker (sync-worker only)
--   POST /ords/daily-office/sync-queue/:queue_id/result      -> mark_sync_result (sync-worker only)

BEGIN
    ords.define_module(
        p_module_name    => 'daily.office',
        p_base_path      => '/daily-office/',
        p_items_per_page => 25,
        p_status         => 'PUBLISHED',
        p_comments       => 'Daily Office Calendar public REST API'
    );

    ---------------------------------------------------------------------
    -- GET availability (busy intervals only — no title/description)
    ---------------------------------------------------------------------
    ords.define_template(
        p_module_name => 'daily.office',
        p_pattern     => 'availability'
    );

    ords.define_handler(
        p_module_name => 'daily.office',
        p_pattern     => 'availability',
        p_method      => 'GET',
        p_source_type => ords.source_type_query,
        p_source      => q'[
            SELECT starts_at, ends_at
            FROM   TABLE(daily_office_api.get_availability(
                     TO_TIMESTAMP_TZ(:from_ts, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),
                     TO_TIMESTAMP_TZ(:to_ts,   'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM')))
        ]'
    );

    ---------------------------------------------------------------------
    -- POST requests (STAFF submits a request — used by vercel-demo)
    ---------------------------------------------------------------------
    ords.define_template(
        p_module_name => 'daily.office',
        p_pattern     => 'requests'
    );

    ords.define_handler(
        p_module_name    => 'daily.office',
        p_pattern        => 'requests',
        p_method         => 'POST',
        p_source_type    => ords.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            DECLARE
                l_id office_requests.id%TYPE;
            BEGIN
                l_id := daily_office_api.submit_request(
                            p_requested_by => :requested_by,
                            p_event_type   => :event_type,
                            p_title        => :title,
                            p_starts_at    => TO_TIMESTAMP_TZ(:starts_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),
                            p_ends_at      => TO_TIMESTAMP_TZ(:ends_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),
                            p_note         => :note);
                :request_id  := l_id;
                :status_code := 201;
            END;
        ]'
    );

    ords.define_parameter(
        p_module_name        => 'daily.office',
        p_pattern            => 'requests',
        p_method             => 'POST',
        p_name               => 'request_id',
        p_bind_variable_name => 'request_id',
        p_source_type        => 'RESPONSE',
        p_param_type         => 'INT',
        p_access_method      => 'OUT'
    );

    ---------------------------------------------------------------------
    -- POST sync-queue/next (sync-worker claims one pending row)
    ---------------------------------------------------------------------
    ords.define_template(
        p_module_name => 'daily.office',
        p_pattern     => 'sync-queue/next'
    );

    ords.define_handler(
        p_module_name => 'daily.office',
        p_pattern     => 'sync-queue/next',
        p_method      => 'POST',
        p_source_type => ords.source_type_plsql,
        p_source      => q'[
            DECLARE
                l_row calendar_sync_queue%ROWTYPE;
            BEGIN
                l_row := daily_office_api.claim_next_sync_item;
                IF l_row.id IS NULL THEN
                    :status_code := 204;
                ELSE
                    :queue_id        := l_row.id;
                    :event_id        := l_row.event_id;
                    :operation       := l_row.operation;
                    :idempotency_key := l_row.idempotency_key;
                    :attempts        := l_row.attempts;
                    :status_code     := 200;
                END IF;
            END;
        ]'
    );

    FOR p IN (
        SELECT 'queue_id' AS name, 'INT' AS ptype FROM dual
        UNION ALL SELECT 'event_id', 'INT' FROM dual
        UNION ALL SELECT 'operation', 'STRING' FROM dual
        UNION ALL SELECT 'idempotency_key', 'STRING' FROM dual
        UNION ALL SELECT 'attempts', 'INT' FROM dual
    ) LOOP
        ords.define_parameter(
            p_module_name        => 'daily.office',
            p_pattern            => 'sync-queue/next',
            p_method             => 'POST',
            p_name               => p.name,
            p_bind_variable_name => p.name,
            p_source_type        => 'RESPONSE',
            p_param_type         => p.ptype,
            p_access_method      => 'OUT'
        );
    END LOOP;

    ---------------------------------------------------------------------
    -- POST sync-queue/:queue_id/result (sync-worker reports outcome)
    ---------------------------------------------------------------------
    ords.define_template(
        p_module_name => 'daily.office',
        p_pattern     => 'sync-queue/:queue_id/result'
    );

    ords.define_handler(
        p_module_name => 'daily.office',
        p_pattern     => 'sync-queue/:queue_id/result',
        p_method      => 'POST',
        p_source_type => ords.source_type_plsql,
        p_source      => q'[
            BEGIN
                daily_office_api.mark_sync_result(
                    p_queue_id => :queue_id,
                    p_status   => :sync_status,
                    p_error    => :error_message);
                :status_code := 204;
            END;
        ]'
    );

    ords.define_parameter(
        p_module_name        => 'daily.office',
        p_pattern            => 'sync-queue/:queue_id/result',
        p_method             => 'POST',
        p_name               => 'queue_id',
        p_bind_variable_name => 'queue_id',
        p_source_type        => 'URI',
        p_param_type         => 'INT',
        p_access_method      => 'IN'
    );

    ---------------------------------------------------------------------
    -- GET sync-queue/event/:event_id (event snapshot for the sync-worker
    -- to build the Google Calendar contract payload — title/location/times)
    ---------------------------------------------------------------------
    ords.define_template(
        p_module_name => 'daily.office',
        p_pattern     => 'sync-queue/event/:event_id'
    );

    ords.define_handler(
        p_module_name => 'daily.office',
        p_pattern     => 'sync-queue/event/:event_id',
        p_method      => 'GET',
        p_source_type => ords.source_type_query,
        p_source      => q'[
            SELECT id AS event_id, title, location, starts_at, ends_at, google_event_id
            FROM   office_events
            WHERE  id = :event_id
        ]'
    );

    COMMIT;
END;
