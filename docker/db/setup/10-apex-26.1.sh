#!/bin/bash
# Runs automatically on the Oracle container's FIRST initialization
# (gvenzl images execute every .sh/.sql in /container-entrypoint-initdb.d,
# alphabetically, only when the data volume is empty). Once the DB has
# already been initialized once, this script no longer runs on its own —
# re-invoke it manually against the running container instead:
#
#   docker exec -e APEX_ADMIN_PASSWORD=... -e APEX_REST_PASSWORD=... \
#     daily-office-calendar-oracle-1 /container-entrypoint-initdb.d/10-apex-26.1.sh
#
# Requires:
#   - exactly one *.zip under docker/apex-dist/ (the official Oracle APEX
#     26.1 download — Gate G2, see docs/architecture.md; NOT distributed in
#     this repo, and NOT renamed — whatever Oracle's download page calls it
#     is fine, this script just looks for "the one zip file" in that folder)
#   - APEX_ADMIN_PASSWORD, APEX_REST_PASSWORD in docker/.env  (Gate G1)
#
# If the ZIP is missing, this script logs a message and exits 0 (success) so
# the database still comes up — APEX install can be re-run manually later.
# If the ZIP is present but the passwords are missing, it fails loudly rather
# than guessing/fabricating a password.

set -euo pipefail

APEX_DIST_DIR="/opt/oracle/apex-dist"
APEX_INSTALL_DIR="${APEX_DIST_DIR}/unzipped"

mapfile -t apex_zips < <(find "$APEX_DIST_DIR" -maxdepth 1 -iname "*.zip" 2>/dev/null)

if [ "${#apex_zips[@]}" -eq 0 ]; then
  echo "[10-apex-26.1] No .zip found under $APEX_DIST_DIR — skipping APEX install."
  echo "[10-apex-26.1] Download the official Oracle APEX 26.1 ZIP and place it (any filename) under docker/apex-dist/, then re-run this script."
  exit 0
fi

if [ "${#apex_zips[@]}" -gt 1 ]; then
  echo "[10-apex-26.1] ERROR: more than one .zip found under $APEX_DIST_DIR: ${apex_zips[*]}" >&2
  echo "[10-apex-26.1] Keep exactly one APEX distribution ZIP there." >&2
  exit 1
fi

APEX_ZIP="${apex_zips[0]}"

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
