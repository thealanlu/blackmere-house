CREATE TABLE offline_escapes (
  player TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  run TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  route TEXT NOT NULL CHECK(route IN ('front','drain')),
  ticks INTEGER NOT NULL,
  replay_hash TEXT NOT NULL,
  UNIQUE(player,replay_hash),
  PRIMARY KEY(player,run)
);
--> statement-breakpoint
ALTER TABLE runs ADD COLUMN rules_difficulty TEXT;
