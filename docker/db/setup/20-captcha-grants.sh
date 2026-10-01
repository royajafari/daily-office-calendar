#!/bin/bash
# Runs automatically on the Oracle container's FIRST initialization (see
# 10-apex-26.1.sh for how gvenzl init scripts work). On an already-initialized
# database, run it once by hand:
#
#   docker exec daily-office-calendar-oracle-1 /container-entrypoint-initdb.d/20-captcha-grants.sh
#
# captcha_api (db/packages/005_captcha_api.sql) needs DBMS_CRYPTO for
# cryptographically random tokens and SHA-256. Idempotent.

set -euo pipefail

APP_USER="${APP_USER:-daily_office}"

echo "[20-captcha-grants] GRANT EXECUTE ON SYS.DBMS_CRYPTO TO ${APP_USER}"
sqlplus -s / as sysdba <<SQL
WHENEVER SQLERROR EXIT SQL.SQLCODE
ALTER SESSION SET CONTAINER = FREEPDB1;
GRANT EXECUTE ON SYS.DBMS_CRYPTO TO ${APP_USER};
SQL
