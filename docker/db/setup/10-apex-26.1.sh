#!/bin/bash
# Runs once, automatically, on the Oracle container's FIRST initialization
# (gvenzl images execute every .sh/.sql in /container-entrypoint-initdb.d,
# alphabetically, only when the data volume is empty).
#
# Requires:
#   - docker/apex-dist/apex_26.1_en.zip  (official Oracle download — Gate G2,
#     see docs/architecture.md; NOT distributed in this repo)
#   - APEX_ADMIN_PASSWORD, APEX_REST_PASSWORD in docker/.env  (Gate G1)
#
# If the ZIP is missing, this script logs a message and exits 0 (success) so
# the database still comes up — APEX install can be re-run manually later.
# If the ZIP is present but the passwords are missing, it fails loudly rather
# than guessing/fabricating a password.

set -euo pipefail

APEX_ZIP="/opt/oracle/apex-dist/apex_26.1_en.zip"
APEX_INSTALL_DIR="/opt/oracle/apex-dist/unzipped"

if [ ! -f "$APEX_ZIP" ]; then
  echo "[10-apex-26.1] $APEX_ZIP not found — skipping APEX install."
  echo "[10-apex-26.1] Download the official Oracle APEX 26.1 ZIP and place it at docker/apex-dist/apex_26.1_en.zip, then recreate this container to install."
  exit 0
fi

if [ -z "${APEX_ADMIN_PASSWORD:-}" ] || [ -z "${APEX_REST_PASSWORD:-}" ]; then
  echo "[10-apex-26.1] ERROR: APEX_ADMIN_PASSWORD and/or APEX_REST_PASSWORD are not set in docker/.env." >&2
  echo "[10-apex-26.1] Refusing to install APEX with a fabricated/default password." >&2
  exit 1
fi

echo "[10-apex-26.1] Unzipping APEX distribution..."
mkdir -p "$APEX_INSTALL_DIR"
unzip -q -o "$APEX_ZIP" -d "$APEX_INSTALL_DIR"
APEX_HOME="$APEX_INSTALL_DIR/apex"

echo "[10-apex-26.1] Running apexins.sql (this can take several minutes)..."
sqlplus -s / as sysdba <<SQL
ALTER SESSION SET CONTAINER = FREEPDB1;
@${APEX_HOME}/apexins.sql SYSAUX SYSAUX TEMP /i/
SQL

echo "[10-apex-26.1] Setting APEX admin password..."
sqlplus -s / as sysdba <<SQL
ALTER SESSION SET CONTAINER = FREEPDB1;
@${APEX_HOME}/apxchpwd.sql
${APEX_ADMIN_PASSWORD}
${APEX_ADMIN_PASSWORD}
SQL

echo "[10-apex-26.1] Configuring APEX RESTful services (ORDS_PUBLIC_USER / APEX_PUBLIC_USER)..."
sqlplus -s / as sysdba <<SQL
ALTER SESSION SET CONTAINER = FREEPDB1;
@${APEX_HOME}/apex_rest_config.sql
${APEX_REST_PASSWORD}
${APEX_REST_PASSWORD}
SQL

echo "[10-apex-26.1] APEX 26.1 install complete."
