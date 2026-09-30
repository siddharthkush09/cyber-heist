# CYBER HEIST — Stage 3C

Cyber Heist is a real-time 3–8 player browser heist using short room codes, server-sent events, temporary identities, simultaneous seven-turn actions, server-authoritative resources, security pressure, events, private objectives, and transparent final scoring.

## Stage 3C scope

Stage 3C preserves the Stage 1/2 room and lobby system and Stage 3A/3B mechanics, then adds:

- shared LOW / ELEVATED / CRITICAL security
- server-selected turn events
- three private objectives per player
- server-tracked objective progress and bonuses
- final asset/objective/security scoring
- deterministic tie-breaking
- synchronized final results
- replay/rematch through the existing room

## Security rules

Security is a server-owned integer from 0 to 2:

- **LOW (0):** baseline
- **ELEVATED (1):** increased network attention
- **CRITICAL (2):** maximum alert; Hack attempts are forced into the traced/failure branch

Per-turn security effects:

- successful or traced **Hack**: +1
- successful **Steal**: +1
- Steal stopped by Firewall Sweep: +1
- **Secure**: -1
- **Decoy**: -1
- values are always clamped to LOW–CRITICAL

A player who takes an action while security is already CRITICAL records the server-side Critical Survivor achievement and receives the Stage 3C security bonus at the end.

## Server events

The server creates an event schedule when the match starts. Clients cannot choose it. Turn 1 is quiet; later turns have a server-selected event or no event. Events are deterministic once selected.

- **Crypto Lockdown:** Hack cannot recover Crypto; a Steal whose server-selected resource is Crypto fails safely.
- **Data Surge:** a successful Hack recovers +1 extra Data.
- **Firewall Sweep:** all Steal attempts fail that turn.
- **Market Shift:** Crypto market value becomes 7 for the turn; a successful Crypto Steal transfers +1 extra Crypto.

## Private objectives

Each player receives three objectives from the server. During the match only the owner sees them. Progress is tracked from server outcomes; clients never submit progress.

Available objective types:

- Ghost Hacker — successfully Hack 3 times
- Data Runner — finish with at least 4 Data
- Crypto Keeper — finish with at least 2 Crypto
- Countermeasure — successfully block 2 Steals with Secure
- Inside Job — successfully execute 1 Steal
- Bait Master — successfully fool 1 Steal with Decoy
- Redline Survivor — take an action while security is CRITICAL and finish the match

Each completed objective is worth **4 points**.

## Final scoring

At the end of Turn 7:

**Asset Score = Credits × 1 + Data × 3 + Crypto × 5**

**Objective Bonus = 4 × completed objectives**

**Security Bonus = 2** when the server records the Critical Survivor achievement, otherwise 0.

**Final Score = Asset Score + Objective Bonus + Security Bonus**

Results are sorted by final score descending. If final scores tie, the deterministic tie-break is:

1. higher Crypto
2. higher Data
3. lower immutable player ID (lexicographic order)

The first player after those tie-breaks is the sole server-designated winner.

## Testing

The Stage 3C suite covers Stage 1/2/3A/3B regression plus security, events, objective privacy/progress, scoring, tie handling, results synchronization, rematch resets, and anti-cheat input attempts.

Run:

```bash
npm test
```

No deployment, audio, or advanced animation is part of Stage 3C.

## Stage 5 production configuration

Cyber Heist remains a dependency-free Node.js application and starts with:

```bash
npm install
npm start
```

Supported environment variables:

- `PORT` — HTTP port; default `3000`
- `HOST` — bind address; default `0.0.0.0`
- `CYBER_HEIST_DECISION_MS` — decision window; default `15000`
- `CYBER_HEIST_RESOLUTION_MS` — resolution display window; default `2500`
- `CYBER_HEIST_DISCONNECT_GRACE_MS` — reconnect grace period; default `15000`
- `CYBER_HEIST_RESULTS_ROOM_TTL_MS` — idle results-room cleanup; default `1800000` (30 minutes)

The production health check is:

```text
GET /api/health
```

The application uses Server-Sent Events for room synchronization. A production reverse proxy must support long-lived HTTP/1.1 SSE connections and must not buffer the `/api/rooms/events` response. The server sends `X-Accel-Buffering: no` for compatible proxies.

HTTPS/TLS should terminate at the production reverse proxy or hosting platform; the Node process can remain on the internal HTTP listener.
