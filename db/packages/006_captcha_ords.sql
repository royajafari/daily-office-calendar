-- "I'm not a robot" captcha — public ORDS endpoints for the browser widget.
--
-- Like 003_ords_modules.sql, this needs the ORDS.* API (schema REST-enabled),
-- so it is applied separately, not by db.changelog-master.yaml:
--
--   liquibase --changelog-file=db/changelog/2026-09-30-02-captcha-ords.yaml update
--
-- Endpoints (the paths not-robot.js expects; set its `server` attribute to
-- <ords base>/<schema alias>/captcha):
--   POST .../captcha/challenge   -> { token, salt, bits, wait }
--   POST .../captcha/solve       { token, nonce } -> { pass, expiresIn } | 400 { error }
--
-- Deliberately public (the login page is pre-authentication). There is no
-- /siteverify here: the APEX login page calls captcha_api.consume_pass directly.

BEGIN
    ords.define_module(
        p_module_name    => 'daily.office.captcha',
        p_base_path      => '/captcha/',
        p_items_per_page => 0,
        p_status         => 'PUBLISHED',
        p_comments       => 'Captcha challenge/solve endpoints for the APEX login page widget'
    );

    ---------------------------------------------------------------------
    -- POST challenge
    ---------------------------------------------------------------------
    ords.define_template(
        p_module_name => 'daily.office.captcha',
        p_pattern     => 'challenge'
    );

    ords.define_handler(
        p_module_name    => 'daily.office.captcha',
        p_pattern        => 'challenge',
        p_method         => 'POST',
        p_source_type    => ords.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            DECLARE
                l_token VARCHAR2(64);
                l_salt  VARCHAR2(32);
                l_bits  PLS_INTEGER;
                l_wait  PLS_INTEGER;
            BEGIN
                captcha_api.issue_challenge(l_token, l_salt, l_bits, l_wait);
                :challenge_token := l_token;
                :salt            := l_salt;
                :bits            := l_bits;
                :wait_ms         := l_wait;
                :status_code     := 200;
            END;
        ]'
    );

    -- JSON key (p_name) differs from the bind name where the key is a reserved word.
    FOR p IN (
        SELECT 'token' AS name, 'challenge_token' AS bind, 'STRING' AS ptype FROM dual
        UNION ALL SELECT 'salt', 'salt',    'STRING' FROM dual
        UNION ALL SELECT 'bits', 'bits',    'INT'    FROM dual
        UNION ALL SELECT 'wait', 'wait_ms', 'INT'    FROM dual
    ) LOOP
        ords.define_parameter(
            p_module_name        => 'daily.office.captcha',
            p_pattern            => 'challenge',
            p_method             => 'POST',
            p_name               => p.name,
            p_bind_variable_name => p.bind,
            p_source_type        => 'RESPONSE',
            p_param_type         => p.ptype,
            p_access_method      => 'OUT'
        );
    END LOOP;

    ---------------------------------------------------------------------
    -- POST solve
    ---------------------------------------------------------------------
    ords.define_template(
        p_module_name => 'daily.office.captcha',
        p_pattern     => 'solve'
    );

    ords.define_handler(
        p_module_name    => 'daily.office.captcha',
        p_pattern        => 'solve',
        p_method         => 'POST',
        p_source_type    => ords.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            DECLARE
                l_body  CLOB := :body_text;
                l_token VARCHAR2(200);
                l_nonce NUMBER;
                l_pass  VARCHAR2(64);
                l_exp   PLS_INTEGER;
                l_err   VARCHAR2(40);
            BEGIN
                SELECT JSON_VALUE(l_body, '$.token' RETURNING VARCHAR2(200) NULL ON ERROR),
                       JSON_VALUE(l_body, '$.nonce' RETURNING NUMBER NULL ON ERROR)
                INTO   l_token, l_nonce
                FROM   dual;

                captcha_api.verify_solution(l_token, l_nonce, l_pass, l_exp, l_err);

                IF l_err IS NULL THEN
                    :pass_token  := l_pass;
                    :expires_in  := l_exp;
                    :status_code := 200;
                ELSE
                    :error_code  := l_err;
                    :status_code := 400;
                END IF;
            END;
        ]'
    );

    FOR p IN (
        SELECT 'pass' AS name, 'pass_token' AS bind, 'STRING' AS ptype FROM dual
        UNION ALL SELECT 'expiresIn', 'expires_in', 'INT'    FROM dual
        UNION ALL SELECT 'error',     'error_code', 'STRING' FROM dual
    ) LOOP
        ords.define_parameter(
            p_module_name        => 'daily.office.captcha',
            p_pattern            => 'solve',
            p_method             => 'POST',
            p_name               => p.name,
            p_bind_variable_name => p.bind,
            p_source_type        => 'RESPONSE',
            p_param_type         => p.ptype,
            p_access_method      => 'OUT'
        );
    END LOOP;

    COMMIT;
END;
