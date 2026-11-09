# Blackmere House

A first-person survival horror game. Find tools and escape through the front door or the storm drain before the Caretaker catches you for the fifth time. Guest runs are available without a Blackmere account. Ranked runs earn a record only after server verification.

## Run locally

Use Node.js 22.13 or newer.

```sh
npm ci
npm run build
npm start
```

Open [http://127.0.0.1:8127](http://127.0.0.1:8127) in a WebGL 2 browser. The local server applies the database migrations to `blackmere.sqlite`. Set `BLACKMERE_DB=:memory:` for a temporary database. Copy `.env.example` to `.env` to set local values. Guest play needs no account provider or credentials.

## Play

| Action | Keyboard or mouse |
| --- | --- |
| Move | W, A, S, D |
| Look | Mouse or left and right arrow keys |
| Sprint | Shift |
| Toggle crouch | C or Ctrl |
| Interact, hide, or use the relevant tool | E |
| Select a slot or drop the selected item | 1–4 or G |
| Flashlight | F |
| Escape journal | Tab |
| Pause | Esc or P |

On a touch device, drag the scene to look around and use the on-screen controls. Check the journal for both escape routes. Drawers and cupboards can hold tools, and item locations vary by run. Items and escape progress carry over after capture. Difficulty is chosen at the start of a run.

## Player accounts

Supabase Auth handles email sign-up, confirmation, sign-in, and password resets. Blackmere keeps password tokens in secure HTTP-only cookies on HTTPS. Email links use PKCE and must be opened in the browser where the player requested the link. Sites installations can also offer ChatGPT sign-in.

Create a profile after signing in. Usernames are unique regardless of case. Profiles support a picture, public or restricted visibility, friend request preferences, and account deletion. Players can send, cancel, decline or accept requests, remove friends, and block or unblock players. Blocking removes the relationship and prevents contact and mutual profile access. Notifications refresh while the friends panel is open.

Rankings cover total points, fastest escape, number of escapes, and escape rate. Filter by calendar week, calendar month, all time, or friends. Escape rate requires five completed verified games. Guests and abandoned runs do not contribute to these statistics.

### Scoring

A verified escape earns 1,000 points on Story, 1,600 on Standard, or 2,400 on Nightmare. It also earns 100 points for each life remaining and two points for each full second under ten minutes. A five-night loss earns zero.

The browser sends movement, look and action inputs in sequence. The server assigns the seed, starts its own clock, replays collision and interactions using the shared simulation, and derives the finish, elapsed time, deaths, and score. It rejects malformed inputs, out-of-order batches, impossible elapsed times, and attempts belonging to another account. Repeated delivery of the same batch is safe. Valid scripted inputs are a remaining form of automation.

## Deploy

`npm run build` produces an ES module Worker at `dist/server/index.js` with the game assets bundled into it. The server expects a Cloudflare D1 binding called `DB`. Apply the SQL migrations in `drizzle/` to the target database. The Sites hosting manifest selects the Worker build and D1 binding. Sites assigns the project ID on registration.

Configure these runtime values on the host.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL for email/password authentication |
| `SUPABASE_PUBLISHABLE_KEY` | Project’s publishable key |
| `AUTH_ORIGIN` | Canonical HTTPS game origin for email redirects and same-origin checks |
| `PLATFORM_AUTH` | Set to `1` only on Sites when its trusted identity headers are available |

In Supabase Authentication, set the Site URL to the game URL with a trailing slash. Enable email confirmation and configure a production SMTP sender for delivery to players outside the Supabase organization. Run [the self-service deletion migration](server/supabase-delete.sql) in the dedicated project’s SQL editor. It allows a signed-in user to delete only their own Supabase login. The Worker handles the associated profile and statistics deletion.

Never place a service-role key in the game code. The integration uses the publishable key and the signed-in player's access token.

## Project layout

- `dist/src/game.js`, `world.js`, `caretaker.js`, and `audio.js` render the mansion and character, handle player input, and play spatial sound.
- `dist/src/simulation.js`, `stalker.js`, and `navigation.js` implement the deterministic game rules used by the browser and server.
- `scripts/level.mjs` derives the simulation level from the rendered mansion, keeping collision and interaction positions aligned.
- `server/` contains authentication, profile, social and ranking endpoints.
- `drizzle/` holds the production schema. `scripts/sqlite.mjs` provides a local SQLite adapter for development and tests.

Run `npm run build && npm test` to check both escape routes, enemy behavior, replay validation, account routes, and social permissions. The authentication suite uses a controlled Supabase response fixture. Live email delivery depends on the project's SMTP setup.

See [third-party notices](dist/third-party-notices.txt) for asset attribution.
