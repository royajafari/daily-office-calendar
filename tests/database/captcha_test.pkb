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

    FUNCTION new_challenge(p_client_ip IN VARCHAR2 DEFAULT NULL) RETURN t_challenge IS
        l_ch t_challenge;
    BEGIN
        captcha_api.issue_challenge(l_ch.token, l_ch.salt, l_ch.bits, l_ch.wait,
                                    p_difficulty => c_bits, p_client_ip => p_client_ip);
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

    PROCEDURE per_ip_rate_limit IS
        -- Documentation-range addresses (RFC 5737), so they never clash with real traffic.
        c_ip     CONSTANT VARCHAR2(45) := '203.0.113.7';
        l_ch     t_challenge;
        l_raised BOOLEAN := FALSE;
    BEGIN
        FOR i IN 1 .. captcha_api.c_max_per_ip_per_minute LOOP
            l_ch := new_challenge(c_ip);
        END LOOP;

        BEGIN
            l_ch := new_challenge(c_ip);
        EXCEPTION
            WHEN captcha_api.e_rate_limited THEN
                l_raised := TRUE;
        END;
        ut.expect(l_raised).to_be_true();

        l_ch := new_challenge('203.0.113.8');
        ut.expect(l_ch.token).not_to_be_null();
        l_ch := new_challenge(NULL);
        ut.expect(l_ch.token).not_to_be_null();
    END per_ip_rate_limit;

    PROCEDURE sha256_plsql_vectors IS
    BEGIN
        -- FIPS 180-4 / NIST examples: empty, one block, two blocks (56 bytes).
        ut.expect(captcha_api.sha256_plsql_hex(NULL))
            .to_equal('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
        ut.expect(captcha_api.sha256_plsql_hex('abc'))
            .to_equal('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        ut.expect(captcha_api.sha256_plsql_hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
            .to_equal('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
        -- Multi-byte UTF-8, and the widget's own proof-of-work vector (12 zero bits).
        ut.expect(captcha_api.sha256_plsql_hex('سلام'))
            .to_equal('bda1fa48345336618741fd2c4bc02809eb099c49a9b02fb5056401ab6d4dc3e6');
        ut.expect(captcha_api.sha256_plsql_hex('00112233445566778899aabbccddeeff:2888'))
            .to_equal('0009b8241882247d89770121dafca4007d6f7dace63185298d7c28f351b72831');
    END sha256_plsql_vectors;

    PROCEDURE sha256_matches_dbms_crypto IS
        l_input VARCHAR2(200);
    BEGIN
        $IF DBMS_DB_VERSION.VERSION < 12 $THEN
            ut.expect(TRUE).to_be_true(); -- 11g: DBMS_CRYPTO has no SHA-256 to compare with
        $ELSE
            -- Every padding case: 1..129 bytes crosses the 55/56/64/119/120/128 boundaries
            -- (empty input is in sha256_plsql_vectors).
            FOR n IN 1 .. 129 LOOP
                l_input := SUBSTR(RPAD('x', n, 'abcdefghij0123456789'), 1, n);
                ut.expect(captcha_api.sha256_plsql_hex(l_input), 'length ' || n).to_equal(
                    LOWER(RAWTOHEX(DBMS_CRYPTO.HASH(
                        UTL_I18N.STRING_TO_RAW(l_input, 'AL32UTF8'), DBMS_CRYPTO.HASH_SH256))));
            END LOOP;
        $END
    END sha256_matches_dbms_crypto;

    -- Runs captcha_api.ajax_response the way an APEX Ajax Callback would, and
    -- returns what it wrote with htp.
    FUNCTION ajax(p_action IN VARCHAR2, p_x01 IN VARCHAR2 DEFAULT NULL, p_x02 IN VARCHAR2 DEFAULT NULL)
        RETURN VARCHAR2
    IS
        l_names  owa.vc_arr;
        l_values owa.vc_arr;
        l_page   htp.htbuf_arr;
        l_rows   INTEGER := 999;
        l_out    VARCHAR2(4000);
    BEGIN
        l_names(1) := 'REQUEST_PROTOCOL';
        l_values(1) := 'HTTP';
        owa.init_cgi_env(1, l_names, l_values);
        htp.init;
        captcha_api.ajax_response(p_action, p_x01, p_x02);
        owa.get_page(l_page, l_rows);
        FOR i IN 1 .. l_rows LOOP
            l_out := l_out || l_page(i);
        END LOOP;
        -- get_page also returns the default CGI headers (APEX writes its own);
        -- the body starts after the first blank line.
        IF INSTR(l_out, CHR(10) || CHR(10)) > 0 THEN
            l_out := SUBSTR(l_out, INSTR(l_out, CHR(10) || CHR(10)) + 2);
        END IF;
        RETURN RTRIM(l_out, CHR(10));
    END ajax;

    PROCEDURE ajax_response_json IS
        l_json  VARCHAR2(4000);
        l_ch    t_challenge;
        l_pass  VARCHAR2(64);
    BEGIN
        -- challenge
        l_json := ajax('challenge');
        ut.expect(l_json).to_be_like('{"token":"%","salt":"%","bits":' || captcha_api.c_bits
                                     || ',"wait":' || captcha_api.c_min_solve_ms || '}');
        g_tokens.EXTEND;
        g_tokens(g_tokens.LAST) := REGEXP_SUBSTR(l_json, '"token":"([0-9a-f]+)"', 1, 1, NULL, 1);
        ut.expect(LENGTH(g_tokens(g_tokens.LAST))).to_equal(64);

        -- solve: success, then the same answer again
        l_ch := new_challenge;
        age(l_ch.token, 1000);
        l_json := ajax('solve', l_ch.token, TO_CHAR(solve(l_ch)));
        ut.expect(l_json).to_be_like('{"pass":"%","expiresIn":' || captcha_api.c_pass_ttl_ms || '}');
        l_pass := REGEXP_SUBSTR(l_json, '"pass":"([0-9a-f]+)"', 1, 1, NULL, 1);
        ut.expect(captcha_api.consume_pass(l_pass)).to_be_null();
        ut.expect(ajax('solve', l_ch.token, TO_CHAR(solve(l_ch)))).to_equal('{"error":"challenge-reused"}');

        -- solve: a nonce that isn't a number, and an unknown action
        l_ch := new_challenge;
        age(l_ch.token, 1000);
        ut.expect(ajax('solve', l_ch.token, 'abc')).to_equal('{"error":"invalid-nonce"}');
        ut.expect(ajax('nope')).to_equal('{"error":"unknown-action"}');
    END ajax_response_json;

END captcha_test;
/
