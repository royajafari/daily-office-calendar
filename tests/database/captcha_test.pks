CREATE OR REPLACE PACKAGE captcha_test AS
    --%suite(captcha_api)
    --%rollback(manual)
    -- captcha_api commits in autonomous transactions, which utPLSQL's savepoint
    -- rollback can't undo (and which can't see uncommitted test data), so tests
    -- commit their setup and delete every challenge they created afterwards.

    --%aftereach
    PROCEDURE cleanup;

    --%test(pow_zero_bits matches the browser widget's SHA-256 proof-of-work)
    PROCEDURE pow_matches_widget;

    --%test(Full flow: challenge → solve → pass is accepted exactly once)
    PROCEDURE full_flow_single_use;

    --%test(A too-fast answer is rejected but the challenge stays usable)
    PROCEDURE too_fast_keeps_challenge;

    --%test(A wrong answer burns the challenge)
    PROCEDURE wrong_solution_burns_challenge;

    --%test(A solved challenge can't be solved again)
    PROCEDURE challenge_single_use;

    --%test(Expired challenges and expired passes are rejected)
    PROCEDURE expiry_is_enforced;

    --%test(Unknown or missing pass tokens are rejected)
    PROCEDURE unknown_pass_rejected;

    --%test(A consumed pass stays consumed even if the caller rolls back)
    PROCEDURE consume_survives_rollback;

    --%test(error_message returns Persian text for errors and NULL for success)
    PROCEDURE error_messages;

END captcha_test;
/
