-- A fresh hosted installation starts with configuration only. Existing settings take precedence.
INSERT OR IGNORE INTO settings (id, doc)
VALUES (1, '{
  "app_name": "Datum Foundry Nine",
  "reference_prefix": "RG",
  "preview_url": "",
  "live_url": "",
  "automation_enabled": true,
  "onboarding_complete": false,
  "policy_version": "shipsure-policy-v1",
  "allowed_recipes": ["workflow.mark_duplicate"],
  "blocked_areas": ["source_code","authentication","permissions","billing","secrets","schema_destructive_change","production_deploy"]
}');
