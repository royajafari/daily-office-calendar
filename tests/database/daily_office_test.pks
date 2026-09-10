CREATE OR REPLACE PACKAGE daily_office_test AS
    --%suite(daily_office_api)
    -- Default utPLSQL rollback (savepoint per test) keeps each test's data isolated;
    -- tests additionally use non-overlapping dates so they're independent either way.

    --%test(Rejects an overlapping confirmed event with ORA-20002)
    PROCEDURE rejects_conflict;

    --%test(Rejects an invalid time range with ORA-20001)
    PROCEDURE rejects_invalid_range;

    --%test(submit_request creates a PENDING request without an event)
    PROCEDURE creates_pending_request;

    --%test(Approving a request creates exactly one linked event)
    PROCEDURE approval_creates_event;

    --%test(Rejecting a request creates no event)
    PROCEDURE rejection_creates_no_event;

    --%test(get_availability returns busy intervals only, no title/description)
    PROCEDURE availability_hides_title;

    --%test(Sync queue retry keeps the same idempotency_key and never duplicates)
    PROCEDURE sync_retry_is_idempotent;

END daily_office_test;
/
