-- The date a meeting took place, read from a leading YYYY-MM-DD on the filename. Null when there is none;
-- readers fall back to created_at.
ALTER TABLE meetings ADD COLUMN meeting_date date;
