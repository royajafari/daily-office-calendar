-- Page Error Handling Function for the Daily Office Calendar app.
-- Maps daily_office_api's raise_application_error codes (ORA-20001..20005) to
-- Persian, user-facing messages instead of a raw ORA- exception (DO-AC-05).
--
-- IMPORTANT: this depends on APEX_ERROR / APEX_ZZZ package types that only
-- exist once APEX 26.1 is installed in the database, so — like
-- db/packages/003_ords_modules.sql — it is applied separately, not part of
-- the base `liquibase update`. See db/changelog/2026-09-10-03-apex-error-handler.yaml.

CREATE OR REPLACE FUNCTION daily_office_pkg_error_handler(
    p_error IN apex_error.t_error
) RETURN apex_error.t_error_result IS
    l_result apex_error.t_error_result;
BEGIN
    l_result := apex_error.init_error_result(p_error => p_error);

    CASE p_error.ora_sqlcode
        WHEN -20001 THEN
            l_result.message := 'زمان پایان باید بعد از زمان شروع باشد.';
            l_result.display_location := apex_error.c_inline_in_notification;
        WHEN -20002 THEN
            l_result.message := 'این بازه‌ی زمانی با یک رویداد تأییدشده‌ی دیگر تداخل دارد.';
            l_result.display_location := apex_error.c_inline_in_notification;
        WHEN -20003 THEN
            l_result.message := 'رویداد یا درخواست مورد نظر یافت نشد.';
            l_result.display_location := apex_error.c_inline_in_notification;
        WHEN -20004 THEN
            l_result.message := 'این درخواست قبلاً بررسی شده است.';
            l_result.display_location := apex_error.c_inline_in_notification;
        WHEN -20005 THEN
            l_result.message := 'مقدار ارسالی نامعتبر است.';
            l_result.display_location := apex_error.c_inline_in_notification;
        ELSE
            NULL; -- keep APEX's default handling for anything unexpected
    END CASE;

    RETURN l_result;
END daily_office_pkg_error_handler;
