ALTER TABLE profiles ADD COLUMN password_login TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX profiles_password_login ON profiles(password_login) WHERE password_login IS NOT NULL;
