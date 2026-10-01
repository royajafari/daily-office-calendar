-- "I'm not a robot" captcha — server side, in PL/SQL, for the APEX login page.
-- Same protocol as not-robot-captcha/server/core.js, so the unchanged browser
-- widget (not-robot-captcha/widget/not-robot.js) talks to it through ORDS
-- (db/packages/006_captcha_ords.sql):
--
--   1. issue_challenge  → random salt + opaque challenge token (row in captcha_challenges).
--   2. The widget finds a nonce so sha256(salt || ':' || nonce) starts with
--      `bits` zero bits (proof-of-work).
--   3. verify_solution  → checks expiry, minimum solve time and the proof-of-work,
--      then issues a pass token (10 minutes).
--   4. consume_pass     → the login page's validation accepts each pass exactly once.
--
-- Requires: GRANT EXECUTE ON SYS.DBMS_CRYPTO TO <schema> (docker/db/setup/20-captcha-grants.sh).
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

    -- Leading zero bits of sha256(p_salt || ':' || p_nonce); public for tests.
    FUNCTION pow_zero_bits(p_salt IN VARCHAR2, p_nonce IN NUMBER) RETURN PLS_INTEGER;

END captcha_api;
/

CREATE OR REPLACE PACKAGE BODY captcha_api AS

    c_max_nonce CONSTANT NUMBER := 9007199254740991; -- JS Number.MAX_SAFE_INTEGER

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

    FUNCTION pow_zero_bits(p_salt IN VARCHAR2, p_nonce IN NUMBER) RETURN PLS_INTEGER IS
        l_hash RAW(32);
        l_bits PLS_INTEGER := 0;
        l_byte PLS_INTEGER;
    BEGIN
        -- 'FM' + 16 digits prints the nonce exactly like JS String(nonce) for safe integers.
        l_hash := DBMS_CRYPTO.HASH(
                      UTL_I18N.STRING_TO_RAW(p_salt || ':' || TO_CHAR(p_nonce, 'FM9999999999999999'), 'AL32UTF8'),
                      DBMS_CRYPTO.HASH_SH256);

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

END captcha_api;
/
