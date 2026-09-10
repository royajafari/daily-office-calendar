CREATE OR REPLACE PACKAGE BODY daily_office_test AS

    PROCEDURE rejects_conflict IS
        l_raised BOOLEAN := FALSE;
    BEGIN
        daily_office_api.create_event(
            p_event_type => 'MEETING', p_title => 'Base meeting',
            p_starts_at  => TIMESTAMP '2026-01-01 09:00:00 +00:00',
            p_ends_at    => TIMESTAMP '2026-01-01 10:00:00 +00:00',
            p_created_by => 'head1');

        BEGIN
            daily_office_api.create_event(
                p_event_type => 'MEETING', p_title => 'Overlapping meeting',
                p_starts_at  => TIMESTAMP '2026-01-01 09:30:00 +00:00',
                p_ends_at    => TIMESTAMP '2026-01-01 10:30:00 +00:00',
                p_created_by => 'head1');
        EXCEPTION
            WHEN daily_office_api.e_conflict THEN
                l_raised := TRUE;
        END;

        ut.expect(l_raised).to_be_true();
    END rejects_conflict;

    PROCEDURE rejects_invalid_range IS
        l_raised BOOLEAN := FALSE;
    BEGIN
        BEGIN
            daily_office_api.create_event(
                p_event_type => 'MEETING', p_title => 'Backwards range',
                p_starts_at  => TIMESTAMP '2026-01-02 10:00:00 +00:00',
                p_ends_at    => TIMESTAMP '2026-01-02 09:00:00 +00:00',
                p_created_by => 'head1');
        EXCEPTION
            WHEN daily_office_api.e_invalid_range THEN
                l_raised := TRUE;
        END;

        ut.expect(l_raised).to_be_true();
    END rejects_invalid_range;

    PROCEDURE creates_pending_request IS
        l_req_id office_requests.id%TYPE;
        l_status office_requests.status%TYPE;
        l_result_event_id office_requests.resulting_event_id%TYPE;
    BEGIN
        l_req_id := daily_office_api.submit_request(
            p_requested_by => 'staff1', p_event_type => 'MEETING', p_title => 'Team sync',
            p_starts_at => TIMESTAMP '2026-02-02 09:00:00 +00:00',
            p_ends_at   => TIMESTAMP '2026-02-02 10:00:00 +00:00');

        SELECT status, resulting_event_id INTO l_status, l_result_event_id
        FROM office_requests WHERE id = l_req_id;

        ut.expect(l_status).to_equal('PENDING');
        ut.expect(l_result_event_id).to_be_null();
    END creates_pending_request;

    PROCEDURE approval_creates_event IS
        l_req_id office_requests.id%TYPE;
        l_status office_requests.status%TYPE;
        l_event_id office_requests.resulting_event_id%TYPE;
        l_event_count NUMBER;
    BEGIN
        l_req_id := daily_office_api.submit_request(
            p_requested_by => 'staff1', p_event_type => 'MEETING', p_title => 'Budget review',
            p_starts_at => TIMESTAMP '2026-02-03 09:00:00 +00:00',
            p_ends_at   => TIMESTAMP '2026-02-03 10:00:00 +00:00');

        daily_office_api.review_request(p_request_id => l_req_id, p_decision => 'APPROVED', p_reviewed_by => 'head1');

        SELECT status, resulting_event_id INTO l_status, l_event_id
        FROM office_requests WHERE id = l_req_id;

        ut.expect(l_status).to_equal('APPROVED');
        ut.expect(l_event_id).to_not_be_null();

        SELECT COUNT(*) INTO l_event_count FROM office_events WHERE id = l_event_id;
        ut.expect(l_event_count).to_equal(1);
    END approval_creates_event;

    PROCEDURE rejection_creates_no_event IS
        l_req_id office_requests.id%TYPE;
        l_status office_requests.status%TYPE;
        l_event_id office_requests.resulting_event_id%TYPE;
    BEGIN
        l_req_id := daily_office_api.submit_request(
            p_requested_by => 'staff1', p_event_type => 'MEETING', p_title => 'Unwanted meeting',
            p_starts_at => TIMESTAMP '2026-02-04 09:00:00 +00:00',
            p_ends_at   => TIMESTAMP '2026-02-04 10:00:00 +00:00');

        daily_office_api.review_request(p_request_id => l_req_id, p_decision => 'REJECTED', p_reviewed_by => 'head1');

        SELECT status, resulting_event_id INTO l_status, l_event_id
        FROM office_requests WHERE id = l_req_id;

        ut.expect(l_status).to_equal('REJECTED');
        ut.expect(l_event_id).to_be_null();
    END rejection_creates_no_event;

    PROCEDURE availability_hides_title IS
        l_count NUMBER;
    BEGIN
        daily_office_api.create_event(
            p_event_type => 'MEETING', p_title => 'Confidential salary review',
            p_starts_at  => TIMESTAMP '2026-02-05 09:00:00 +00:00',
            p_ends_at    => TIMESTAMP '2026-02-05 10:00:00 +00:00',
            p_created_by => 'head1');

        -- t_busy_row only has starts_at/ends_at columns, so title/description
        -- cannot leak through this function by construction.
        SELECT COUNT(*) INTO l_count
        FROM TABLE(daily_office_api.get_availability(
                 TIMESTAMP '2026-02-05 00:00:00 +00:00',
                 TIMESTAMP '2026-02-06 00:00:00 +00:00'));

        ut.expect(l_count).to_equal(1);
    END availability_hides_title;

    PROCEDURE sync_retry_is_idempotent IS
        l_event_id office_events.id%TYPE;
        l_key1 calendar_sync_queue.idempotency_key%TYPE;
        l_claimed calendar_sync_queue%ROWTYPE;
        l_status2 calendar_sync_queue.status%TYPE;
        l_key2 calendar_sync_queue.idempotency_key%TYPE;
        l_claimed2 calendar_sync_queue%ROWTYPE;
        l_status3 calendar_sync_queue.status%TYPE;
        l_total NUMBER;
    BEGIN
        l_event_id := daily_office_api.create_event(
            p_event_type => 'MISSION', p_title => 'Field visit',
            p_starts_at  => TIMESTAMP '2026-02-07 09:00:00 +00:00',
            p_ends_at    => TIMESTAMP '2026-02-07 11:00:00 +00:00',
            p_created_by => 'head1');

        SELECT idempotency_key INTO l_key1
        FROM calendar_sync_queue WHERE event_id = l_event_id AND operation = 'UPSERT';

        l_claimed := daily_office_api.claim_next_sync_item;
        ut.expect(l_claimed.event_id).to_equal(l_event_id);

        daily_office_api.mark_sync_result(p_queue_id => l_claimed.id, p_status => 'FAILED', p_error => 'simulated timeout');

        SELECT status, idempotency_key INTO l_status2, l_key2
        FROM calendar_sync_queue WHERE id = l_claimed.id;

        ut.expect(l_status2).to_equal('PENDING');
        ut.expect(l_key2).to_equal(l_key1);

        l_claimed2 := daily_office_api.claim_next_sync_item;
        ut.expect(l_claimed2.id).to_equal(l_claimed.id);

        daily_office_api.mark_sync_result(p_queue_id => l_claimed2.id, p_status => 'DONE');

        SELECT status INTO l_status3 FROM calendar_sync_queue WHERE id = l_claimed2.id;
        ut.expect(l_status3).to_equal('DONE');

        SELECT COUNT(*) INTO l_total FROM calendar_sync_queue WHERE event_id = l_event_id;
        ut.expect(l_total).to_equal(1);
    END sync_retry_is_idempotent;

END daily_office_test;
/
