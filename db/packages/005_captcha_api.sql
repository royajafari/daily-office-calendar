-- "I'm not a robot" captcha — server side, in PL/SQL, for the APEX login page.
-- Same protocol as not-robot-captcha/server/core.js, so the unchanged browser
-- widget (not-robot-captcha/widget/not-robot.js) talks to it either through
-- ORDS (db/packages/006_captcha_ords.sql) or, where there is no ORDS (e.g.
-- APEX on mod_plsql), through two APEX Ajax Callbacks calling ajax_response:
--
--   1. issue_challenge  → random salt + opaque challenge token (row in captcha_challenges).
--   2. The widget finds a nonce so sha256(salt || ':' || nonce) starts with
--      `bits` zero bits (proof-of-work).
--   3. verify_solution  → checks expiry, minimum solve time and the proof-of-work,
--      then issues a pass token (10 minutes).
--   4. consume_pass     → the login page's validation accepts each pass exactly once.
--
-- Requires: GRANT EXECUTE ON SYS.DBMS_CRYPTO TO <schema> (docker/db/setup/20-captcha-grants.sh).
-- Runs on Oracle 11g and later: 11g has no DBMS_CRYPTO.HASH_SH256, so SHA-256
-- is also implemented in plain PL/SQL and chosen by conditional compilation.
--
-- Every state change runs in an autonomous transaction, so it sticks even when
-- the caller rolls back — in particular a failed login still burns its pass
-- token, which limits password guessing to one attempt per solved captcha.

CREATE OR REPLACE PACKAGE captcha_api AS

    c_bits             CONSTANT PLS_INTEGER := 17;     -- proof-of-work difficulty (each +1 doubles the work)
    c_challenge_ttl_ms CONSTANT PLS_INTEGER := 120000;
    -- Time between ticking and pressing Login. Generous because this is an
    -- intranet-only app: stockpiling passes needs a foothold inside the network,
    -- and each pass is still single-use and rate-limited per IP.
    c_pass_ttl_ms      CONSTANT PLS_INTEGER := 600000;
    c_min_solve_ms     CONSTANT PLS_INTEGER := 400;    -- faster than this is not a person

    -- The challenge endpoint is public and every call stores a row, so it is capped:
    c_max_per_ip_per_minute CONSTANT PLS_INTEGER := 30;     -- generous for one office behind NAT
    c_max_stored            CONSTANT PLS_INTEGER := 100000; -- whole table (rows live an hour), against many-IP floods

    e_rate_limited EXCEPTION;
    PRAGMA EXCEPTION_INIT(e_rate_limited, -20010);

    -- Raises e_rate_limited (ORA-20010) when a limit above is reached.
    -- p_client_ip NULL skips the per-IP limit (the table-wide cap still applies).
    PROCEDURE issue_challenge(
        p_token      OUT VARCHAR2,
        p_salt       OUT VARCHAR2,
        p_bits       OUT PLS_INTEGER,
        p_wait_ms    OUT PLS_INTEGER,
        p_difficulty IN  PLS_INTEGER DEFAULT c_bits,
        p_client_ip  IN  VARCHAR2 DEFAULT NULL
    );

    -- p_error is NULL on success, otherwise one of: invalid-challenge,
    -- challenge-expired, challenge-reused, too-fast, invalid-nonce, wrong-solution.
    PROCEDURE verify_solution(
        p_token         IN  VARCHAR2,
        p_nonce         IN  NUMBER,
        p_pass          OUT VARCHAR2,
        p_expires_in_ms OUT PLS_INTEGER,
        p_error         OUT VARCHAR2
    );

    -- NULL when the pass is valid (and now used up), otherwise one of:
    -- invalid-token, token-expired, token-reused.
    FUNCTION consume_pass(p_pass IN VARCHAR2) RETURN VARCHAR2;

    -- Persian, user-facing text for an error code from consume_pass (NULL → NULL),
    -- ready for an APEX "Function Body (returning Error Text)" validation.
    FUNCTION error_message(p_error IN VARCHAR2) RETURN VARCHAR2;

    -- For APEX Ajax Callbacks (no ORDS): writes the JSON the widget expects with htp.p.
    --   p_action 'challenge' → {"token","salt","bits","wait"} | {"error":"rate-limited"}
    --   p_action 'solve'     → p_x01 = challenge token, p_x02 = nonce
    --                          → {"pass","expiresIn"} | {"error":"<code>"}
    PROCEDURE ajax_response(
        p_action    IN VARCHAR2,
        p_x01       IN VARCHAR2 DEFAULT NULL,
        p_x02       IN VARCHAR2 DEFAULT NULL,
        p_client_ip IN VARCHAR2 DEFAULT NULL
    );

    -- Leading zero bits of sha256(p_salt || ':' || p_nonce); public for tests.
    FUNCTION pow_zero_bits(p_salt IN VARCHAR2, p_nonce IN NUMBER) RETURN PLS_INTEGER;

    -- SHA-256 in plain PL/SQL (lowercase hex), the 11g code path; public for tests.
    FUNCTION sha256_plsql_hex(p_input IN VARCHAR2) RETURN VARCHAR2;

END captcha_api;
/

CREATE OR REPLACE PACKAGE BODY captcha_api AS

    c_max_nonce CONSTANT NUMBER := 9007199254740991; -- JS Number.MAX_SAFE_INTEGER

    -- For sha256_plsql below (declarations must precede all subprogram bodies).
    c_2_32 CONSTANT NUMBER := 4294967296;
    c_mask CONSTANT NUMBER := 4294967295;

    TYPE t_words IS TABLE OF NUMBER INDEX BY PLS_INTEGER;
    g_k t_words;  -- round constants, filled in the package initialisation block

    FUNCTION random_hex(p_bytes IN PLS_INTEGER) RETURN VARCHAR2 IS
    BEGIN
        RETURN LOWER(RAWTOHEX(DBMS_CRYPTO.RANDOMBYTES(p_bytes)));
    END random_hex;

    FUNCTION ms_between(
        p_from IN TIMESTAMP WITH TIME ZONE,
        p_to   IN TIMESTAMP WITH TIME ZONE
    ) RETURN NUMBER IS
        l_diff INTERVAL DAY(9) TO SECOND(6) := p_to - p_from;
    BEGIN
        RETURN EXTRACT(DAY FROM l_diff) * 86400000
             + EXTRACT(HOUR FROM l_diff) * 3600000
             + EXTRACT(MINUTE FROM l_diff) * 60000
             + EXTRACT(SECOND FROM l_diff) * 1000;
    END ms_between;

    FUNCTION ms_interval(p_ms IN PLS_INTEGER) RETURN INTERVAL DAY TO SECOND IS
    BEGIN
        RETURN NUMTODSINTERVAL(p_ms / 1000, 'SECOND');
    END ms_interval;

    ---------------------------------------------------------------------
    -- SHA-256 (FIPS 180-4) in plain PL/SQL, for Oracle 11g. PL/SQL only has
    -- BITAND, so XOR/rotate/shift are built arithmetically on 32-bit words
    -- held in NUMBER. Slow-ish, but the server hashes once per verification.
    ---------------------------------------------------------------------
    FUNCTION w_xor(a IN NUMBER, b IN NUMBER) RETURN NUMBER IS
    BEGIN
        RETURN a + b - 2 * BITAND(a, b);
    END w_xor;

    FUNCTION w_rotr(x IN NUMBER, n IN PLS_INTEGER) RETURN NUMBER IS
    BEGIN
        RETURN TRUNC(x / POWER(2, n)) + MOD(x, POWER(2, n)) * POWER(2, 32 - n);
    END w_rotr;

    FUNCTION w_shr(x IN NUMBER, n IN PLS_INTEGER) RETURN NUMBER IS
    BEGIN
        RETURN TRUNC(x / POWER(2, n));
    END w_shr;

    FUNCTION sha256_plsql(p_input IN RAW) RETURN RAW IS
        l_len PLS_INTEGER := NVL(UTL_RAW.LENGTH(p_input), 0);
        -- Pad: 0x80, zero bytes, then the bit length as a 64-bit big-endian
        -- number, to a multiple of 64 bytes. (RPAD to length 0 gives NULL,
        -- which concatenates as empty — no special case needed.)
        l_hex VARCHAR2(32767) := RAWTOHEX(p_input) || '80'
                                 || RPAD('0', 2 * MOD(55 - MOD(l_len, 64) + 64, 64), '0')
                                 || LPAD(TO_CHAR(l_len * 8, 'FMXXXXXXXXXXXXXXXX'), 16, '0');
        h  t_words;
        w  t_words;
        a NUMBER; b NUMBER; c NUMBER; d NUMBER; e NUMBER; f NUMBER; g NUMBER; hh NUMBER;
        s0 NUMBER; s1 NUMBER; t1 NUMBER; t2 NUMBER;
        l_out VARCHAR2(64);
    BEGIN
        h(0) := 1779033703; h(1) := 3144134277; h(2) := 1013904242; h(3) := 2773480762;
        h(4) := 1359893119; h(5) := 2600822924; h(6) := 528734635;  h(7) := 1541459225;

        FOR blk IN 0 .. LENGTH(l_hex) / 128 - 1 LOOP
            FOR t IN 0 .. 15 LOOP
                w(t) := TO_NUMBER(SUBSTR(l_hex, blk * 128 + t * 8 + 1, 8), 'XXXXXXXX');
            END LOOP;
            FOR t IN 16 .. 63 LOOP
                s0 := w_xor(w_xor(w_rotr(w(t - 15), 7), w_rotr(w(t - 15), 18)), w_shr(w(t - 15), 3));
                s1 := w_xor(w_xor(w_rotr(w(t - 2), 17), w_rotr(w(t - 2), 19)), w_shr(w(t - 2), 10));
                w(t) := MOD(w(t - 16) + s0 + w(t - 7) + s1, c_2_32);
            END LOOP;

            a := h(0); b := h(1); c := h(2); d := h(3);
            e := h(4); f := h(5); g := h(6); hh := h(7);
            FOR t IN 0 .. 63 LOOP
                s1 := w_xor(w_xor(w_rotr(e, 6), w_rotr(e, 11)), w_rotr(e, 25));
                -- ch = (e AND f) XOR (NOT e AND g); the two terms share no bits, so XOR = +.
                t1 := MOD(hh + s1 + BITAND(e, f) + BITAND(c_mask - e, g) + g_k(t) + w(t), c_2_32);
                s0 := w_xor(w_xor(w_rotr(a, 2), w_rotr(a, 13)), w_rotr(a, 22));
                t2 := MOD(s0 + w_xor(w_xor(BITAND(a, b), BITAND(a, c)), BITAND(b, c)), c_2_32);
                hh := g; g := f; f := e; e := MOD(d + t1, c_2_32);
                d := c; c := b; b := a; a := MOD(t1 + t2, c_2_32);
            END LOOP;
            h(0) := MOD(h(0) + a, c_2_32);  h(1) := MOD(h(1) + b, c_2_32);
            h(2) := MOD(h(2) + c, c_2_32);  h(3) := MOD(h(3) + d, c_2_32);
            h(4) := MOD(h(4) + e, c_2_32);  h(5) := MOD(h(5) + f, c_2_32);
            h(6) := MOD(h(6) + g, c_2_32);  h(7) := MOD(h(7) + hh, c_2_32);
        END LOOP;

        FOR i IN 0 .. 7 LOOP
            l_out := l_out || LPAD(TO_CHAR(h(i), 'FMXXXXXXXX'), 8, '0');
        END LOOP;
        RETURN HEXTORAW(l_out);
    END sha256_plsql;

    FUNCTION sha256_plsql_hex(p_input IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN LOWER(RAWTOHEX(sha256_plsql(UTL_I18N.STRING_TO_RAW(p_input, 'AL32UTF8'))));
    END sha256_plsql_hex;

    FUNCTION sha256(p_input IN RAW) RETURN RAW IS
    BEGIN
        $IF DBMS_DB_VERSION.VERSION < 12 $THEN
            RETURN sha256_plsql(p_input);
        $ELSE
            RETURN DBMS_CRYPTO.HASH(p_input, DBMS_CRYPTO.HASH_SH256);
        $END
    END sha256;

    FUNCTION pow_zero_bits(p_salt IN VARCHAR2, p_nonce IN NUMBER) RETURN PLS_INTEGER IS
        l_hash RAW(32);
        l_bits PLS_INTEGER := 0;
        l_byte PLS_INTEGER;
    BEGIN
        -- 'FM' + 16 digits prints the nonce exactly like JS String(nonce) for safe integers.
        l_hash := sha256(
                      UTL_I18N.STRING_TO_RAW(p_salt || ':' || TO_CHAR(p_nonce, 'FM9999999999999999'), 'AL32UTF8'));

        FOR i IN 1 .. UTL_RAW.LENGTH(l_hash) LOOP
            l_byte := TO_NUMBER(RAWTOHEX(UTL_RAW.SUBSTR(l_hash, i, 1)), 'XX');
            IF l_byte = 0 THEN
                l_bits := l_bits + 8;
            ELSE
                WHILE l_byte < 128 LOOP
                    l_bits := l_bits + 1;
                    l_byte := l_byte * 2;
                END LOOP;
                RETURN l_bits;
            END IF;
        END LOOP;
        RETURN l_bits;
    END pow_zero_bits;

    PROCEDURE issue_challenge(
        p_token      OUT VARCHAR2,
        p_salt       OUT VARCHAR2,
        p_bits       OUT PLS_INTEGER,
        p_wait_ms    OUT PLS_INTEGER,
        p_difficulty IN  PLS_INTEGER DEFAULT c_bits,
        p_client_ip  IN  VARCHAR2 DEFAULT NULL
    ) IS
        PRAGMA AUTONOMOUS_TRANSACTION;
        -- Computed in PL/SQL: private package functions can't be called from SQL.
        l_now     TIMESTAMP WITH TIME ZONE := SYSTIMESTAMP;
        l_expires TIMESTAMP WITH TIME ZONE := l_now + ms_interval(c_challenge_ttl_ms);
        l_count   PLS_INTEGER;
        l_ip      captcha_challenges.client_ip%TYPE := SUBSTR(p_client_ip, 1, 45);
    BEGIN
        -- Housekeeping: nothing outlives challenge TTL + pass TTL, an hour is plenty.
        DELETE FROM captcha_challenges WHERE issued_at < l_now - INTERVAL '1' HOUR;
        -- Keep the purge, and end the autonomous transaction before any raise (else ORA-06519).
        COMMIT;

        SELECT COUNT(*) INTO l_count FROM captcha_challenges;
        IF l_count >= c_max_stored THEN
            RAISE_APPLICATION_ERROR(-20010, 'Too many captcha challenges stored; try again later.');
        END IF;

        IF l_ip IS NOT NULL THEN
            SELECT COUNT(*) INTO l_count
            FROM   captcha_challenges
            WHERE  client_ip = l_ip
            AND    issued_at > l_now - INTERVAL '1' MINUTE;
            IF l_count >= c_max_per_ip_per_minute THEN
                RAISE_APPLICATION_ERROR(-20010, 'Too many captcha challenges from this client; try again in a minute.');
            END IF;
        END IF;

        p_token   := random_hex(32);
        p_salt    := random_hex(16);
        p_bits    := p_difficulty;
        -- The widget holds a lucky fast answer this long so it isn't rejected as too-fast.
        p_wait_ms := c_min_solve_ms;

        INSERT INTO captcha_challenges (challenge_token, salt, bits, issued_at, expires_at, client_ip)
        VALUES (p_token, p_salt, p_bits, l_now, l_expires, l_ip);
        COMMIT;
    END issue_challenge;

    PROCEDURE verify_solution(
        p_token         IN  VARCHAR2,
        p_nonce         IN  NUMBER,
        p_pass          OUT VARCHAR2,
        p_expires_in_ms OUT PLS_INTEGER,
        p_error         OUT VARCHAR2
    ) IS
        PRAGMA AUTONOMOUS_TRANSACTION;
        l_row captcha_challenges%ROWTYPE;
        l_now TIMESTAMP WITH TIME ZONE := SYSTIMESTAMP;
        l_pass_expires TIMESTAMP WITH TIME ZONE := l_now + ms_interval(c_pass_ttl_ms);
    BEGIN
        BEGIN
            SELECT * INTO l_row
            FROM   captcha_challenges
            WHERE  challenge_token = p_token
            FOR UPDATE;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                p_error := 'invalid-challenge';
                ROLLBACK;
                RETURN;
        END;

        IF l_row.pass_token IS NOT NULL THEN
            p_error := 'challenge-reused';
        ELSIF l_row.expires_at < l_now THEN
            p_error := 'challenge-expired';
        ELSIF ms_between(l_row.issued_at, l_now) < c_min_solve_ms THEN
            p_error := 'too-fast';
        ELSIF p_nonce IS NULL OR p_nonce < 0 OR p_nonce > c_max_nonce OR p_nonce <> TRUNC(p_nonce) THEN
            p_error := 'invalid-nonce';
        ELSIF pow_zero_bits(l_row.salt, p_nonce) < l_row.bits THEN
            p_error := 'wrong-solution';
        END IF;

        IF p_error IN ('invalid-nonce', 'wrong-solution') THEN
            -- One answer per challenge: guessing nonces against the server gets nowhere.
            DELETE FROM captcha_challenges WHERE challenge_token = p_token;
            COMMIT;
            RETURN;
        ELSIF p_error IS NOT NULL THEN
            ROLLBACK;
            RETURN;
        END IF;

        p_pass          := random_hex(32);
        p_expires_in_ms := c_pass_ttl_ms;

        UPDATE captcha_challenges
        SET    pass_token      = p_pass,
               pass_expires_at = l_pass_expires
        WHERE  challenge_token = p_token;
        COMMIT;
    END verify_solution;

    FUNCTION consume_pass(p_pass IN VARCHAR2) RETURN VARCHAR2 IS
        PRAGMA AUTONOMOUS_TRANSACTION;
        l_used_at    captcha_challenges.pass_used_at%TYPE;
        l_expires_at captcha_challenges.pass_expires_at%TYPE;
    BEGIN
        IF p_pass IS NULL THEN
            RETURN 'invalid-token';
        END IF;

        -- A single conditional UPDATE, so two concurrent submits can't both win.
        UPDATE captcha_challenges
        SET    pass_used_at = SYSTIMESTAMP
        WHERE  pass_token = p_pass
        AND    pass_used_at IS NULL
        AND    pass_expires_at > SYSTIMESTAMP;

        IF SQL%ROWCOUNT = 1 THEN
            COMMIT;
            RETURN NULL;
        END IF;
        COMMIT;

        BEGIN
            SELECT pass_used_at, pass_expires_at
            INTO   l_used_at, l_expires_at
            FROM   captcha_challenges
            WHERE  pass_token = p_pass;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RETURN 'invalid-token';
        END;

        RETURN CASE WHEN l_used_at IS NOT NULL THEN 'token-reused' ELSE 'token-expired' END;
    END consume_pass;

    FUNCTION error_message(p_error IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE p_error
            WHEN 'invalid-token' THEN 'لطفاً تیک «من ربات نیستم» را بزنید.'
            WHEN 'token-expired' THEN 'تأیید «من ربات نیستم» منقضی شده است. دوباره تیک بزنید.'
            WHEN 'token-reused'  THEN 'این تأیید قبلاً استفاده شده است. دوباره تیک بزنید.'
            ELSE CASE WHEN p_error IS NOT NULL THEN 'تأیید «من ربات نیستم» ناموفق بود. دوباره تیک بزنید.' END
        END;
    END error_message;

    PROCEDURE ajax_response(
        p_action    IN VARCHAR2,
        p_x01       IN VARCHAR2 DEFAULT NULL,
        p_x02       IN VARCHAR2 DEFAULT NULL,
        p_client_ip IN VARCHAR2 DEFAULT NULL
    ) IS
        l_token VARCHAR2(64);
        l_salt  VARCHAR2(32);
        l_bits  PLS_INTEGER;
        l_wait  PLS_INTEGER;
        l_nonce NUMBER;
        l_pass  VARCHAR2(64);
        l_exp   PLS_INTEGER;
        l_err   VARCHAR2(40);
    BEGIN
        -- Every value written below is hex, a number or a fixed error code, so
        -- no JSON escaping is needed (and no APEX_JSON, which older APEX lacks).
        IF p_action = 'challenge' THEN
            BEGIN
                issue_challenge(l_token, l_salt, l_bits, l_wait, p_client_ip => p_client_ip);
                htp.p('{"token":"' || l_token || '","salt":"' || l_salt
                      || '","bits":' || l_bits || ',"wait":' || l_wait || '}');
            EXCEPTION
                WHEN e_rate_limited THEN
                    htp.p('{"error":"rate-limited"}');
            END;
        ELSIF p_action = 'solve' THEN
            BEGIN
                l_nonce := TO_NUMBER(p_x02);
            EXCEPTION
                WHEN VALUE_ERROR THEN
                    l_nonce := NULL; -- verify_solution reports invalid-nonce
            END;
            verify_solution(p_x01, l_nonce, l_pass, l_exp, l_err);
            IF l_err IS NULL THEN
                htp.p('{"pass":"' || l_pass || '","expiresIn":' || l_exp || '}');
            ELSE
                htp.p('{"error":"' || l_err || '"}');
            END IF;
        ELSE
            htp.p('{"error":"unknown-action"}');
        END IF;
    END ajax_response;

BEGIN
    -- SHA-256 round constants (first 32 bits of the fractional parts of the
    -- cube roots of the first 64 primes), for sha256_plsql.
        g_k(0) := 1116352408; g_k(1) := 1899447441; g_k(2) := 3049323471; g_k(3) := 3921009573;
        g_k(4) := 961987163; g_k(5) := 1508970993; g_k(6) := 2453635748; g_k(7) := 2870763221;
        g_k(8) := 3624381080; g_k(9) := 310598401; g_k(10) := 607225278; g_k(11) := 1426881987;
        g_k(12) := 1925078388; g_k(13) := 2162078206; g_k(14) := 2614888103; g_k(15) := 3248222580;
        g_k(16) := 3835390401; g_k(17) := 4022224774; g_k(18) := 264347078; g_k(19) := 604807628;
        g_k(20) := 770255983; g_k(21) := 1249150122; g_k(22) := 1555081692; g_k(23) := 1996064986;
        g_k(24) := 2554220882; g_k(25) := 2821834349; g_k(26) := 2952996808; g_k(27) := 3210313671;
        g_k(28) := 3336571891; g_k(29) := 3584528711; g_k(30) := 113926993; g_k(31) := 338241895;
        g_k(32) := 666307205; g_k(33) := 773529912; g_k(34) := 1294757372; g_k(35) := 1396182291;
        g_k(36) := 1695183700; g_k(37) := 1986661051; g_k(38) := 2177026350; g_k(39) := 2456956037;
        g_k(40) := 2730485921; g_k(41) := 2820302411; g_k(42) := 3259730800; g_k(43) := 3345764771;
        g_k(44) := 3516065817; g_k(45) := 3600352804; g_k(46) := 4094571909; g_k(47) := 275423344;
        g_k(48) := 430227734; g_k(49) := 506948616; g_k(50) := 659060556; g_k(51) := 883997877;
        g_k(52) := 958139571; g_k(53) := 1322822218; g_k(54) := 1537002063; g_k(55) := 1747873779;
        g_k(56) := 1955562222; g_k(57) := 2024104815; g_k(58) := 2227730452; g_k(59) := 2361852424;
        g_k(60) := 2428436474; g_k(61) := 2756734187; g_k(62) := 3204031479; g_k(63) := 3329325298;
END captcha_api;
/
