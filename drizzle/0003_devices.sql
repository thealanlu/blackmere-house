CREATE TABLE player_devices (
  player TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  preferences TEXT NOT NULL DEFAULT '{}',
  checkpoint TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
