CREATE TABLE multiplayer_rooms (
  code TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  touched INTEGER NOT NULL,
  phase TEXT NOT NULL,
  access TEXT NOT NULL,
  mode TEXT NOT NULL,
  state TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX multiplayer_room_lookup ON multiplayer_rooms(phase,access,mode,touched);
--> statement-breakpoint
CREATE TABLE multiplayer_invites (
  code TEXT NOT NULL REFERENCES multiplayer_rooms(code) ON DELETE CASCADE,
  sender TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY(code,recipient)
);
--> statement-breakpoint
CREATE INDEX multiplayer_invite_inbox ON multiplayer_invites(recipient,sent_at);
--> statement-breakpoint
CREATE TABLE multiplayer_matches (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  lineup TEXT NOT NULL,
  ranked INTEGER NOT NULL,
  finished_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX multiplayer_match_history ON multiplayer_matches(lineup,ranked,finished_at);
--> statement-breakpoint
CREATE TABLE multiplayer_results (
  game TEXT NOT NULL REFERENCES multiplayer_matches(id) ON DELETE CASCADE,
  player TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  won INTEGER NOT NULL,
  escapes INTEGER NOT NULL,
  rescues INTEGER NOT NULL,
  objectives INTEGER NOT NULL,
  captures INTEGER NOT NULL,
  seconds INTEGER NOT NULL,
  capture_time INTEGER NOT NULL,
  score INTEGER NOT NULL,
  PRIMARY KEY(game,player)
);
--> statement-breakpoint
CREATE INDEX multiplayer_result_player ON multiplayer_results(player,role);
--> statement-breakpoint
CREATE TABLE multiplayer_reports (
  game TEXT NOT NULL REFERENCES multiplayer_matches(id) ON DELETE CASCADE,
  reporter TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  reported_at INTEGER NOT NULL,
  PRIMARY KEY(game,reporter,target)
);
--> statement-breakpoint
CREATE TABLE multiplayer_voice_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL REFERENCES multiplayer_rooms(code) ON DELETE CASCADE,
  game TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX multiplayer_voice_inbox ON multiplayer_voice_signals(code,game,recipient,id);
--> statement-breakpoint
CREATE INDEX multiplayer_voice_expiry ON multiplayer_voice_signals(expires);
