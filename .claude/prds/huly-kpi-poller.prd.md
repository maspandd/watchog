# Huly Monitoring Poller (Telegram POC → Monitoring App Feed)

## Problem
An Engineering Manager oversees ~50 people across two stacks (High-Code and
Low-Code OutSystems), all tracked as cards in self-hosted Huly. Today the EM
checks each person's board **manually, one-by-one, every morning** — and since
one person works across multiple projects, getting a true per-person workload
picture means mentally aggregating across boards. This is slow and tedious,
and doesn't feed the EM's existing monitoring app, which has no Huly
integration. The goal is **monitoring / visibility** — a glanceable picture of
who has how many cards and how many are closed — not formal KPI measurement
(that's handled manually and deferred).

## Evidence
- ~50 people are eyeballed individually each morning (stated by EM).
- One person handles multiple projects, so manual aggregation per person is
  required and error-prone (stated by EM).
- EM already operates a monitoring app but it has **no** Huly data source today
  (stated by EM).
- KPI use is explicitly *not* the driver — the EM just wants automated
  visibility and may consider KPIs manually/later (stated by EM).

## Users
- **Primary**: The Engineering Manager (single user, self-serve). Trigger: the
  daily/recurring need to see per-person card load and completion at a glance
  without opening Huly board-by-board. Oversees both High-Code and OutSystems
  delivery.
- **Not for**: Individual contributors, other team leads, or management
  consumers — no multi-user access, roles, or sharing in this scope.

## Hypothesis
We believe a **scheduled poller that reads Huly and pushes a per-person
total/done/open summary to Telegram** will **eliminate the manual one-by-one
board check** for **the Engineering Manager**.
We'll know we're right when **the EM stops manually checking Huly boards and
instead relies on the automated summary, and the numbers look right against an
occasional spot-check**.

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| Manual morning board checks | Stops (0 one-by-one checks) | EM self-report |
| People covered per run | All ~50 (assigned) | Count of employees in the summary |
| Counts look right | Roughly matches Huly on occasional spot-check | Quick manual glance vs. Huly for a few people |
| Delivery reliability | Scheduled run lands without manual intervention | Observed over consecutive scheduled runs |

## Scope
**MVP** — A single serverless scheduled job that connects to Huly, counts cards
**per person aggregated across all their projects** (total / done / open), and
sends one readable summary message to a Telegram bot covering all ~50 assigned
people. Counts should look right against a quick manual Huly glance.

**Out of scope**
- KPI measurement, scoring, or dashboards — handled manually / deferred; this
  is monitoring/visibility only.
- Monitoring-app API integration (the JSON POST) — deferred to a later
  milestone, after the Telegram POC proves Huly extraction works.
- OutSystems-specific integration — not needed; OutSystems work is already
  tracked as Huly cards, so Huly is the single source for now.
- Historical/trend storage and computation over time — deferred.
- Any write-back to Huly — read-only.
- Multi-user access, roles, auth, or sharing — single-user only.

## Delivery Milestones
<!-- Business outcomes, not engineering tasks. /plan turns each into a plan. -->
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | Telegram POC | EM receives a per-person (across projects) total/done/open summary on a schedule, replacing the manual board check | in-progress | `.claude/plans/huly-kpi-poller.plan.md` |
| 2 | Monitoring-app feed | The same summary is delivered to the EM's monitoring app via its API | pending | — |

## Open Questions
- [ ] **Service account vs. personal login** — should the poller authenticate as
      a dedicated Huly bot/service account rather than the EM's personal
      credentials in CI? (Security + "acts as you" concern.)
- [ ] **Done vs. Cancelled** — should Cancelled cards count toward "done",
      be excluded, or be ignored? Lower stakes for monitoring, but pick a
      sensible default so the "done" number isn't misleading.
- [ ] **Unassigned cards** — currently skipped; should they appear as a separate
      "Unassigned" line so work-in-flight isn't invisible?
- [ ] **"Per person across projects" definition** — confirm a person's cards are
      aggregated across all projects and each card counted once.
- [ ] **Cadence** — is the morning check daily? (Plan defaults to hourly cron —
      likely more frequent than needed for monitoring.)

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| "Done" status mapping doesn't match real Huly workflow categories, making the "done" count misleading | Medium | Medium | Pick a sensible default mapping; glance-check against Huly during POC |
| Personal credentials stored in CI secrets ("poller acts as you") | Medium | Medium | Resolve service-account open question; restrict secret scope |
| Huly API/SDK changes or auth instability on self-hosted instance | Medium | Medium | Keep poller read-only; fail loudly; spot-check after runs |
| Per-person aggregation across projects double-counts or misses cards | Medium | Medium | Define counting rule explicitly; glance-check a few people against Huly |
| Summary message becomes unreadable with ~50 people | Medium | Low | Sort/group sensibly; keep format compact (e.g. only non-zero rows) |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
