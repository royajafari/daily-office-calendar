-- Daily Office Calendar — core schema
-- Roles: OFFICE_HEAD (full CRUD on office_events), STAFF (availability + requests only)

CREATE TABLE app_user_roles (
    user_name  VARCHAR2(128) NOT NULL,
    user_role  VARCHAR2(20)  NOT NULL,
    CONSTRAINT pk_app_user_roles PRIMARY KEY (user_name, user_role),
    CONSTRAINT ck_app_user_roles_role CHECK (user_role IN ('OFFICE_HEAD', 'STAFF'))
);

CREATE TABLE office_events (
    id             NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type     VARCHAR2(20)  NOT NULL,
    title          VARCHAR2(200) NOT NULL,
    location       VARCHAR2(200),
    description    VARCHAR2(4000),
    starts_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    ends_at        TIMESTAMP WITH TIME ZONE NOT NULL,
    status         VARCHAR2(20) DEFAULT 'CONFIRMED' NOT NULL,
    google_event_id VARCHAR2(200),
    created_by     VARCHAR2(128) NOT NULL,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT ck_office_events_type CHECK (event_type IN ('MEETING', 'MISSION', 'APPOINTMENT', 'OTHER')),
    CONSTRAINT ck_office_events_status CHECK (status IN ('CONFIRMED', 'CANCELLED')),
    CONSTRAINT ck_office_events_range CHECK (ends_at > starts_at)
);

CREATE INDEX ix_office_events_window ON office_events (starts_at, ends_at);
CREATE INDEX ix_office_events_status ON office_events (status);

CREATE TABLE office_requests (
    id                 NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    requested_by       VARCHAR2(128) NOT NULL,
    event_type         VARCHAR2(20)  NOT NULL,
    title              VARCHAR2(200) NOT NULL,
    note               VARCHAR2(4000),
    starts_at          TIMESTAMP WITH TIME ZONE NOT NULL,
    ends_at            TIMESTAMP WITH TIME ZONE NOT NULL,
    status             VARCHAR2(20) DEFAULT 'PENDING' NOT NULL,
    reviewed_by        VARCHAR2(128),
    reviewed_at        TIMESTAMP WITH TIME ZONE,
    resulting_event_id NUMBER,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT ck_office_requests_type CHECK (event_type IN ('MEETING', 'MISSION', 'APPOINTMENT', 'OTHER')),
    CONSTRAINT ck_office_requests_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    CONSTRAINT ck_office_requests_range CHECK (ends_at > starts_at),
    CONSTRAINT fk_office_requests_event FOREIGN KEY (resulting_event_id) REFERENCES office_events (id)
);

CREATE INDEX ix_office_requests_status ON office_requests (status);

CREATE TABLE calendar_sync_queue (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id        NUMBER NOT NULL,
    operation       VARCHAR2(10) NOT NULL,
    idempotency_key VARCHAR2(200) NOT NULL,
    status          VARCHAR2(20) DEFAULT 'PENDING' NOT NULL,
    attempts        NUMBER DEFAULT 0 NOT NULL,
    last_error      VARCHAR2(4000),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    processed_at    TIMESTAMP WITH TIME ZONE,
    CONSTRAINT ck_sync_queue_operation CHECK (operation IN ('UPSERT', 'DELETE')),
    CONSTRAINT ck_sync_queue_status CHECK (status IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED')),
    CONSTRAINT uq_sync_queue_idempotency UNIQUE (idempotency_key),
    CONSTRAINT fk_sync_queue_event FOREIGN KEY (event_id) REFERENCES office_events (id)
);

CREATE INDEX ix_sync_queue_status ON calendar_sync_queue (status);
