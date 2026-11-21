-- The initial installation creates its first administrator before any other account.
UPDATE users
SET full_name = 'Datum Foundry Nine'
WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY rowid LIMIT 1)
  AND full_name IN ('Polaris Sandbox', 'Polaris Craft');

UPDATE settings
SET doc = json_set(doc, '$.app_name', 'Datum Foundry Nine')
WHERE id = 1 AND json_extract(doc, '$.app_name') IN ('Polaris Craft', 'Polaris Sandbox');
