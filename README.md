# aicrm — Agentic Real Estate CRM

A multi-tenant, agentic CRM built for real estate professionals. Contacts, properties, leads, and tasks with a natural-language interface: instead of building node-graph automations, users type plain-English commands and the built-in HyperNexus orchestration layer (Model Context Protocol) translates intent into database operations and workflows. Built as part of the RealEstateCRM project family for Excel Legacy Realty Group.

## Status

**Active development.** Version 0.13.1 (per `VERSION.md`, `package.json`, and `CHANGELOG.md`). Last commit 2026-11-12 (org transfer to RealEstateCRMLLC, merge-conflict cleanup, dev port moved from 3001 to 3007 to avoid colliding with leadG). Before that, the most recent feature work was Oct 5–6, 2026 (contacts list page, webhook guards, pagination and Prisma fixes).

## What it does

### Orchestration (HyperNexus)

- **Natural-language commands** — in the HyperNexus tab, type plain English: `summarize my brokerage`, `create a task to call John about the offer`, `update lead [name] to hot`, `list contacts`, `list properties`, `list tasks`
- **Workflows (if/then automation)** — e.g. when a lead replies "yes", mark them Hot and notify the broker. Triggers: communication received, lead created/updated, contact created, task completed. Actions: update stage, create task, log activity, send communication, notify.
- **MCP server** — the CRM exposes tools over the Model Context Protocol (`POST /api/mcp`), so any MCP client (Claude Desktop, Cursor, custom agents) can use it: `list_contacts`, `get_contact`, `create_contact`, `update_lead_stage`, `list_properties`, `create_task`, `list_tasks`, `summarize_brokerage`, `search_contacts`, `log_activity`

### Multi-model router & API vault

- Users plug in their own API keys (OpenAI, Google Gemini, Anthropic, DeepSeek, Qwen) or connect local tools (Hermes Agent, OpenClaw). Keys are kept server-side and excluded from version control.
- Tiered routing assigns fast, low-cost models to basic tasks and escalates complex reasoning to frontier models.

### Core CRM

- **Contacts** — lead profiles, CSV import/export, dynamic "Smart Filter" segments; contacts list page with search, quick-create, and detail navigation
- **Properties & tasks** — property records, task management, lead pipeline stages
- **Enrichment** — background web-scrubbing agent for missing contact details
- **Compliance** — database schemas mapped to local MLS standards, with Agent, Team, and Brokerage hierarchy profiles
- **Funnel & page builder** — custom landing pages and Single Property Sites with analytics

### Social studio & marketing

- Omnichannel drip campaigns (SMS via Twilio, email via Resend), custom text codes for property signs
- Agentic content creator: connect Facebook, Instagram, LinkedIn, YouTube, and Google Business via OAuth; the AI researches a topic, writes copy, attaches media, and schedules posts

### Voice (leadG)

The database schema includes call logging, disposition tracking, and transcription storage, and the backend has WebSocket endpoints for bi-directional audio — designed for the leadG voice dialing agent. leadG now exists as a separate repo in this org ([RealEstateCRMLLC/leadG](https://github.com/RealEstateCRMLLC/leadG)); integration between the two is the open piece, not a future project.

## Stack

Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4; Prisma 7 (libSQL + PostgreSQL adapters); Inngest; Twilio; Resend; jose; Zod; Vitest tests. Runs on port 3007 in dev.

## What's working / what's not

- The CRM core (contacts, properties, tasks, leads), the HyperNexus command/workflow/MCP layer, the theme system (light/dark + 6 accent palettes), and the social studio are implemented, per the changelog (v0.13.0–0.13.1) and the Oct 2026 commits.
- No production deployment is documented in this repo — `DEPLOY.md` exists, but there is no live URL, uptime, or user evidence in the repo itself. The app is built by the main RealEstateCRM repo's CI (aicrm job), which was green as of Nov 12, 2026 (RealEstateCRM v0.63.5/6).
- Housekeeping: `dev.db` (a ~430 KB SQLite database) is deliberately tracked in the repo (per the v0.13.1 changelog) — unusual, and worth revisiting if it ever holds real data. The old README published a demo-login password; it has been removed from this revision.
- Live-service behavior (real AI calls, real SMS/email, real social posting) depends on API keys configured via `.env` — no evidence in the repo that the full chain has run end-to-end against live services.

## Relationship to RealEstateCRM

This is a satellite service of [RealEstateCRM](https://github.com/RealEstateCRMLLC/RealEstateCRM) — the agentic CRM (natural-language workflows + MCP) that complements the main CRM. It is a separate service, not part of the main CRM codebase. The HyperNexus orchestration here is this CRM's built-in MCP engine, not the standalone [TormentNexus/HyperNexus](https://github.com/MDMAtk/TormentNexus) platform — see `HYPERNEXUS.md` and `INTEGRATION.md` for how they relate.

## Running it

```bash
npm install
npm run dev        # starts on port 3007
```

Copy `.env.example` to `.env` and fill in API keys and database URL. A demo login exists for local development (see `.env.example` / `prisma/seed.ts` for the seeded account). See `HYPERNEXUS.md` for commands, workflows, and MCP/Claude Desktop setup; `INTEGRATION.md` for the control-plane wiring.

## Documentation

| File | Purpose |
|---|---|
| `HYPERNEXUS.md` | HyperNexus commands, workflows, MCP setup |
| `INTEGRATION.md` | Control-plane integration |
| `STRUCTURE.md` | Codebase structure |
| `VISION.md` | Product vision |
| `ROADMAP.md` | Development phases |
| `CHANGELOG.md` | Version history |
| `DEPLOY.md` | Deployment |
| `RETS_REQUEST_TEMPLATE.md` | RETS (MLS data) request template |

## Links

- Main CRM: https://github.com/RealEstateCRMLLC/RealEstateCRM
- Org: https://github.com/RealEstateCRMLLC
