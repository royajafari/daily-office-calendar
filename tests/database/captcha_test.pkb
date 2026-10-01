CREATE OR REPLACE PACKAGE BODY captcha_test AS

    TYPE t_tokens IS TABLE OF captcha_challenges.challenge_token%TYPE;
    g_tokens t_tokens := t_tokens();

    c_bits CONSTANT PLS_INTEGER := 8; -- cheap proof-of-work for tests

    TYPE t_challenge IS RECORD (
        token captcha_challenges.challenge_token%TYPE,
        salt  captcha_challenges.salt%TYPE,
        bits  PLS_INTEGER,
        wait  PLS_INTEGER
    );

    FUNCTION new_challenge RETURN t_challenge IS
        l_ch t_challenge;
    BEGIN
        captcha_api.issue_challenge(l_ch.token, l_ch.salt, l_ch.bits, l_ch.wait, p_difficulty => c_bits);
        g_tokens.EXTEND;
        g_tokens(g_tokens.LAST) := l_ch.token;
        RETURN l_ch;
    END new_challenge;

    -- Moves a challenge's timestamps into the past, as if p_ms had elapsed.
    PROCEDURE age(p_token IN VARCHAR2, p_ms IN PLS_INTEGER) IS
        l_shift INTERVAL DAY TO SECOND := NUMTODSINTERVAL(p_ms / 1000, 'SECOND');
    BEGIN
        UPDATE captcha_challenges
        SET    issued_at       = issued_at - l_shift,
               expires_at      = expires_at - l_shift,
               pass_expires_at = pass_expires_at - l_shift
        WHERE  challenge_token = p_token;
        COMMIT;
    END age;

    FUNCTION solve(p_ch IN t_challenge) RETURN NUMBER IS
    BEGIN
        FOR n IN 0 .. 1000000 LOOP
            IF captcha_api.pow_zero_bits(p_ch.salt, n) >= p_ch.bits THEN
                RETURN n;
            END IF;
        END LOOP;
        RAISE_APPLICATION_ERROR(-20999, 'no nonce found');
    END solve;

    FUNCTION wrong_nonce(p_ch IN t_challenge) RETURN NUMBER IS
    BEGIN
        FOR n IN 0 .. 1000000 LOOP
            IF captcha_api.pow_zero_bits(p_ch.salt, n) < p_ch.bits THEN
                RETURN n;
            END IF;
        END LOOP;
        RAISE_APPLICATION_ERROR(-20999, 'no wrong nonce found');
    END wrong_nonce;

    -- Solves and verifies (after the minimum solve time), returning the pass.
    FUNCTION pass_for(p_ch IN t_challenge) RETURN VARCHAR2 IS
        l_pass VARCHAR2(64);
        l_exp  PLS_INTEGER;
        l_err  VARCHAR2(40);
    BEGIN
        age(p_ch.token, 1000);
        captcha_api.verify_solution(p_ch.token, solve(p_ch), l_pass, l_exp, l_err);
        ut.expect(l_err).to_be_null();
        RETURN l_pass;
    END pass_for;

    PROCEDURE cleanup IS
    BEGIN
        FORALL i IN 1 .. g_tokens.COUNT
            DELETE FROM captcha_challenges WHERE challenge_token = g_tokens(i);
        COMMIT;
        g_tokens := t_tokens();
    END cleanup;

    PROCEDURE pow_matches_widget IS
        -- Computed with not-robot-captcha/widget/not-robot.js + node:crypto.
        c_salt CONSTANT VARCHAR2(32) := '00112233445566778899aabbccddeeff';
    BEGIN
        ut.expect(captcha_api.pow_zero_bits(c_salt, 2888)).to_equal(12);
        ut.expect(captcha_api.pow_zero_bits(c_salt, 0)).to_equal(1);
        ut.expect(captcha_api.pow_zero_bits(c_salt, 1)).to_equal(0);
    END pow_matches_widget;

    PROCEDURE full_flow_single_use IS
        l_ch   t_challenge := new_challenge;
        l_pass VARCHAR2(64);
    BEGIN
        ut.expect(l_ch.bits).to_equal(c_bits);
        ut.expect(l_ch.wait).to_equal(captcha_api.c_min_solve_ms);
        ut.expect(LENGTH(l_ch.token)).to_equal(64);

        l_pass := pass_for(l_ch);
        ut.expect(LENGTH(l_pass)).to_equal(64);
        ut.expect(captcha_api.consume_pass(l_pass)).to_be_null();
        ut.expect(captcha_api.consume_pass(l_pass)).to_equal('token-reused');
    END full_flow_single_use;

    PROCEDURE too_fast_keeps_challenge IS
        l_ch   t_challenge := new_challenge;
        l_pass VARCHAR2(64);
        l_exp  PLS_INTEGER;
        l_err  VARCHAR2(40);
    BEGIN
        captcha_api.verify_solution(l_ch.token, solve(l_ch), l_pass, l_exp, l_err);
        ut.expect(l_err).to_equal('too-fast');

        l_pass := pass_for(l_ch);
        ut.expect(l_pass).not_to_be_null();
    END too_fast_keeps_challenge;

    PROCEDURE wrong_solution_burns_challenge IS
        l_ch   t_challenge := new_challenge;
        l_pass VARCHAR2(64);
        l_exp  PLS_INTEGER;
        l_err  VARCHAR2(40);
    BEGIN
        age(l_ch.token, 1000);
        captcha_api.verify_solution(l_ch.token, wrong_nonce(l_ch), l_pass, l_exp, l_err);
        ut.expect(l_err).to_equal('wrong-solution');

        captcha_api.verify_solution(l_ch.token, solve(l_ch), l_pass, l_exp, l_err);
        ut.expect(l_err).to_equal('invalid-challenge');
        ut.expect(l_pass).to_be_null();
    END wrong_solution_burns_challenge;

    PROCEDURE challenge_single_use IS
        l_ch   t_challenge := new_challenge;
        l_pass VARCHAR2(64);
        l_exp  PLS_INTEGER;
        l_err  VARCHAR2(40);
    BEGIN
        l_pass := pass_for(l_ch);
        captcha_api.verify_solution(l_ch.token, solve(l_ch), l_pass, l_exp, l_err);
        ut.expect(l_err).to_equal('challenge-reused');
    END challenge_single_use;

    PROCEDURE expiry_is_enforced IS
        l_ch   t_challenge := new_challenge;
        l_ch2  t_challenge := new_challenge;
        l_pass VARCHAR2(64);
        l_exp  PLS_INTEGER;
        l_err  VARCHAR2(40);
    BEGIN
        age(l_ch.token, captcha_api.c_challenge_ttl_ms + 1000);
        captcha_api.verify_solution(l_ch.token, solve(l_ch), l_pass, l_exp, l_err);
        ut.expect(l_err).to_equal('challenge-expired');

        l_pass := pass_for(l_ch2);
        age(l_ch2.token, captcha_api.c_pass_ttl_ms + 1000);
        ut.expect(captcha_api.consume_pass(l_pass)).to_equal('token-expired');
    END expiry_is_enforced;

    PROCEDURE unknown_pass_rejected IS
    BEGIN
        ut.expect(captcha_api.consume_pass(NULL)).to_equal('invalid-token');
        ut.expect(captcha_api.consume_pass(RPAD('0', 64, '0'))).to_equal('invalid-token');
    END unknown_pass_rejected;

    PROCEDURE consume_survives_rollback IS
        l_ch   t_challenge := new_challenge;
        l_pass VARCHAR2(64) := pass_for(l_ch);
    BEGIN
        -- Like a failed login: the page's transaction is rolled back afterwards.
        ut.expect(captcha_api.consume_pass(l_pass)).to_be_null();
        ROLLBACK;
        ut.expect(captcha_api.consume_pass(l_pass)).to_equal('token-reused');
    END consume_survives_rollback;

    PROCEDURE error_messages IS
    BEGIN
        ut.expect(captcha_api.error_message(NULL)).to_be_null();
        ut.expect(captcha_api.error_message('invalid-token')).to_equal('لطفاً تیک «من ربات نیستم» را بزنید.');
        ut.expect(captcha_api.error_message('token-expired')).to_be_like('%منقضی%');
        ut.expect(captcha_api.error_message('token-reused')).to_be_like('%قبلاً%');
        ut.expect(captcha_api.error_message('something-else')).to_be_like('%ناموفق%');
    END error_messages;

END captcha_test;
/
