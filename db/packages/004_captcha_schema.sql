-- "I'm not a robot" captcha — storage for captcha_api (see 005_captcha_api.sql).
-- One row per challenge; once solved, the same row carries the single-use pass
-- token that the APEX login page consumes. Rows are purged an hour after issue.

CREATE TABLE captcha_challenges (
    challenge_token VARCHAR2(64)  NOT NULL,
    salt            VARCHAR2(32)  NOT NULL,
    bits            NUMBER(2)     NOT NULL,
    issued_at       TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    expires_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    pass_token      VARCHAR2(64),
    pass_expires_at TIMESTAMP WITH TIME ZONE,
    pass_used_at    TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_captcha_challenges PRIMARY KEY (challenge_token),
    CONSTRAINT uq_captcha_challenges_pass UNIQUE (pass_token)
);

CREATE INDEX ix_captcha_challenges_issued ON captcha_challenges (issued_at);
