-- Run only as the owner of the NEW dedicated Preview database, after migrations.
-- The provider must create a separate LOGIN role named quoteflow_preview_runtime
-- through its secure role UI. No password belongs in this file.
-- Do not execute against an existing shared/production database.
GRANT CONNECT ON DATABASE quoteflow_preview TO quoteflow_preview_runtime;
GRANT USAGE ON SCHEMA public TO quoteflow_preview_runtime;
GRANT SELECT, INSERT, UPDATE ON qf_jobs TO quoteflow_preview_runtime;
GRANT INSERT ON qf_uploads TO quoteflow_preview_runtime;
GRANT SELECT, INSERT ON qf_stripe_events TO quoteflow_preview_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON qf_upload_rates, qf_upload_leases TO quoteflow_preview_runtime;
-- Retention cleanup runs separately under an owner/maintenance role.
