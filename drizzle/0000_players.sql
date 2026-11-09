CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(username) BETWEEN 3 AND 24),
  created_at INTEGER NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','friends','private')),
  requests INTEGER NOT NULL DEFAULT 1 CHECK(requests IN (0,1)),
  avatar TEXT CHECK(length(avatar) <= 36000),
  closing INTEGER NOT NULL DEFAULT 0 CHECK(closing IN (0,1))
);
--> statement-breakpoint
CREATE TABLE friendships (
  low TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  high TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sender TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted')),
  changed_at INTEGER NOT NULL,
  PRIMARY KEY(low,high),
  CHECK(low < high AND (sender = low OR sender = high))
);
--> statement-breakpoint
CREATE INDEX friendships_high ON friendships(high,status);
--> statement-breakpoint
CREATE TABLE blocks (
  owner TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY(owner,target),
  CHECK(owner <> target)
);
--> statement-breakpoint
CREATE INDEX blocks_target ON blocks(target);
--> statement-breakpoint
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sender TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('request','accepted')),
  created_at INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0 CHECK(seen IN (0,1))
);
--> statement-breakpoint
CREATE INDEX notifications_owner ON notifications(owner,seen,created_at);
--> statement-breakpoint
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  player TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  difficulty TEXT NOT NULL CHECK(difficulty IN ('story','normal','dread')),
  seed INTEGER NOT NULL,
  version INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  last_hash TEXT,
  snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','finished','abandoned')),
  ticks INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX runs_player ON runs(player,status,expires_at);
--> statement-breakpoint
CREATE TABLE results (
  run TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  player TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  finished_at INTEGER NOT NULL,
  route TEXT CHECK(route IN ('front','drain')),
  deaths INTEGER NOT NULL CHECK(deaths BETWEEN 0 AND 5),
  ticks INTEGER NOT NULL CHECK(ticks BETWEEN 1 AND 45000),
  score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 4100),
  CHECK((route IS NULL AND deaths=5 AND score=0) OR (route IS NOT NULL AND deaths<5 AND score>0))
);
--> statement-breakpoint
CREATE INDEX results_player ON results(player,finished_at);
--> statement-breakpoint
CREATE INDEX results_period ON results(finished_at,player);
--> statement-breakpoint
CREATE TABLE throttles (
  bucket TEXT NOT NULL,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(bucket,window)
);
--> statement-breakpoint
CREATE INDEX throttles_expiry ON throttles(window);
