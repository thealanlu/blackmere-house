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

On a touch device, use the virtual joystick to move, drag the scene to look, and use the contextual action button. Landscape is preferred, and portrait stays playable. The game switches the HUD when it detects touch, mouse, keyboard, or standard controller input. In Settings, adjust touch and controller aim, inversion, joystick size, opacity, side and offsets, motion effects, and optional gyroscope and haptic controls.

Check the journal for both escape routes. Drawers and cupboards can hold tools, and item locations vary by run. Items and escape progress carry over after capture. Difficulty is chosen at the start of a run. Use **Save & Exit** to keep one unranked solo checkpoint. The game also keeps local checkpoints during play. Local saves reopen through **Continue Solo Save**. In the hosted edition, sign in and open **Local Saves & Record** to review and upload a checkpoint. When copies differ, choose which to use. Blackmere keeps the other copy on this device. Verified ranked runs stay tied to their original session.

### Play offline

On the title screen, open **Download Offline Content**. Wait for **Ready for offline play** before disconnecting. **Install Game** opens your browser’s install prompt or shows home-screen instructions. On iPhone and iPad, open the installed icon while connected and confirm readiness there. Some browsers keep installed-app storage separate from regular tabs.

Use **Download / Repair** to replace missing or damaged files when connected. Updates download in the background and take effect after all Blackmere tabs close. The offline download contains only public game files. Checkpoints, settings, and personal records live in browser storage.

In the hosted edition, **Sync Personal Record** submits eligible solo escape replays for server verification. Valid results appear in your personal offline record. Global rankings use verified online runs.

The mansion has four levels. Take either east staircase from the ground floor to the library and east bedrooms, then use either stairway into the attic. The basement contains the boiler room and storm drain. In Easy, Normal, and Hard, use **M**, D-pad Left, or the floor button to cycle through visited maps. A red pulse lasts five seconds at each door Granny opens. Teal arrows indicate nearby teammates above or below the displayed level.

**Nightmare** removes the map, map markers, and directional Granny captions in solo, co-op, and PvP. Granny reacts faster, the house is darker, key items can appear upstairs, and the front door and drain require extra parts. Valid hiding spots still protect you.

The flashlight lasts eight minutes in Easy, Normal, and Hard and four and a half minutes in Nightmare. Press **F** or tap **Light** to toggle it. Press **R**, hold **Light**, or use controller right trigger + X to fit a spare. A Survivor can carry two spares. Select one and drop it to share with a teammate.

Use **E** or the contextual action to get into or out of cover. You can look through the wardrobe gap, under the bed, around the drawing-room sofa, or out of the coal recess. Granny can search nearby while you watch. The game keeps you concealed until you have fully exited.

| Controller | Action |
| --- | --- |
| Left stick / right stick | Move / look |
| A / B / X / Y | Interact / crouch / flashlight / journal |
| Right trigger / left trigger | Sprint / drop |
| Left and right bumpers | Select inventory slots |
| Menu / View | Pause / back |
| L3 / R3 | Granny’s snare / door bolt |
| D-pad up | Multiplayer push-to-talk |

## Browser and home screen

Play in a modern WebGL 2 browser. Use **Automatic** graphics for a device-based starting preset, or choose **Low**, **Medium**, **High**, or **Ultra**. Graphics profiles control shadows, texture resolution, model detail, lighting, and particle density. Adaptive resolution lowers the render workload under sustained pressure. A 30 FPS cap is available for battery-powered devices. Frame rate varies by hardware, browser, and temperature.

Choose **Install Blackmere House** in the title menu. On iPhone or iPad, use Safari’s Share menu and **Add to Home Screen**. Fullscreen in Settings and the pause menu uses the browser’s available fullscreen controls. Gyroscope access requires permission in supported browsers, and haptics depend on the device. After the game finishes caching, a previously visited installation can start or continue local Single Player offline. Multiplayer, rankings, friends, and account sync need a connection.

Graphics, frame rate, joystick layout, and device permissions stay local. Signed-in audio, look sensitivity, inversion, brightness, motion effects, and sound captions follow the account.

## Multiplayer

Open **Multiplayer** on the server-hosted game and sign in. **Co-op vs. AI** takes two to four Survivors. **Survivors vs. Granny** takes one human Granny and one to four Survivors. Create a private room to share a code or invite accepted friends, or use **Quick Match** to join the public queue. In a hosted room, pick a preferred role and mark yourself ready. The host can start when everyone is ready or fill empty seats through public matchmaking.

Survivors share both escape routes. Press **E** near a captured teammate to rescue them before the window closes. Granny uses **E** to open a door or swing at a Survivor, **Q** to set a snare, and **X** to bolt an ordinary door. Snares and bolts have cooldowns. An escaped or eliminated Survivor can watch a teammate while the remaining players finish.

The match keeps running while menus are open. A disconnected player has 45 seconds to reconnect. The room remains on the Multiplayer screen after a reload in the same tab. On a different device, sign in with the same account and use **Rejoin Active Match** or the room code. All supported devices use the same rooms and matchmaking. Public PvP matches can earn competitive points. Private, short, forfeited, and repeat-opponent matches within six hours are casual.

Proximity voice is off by default. The host can allow it, then each player can opt in from the match menu. Hold **V** or the touch **Talk** button to transmit to nearby players, including Granny. Voice uses direct WebRTC and can fail on restrictive networks that require a relay. Lobby and team text chat are available separately.

## Player accounts

Choose a gamer tag and password to create your profile and start playing ranked. Gamer tags are unique regardless of case. Supabase Auth manages passwords, and the game keeps session tokens in secure HTTP-only cookies on HTTPS. Store your password safely because the game has no email-based recovery. Sites installations can also offer ChatGPT sign-in.
Profiles support a picture, public or restricted visibility, friend request preferences, and account deletion. Players can send, cancel, decline or accept requests, remove friends, and block or unblock players. Blocking removes the relationship and prevents contact and mutual profile access. Notifications refresh while the friends panel is open.

Rankings cover total points, fastest escape, number of escapes, and escape rate. Filter by calendar week, calendar month, all time, or friends. Escape rate requires five completed verified games. Guests and abandoned runs do not contribute to these statistics.

### Scoring

A verified escape earns 1,000 points on Story, 1,600 on Standard, or 2,400 on Nightmare. It also earns 100 points for each life remaining and two points for each full second under ten minutes. A five-night loss earns zero.

The browser sends movement, look and action inputs in sequence. The server assigns the seed, starts its own clock, replays collision and interactions using the shared simulation, and derives the finish, elapsed time, deaths, and score. It rejects malformed inputs, out-of-order batches, impossible elapsed times, and attempts belonging to another account. Repeated delivery of the same batch is safe. Valid scripted inputs are a remaining form of automation.

## GitHub Pages

The public [GitHub Pages edition](https://thealanlu.github.io/blackmere-house/) runs the full guest game, including both escape routes and touch controls. It links to the hosted edition for multiplayer, accounts, friends, and rankings.

Run `node scripts/pages.mjs` to generate the static site in `.pages/`. The Pages workflow publishes it whenever changes land on `main`.

## Deploy

`npm run build` produces an ES module Worker at `dist/server/index.js` with the game assets bundled into it. The server expects a Cloudflare D1 binding called `DB`. Apply the SQL migrations in `drizzle/` to the target database. The Sites hosting manifest selects the Worker build and D1 binding. Sites assigns the project ID on registration.

Configure these runtime values on the host.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL for gamer-tag accounts |
| `SUPABASE_PUBLISHABLE_KEY` | Project’s publishable key |
| `AUTH_ORIGIN` | Canonical HTTPS game origin for same-origin checks |
| `PLATFORM_AUTH` | Set to `1` only on Sites when its trusted identity headers are available |

In the dedicated Supabase project, enable new user signups and turn off **Confirm email**. The server creates a random internal login identifier for each player. Players only enter their gamer tag and password. Run [the self-service deletion migration](server/supabase-delete.sql) in the dedicated project’s SQL editor. It allows a signed-in user to delete only their own Supabase login. The Worker handles the associated profile and statistics deletion.

Never place a service-role key in the game code. The integration uses the publishable key and the signed-in player's access token.

## Project layout

- `dist/src/game.js`, `world.js`, `caretaker.js`, and `audio.js` render the mansion and character, handle player input, and play spatial sound.
- `dist/src/simulation.js`, `stalker.js`, and `navigation.js` implement the deterministic game rules used by the browser and server.
- `dist/src/match.js` and `server/multiplayer.js` run authoritative multiplayer matches. Players send inputs and receive snapshots over HTTPS. The server commits each room update against its last stored revision.
- `scripts/level.mjs` derives the simulation level from the rendered mansion, keeping collision and interaction positions aligned.
- `scripts/validate-level.mjs` checks the room graph and collision geometry for usable approaches, alternate routes, and hiding exits.
- `server/` contains authentication, profile, social and ranking endpoints.
- `drizzle/` holds the production schema. `scripts/sqlite.mjs` provides a local SQLite adapter for development and tests.

Run `npm run build && npm test` to check both escape routes, enemy behavior, replay validation, account routes, social permissions, and multiplayer rules. The authentication suite uses a controlled Supabase response fixture.

See [third-party notices](dist/third-party-notices.txt) for asset attribution.
