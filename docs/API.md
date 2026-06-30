# watchog API Reference

watchog publishes read-only snapshots of a self-hosted [Huly](https://huly.io)
workspace and serves them over a small bearer-authenticated HTTP API. A cron
(GitHub Actions) talks to Huly, writes JSON documents to a KV store, and the
serverless endpoints read those documents — so the API is **always cheap and
fast, and as fresh as the last cron run**. The endpoints never call Huly.

The data is exposed as several orthogonal views, all derived from the same
snapshots so they reconcile with each other:

- **[Summary API](#summary-api)** — per-person card counts (`/summary`) and the
  overall totals (`/overview`).
- **[Persons API](#persons-api)** — the person directory and per-person summary
  (`/persons`).
- **[Projects API](#projects-api)** — the project catalog, membership, and
  per-project summary (`/projects`).

All example payloads below are captured from a live workspace; personal names
and emails have been replaced with fictional values, but the structure, field
names, and counts are real.

> **Interactive docs (Swagger UI):** an OpenAPI 3.0 spec lives at
> [`public/openapi.json`](../public/openapi.json) and renders as Swagger UI at
> **`/docs`** on the deploy (locally: `http://localhost:3000/docs` after
> `node local-server.mjs`). Use the **Authorize** button to paste your bearer
> token and try requests in the browser. This Markdown page is the prose
> companion to that spec.

---

## Conventions

### Base URL

```
https://<your-deploy>            e.g. https://watchog.vercel.app
```

Locally, `node local-server.mjs` serves the same routes on
`http://localhost:3000`.

### Authentication

Every request requires a bearer token in the `Authorization` header. The token
is the `API_TOKEN` configured on the API host.

```http
Authorization: Bearer <API_TOKEN>
```

```bash
curl -H "Authorization: Bearer $API_TOKEN" https://<your-deploy>/summary
```

A missing or wrong token returns `401`. The comparison is constant-time.

### Methods

All endpoints are **`GET` only**. Any other method returns `405`.

### Freshness: `generatedAt` and `stale`

Every successful response carries:

| Field | Type | Meaning |
|---|---|---|
| `generatedAt` | ISO-8601 string \| `null` | When the cron produced the document |
| `stale` | boolean | `true` once `generatedAt` is older than **90 minutes** |

`stale: true` does not change the data — it is a hint that the cron may not have
run recently. Consumers decide whether to trust or warn on stale data.

### Status codes

| Code | When |
|---|---|
| `200` | Success |
| `401` | Missing or invalid bearer token |
| `404` | Unknown id, or an unrecognized path |
| `405` | Method other than `GET` |
| `503` | The cron has not written this document yet (store empty) |

### Error shape

Non-2xx responses return a JSON object with a single `error` string:

```json
{ "error": "Project not found" }
```

### Person identity (shared across both APIs)

People are identified by their stable Huly person id (`Person._id`) in the `id`
field — the **same id** in `/summary` and in project membership — so a consumer
can join a person's card counts to the projects they belong to on one key.

Each person also carries up to three email fields, surfaced separately because
they come from independent Huly sources:

| Field | Source | Notes |
|---|---|---|
| `loginEmail` | `contact:class:SocialIdentity` (login/account identity) | Present for most members |
| `contactEmail` | `contact:class:Channel` (an added contact channel) | Often empty |
| `email` | convenience = `loginEmail ?? contactEmail` | Best available; may equal both |

Any of these may be `null`. They are frequently identical.

---

## Summary API

Per-person card counts, aggregated across all projects. See the project README
for the counting rules (cancelled excluded, unassigned skipped, unknown status
treated as open).

### `GET /summary`

The full roster.

**Response `200`**

```json
{
  "generatedAt": "2026-06-30T03:58:39.753Z",
  "source": "watchog",
  "people": [
    {
      "id": "69968d22a4fa712519af41e3",
      "name": "Jane Doe",
      "email": "jane.doe@example.com",
      "loginEmail": "jane.doe@example.com",
      "contactEmail": "jane.doe@example.com",
      "open": 309,
      "done": 130,
      "total": 439,
      "projects": [
        { "id": "69967ace2a6825a419f8fcd3", "name": "PPU Internships", "total": 402, "done": 106, "open": 296 },
        { "id": "6a06a6b5e8da794d686b9202", "name": "BDS - SPK",       "total": 37,  "done": 24,  "open": 13 }
      ]
    }
  ],
  "totals": { "people": 44, "total": 4146, "done": 3185, "open": 961 },
  "unassigned": 623,
  "cancelled": 76,
  "stale": false
}
```

**Top-level fields**

| Field | Type | Meaning |
|---|---|---|
| `source` | string | Always `"watchog"` |
| `people` | array | One row per assignee — **all** people, not just those with open cards |
| `totals` | object | `{ people, total, done, open }` summed over `people` |
| `unassigned` | number | Cards with no assignee (skipped — counted here only) |
| `cancelled` | number | Cancelled cards (excluded entirely — counted here only) |

**Person row**

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable Huly person `_id` |
| `name` | string | Display name (normalized to `"First Last"`) |
| `email` / `loginEmail` / `contactEmail` | string \| null | See [Person identity](#person-identity-shared-across-both-apis) |
| `open` / `done` / `total` | number | Card counts across all projects |
| `projects` | array | Per-project breakdown: `{ id, name, total, done, open }`; empty for cards with no project |

People are sorted by most open cards first, then by name.

### `GET /summary/{id}`

One person by their Huly person id. Returns the same person object as a row in
`/summary`, plus `generatedAt` and `stale`.

**Response `200`**

```json
{
  "id": "69968d22a4fa712519af41e3",
  "name": "Jane Doe",
  "email": "jane.doe@example.com",
  "loginEmail": "jane.doe@example.com",
  "contactEmail": "jane.doe@example.com",
  "open": 309,
  "done": 130,
  "total": 439,
  "projects": [
    { "id": "69967ace2a6825a419f8fcd3", "name": "PPU Internships", "total": 402, "done": 106, "open": 296 }
  ],
  "generatedAt": "2026-06-30T03:58:39.753Z",
  "stale": false
}
```

**Response `404`** — unknown id:

```json
{ "error": "Person not found" }
```

### `GET /overview`

The overall totals only — a lean view for a header/badge that doesn't need the
full roster. Derived from the same snapshot as `/summary`.

**Response `200`**

```json
{
  "generatedAt": "2026-06-30T03:58:39.753Z",
  "source": "watchog",
  "stale": false,
  "totals": { "people": 44, "total": 4146, "done": 3185, "open": 961 },
  "unassigned": 623,
  "cancelled": 76
}
```

| Field | Type | Meaning |
|---|---|---|
| `totals` | object | `{ people, total, done, open }` across the roster |
| `unassigned` | number | Cards with no assignee |
| `cancelled` | number | Cancelled cards (excluded from totals) |

---

## Persons API

Person identity and per-person card summary, derived from the `/summary`
snapshot. The directory contains **people who have cards** (assignees) — the same
people that appear in `/summary`.

### `GET /persons`

The person directory: identity only (no card counts), sorted by name.

**Response `200`**

```json
{
  "generatedAt": "2026-06-30T03:58:39.753Z",
  "source": "watchog",
  "stale": false,
  "persons": [
    {
      "id": "69968d22a4fa712519af41e3",
      "name": "Jane Doe",
      "email": "jane.doe@example.com",
      "loginEmail": "jane.doe@example.com",
      "contactEmail": "jane.doe@example.com"
    }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `persons` | array | Each entry: `{ id, name, email, loginEmail, contactEmail }` — no card counts |

### `GET /persons/{id}`

One person's identity (no counts). `404` if the id is unknown.

```json
{
  "id": "69968d22a4fa712519af41e3",
  "name": "Jane Doe",
  "email": "jane.doe@example.com",
  "loginEmail": "jane.doe@example.com",
  "contactEmail": "jane.doe@example.com",
  "generatedAt": "2026-06-30T03:58:39.753Z",
  "stale": false
}
```

### `GET /persons/{id}/summary`

That person's card summary — `open/done/total` plus the per-project breakdown.
This returns the **same object as [`GET /summary/{id}`](#get-summaryid)** (it is an
alias under the persons resource); `404` if the id is unknown.

---

## Projects API

The Huly project catalog with members and owners resolved to people. Project
`members[]`/`owners[]` are stored in Huly as account UUIDs; watchog resolves them
to the same person `id` + name + email fields the Summary API uses.

> **Coverage caveat.** Private projects are only visible to the poller's own
> Huly login. Many projects are private, so the catalog reflects the poller
> account's membership, not necessarily every project in the workspace.

> **`owners` is the lead.** Huly has no separate `lead` field; the project
> owner(s) are in `owners[]`.

### `GET /projects`

The project catalog. List items are **light**: no `members[]`, no `description`,
and `owners` reduced to `{ id, name }` — keeping the list small and free of
member PII. Use `/projects/{id}` for full detail.

**Response `200`**

```json
{
  "generatedAt": "2026-06-30T03:58:39.753Z",
  "source": "watchog",
  "stale": false,
  "projects": [
    {
      "id": "6912bbb19a6df5a9db9ff353",
      "name": "[Tech Academy] Learning Management System",
      "identifier": "TECH",
      "archived": false,
      "private": false,
      "memberCount": 12,
      "owners": [
        { "id": "689d8510a4fa712519af406e", "name": "Sam Lee" }
      ]
    },
    {
      "id": "695f423ae1ea3a4a61a87bac",
      "name": "Apps Catalog",
      "identifier": "CATA",
      "archived": false,
      "private": false,
      "memberCount": 8,
      "owners": [
        { "id": "685a6c6ea4fa712519af3edc", "name": "Alex Park" }
      ]
    }
  ]
}
```

**List item fields**

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Huly project (space) `_id` |
| `name` | string | Project name |
| `identifier` | string \| null | Short project key (e.g. `TECH`) |
| `archived` | boolean | Whether the project is archived |
| `private` | boolean | Whether the project is private |
| `memberCount` | number | Number of members |
| `owners` | array | `{ id, name }` per owner (the lead) |

Projects are sorted by name.

### `GET /projects/{id}`

One project, in full: the `description`, and `members[]` / `owners[]` resolved to
people with their email fields.

**Response `200`**

```json
{
  "id": "6912bbb19a6df5a9db9ff353",
  "name": "[Tech Academy] Learning Management System",
  "identifier": "TECH",
  "description": "Project LMS for Tech Academy",
  "private": false,
  "archived": false,
  "memberCount": 12,
  "owners": [
    {
      "id": "689d8510a4fa712519af406e",
      "name": "Sam Lee",
      "email": "sam.lee@example.com",
      "loginEmail": "sam.lee@example.com",
      "contactEmail": "sam.lee@example.com"
    }
  ],
  "members": [
    {
      "id": "68d0ef64a4fa712519af4100",
      "name": "Adi Prakasa",
      "email": "adi.prakasa@example.com",
      "loginEmail": "adi.prakasa@example.com",
      "contactEmail": "adi.prakasa@example.com"
    }
  ],
  "generatedAt": "2026-06-30T03:58:39.753Z",
  "stale": false
}
```

| Field | Type | Meaning |
|---|---|---|
| `description` | string | Full project description (may be `""`) |
| `members` | array | Each member resolved to a person (id, name, emails) |
| `owners` | array | Each owner resolved to a person (id, name, emails) |

Members and owners are sorted by name.

**Response `404`** — unknown id:

```json
{ "error": "Project not found" }
```

### `GET /projects/{id}/team`

Just the project's members, resolved to people — a focused view for "who is on
this project".

**Response `200`**

```json
{
  "projectId": "6912bbb19a6df5a9db9ff353",
  "name": "[Tech Academy] Learning Management System",
  "stale": false,
  "generatedAt": "2026-06-30T03:58:39.753Z",
  "members": [
    {
      "id": "68d0ef64a4fa712519af4100",
      "name": "Adi Prakasa",
      "email": "adi.prakasa@example.com",
      "loginEmail": "adi.prakasa@example.com",
      "contactEmail": "adi.prakasa@example.com"
    },
    {
      "id": "691a95d9a4fa712519af4176",
      "name": "Nia Fakhira",
      "email": "nia.fakhira@example.com",
      "loginEmail": "nia.fakhira@example.com",
      "contactEmail": "nia.fakhira@example.com"
    }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `projectId` | string | Huly project `_id` |
| `name` | string | Project name |
| `members` | array | Each member resolved to a person (id, name, emails) |

**Response `404`** — unknown id:

```json
{ "error": "Project not found" }
```

### `GET /projects/{id}/summary`

Per-project card counts: the project's totals plus a per-person breakdown,
derived from the `/summary` roster (so the numbers reconcile with `/summary`).

**Response `200`**

```json
{
  "projectId": "69967ace2a6825a419f8fcd3",
  "name": "PPU Internships",
  "identifier": "PPU",
  "stale": false,
  "generatedAt": "2026-06-30T03:58:39.753Z",
  "totals": { "people": 7, "total": 402, "done": 106, "open": 296 },
  "people": [
    { "id": "69968d22a4fa712519af41e3", "name": "Jane Doe", "open": 296, "done": 106, "total": 402 }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `projectId` | string | Huly project `_id` |
| `name` / `identifier` | string \| null | Project name and short key |
| `totals` | object | `{ people, total, done, open }` across assignees on this project |
| `people` | array | Per-person counts on this project: `{ id, name, open, done, total }`, sorted by open desc |

> **Derived from the roster.** These counts sum each person's per-project
> breakdown, so they **exclude unassigned cards** and cards with no project. A
> project that exists in the catalog but has no assigned cards returns `200` with
> zeroed totals (not `404`). `404` is returned only when the id is in neither the
> catalog nor any person's breakdown.

**Response `404`** — unknown id:

```json
{ "error": "Project not found" }
```

---

## Endpoint summary

| Method | Path | Returns | Errors |
|---|---|---|---|
| `GET` | `/summary` | Full per-person roster | 401, 405, 503 |
| `GET` | `/summary/{id}` | One person (counts + projects) | 401, 404, 405, 503 |
| `GET` | `/overview` | Overall totals only | 401, 405, 503 |
| `GET` | `/persons` | Person directory (identity only) | 401, 405, 503 |
| `GET` | `/persons/{id}` | One person's identity | 401, 404, 405, 503 |
| `GET` | `/persons/{id}/summary` | One person (alias of `/summary/{id}`) | 401, 404, 405, 503 |
| `GET` | `/projects` | Light project catalog | 401, 405, 503 |
| `GET` | `/projects/{id}` | One project, full detail | 401, 404, 405, 503 |
| `GET` | `/projects/{id}/team` | One project's members | 401, 404, 405, 503 |
| `GET` | `/projects/{id}/summary` | Per-project card counts | 401, 404, 405, 503 |

## Testing locally

```bash
node local-server.mjs    # serves all routes on http://localhost:3000

curl -H "Authorization: Bearer $API_TOKEN" http://localhost:3000/summary
curl -H "Authorization: Bearer $API_TOKEN" http://localhost:3000/overview
curl -H "Authorization: Bearer $API_TOKEN" http://localhost:3000/persons
curl -H "Authorization: Bearer $API_TOKEN" http://localhost:3000/persons/<id>/summary
curl -H "Authorization: Bearer $API_TOKEN" http://localhost:3000/projects/<id>/summary
```

The local server reads the same KV store the deployed API does, so it returns
whatever the last `npm run once` wrote.
