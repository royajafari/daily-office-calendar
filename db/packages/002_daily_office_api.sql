-- Daily Office Calendar — business logic
-- All CRUD on office_events and request review MUST go through this package so
-- that conflict-checking, availability privacy and sync-queue enrollment stay consistent.

CREATE OR REPLACE PACKAGE daily_office_api AS

    e_invalid_range   EXCEPTION;
    e_conflict        EXCEPTION;
    e_not_found       EXCEPTION;
    e_already_reviewed EXCEPTION;
    e_invalid_decision EXCEPTION;
    PRAGMA EXCEPTION_INIT(e_invalid_range, -20001);
    PRAGMA EXCEPTION_INIT(e_conflict, -20002);
    PRAGMA EXCEPTION_INIT(e_not_found, -20003);
    PRAGMA EXCEPTION_INIT(e_already_reviewed, -20004);
    PRAGMA EXCEPTION_INIT(e_invalid_decision, -20005);

    TYPE t_busy_row IS RECORD (
        starts_at office_events.starts_at%TYPE,
        ends_at   office_events.ends_at%TYPE
    );
    TYPE t_busy_tab IS TABLE OF t_busy_row;

    FUNCTION create_event(
        p_event_type   IN office_events.event_type%TYPE,
        p_title        IN office_events.title%TYPE,
        p_starts_at    IN office_events.starts_at%TYPE,
        p_ends_at      IN office_events.ends_at%TYPE,
        p_created_by   IN office_events.created_by%TYPE,
        p_location     IN office_events.location%TYPE DEFAULT NULL,
        p_description  IN office_events.description%TYPE DEFAULT NULL
    ) RETURN office_events.id%TYPE;

    PROCEDURE update_event(
        p_event_id    IN office_events.id%TYPE,
        p_title       IN office_events.title%TYPE,
        p_starts_at   IN office_events.starts_at%TYPE,
        p_ends_at     IN office_events.ends_at%TYPE,
        p_location    IN office_events.location%TYPE DEFAULT NULL,
        p_description IN office_events.description%TYPE DEFAULT NULL
    );

    PROCEDURE delete_event(p_event_id IN office_events.id%TYPE);

    FUNCTION submit_request(
        p_requested_by IN office_requests.requested_by%TYPE,
        p_event_type   IN office_requests.event_type%TYPE,
        p_title        IN office_requests.title%TYPE,
        p_starts_at    IN office_requests.starts_at%TYPE,
        p_ends_at      IN office_requests.ends_at%TYPE,
        p_note         IN office_requests.note%TYPE DEFAULT NULL
    ) RETURN office_requests.id%TYPE;

    -- p_decision: 'APPROVED' or 'REJECTED'. APPROVED creates exactly one linked
    -- office_events row and enqueues it for Google Calendar sync.
    PROCEDURE review_request(
        p_request_id  IN office_requests.id%TYPE,
        p_decision    IN VARCHAR2,
        p_reviewed_by IN office_requests.reviewed_by%TYPE
    );

    -- Busy intervals only (no title/description) — safe to expose to STAFF.
    FUNCTION get_availability(
        p_from IN TIMESTAMP WITH TIME ZONE,
        p_to   IN TIMESTAMP WITH TIME ZONE
    ) RETURN t_busy_tab PIPELINED;

    PROCEDURE queue_sync(
        p_event_id  IN calendar_sync_queue.event_id%TYPE,
        p_operation IN calendar_sync_queue.operation%TYPE
    );

    -- Claims the oldest PENDING queue row for processing (FOR UPDATE SKIP LOCKED),
    -- marking it PROCESSING and incrementing attempts. Returns NULL when the
    -- queue is empty. Called by the sync-worker through an ORDS endpoint.
    FUNCTION claim_next_sync_item RETURN calendar_sync_queue%ROWTYPE;

    PROCEDURE mark_sync_result(
        p_queue_id IN calendar_sync_queue.id%TYPE,
        p_status   IN calendar_sync_queue.status%TYPE,
        p_error    IN calendar_sync_queue.last_error%TYPE DEFAULT NULL
    );

END daily_office_api;
/

CREATE OR REPLACE PACKAGE BODY daily_office_api AS

    PROCEDURE check_conflict(
        p_starts_at  IN office_events.starts_at%TYPE,
        p_ends_at    IN office_events.ends_at%TYPE,
        p_exclude_id IN office_events.id%TYPE DEFAULT NULL
    ) IS
        l_count NUMBER;
    BEGIN
        IF p_ends_at <= p_starts_at THEN
            raise_application_error(-20001, 'ends_at must be after starts_at.');
        END IF;

        SELECT COUNT(*) INTO l_count
        FROM office_events e
        WHERE e.status = 'CONFIRMED'
          AND e.id != NVL(p_exclude_id, -1)
          AND e.starts_at < p_ends_at
          AND e.ends_at > p_starts_at;

        IF l_count > 0 THEN
            raise_application_error(-20002, 'Requested time range conflicts with an existing confirmed event.');
        END IF;
    END check_conflict;

    FUNCTION create_event(
        p_event_type   IN office_events.event_type%TYPE,
        p_title        IN office_events.title%TYPE,
        p_starts_at    IN office_events.starts_at%TYPE,
        p_ends_at      IN office_events.ends_at%TYPE,
        p_created_by   IN office_events.created_by%TYPE,
        p_location     IN office_events.location%TYPE DEFAULT NULL,
        p_description  IN office_events.description%TYPE DEFAULT NULL
    ) RETURN office_events.id%TYPE IS
        l_id office_events.id%TYPE;
    BEGIN
        check_conflict(p_starts_at, p_ends_at);

        INSERT INTO office_events (event_type, title, location, description, starts_at, ends_at, created_by)
        VALUES (p_event_type, p_title, p_location, p_description, p_starts_at, p_ends_at, p_created_by)
        RETURNING id INTO l_id;

        queue_sync(l_id, 'UPSERT');
        RETURN l_id;
    END create_event;

    PROCEDURE update_event(
        p_event_id    IN office_events.id%TYPE,
        p_title       IN office_events.title%TYPE,
        p_starts_at   IN office_events.starts_at%TYPE,
        p_ends_at     IN office_events.ends_at%TYPE,
        p_location    IN office_events.location%TYPE DEFAULT NULL,
        p_description IN office_events.description%TYPE DEFAULT NULL
    ) IS
    BEGIN
        check_conflict(p_starts_at, p_ends_at, p_event_id);

        UPDATE office_events
           SET title = p_title,
               starts_at = p_starts_at,
               ends_at = p_ends_at,
               location = p_location,
               description = p_description,
               updated_at = SYSTIMESTAMP
         WHERE id = p_event_id;

        IF SQL%ROWCOUNT = 0 THEN
            raise_application_error(-20003, 'Event not found: ' || p_event_id);
        END IF;

        queue_sync(p_event_id, 'UPSERT');
    END update_event;

    PROCEDURE delete_event(p_event_id IN office_events.id%TYPE) IS
    BEGIN
        UPDATE office_events
           SET status = 'CANCELLED', updated_at = SYSTIMESTAMP
         WHERE id = p_event_id
           AND status = 'CONFIRMED';

        IF SQL%ROWCOUNT = 0 THEN
            raise_application_error(-20003, 'Event not found or already cancelled: ' || p_event_id);
        END IF;

        queue_sync(p_event_id, 'DELETE');
    END delete_event;

    FUNCTION submit_request(
        p_requested_by IN office_requests.requested_by%TYPE,
        p_event_type   IN office_requests.event_type%TYPE,
        p_title        IN office_requests.title%TYPE,
        p_starts_at    IN office_requests.starts_at%TYPE,
        p_ends_at      IN office_requests.ends_at%TYPE,
        p_note         IN office_requests.note%TYPE DEFAULT NULL
    ) RETURN office_requests.id%TYPE IS
        l_id office_requests.id%TYPE;
    BEGIN
        IF p_ends_at <= p_starts_at THEN
            raise_application_error(-20001, 'ends_at must be after starts_at.');
        END IF;

        INSERT INTO office_requests (requested_by, event_type, title, note, starts_at, ends_at)
        VALUES (p_requested_by, p_event_type, p_title, p_note, p_starts_at, p_ends_at)
        RETURNING id INTO l_id;

        RETURN l_id;
    END submit_request;

    PROCEDURE review_request(
        p_request_id  IN office_requests.id%TYPE,
        p_decision    IN VARCHAR2,
        p_reviewed_by IN office_requests.reviewed_by%TYPE
    ) IS
        l_req      office_requests%ROWTYPE;
        l_event_id office_events.id%TYPE;
    BEGIN
        IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN
            raise_application_error(-20005, 'Invalid decision: ' || p_decision);
        END IF;

        BEGIN
            SELECT * INTO l_req FROM office_requests WHERE id = p_request_id FOR UPDATE;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                raise_application_error(-20003, 'Request not found: ' || p_request_id);
        END;

        IF l_req.status != 'PENDING' THEN
            raise_application_error(-20004, 'Request already reviewed: ' || p_request_id);
        END IF;

        IF p_decision = 'APPROVED' THEN
            l_event_id := create_event(
                p_event_type  => l_req.event_type,
                p_title       => l_req.title,
                p_starts_at   => l_req.starts_at,
                p_ends_at     => l_req.ends_at,
                p_created_by  => p_reviewed_by,
                p_description => l_req.note
            );

            UPDATE office_requests
               SET status = 'APPROVED',
                   reviewed_by = p_reviewed_by,
                   reviewed_at = SYSTIMESTAMP,
                   resulting_event_id = l_event_id
             WHERE id = p_request_id;
        ELSE
            UPDATE office_requests
               SET status = 'REJECTED',
                   reviewed_by = p_reviewed_by,
                   reviewed_at = SYSTIMESTAMP
             WHERE id = p_request_id;
        END IF;
    END review_request;

    FUNCTION get_availability(
        p_from IN TIMESTAMP WITH TIME ZONE,
        p_to   IN TIMESTAMP WITH TIME ZONE
    ) RETURN t_busy_tab PIPELINED IS
    BEGIN
        FOR r IN (
            SELECT starts_at, ends_at
            FROM office_events
            WHERE status = 'CONFIRMED'
              AND starts_at < p_to
              AND ends_at > p_from
            ORDER BY starts_at
        ) LOOP
            PIPE ROW (t_busy_row(r.starts_at, r.ends_at));
        END LOOP;
        RETURN;
    END get_availability;

    PROCEDURE queue_sync(
        p_event_id  IN calendar_sync_queue.event_id%TYPE,
        p_operation IN calendar_sync_queue.operation%TYPE
    ) IS
        l_key calendar_sync_queue.idempotency_key%TYPE;
    BEGIN
        l_key := p_event_id || ':' || p_operation || ':' || TO_CHAR(SYSTIMESTAMP, 'YYYYMMDDHH24MISSFF3');

        INSERT INTO calendar_sync_queue (event_id, operation, idempotency_key)
        VALUES (p_event_id, p_operation, l_key);
    END queue_sync;

    FUNCTION claim_next_sync_item RETURN calendar_sync_queue%ROWTYPE IS
        l_id  calendar_sync_queue.id%TYPE;
        l_row calendar_sync_queue%ROWTYPE;
    BEGIN
        SELECT id INTO l_id
        FROM calendar_sync_queue
        WHERE status = 'PENDING'
        ORDER BY created_at
        FETCH FIRST 1 ROWS ONLY
        FOR UPDATE SKIP LOCKED;

        UPDATE calendar_sync_queue
           SET status = 'PROCESSING', attempts = attempts + 1
         WHERE id = l_id
         RETURNING id, event_id, operation, idempotency_key, status, attempts, last_error, created_at, processed_at
           INTO l_row.id, l_row.event_id, l_row.operation, l_row.idempotency_key,
                l_row.status, l_row.attempts, l_row.last_error, l_row.created_at, l_row.processed_at;

        RETURN l_row;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RETURN NULL;
    END claim_next_sync_item;

    PROCEDURE mark_sync_result(
        p_queue_id IN calendar_sync_queue.id%TYPE,
        p_status   IN calendar_sync_queue.status%TYPE,
        p_error    IN calendar_sync_queue.last_error%TYPE DEFAULT NULL
    ) IS
    BEGIN
        IF p_status NOT IN ('DONE', 'FAILED') THEN
            raise_application_error(-20005, 'Invalid sync result status: ' || p_status);
        END IF;

        -- Failed attempts go back to PENDING for retry (idempotency_key is untouched,
        -- so a later successful retry cannot create a duplicate Google event) unless
        -- the retry budget is exhausted, in which case the row is parked as FAILED.
        UPDATE calendar_sync_queue
           SET status = CASE
                            WHEN p_status = 'DONE' THEN 'DONE'
                            WHEN attempts >= 5 THEN 'FAILED'
                            ELSE 'PENDING'
                        END,
               last_error = p_error,
               processed_at = CASE WHEN p_status = 'DONE' THEN SYSTIMESTAMP ELSE processed_at END
         WHERE id = p_queue_id;
    END mark_sync_result;

END daily_office_api;
/
