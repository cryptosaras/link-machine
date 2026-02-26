# LINK MACHINE — Complete System Blueprint

## Context

LINK MACHINE is a link building automation platform designed for a solo operator managing 20-100+ websites at scale (100-10,000+ links/day). The system runs 24/7 on VPS infrastructure with a control server + scalable worker nodes architecture. It automates the entire link building pipeline: sitemap parsing → page selection → AI content generation → link creation across multiple platforms → tracking and monitoring.

**Problem it solves:** Manual link building is time-consuming and doesn't scale. This system automates the entire workflow with AI-generated content, modular platform plugins, tiered link strategies (T1, T2, etc.), and distributed workers that can scale horizontally.

**Tech Stack:** Python (FastAPI) backend + React (Vite + TailwindCSS) frontend + PostgreSQL + Redis + Celery Beat + Playwright

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Project Structure](#2-project-structure)
3. [Database Schema](#3-database-schema)
4. [Backend — FastAPI Application](#4-backend--fastapi-application)
5. [Plugin System](#5-plugin-system)
6. [Worker Agent](#6-worker-agent)
7. [Frontend — React Application](#7-frontend--react-application)
8. [AI Content Pipeline](#8-ai-content-pipeline)
9. [Deployment & Docker](#9-deployment--docker)
10. [Implementation Phases](#10-implementation-phases)
11. [Verification & Testing](#11-verification--testing)

---

## 1. System Architecture

### 1.1 Overview

```
CONTROL SERVER (VPS)
├── Nginx (reverse proxy, SSL termination)
├── React Frontend (static files served by Nginx)
├── FastAPI Backend (Python, async)
│   ├── REST API (all CRUD + business logic)
│   ├── WebSocket Server (real-time events to UI)
│   ├── Worker Agent API (endpoints workers call)
│   └── Service Layer (core business logic)
├── PostgreSQL (primary database, all state)
├── Redis (queue signaling, rate limit buckets, model cache)
└── Celery Beat (scheduler: sitemap watcher, health checks, rate refills)

        ↕ HTTPS (workers poll this API)

WORKER NODE 1..N (separate VPS machines)
└── Worker Agent (Python, standalone)
    ├── Poller (heartbeat + task polling loop)
    ├── Executor (dispatches tasks to plugins)
    ├── Plugin Runner (Telegraph, WordPress, etc.)
    ├── Playwright Browser (for browser-based plugins)
    └── Reporter (sends results/failures back to control server)
```

### 1.2 Communication Flow

1. **Worker → Control Server** (HTTPS polling):
   - Heartbeat every 30 seconds (status, active tasks, system stats)
   - Poll for pending tasks when capacity available
   - Report task start/completion/failure
2. **Control Server → UI** (WebSocket):
   - Real-time task status updates
   - Worker online/offline events
   - Campaign progress events
3. **Control Server → External APIs**:
   - OpenRouter (AI content generation)
   - Platform APIs (Telegraph, etc.)
   - Target websites (content fetching for AI)

### 1.3 Security Model

- **Authentication:** JWT tokens for UI, API keys for workers
- **Credentials:** AES-256-GCM encrypted at rest in PostgreSQL, decrypted on control server only, sent per-task to workers over HTTPS
- **Workers:** Semi-trusted compute nodes. Never store credentials. If compromised, only current task data is exposed
- **HTTPS:** All communication encrypted in transit
- **Single user:** No multi-tenancy complexity

---

## 2. Project Structure

```
link-machine/
│
├── docker-compose.yml                    # Control server stack
├── docker-compose.worker.yml             # Worker node stack
├── .env.example                          # Environment variables template
├── Makefile                              # Common commands
│
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml                    # Dependencies (uv or Poetry)
│   ├── alembic.ini                       # Database migration config
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/                     # Migration files (auto-generated)
│   │
│   └── app/
│       ├── __init__.py
│       ├── main.py                       # FastAPI app factory
│       ├── config.py                     # Settings (pydantic-settings)
│       ├── database.py                   # SQLAlchemy async engine + sessions
│       ├── dependencies.py               # Shared dependencies (get_db, get_current_user)
│       │
│       ├── auth/
│       │   ├── __init__.py
│       │   ├── router.py                 # POST /login, POST /refresh, GET /me
│       │   ├── service.py                # JWT creation, password hashing (bcrypt)
│       │   └── schemas.py                # LoginRequest, TokenResponse, UserResponse
│       │
│       ├── models/                       # SQLAlchemy ORM models
│       │   ├── __init__.py               # Import all models for Alembic
│       │   ├── user.py                   # User model
│       │   ├── website.py                # Website model
│       │   ├── page.py                   # Page model
│       │   ├── strategy.py               # Strategy + StrategyPlatform models
│       │   ├── platform.py               # Platform model
│       │   ├── campaign.py               # Campaign + CampaignPage models
│       │   ├── link.py                   # Link model (the core entity)
│       │   ├── task.py                   # Task model (work queue)
│       │   ├── worker.py                 # Worker model
│       │   ├── credential.py             # Credential model (encrypted)
│       │   ├── ai_config.py              # AI configuration + model cache
│       │   ├── sitemap_watcher.py        # Sitemap watcher model
│       │   └── activity_log.py           # Activity audit log
│       │
│       ├── schemas/                      # Pydantic request/response schemas
│       │   ├── __init__.py
│       │   ├── website.py
│       │   ├── page.py
│       │   ├── strategy.py
│       │   ├── platform.py
│       │   ├── campaign.py
│       │   ├── link.py
│       │   ├── task.py
│       │   ├── worker.py
│       │   ├── credential.py
│       │   ├── ai.py
│       │   └── dashboard.py
│       │
│       ├── routers/                      # FastAPI route handlers
│       │   ├── __init__.py
│       │   ├── websites.py
│       │   ├── pages.py
│       │   ├── strategies.py
│       │   ├── platforms.py
│       │   ├── campaigns.py
│       │   ├── links.py
│       │   ├── tasks.py
│       │   ├── workers.py
│       │   ├── worker_agent.py           # API for workers (poll, heartbeat, report)
│       │   ├── credentials.py
│       │   ├── ai_settings.py
│       │   ├── sitemap_watchers.py
│       │   ├── dashboard.py
│       │   └── websocket.py              # WebSocket event stream
│       │
│       ├── services/                     # Business logic layer
│       │   ├── __init__.py
│       │   ├── sitemap_parser.py         # Fetch + parse XML sitemaps
│       │   ├── campaign_engine.py        # Expand strategies → links → tasks
│       │   ├── link_builder.py           # Orchestrate link building pipeline
│       │   ├── task_scheduler.py         # Queue management, rate limiting
│       │   ├── ai_service.py             # OpenRouter client
│       │   ├── content_fetcher.py        # Fetch + cache page content
│       │   ├── credential_vault.py       # Encrypt/decrypt credentials
│       │   ├── worker_provisioner.py     # SSH-based worker setup
│       │   └── event_bus.py              # Pub/sub for WebSocket events
│       │
│       ├── plugins/                      # Platform plugin system
│       │   ├── __init__.py
│       │   ├── base.py                   # PlatformPlugin ABC + LinkResult
│       │   ├── registry.py               # Plugin registry
│       │   └── telegraph.py              # Telegraph plugin (V1)
│       │
│       ├── celery_app/                   # Scheduled tasks (control server)
│       │   ├── __init__.py
│       │   ├── celery.py                 # Celery app configuration
│       │   ├── tasks.py                  # Periodic task implementations
│       │   └── beat_schedule.py          # Schedule definitions
│       │
│       └── utils/
│           ├── __init__.py
│           ├── encryption.py             # AES-256-GCM encrypt/decrypt
│           ├── pagination.py             # Cursor/offset pagination
│           └── validators.py             # URL validation, etc.
│
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   │
│   └── src/
│       ├── main.tsx                      # App entry point
│       ├── App.tsx                       # Root component + router setup
│       │
│       ├── api/                          # API client layer
│       │   ├── client.ts                 # Axios instance with JWT interceptor
│       │   ├── websites.ts
│       │   ├── pages.ts
│       │   ├── strategies.ts
│       │   ├── platforms.ts
│       │   ├── campaigns.ts
│       │   ├── links.ts
│       │   ├── tasks.ts
│       │   ├── workers.ts
│       │   ├── credentials.ts
│       │   ├── ai.ts
│       │   ├── dashboard.ts
│       │   └── websocket.ts              # WebSocket connection manager
│       │
│       ├── hooks/
│       │   ├── useAuth.ts
│       │   ├── useWebSocket.ts
│       │   ├── usePagination.ts
│       │   └── usePolling.ts             # Fallback if WS disconnects
│       │
│       ├── stores/                       # Zustand state management
│       │   ├── authStore.ts
│       │   ├── websiteStore.ts
│       │   └── notificationStore.ts
│       │
│       ├── components/
│       │   ├── layout/
│       │   │   ├── Sidebar.tsx
│       │   │   ├── Header.tsx
│       │   │   └── MainLayout.tsx
│       │   ├── ui/                       # Button, Card, Table, Modal, Badge, Input, Select, etc.
│       │   ├── forms/                    # DynamicForm, ModelPicker, PromptEditor
│       │   ├── data/                     # DataTable, TreeView, StatusBadge
│       │   └── charts/                   # SparklineChart, ProgressBar
│       │
│       ├── pages/
│       │   ├── Dashboard.tsx
│       │   ├── Login.tsx
│       │   ├── websites/
│       │   │   ├── WebsiteList.tsx
│       │   │   └── WebsiteDetail.tsx
│       │   ├── campaigns/
│       │   │   ├── CampaignList.tsx
│       │   │   ├── CampaignDetail.tsx
│       │   │   └── CampaignTree.tsx
│       │   ├── strategies/
│       │   │   ├── StrategyList.tsx
│       │   │   └── StrategyBuilder.tsx
│       │   ├── platforms/
│       │   │   ├── PlatformList.tsx
│       │   │   └── PlatformConfig.tsx
│       │   ├── workers/
│       │   │   ├── WorkerList.tsx
│       │   │   └── WorkerDetail.tsx
│       │   ├── queue/
│       │   │   └── JobQueue.tsx
│       │   └── settings/
│       │       ├── AISettings.tsx
│       │       ├── CredentialsVault.tsx
│       │       ├── SitemapWatchers.tsx
│       │       └── GeneralSettings.tsx
│       │
│       └── lib/
│           ├── formatters.ts
│           ├── constants.ts
│           └── types.ts
│
├── worker/                               # Standalone worker agent
│   ├── Dockerfile
│   ├── pyproject.toml
│   │
│   └── agent/
│       ├── __init__.py
│       ├── main.py                       # Entry point
│       ├── config.py                     # Worker config
│       ├── poller.py                     # Heartbeat + polling loop
│       ├── executor.py                   # Task dispatcher
│       ├── reporter.py                   # Result reporting
│       │
│       ├── plugins/                      # Execution-only plugin copies
│       │   ├── base.py
│       │   ├── registry.py
│       │   └── telegraph.py
│       │
│       └── utils/
│           ├── browser.py                # Playwright browser pool
│           ├── http_client.py            # httpx with retry
│           └── logger.py                 # Structured logging
│
├── scripts/
│   ├── seed_platforms.py                 # Insert default platforms
│   ├── create_user.py                    # Create admin user
│   └── provision_worker.sh              # Remote worker setup script
│
└── docs/
    ├── architecture.md
    ├── plugin-development.md
    ├── worker-deployment.md
    └── api-reference.md
```

---

## 3. Database Schema

### 3.1 Users Table

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(100) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,       -- bcrypt hashed
    created_at      TIMESTAMPTZ DEFAULT now()
);
```

**Fields:**
- `id` — UUID primary key
- `username` — Login username (single user system)
- `password_hash` — bcrypt hash of password
- `created_at` — Account creation timestamp

### 3.2 Websites Table

```sql
CREATE TABLE websites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    name            VARCHAR(255) NOT NULL,
    url             VARCHAR(2048) NOT NULL,
    sitemap_url     VARCHAR(2048),
    last_scanned_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
```

**Fields:**
- `name` — Display name for the website (user-given)
- `url` — Base URL of the website (e.g., `https://example.com`)
- `sitemap_url` — URL to the XML sitemap (e.g., `https://example.com/sitemap.xml`)
- `last_scanned_at` — When sitemap was last parsed

### 3.3 Pages Table

```sql
CREATE TABLE pages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    website_id      UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
    url             VARCHAR(2048) NOT NULL,
    title           VARCHAR(512),
    page_type       VARCHAR(50) DEFAULT 'post',  -- 'post', 'page', 'category', 'product', etc.
    content_cache   TEXT,                          -- cached page content for AI context
    content_hash    VARCHAR(64),                   -- SHA-256 to detect content changes
    last_fetched_at TIMESTAMPTZ,                   -- when content was last fetched
    is_active       BOOLEAN DEFAULT true,          -- soft delete / exclude from campaigns
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(website_id, url)
);

CREATE INDEX idx_pages_website ON pages(website_id);
CREATE INDEX idx_pages_type ON pages(page_type);
```

**Fields:**
- `page_type` — Detected from sitemap or URL pattern (post, page, category, product, etc.)
- `content_cache` — Full text content fetched from the page, used as AI context for generating articles
- `content_hash` — SHA-256 hash of content, used by sitemap watcher to detect changes
- `is_active` — Allows excluding pages without deleting

### 3.4 Platforms Table

```sql
CREATE TABLE platforms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            VARCHAR(100) UNIQUE NOT NULL,  -- 'telegraph', 'wordpress_com', 'blogger'
    name            VARCHAR(255) NOT NULL,          -- 'Telegraph', 'WordPress.com'
    plugin_type     VARCHAR(50) NOT NULL,           -- 'api', 'playwright', 'hybrid'
    config_schema   JSONB NOT NULL DEFAULT '{}',    -- JSON Schema defining what settings this platform needs
    prompt_template TEXT,                            -- Default AI prompt template for this platform
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now()
);
```

**Fields:**
- `slug` — Unique machine-readable ID matching the Python plugin class
- `plugin_type` — How the platform is automated: `api` (HTTP API calls), `playwright` (browser automation), `hybrid` (both)
- `config_schema` — JSON Schema that defines what configuration fields the platform needs (e.g., `author_name` for Telegraph). The UI renders a dynamic form from this schema
- `prompt_template` — Default AI prompt for generating content for this platform. Contains template variables like `{target_url}`, `{anchor_text}`, `{page_title}`, `{keywords}`

### 3.5 Strategies Table

```sql
CREATE TABLE strategies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,          -- 'T1 Authority', 'T2 Support', 'Link Farm'
    tier            INTEGER NOT NULL DEFAULT 1,     -- 1 = T1, 2 = T2, 3 = T3, etc.
    description     TEXT,
    ai_instructions TEXT,                            -- Global AI instructions for this strategy
    anchor_text_rules JSONB DEFAULT '{}',           -- Rules for anchor text generation
    rate_limit_mode VARCHAR(20) DEFAULT 'asap',     -- 'asap' or 'daily_limit'
    rate_limit_value INTEGER,                        -- Max links per day (when mode = 'daily_limit')
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
```

**`anchor_text_rules` JSONB structure:**
```json
{
    "exact_match_ratio": 0.3,       // 30% exact keyword match
    "partial_match_ratio": 0.25,    // 25% partial keyword
    "branded_ratio": 0.15,          // 15% brand name
    "generic_ratio": 0.15,          // 15% "click here", "read more"
    "url_ratio": 0.15               // 15% naked URL as anchor
}
```

**`ai_instructions` example:**
```
Generate content for a T1 authority backlink. The content should:
- Be 500-800 words
- Sound professional and authoritative
- Include 2-3 internal references to related topics
- Naturally weave in the anchor text without over-optimization
- Focus on providing genuine value to readers
```

### 3.6 Strategy Platforms Table (Many-to-Many with Multiplier)

```sql
CREATE TABLE strategy_platforms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id     UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
    platform_id     UUID NOT NULL REFERENCES platforms(id),
    multiplier      INTEGER NOT NULL DEFAULT 1,     -- How many links to build on this platform
    custom_prompt   TEXT,                            -- Override platform's default prompt for this strategy
    platform_config JSONB DEFAULT '{}',             -- Strategy-specific platform settings
    ai_model_id     VARCHAR(255),                   -- Override AI model for this strategy+platform combo
    UNIQUE(strategy_id, platform_id)
);
```

**Example:** Strategy "T1 Authority" with platforms:
- Telegraph (multiplier: 3) → build 3 Telegraph articles per page
- WordPress.com (multiplier: 1) → build 1 WordPress post per page
- Blogger (multiplier: 2) → build 2 Blogger posts per page
- Total: 6 T1 links per page

### 3.7 Campaigns Table

```sql
CREATE TABLE campaigns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    website_id      UUID NOT NULL REFERENCES websites(id),
    name            VARCHAR(255),
    status          VARCHAR(20) DEFAULT 'active',   -- 'active', 'paused', 'completed', 'cancelled'
    strategy_chain  JSONB NOT NULL,                  -- Ordered array of strategy IDs: ["uuid1", "uuid2"]
    auto_created    BOOLEAN DEFAULT false,           -- True if created by sitemap watcher
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_campaigns_website ON campaigns(website_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
```

**`strategy_chain` example:**
```json
["strategy_t1_uuid", "strategy_t2_uuid"]
```

This means: First build T1 links using the T1 strategy, then build T2 links pointing to the T1 links using the T2 strategy.

### 3.8 Campaign Pages Table

```sql
CREATE TABLE campaign_pages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    page_id         UUID NOT NULL REFERENCES pages(id),
    UNIQUE(campaign_id, page_id)
);
```

Associates selected pages with a campaign.

### 3.9 Links Table (Core Entity)

```sql
CREATE TABLE links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID NOT NULL REFERENCES campaigns(id),
    page_id         UUID NOT NULL REFERENCES pages(id),            -- Original money site page
    parent_link_id  UUID REFERENCES links(id),                      -- NULL for T1, parent link ID for T2+
    strategy_id     UUID NOT NULL REFERENCES strategies(id),
    platform_id     UUID NOT NULL REFERENCES platforms(id),
    tier            INTEGER NOT NULL DEFAULT 1,                     -- 1=T1, 2=T2, etc.
    target_url      VARCHAR(2048) NOT NULL,                         -- URL being linked TO
    source_url      VARCHAR(2048),                                  -- URL of created link (filled after build)
    anchor_text     VARCHAR(512),                                   -- Actual anchor text used
    generated_title VARCHAR(512),                                   -- Title of generated article
    generated_content TEXT,                                          -- Full AI-generated content
    status          VARCHAR(20) DEFAULT 'pending',                  -- See status flow below
    attempts        INTEGER DEFAULT 0,
    max_attempts    INTEGER DEFAULT 3,
    error_message   TEXT,                                            -- Last error if failed
    worker_id       UUID,                                            -- Which worker built this
    created_at      TIMESTAMPTZ DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    metadata        JSONB DEFAULT '{}'                               -- Platform-specific metadata
);

CREATE INDEX idx_links_status ON links(status);
CREATE INDEX idx_links_campaign ON links(campaign_id);
CREATE INDEX idx_links_parent ON links(parent_link_id);
CREATE INDEX idx_links_tier ON links(tier);
CREATE INDEX idx_links_page ON links(page_id);
CREATE INDEX idx_links_platform ON links(platform_id);
```

**Link status flow:**
```
pending → content_generating → content_ready → queued → assigned → in_progress → completed
                                                                                → failed → retry → queued
                                                                                → failed (max attempts)
```

Detailed statuses:
- `pending` — Link record created, waiting for AI content generation
- `content_generating` — AI is generating the article content
- `content_ready` — Content generated, waiting to be queued as a task
- `queued` — Task created in task queue, waiting for a worker
- `assigned` — Assigned to a worker
- `in_progress` — Worker is actively building the link
- `completed` — Link successfully built, `source_url` populated
- `failed` — Build failed, can be retried if attempts < max_attempts
- `retry` — Scheduled for retry

**The `parent_link_id` creates the tree structure:**
```
Page (money site) → Link T1-A (parent=NULL, target=page.url)
                   → Link T1-B (parent=NULL, target=page.url)
                       → Link T2-A (parent=T1-A, target=T1-A.source_url)
                       → Link T2-B (parent=T1-A, target=T1-A.source_url)
                       → Link T2-C (parent=T1-B, target=T1-B.source_url)
```

### 3.10 Tasks Table (Work Queue)

```sql
CREATE TABLE tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id         UUID REFERENCES links(id),
    task_type       VARCHAR(50) NOT NULL,            -- 'build_link', 'fetch_content', 'generate_content'
    priority        INTEGER DEFAULT 5,               -- 1=highest, 10=lowest
    payload         JSONB NOT NULL DEFAULT '{}',     -- Everything worker needs to execute
    status          VARCHAR(20) DEFAULT 'pending',   -- 'pending', 'assigned', 'in_progress', 'completed', 'failed'
    worker_id       UUID REFERENCES workers(id),
    assigned_at     TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    result          JSONB,                            -- Worker's result payload
    error_message   TEXT,
    attempts        INTEGER DEFAULT 0,
    max_attempts    INTEGER DEFAULT 3,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tasks_status_priority ON tasks(status, priority);
CREATE INDEX idx_tasks_worker ON tasks(worker_id);
CREATE INDEX idx_tasks_link ON tasks(link_id);
```

**Task types:**
- `build_link` — Build a link on a platform (main task type)
- `fetch_content` — Fetch page content for AI context
- `generate_content` — Generate AI content for a link (runs on control server, not worker)

**Task payload for `build_link`:**
```json
{
    "platform_slug": "telegraph",
    "target_url": "https://moneysite.com/best-widgets",
    "anchor_text": "best widgets 2026",
    "article_title": "The Ultimate Guide to Modern Widgets",
    "article_content": "<h3>The Ultimate Guide...</h3><p>In today's world...</p>",
    "platform_config": {
        "author_name": "Tech Expert",
        "author_url": ""
    },
    "credentials": {
        "api_key": "decrypted-per-task"
    }
}
```

### 3.11 Workers Table

```sql
CREATE TABLE workers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255),                    -- User-given name ("Worker US-1")
    hostname        VARCHAR(255),                    -- Detected hostname
    ip_address      VARCHAR(45),                     -- Detected IP
    ssh_host        VARCHAR(255),                    -- SSH host for provisioning
    ssh_user        VARCHAR(100),                    -- SSH username
    ssh_port        INTEGER DEFAULT 22,
    ssh_key_encrypted BYTEA,                         -- Encrypted SSH private key
    api_key         VARCHAR(255) NOT NULL UNIQUE,    -- Unique API key for worker auth
    status          VARCHAR(20) DEFAULT 'offline',   -- 'online', 'offline', 'provisioning', 'error'
    capabilities    JSONB DEFAULT '["api", "playwright"]',  -- What this worker can do
    max_concurrent  INTEGER DEFAULT 5,               -- Max simultaneous tasks
    current_tasks   INTEGER DEFAULT 0,               -- Current active task count
    last_heartbeat  TIMESTAMPTZ,
    version         VARCHAR(20),                     -- Worker agent version
    system_stats    JSONB DEFAULT '{}',              -- CPU, RAM, disk from last heartbeat
    created_at      TIMESTAMPTZ DEFAULT now()
);
```

### 3.12 Credentials Vault Table

```sql
CREATE TABLE credentials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,           -- Display name ("My Telegraph API Key")
    credential_type VARCHAR(50) NOT NULL,            -- 'api_key', 'account', 'oauth_token'
    platform_id     UUID REFERENCES platforms(id),   -- NULL if global (e.g., OpenRouter key)
    encrypted_data  BYTEA NOT NULL,                  -- AES-256-GCM encrypted JSON blob
    metadata        JSONB DEFAULT '{}',              -- Non-sensitive: label, last_used_at, etc.
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
```

**Encrypted data structure (before encryption):**
```json
{
    "api_key": "actual-secret-key",
    "username": "user@example.com",
    "password": "actual-password",
    "token": "oauth-token"
}
```

### 3.13 AI Configuration Table

```sql
CREATE TABLE ai_config (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    openrouter_key_encrypted BYTEA,                  -- Encrypted OpenRouter API key
    default_content_model VARCHAR(255),               -- Default model for content generation
    default_keyword_model VARCHAR(255),               -- Default model for keyword research
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ai_models_cache (
    model_id        VARCHAR(255) PRIMARY KEY,         -- OpenRouter model ID
    name            VARCHAR(255),                      -- Display name
    provider        VARCHAR(100),                      -- 'anthropic', 'openai', 'google', etc.
    pricing_input   DECIMAL(12, 6),                   -- $ per 1M input tokens
    pricing_output  DECIMAL(12, 6),                   -- $ per 1M output tokens
    context_length  INTEGER,                           -- Max context window
    is_available    BOOLEAN DEFAULT true,
    last_synced_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ai_models_provider ON ai_models_cache(provider);
CREATE INDEX idx_ai_models_pricing ON ai_models_cache(pricing_input);
```

### 3.14 Sitemap Watchers Table

```sql
CREATE TABLE sitemap_watchers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    website_id      UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
    is_active       BOOLEAN DEFAULT true,
    interval_minutes INTEGER DEFAULT 1440,            -- Check interval (default: daily)
    auto_assign_campaign_id UUID REFERENCES campaigns(id),  -- Auto-add new pages to this campaign
    auto_assign_strategy_chain JSONB,                 -- Or auto-create new campaign with this chain
    last_check_at   TIMESTAMPTZ,
    new_pages_found INTEGER DEFAULT 0,                -- Counter since creation
    created_at      TIMESTAMPTZ DEFAULT now()
);
```

**Watcher behavior:**
1. Celery Beat triggers the watcher task at the configured interval
2. Fetches the sitemap XML
3. Compares URLs against existing pages in the database
4. New URLs → inserted as new pages
5. If `auto_assign_campaign_id` is set → add new pages to that campaign and generate links/tasks
6. If `auto_assign_strategy_chain` is set → create a new campaign with the new pages

### 3.15 Activity Log Table

```sql
CREATE TABLE activity_log (
    id              BIGSERIAL PRIMARY KEY,
    entity_type     VARCHAR(50),                      -- 'link', 'campaign', 'worker', 'website'
    entity_id       UUID,
    action          VARCHAR(50),                      -- 'created', 'status_changed', 'completed', 'failed', 'error'
    details         JSONB,                            -- Action-specific details
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_activity_entity ON activity_log(entity_type, entity_id);
CREATE INDEX idx_activity_time ON activity_log(created_at DESC);
```

---

## 4. Backend — FastAPI Application

### 4.1 Application Setup (`app/main.py`)

```python
# Functions and logic:
def create_app() -> FastAPI:
    """
    Factory function that creates and configures the FastAPI application.

    Steps:
    1. Create FastAPI instance with title, version, docs URL
    2. Add CORS middleware (allow frontend origin)
    3. Include all routers with their prefixes:
       - auth_router → /api/auth
       - websites_router → /api/websites
       - pages_router → /api/pages
       - strategies_router → /api/strategies
       - platforms_router → /api/platforms
       - campaigns_router → /api/campaigns
       - links_router → /api/links
       - tasks_router → /api/tasks
       - workers_router → /api/workers
       - worker_agent_router → /api/worker-agent
       - credentials_router → /api/credentials
       - ai_settings_router → /api/ai
       - sitemap_watchers_router → /api/sitemap-watchers
       - dashboard_router → /api/dashboard
       - websocket_router → /ws
    4. Register startup event: initialize DB connection pool, Redis, event bus
    5. Register shutdown event: close DB pool, Redis connection
    """
```

### 4.2 Configuration (`app/config.py`)

```python
# Uses pydantic-settings to load from environment variables
class Settings(BaseSettings):
    # Database
    DATABASE_URL: str              # postgresql+asyncpg://user:pass@host:5432/linkmachine

    # Redis
    REDIS_URL: str                 # redis://localhost:6379/0

    # JWT Auth
    JWT_SECRET_KEY: str            # Random 64-char hex string
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # Encryption (for credentials vault)
    ENCRYPTION_KEY: str            # 32-byte base64-encoded key for AES-256-GCM

    # OpenRouter (optional, can also be set in UI)
    OPENROUTER_API_KEY: str = ""

    # Worker provisioning
    WORKER_AGENT_VERSION: str = "0.1.0"

    # Celery
    CELERY_BROKER_URL: str         # redis://localhost:6379/1

    class Config:
        env_file = ".env"
```

### 4.3 Database Setup (`app/database.py`)

```python
# Functions:
async def get_engine() -> AsyncEngine:
    """Create SQLAlchemy async engine with connection pooling."""
    # pool_size=20, max_overflow=10, pool_timeout=30

async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield an async database session for each request."""
    # Used as a FastAPI dependency
```

### 4.4 Authentication (`app/auth/`)

**`auth/service.py` functions:**

```python
def hash_password(password: str) -> str:
    """Hash password using bcrypt."""

def verify_password(plain: str, hashed: str) -> bool:
    """Verify password against bcrypt hash."""

def create_access_token(user_id: str) -> str:
    """Create JWT access token with user_id claim and expiry."""

def create_refresh_token(user_id: str) -> str:
    """Create JWT refresh token with longer expiry."""

def decode_token(token: str) -> dict:
    """Decode and validate JWT token. Raises HTTPException on invalid/expired."""
```

**`auth/router.py` endpoints:**

```
POST /api/auth/login
  Input: { "username": "admin", "password": "secret" }
  Logic: Verify credentials → create access + refresh tokens → set httpOnly cookie
  Output: { "access_token": "...", "token_type": "bearer", "user": {...} }

POST /api/auth/refresh
  Input: Refresh token in httpOnly cookie
  Logic: Validate refresh token → issue new access token
  Output: { "access_token": "..." }

GET /api/auth/me
  Input: Bearer token in Authorization header
  Logic: Decode token → fetch user from DB
  Output: { "id": "...", "username": "admin" }
```

### 4.5 Website Management (`app/routers/websites.py`)

```
GET /api/websites
  Logic: Query all websites for current user, include page count and link stats
  Output: [{ id, name, url, sitemap_url, page_count, links_total, links_completed, last_scanned_at }]

POST /api/websites
  Input: { "name": "My Site", "url": "https://example.com", "sitemap_url": "https://example.com/sitemap.xml" }
  Logic:
    1. Validate URL format
    2. Insert website record
    3. If sitemap_url provided → trigger async sitemap scan
  Output: { id, name, url, sitemap_url }

GET /api/websites/:id
  Output: Full website details with page count, campaign count, link stats

PUT /api/websites/:id
  Input: Partial update fields
  Logic: Update website, if sitemap_url changed → trigger rescan

DELETE /api/websites/:id
  Logic: Cascade delete pages, campaigns, links, tasks

POST /api/websites/:id/scan
  Logic: Trigger immediate sitemap scan → calls sitemap_parser.scan_sitemap(website)
  Output: { "pages_found": 142, "new_pages": 15, "updated_pages": 3 }

GET /api/websites/:id/pages
  Query params: ?page_type=post&search=keyword&page=1&per_page=50&sort=url
  Logic: Paginated, filterable list of pages for this website
  Output: { items: [...], total: 142, page: 1, per_page: 50 }
```

### 4.6 Page Management (`app/routers/pages.py`)

```
GET /api/pages/:id
  Output: Page details with content_cache, link count per tier, active campaigns

POST /api/pages/:id/fetch-content
  Logic:
    1. HTTP GET the page URL
    2. Parse HTML → extract main content (strip nav, footer, scripts)
    3. Store in content_cache, compute content_hash
    4. Update last_fetched_at
  Output: { "content_length": 5432, "title": "..." }
```

### 4.7 Strategy Management (`app/routers/strategies.py`)

```
GET /api/strategies
  Output: All strategies with platform assignments and multipliers

POST /api/strategies
  Input: {
    "name": "T1 Authority",
    "tier": 1,
    "description": "High-quality T1 backlinks",
    "ai_instructions": "Write a 500-800 word...",
    "anchor_text_rules": { "exact_match_ratio": 0.3, ... },
    "rate_limit_mode": "daily_limit",
    "rate_limit_value": 50,
    "platforms": [
      { "platform_id": "uuid", "multiplier": 3, "custom_prompt": null, "ai_model_id": null },
      { "platform_id": "uuid", "multiplier": 1, "custom_prompt": "Custom prompt...", "ai_model_id": "anthropic/claude-3-haiku" }
    ]
  }
  Logic:
    1. Insert strategy record
    2. Insert strategy_platforms records for each platform assignment
  Output: Strategy with full platform assignments

PUT /api/strategies/:id
  Logic: Update strategy + upsert platform assignments

DELETE /api/strategies/:id
  Logic: Cascade delete strategy_platforms. Check no active campaigns use it.

GET /api/strategies/:id/platforms
  Output: Platform assignments with multipliers, custom prompts, model overrides
```

### 4.8 Campaign Management (`app/routers/campaigns.py`)

```
POST /api/campaigns
  Input: {
    "website_id": "uuid",
    "name": "January Campaign",
    "page_ids": ["uuid1", "uuid2", "uuid3"],
    "strategy_chain": ["strategy_t1_uuid", "strategy_t2_uuid"]
  }
  Logic:
    1. Insert campaign record
    2. Insert campaign_pages records
    3. Call campaign_engine.expand_campaign(campaign) to generate links
    4. For T1: generate link records for each page × each platform × multiplier
    5. T2+ links are NOT created yet (they depend on T1 completion)
  Output: Campaign with stats

GET /api/campaigns/:id/tree
  Logic: Build the tree structure:
    1. Get all pages in campaign
    2. For each page, get all links (T1)
    3. For each T1 link, get child links (T2)
    4. Continue for deeper tiers
  Output: {
    "pages": [
      {
        "page": { id, url, title },
        "tiers": [
          {
            "tier": 1,
            "strategy": { id, name },
            "links": [
              {
                "id": "uuid",
                "platform": "telegraph",
                "status": "completed",
                "source_url": "https://telegra.ph/...",
                "anchor_text": "...",
                "children": [
                  { "id": "uuid", "platform": "telegraph", "tier": 2, "status": "pending", ... }
                ]
              }
            ]
          }
        ]
      }
    ]
  }

POST /api/campaigns/:id/pause
  Logic: Set status='paused'. Mark all pending/queued tasks as 'paused'. Workers skip paused tasks.

POST /api/campaigns/:id/resume
  Logic: Set status='active'. Requeue paused tasks.

GET /api/campaigns/:id/stats
  Output: {
    "total_links": 600,
    "by_status": { "pending": 200, "completed": 350, "failed": 30, "in_progress": 20 },
    "by_tier": { "1": 200, "2": 400 },
    "by_platform": { "telegraph": 300, "wordpress": 150, "blogger": 150 },
    "completion_rate": 0.583,
    "avg_build_time_seconds": 12.5
  }
```

### 4.9 Link Management (`app/routers/links.py`)

```
GET /api/links
  Query params: ?campaign_id=&status=&tier=&platform_id=&page=1&per_page=50
  Output: Paginated link list with all details

GET /api/links/:id
  Output: Link details + task history (all attempts)

POST /api/links/:id/retry
  Logic:
    1. Check attempts < max_attempts
    2. Reset status to 'queued'
    3. Increment attempts
    4. Create new task record
  Output: Updated link

DELETE /api/links/:id
  Logic: Only if status is 'pending' or 'queued'. Cancel the link + associated task.
```

### 4.10 Worker Agent API (`app/routers/worker_agent.py`)

**This is the API that worker nodes call. Authenticated via API key in Authorization header.**

```
POST /api/worker-agent/heartbeat
  Input: {
    "status": "online",
    "active_tasks": 3,
    "max_concurrent": 5,
    "capabilities": ["api", "playwright"],
    "version": "0.1.0",
    "system_stats": { "cpu_percent": 45, "ram_percent": 62, "disk_percent": 30 }
  }
  Logic:
    1. Validate worker API key
    2. Update worker record: last_heartbeat, status, current_tasks, system_stats
    3. Broadcast worker status via WebSocket event bus
  Output: { "ok": true }

POST /api/worker-agent/poll
  Input: {
    "max_tasks": 2,
    "capabilities": ["api", "playwright"]
  }
  Logic:
    1. Validate worker API key
    2. Query tasks WHERE status='pending' AND platform capability matches
    3. Order by priority ASC, created_at ASC
    4. Check rate limits (if strategy has daily_limit, check Redis counter)
    5. Assign up to max_tasks to this worker (UPDATE SET status='assigned', worker_id=X)
    6. For each assigned task, decrypt credentials and include in payload
    7. Return task payloads
  Output: {
    "tasks": [
      {
        "task_id": "uuid",
        "task_type": "build_link",
        "priority": 3,
        "payload": {
          "platform_slug": "telegraph",
          "target_url": "https://...",
          "anchor_text": "best widgets",
          "article_title": "Guide to Widgets",
          "article_content": "<h3>Guide...</h3>...",
          "platform_config": { "author_name": "Tech Expert" },
          "credentials": { "api_key": "decrypted-secret" }
        }
      }
    ]
  }

POST /api/worker-agent/task/:id/start
  Input: { "started_at": "2026-02-25T10:30:00Z" }
  Logic: Update task status='in_progress', update link status='in_progress'

POST /api/worker-agent/task/:id/complete
  Input: {
    "result": {
      "source_url": "https://telegra.ph/Guide-to-Widgets-02-25",
      "anchor_text": "best widgets",
      "status_code": 200,
      "metadata": { "telegraph_path": "Guide-to-Widgets-02-25" }
    }
  }
  Logic:
    1. Update task: status='completed', result=payload, completed_at=now
    2. Update link: status='completed', source_url=result.source_url, completed_at=now
    3. **CRITICAL: Check if this link completion should trigger T2 link creation**
       - Look up the campaign's strategy_chain
       - If there's a next strategy in the chain
       - Create new link records with parent_link_id=this_link, target_url=this_link.source_url
       - For each platform in the next strategy × multiplier
       - Queue AI content generation tasks for new links
    4. Broadcast completion event via WebSocket
    5. Log to activity_log

POST /api/worker-agent/task/:id/fail
  Input: { "error_message": "Telegraph API returned 429 Too Many Requests" }
  Logic:
    1. Update task: status='failed', error_message
    2. Check attempts < max_attempts
    3. If retryable → create new task, set link status='retry'
    4. If max attempts reached → set link status='failed'
    5. Broadcast failure event via WebSocket
```

### 4.11 AI Settings API (`app/routers/ai_settings.py`)

```
GET /api/ai/config
  Output: { "has_api_key": true, "default_content_model": "...", "default_keyword_model": "..." }
  Note: Never return the actual API key, just whether one is set

PUT /api/ai/config
  Input: { "openrouter_api_key": "sk-...", "default_content_model": "...", "default_keyword_model": "..." }
  Logic: Encrypt API key, store in ai_config table

GET /api/ai/models
  Query params: ?search=claude&sort=pricing_input&provider=anthropic
  Logic: Return from ai_models_cache, filterable and sortable
  Output: [{ model_id, name, provider, pricing_input, pricing_output, context_length }]

POST /api/ai/models/sync
  Logic:
    1. Decrypt OpenRouter API key
    2. GET https://openrouter.ai/api/v1/models
    3. Parse response → upsert into ai_models_cache
    4. Return count of models synced
  Output: { "models_synced": 290 }

POST /api/ai/generate-preview
  Input: { "model_id": "...", "prompt": "...", "max_tokens": 1000 }
  Logic: Call OpenRouter with the prompt, return generated content for preview
  Output: { "content": "...", "tokens_used": 450, "cost": 0.0012 }
```

### 4.12 Credentials Vault API (`app/routers/credentials.py`)

```
GET /api/credentials
  Output: [{ id, name, credential_type, platform_name, created_at, updated_at }]
  Note: NEVER include encrypted_data in list response

POST /api/credentials
  Input: { "name": "Telegraph Key", "credential_type": "api_key", "platform_id": "uuid", "data": { "api_key": "..." } }
  Logic: Encrypt data with AES-256-GCM → store as encrypted_data

PUT /api/credentials/:id
  Logic: Re-encrypt new data, update record

DELETE /api/credentials/:id
  Logic: Hard delete (credentials should be fully removable)
```

### 4.13 Worker Management API (`app/routers/workers.py`)

```
POST /api/workers
  Input: { "name": "US Worker 1", "ssh_host": "123.45.67.89", "ssh_user": "root", "ssh_port": 22 }
  Logic:
    1. Generate unique API key for worker
    2. Insert worker record
    3. Return API key (shown once to user, needed for worker config)
  Output: { id, name, api_key, status: "offline" }

POST /api/workers/:id/provision
  Logic:
    1. SSH into worker using stored credentials
    2. Execute provision_worker.sh script:
       a. Install Python 3.11+
       b. Install Playwright + browsers
       c. Create virtual environment
       d. Install worker agent package
       e. Configure worker: control server URL, API key, max_concurrent
       f. Create systemd service for auto-start
       g. Start the worker agent
    3. Update worker status to 'provisioning'
    4. Worker agent starts sending heartbeats → status changes to 'online'
```

### 4.14 Sitemap Watcher API (`app/routers/sitemap_watchers.py`)

```
POST /api/sitemap-watchers
  Input: {
    "website_id": "uuid",
    "interval_minutes": 1440,
    "auto_assign_strategy_chain": ["t1_uuid", "t2_uuid"]
  }

POST /api/sitemap-watchers/:id/run
  Logic: Trigger immediate check (calls sitemap_parser.scan_sitemap)
```

### 4.15 Dashboard API (`app/routers/dashboard.py`)

```
GET /api/dashboard/summary
  Output: {
    "total_websites": 45,
    "total_pages": 12500,
    "total_campaigns": 120,
    "total_links": 85000,
    "links_today": { "completed": 450, "failed": 12, "pending": 1200 },
    "workers": { "online": 3, "offline": 1 },
    "links_7d": [120, 145, 130, 160, 180, 200, 150],  // sparkline data
    "links_30d": [...]
  }

GET /api/dashboard/activity
  Query params: ?limit=50
  Output: Recent activity_log entries
```

### 4.16 WebSocket Events (`app/routers/websocket.py`)

```
WS /ws/events
  Auth: JWT token in query param or first message

  Events broadcast to connected clients:
  - { "type": "task_status", "task_id": "uuid", "status": "completed", "link_id": "uuid" }
  - { "type": "worker_status", "worker_id": "uuid", "status": "online" }
  - { "type": "campaign_progress", "campaign_id": "uuid", "completed": 350, "total": 600 }
  - { "type": "link_created", "link_id": "uuid", "tier": 2, "parent_link_id": "uuid" }
  - { "type": "error", "entity_type": "link", "entity_id": "uuid", "message": "..." }
```

---

## 5. Plugin System

### 5.1 Base Plugin Interface (`app/plugins/base.py`)

```python
class LinkResult(BaseModel):
    source_url: str          # URL where the link was created
    anchor_text: str         # Actual anchor text used
    title: str = ""          # Title of created article
    status: str              # 'success' or 'failed'
    error: str = ""          # Error message if failed
    metadata: dict = {}      # Platform-specific metadata

class PlatformPlugin(ABC):
    # Class-level metadata (override in subclass)
    slug: str = ""                 # Unique identifier: "telegraph", "wordpress_com"
    name: str = ""                 # Display name: "Telegraph"
    plugin_type: str = "api"       # "api", "playwright", "hybrid"
    requires_account: bool = False # Whether platform needs stored credentials

    @abstractmethod
    def get_config_schema(self) -> dict:
        """Return JSON Schema for platform-specific settings.
        The UI will render a dynamic form from this schema.
        Example: { "type": "object", "properties": { "author_name": { "type": "string" } } }
        """

    @abstractmethod
    def get_default_prompt_template(self) -> str:
        """Return default AI prompt template. Template variables available:
        {target_url}, {anchor_text}, {page_title}, {page_content}, {keywords}, {platform_name}
        """

    @abstractmethod
    async def execute(self, content: str, target_url: str, anchor_text: str,
                      config: dict, credentials: dict | None = None) -> LinkResult:
        """Build a link on this platform. Returns LinkResult with the created URL."""

    async def validate_config(self, config: dict) -> list[str]:
        """Optional: Validate platform config before saving. Return list of error messages."""
        return []

    async def health_check(self, config: dict, credentials: dict | None = None) -> bool:
        """Optional: Check if platform is reachable. Called from UI 'test' button."""
        return True
```

### 5.2 Telegraph Plugin (`app/plugins/telegraph.py`)

```python
class TelegraphPlugin(PlatformPlugin):
    slug = "telegraph"
    name = "Telegraph"
    plugin_type = "api"
    requires_account = False

    def get_config_schema(self) -> dict:
        """Returns schema with: author_name (string), author_url (string, optional)."""

    def get_default_prompt_template(self) -> str:
        """Returns prompt instructing AI to write a 400-600 word HTML article
        with natural anchor text placement. Output format: HTML with
        <h3>, <h4>, <p>, <ul>, <li>, <b>, <i>, <a> tags."""

    async def execute(self, content, target_url, anchor_text, config, credentials=None) -> LinkResult:
        """
        Steps:
        1. Call Telegraph createAccount API → get ephemeral access_token
        2. Parse HTML content into Telegraph Node format:
           - Convert <h3> → {"tag": "h3", "children": [...]}
           - Convert <p> → {"tag": "p", "children": [...]}
           - Convert <a href="..."> → {"tag": "a", "attrs": {"href": "..."}, "children": [...]}
           - Text nodes → plain strings
        3. Call Telegraph createPage API with title, content nodes, author info
        4. Return LinkResult with source_url = telegra.ph URL
        """

    def _html_to_telegraph_nodes(self, html: str) -> list:
        """Parse HTML string into Telegraph's Node format (list of dicts/strings).
        Uses Python's html.parser or BeautifulSoup.

        Telegraph Node format:
        - String = text node
        - {"tag": "p", "children": ["text", {"tag": "a", ...}]}
        - {"tag": "a", "attrs": {"href": "https://..."}, "children": ["anchor text"]}
        """

    def _extract_title(self, html: str) -> str:
        """Extract title from first <h3> tag in content."""
```

### 5.3 Plugin Registry (`app/plugins/registry.py`)

```python
_REGISTRY: Dict[str, Type[PlatformPlugin]] = {}

def register_plugin(plugin_cls: Type[PlatformPlugin]):
    """Register a plugin class by its slug."""
    _REGISTRY[plugin_cls.slug] = plugin_cls

def get_plugin(slug: str) -> PlatformPlugin:
    """Get plugin instance by slug. Raises ValueError if not found."""
    return _REGISTRY[slug]()

def list_plugins() -> list[dict]:
    """List all registered plugins with metadata."""
    return [{"slug": c.slug, "name": c.name, "type": c.plugin_type,
             "requires_account": c.requires_account} for c in _REGISTRY.values()]

# Register built-in plugins
register_plugin(TelegraphPlugin)
# register_plugin(WordPressPlugin)  # Phase 6
```

### 5.4 How to Add a New Platform Plugin

**Step 1:** Create `backend/app/plugins/<platform_name>.py`:
```python
from .base import PlatformPlugin, LinkResult

class MyPlatformPlugin(PlatformPlugin):
    slug = "my_platform"
    name = "My Platform"
    plugin_type = "playwright"  # or "api" or "hybrid"
    requires_account = True

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "blog_category": {"type": "string", "default": "general"},
                "max_word_count": {"type": "integer", "default": 800}
            }
        }

    def get_default_prompt_template(self) -> str:
        return "Write a {max_word_count}-word blog post about {page_title}..."

    async def execute(self, content, target_url, anchor_text, config, credentials=None):
        # For Playwright-based platforms:
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            # ... automation logic ...
            await browser.close()
        return LinkResult(source_url="...", anchor_text=anchor_text, status="success")
```

**Step 2:** Register in `backend/app/plugins/registry.py`:
```python
from .my_platform import MyPlatformPlugin
register_plugin(MyPlatformPlugin)
```

**Step 3:** Also copy the execution-only parts to `worker/agent/plugins/my_platform.py` (the execute method + any helpers). Register in worker's registry.

**Step 4:** Run `python scripts/seed_platforms.py` to insert the platform record into the database.

That's it. The UI will auto-discover the new platform through the `/api/platforms` endpoint.

---

## 6. Worker Agent

### 6.1 Worker Entry Point (`worker/agent/main.py`)

```python
async def main():
    """
    1. Load config from environment or config file:
       - CONTROL_SERVER_URL: https://control.example.com
       - WORKER_API_KEY: wk_xxxxxxxxxxxxx
       - MAX_CONCURRENT: 5
       - POLL_INTERVAL: 5 (seconds)
       - HEARTBEAT_INTERVAL: 30 (seconds)
    2. Register all platform plugins
    3. Initialize Playwright browser (if needed)
    4. Start the polling loop
    """
```

### 6.2 Worker Config (`worker/agent/config.py`)

```python
class WorkerConfig(BaseSettings):
    CONTROL_SERVER_URL: str       # https://your-control-server.com
    WORKER_API_KEY: str           # Unique API key assigned by control server
    MAX_CONCURRENT: int = 5       # Max simultaneous tasks
    POLL_INTERVAL: int = 5        # Seconds between polls
    HEARTBEAT_INTERVAL: int = 30  # Seconds between heartbeats
    PLAYWRIGHT_HEADLESS: bool = True
    LOG_LEVEL: str = "INFO"
```

### 6.3 Poller (`worker/agent/poller.py`)

```python
class Poller:
    """Main worker loop. Manages heartbeats and task polling."""

    async def start(self, config: WorkerConfig):
        """
        Run two concurrent loops:
        1. Heartbeat loop (every HEARTBEAT_INTERVAL seconds):
           - POST /api/worker-agent/heartbeat with status, active tasks, system stats
           - System stats: CPU%, RAM%, disk% (via psutil)

        2. Poll loop (every POLL_INTERVAL seconds):
           - Calculate available slots = MAX_CONCURRENT - len(running_tasks)
           - If slots > 0: POST /api/worker-agent/poll with max_tasks=slots
           - For each returned task: spawn asyncio task → executor.execute(task)
           - Track running tasks in a dict[task_id, asyncio.Task]
           - On completion: remove from running tasks
        """

    async def _heartbeat(self):
        """Send heartbeat to control server."""

    async def _poll_tasks(self):
        """Poll for available tasks and dispatch to executor."""

    def _get_system_stats(self) -> dict:
        """Get CPU, RAM, disk usage via psutil."""
```

### 6.4 Executor (`worker/agent/executor.py`)

```python
class TaskExecutor:
    """Executes tasks by dispatching to the appropriate platform plugin."""

    async def execute(self, task: dict, http_client: httpx.AsyncClient):
        """
        Steps:
        1. POST /api/worker-agent/task/{id}/start
        2. Get platform plugin from registry by task.payload.platform_slug
        3. Call plugin.execute(
               content=task.payload.article_content,
               target_url=task.payload.target_url,
               anchor_text=task.payload.anchor_text,
               config=task.payload.platform_config,
               credentials=task.payload.credentials
           )
        4. On success: POST /api/worker-agent/task/{id}/complete with result
        5. On exception: POST /api/worker-agent/task/{id}/fail with error message
        """
```

### 6.5 Browser Pool (`worker/agent/utils/browser.py`)

```python
class BrowserPool:
    """Manages Playwright browser instance and contexts for the worker.

    - Single browser instance (saves memory)
    - Multiple browser contexts (isolated sessions)
    - Context pool with max size (e.g., 5 concurrent)
    - Auto-cleanup: close context after task completion
    """

    async def start(self):
        """Launch Playwright Chromium browser in headless mode."""

    async def get_context(self) -> BrowserContext:
        """Get or create a browser context from the pool."""

    async def release_context(self, context: BrowserContext):
        """Close and release a browser context back to the pool."""

    async def shutdown(self):
        """Close all contexts and the browser."""
```

---

## 7. Frontend — React Application

### 7.1 App Shell (`src/App.tsx`)

```
Routes:
  /login              → Login page (unauthenticated)
  /                   → Dashboard (authenticated)
  /websites           → Website list
  /websites/:id       → Website detail (page list)
  /campaigns          → Campaign list
  /campaigns/:id      → Campaign detail + tree view
  /links              → Link explorer
  /strategies         → Strategy list
  /strategies/new     → Strategy builder
  /strategies/:id     → Strategy editor
  /platforms          → Platform list
  /platforms/:id      → Platform config
  /workers            → Worker list
  /workers/:id        → Worker detail
  /queue              → Job queue
  /settings/ai        → AI settings
  /settings/credentials → Credentials vault
  /settings/watchers  → Sitemap watchers

Layout: Sidebar (always visible) + Main content area + Header with user dropdown
```

### 7.2 API Client (`src/api/client.ts`)

```typescript
// Axios instance with:
// - Base URL from environment
// - Request interceptor: add JWT token from authStore
// - Response interceptor: on 401, try refresh token, if fails redirect to /login
// - Error handling: toast notifications for 4xx/5xx
```

### 7.3 WebSocket Manager (`src/api/websocket.ts`)

```typescript
class WebSocketManager {
    // Connect to WS /ws/events with JWT
    // Auto-reconnect with exponential backoff
    // Event handlers:
    //   - task_status → update task/link in local state
    //   - worker_status → update worker indicator
    //   - campaign_progress → update campaign progress bar
    //   - link_created → add new link to tree view
    //   - error → show toast notification
}
```

### 7.4 Key Pages

#### Login Page (`src/pages/Login.tsx`)
- Simple centered form: username + password + submit button
- On success: store tokens, redirect to dashboard
- Clean, minimal design

#### Dashboard (`src/pages/Dashboard.tsx`)
- **Summary cards:** Total websites, Total campaigns, Links today (completed/failed/pending), Workers online
- **Sparkline charts:** Links built over last 7 days and 30 days
- **Recent activity feed:** Last 20 events from activity_log
- **Worker status bar:** Small indicators showing online/offline workers

#### Website Detail (`src/pages/websites/WebsiteDetail.tsx`)
- **Page table** with columns: Checkbox, URL, Title, Type, Links (count), Last Fetched
- **Filters:** Page type dropdown, search box
- **Select all / Select none** controls
- **Bulk actions bar** (appears when pages selected):
  - "Create Campaign" → opens campaign creation modal
  - "Fetch Content" → trigger content fetch for selected pages
- **Sitemap watcher status** indicator + config button

#### Campaign Tree (`src/pages/campaigns/CampaignTree.tsx`)
- **Visual tree component** showing the full link hierarchy:
  ```
  📄 /best-widgets (money site page)
  ├── T1: 🟢 Telegraph → telegra.ph/guide-to-widgets (completed)
  │   ├── T2: 🟡 Telegraph → (pending)
  │   ├── T2: 🔵 Telegraph → telegra.ph/more-about... (in_progress)
  │   └── T2: 🟢 Telegraph → telegra.ph/widget-tips (completed)
  ├── T1: 🟢 Telegraph → telegra.ph/modern-widgets (completed)
  │   ├── T2: 🟢 Telegraph → ...
  │   └── T2: 🔴 Telegraph → (failed) [Retry button]
  └── T1: 🟡 WordPress → (pending)
  ```
- Color-coded status badges: green=completed, yellow=pending, blue=in_progress, red=failed
- Click on any link → shows details panel (content preview, error message, timestamps)
- Expand/collapse tiers
- Progress bar at top: "350/600 links completed (58%)"

#### Strategy Builder (`src/pages/strategies/StrategyBuilder.tsx`)
- **Name + Tier** inputs
- **AI Instructions** textarea (markdown-capable)
- **Anchor Text Rules** section:
  - Sliders for each ratio (exact match, partial, branded, generic, URL)
  - Sliders always sum to 100%
  - Visual pie chart preview
- **Rate Limiting** section:
  - Toggle: "Build ASAP" or "Daily Limit"
  - When daily limit: number input for max links/day
- **Platform Assignments** section:
  - "Add Platform" button → dropdown of available platforms
  - For each platform:
    - Platform name + icon
    - Multiplier: number input (default 1)
    - "Custom Prompt" expandable section (overrides platform default)
    - "AI Model" dropdown (overrides default model)
    - "Remove" button

#### AI Settings (`src/pages/settings/AISettings.tsx`)
- **OpenRouter API Key** input (masked, with show/hide toggle)
- **Sync Models** button → fetches latest models from OpenRouter
- **Default Models** section:
  - Content Generation: model picker dropdown
  - Keyword Research: model picker dropdown
- **Model Picker dropdown component:**
  - Search box at top (filters by name)
  - Table columns: Model Name | Provider | Input Price | Output Price | Context Length
  - Price displayed as "$X.XX / 1M tokens"
  - Click to select
  - Shows currently selected model with a checkmark

#### Worker Management (`src/pages/workers/WorkerList.tsx`)
- **Worker table:** Name | IP | Status (green/red dot) | Last Heartbeat | Active Tasks | CPU | RAM | Version
- **Add Worker** button → modal:
  - Name, SSH Host, SSH User, SSH Port inputs
  - "Register" → generates API key → shows it once
  - "Provision" → button to trigger remote setup via SSH
- **Worker detail page:**
  - System stats over time
  - Recent task history
  - Logs viewer
  - "Remove Worker" button

#### Job Queue (`src/pages/queue/JobQueue.tsx`)
- **Tabs:** Pending | In Progress | Completed | Failed
- **Table columns:** Task Type | Platform | Target URL | Worker | Status | Duration | Created | Error
- **Queue depth counters** at top
- **Bulk actions:** Retry all failed, Cancel all pending
- **Auto-refresh** via WebSocket events

---

## 8. AI Content Pipeline

### 8.1 Content Generation Service (`app/services/ai_service.py`)

```python
class AIService:
    """Handles all AI content generation via OpenRouter API."""

    async def generate_content(self, model_id: str, prompt: str, max_tokens: int = 2000) -> str:
        """
        Call OpenRouter API:
        POST https://openrouter.ai/api/v1/chat/completions
        Headers: Authorization: Bearer <openrouter_api_key>
        Body: {
            "model": model_id,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens
        }
        Returns: generated text content
        """

    async def generate_keywords(self, page_content: str, page_title: str, model_id: str) -> dict:
        """
        Generate anchor texts and LSI keywords from page content.

        Prompt: "Analyze the following page content and generate:
        1. 10 anchor text variations (exact match, partial match, branded, generic, URL)
        2. 15 LSI (Latent Semantic Indexing) keywords related to the topic
        3. 5 long-tail keyword phrases

        Page title: {page_title}
        Page content: {page_content[:3000]}

        Return as JSON: { anchors: [...], lsi_keywords: [...], long_tail: [...] }"

        Returns: { "anchors": [...], "lsi_keywords": [...], "long_tail": [...] }
        """

    async def generate_article(self, template: str, variables: dict, model_id: str) -> str:
        """
        Render prompt template with variables, then call OpenRouter.

        template: The platform's prompt template (from platform.prompt_template or strategy_platform.custom_prompt)
        variables: {
            "target_url": "https://moneysite.com/page",
            "anchor_text": "best widgets",
            "page_title": "Best Widgets 2026",
            "page_content": "cached content of the target page...",
            "keywords": "widget, best widget, modern widget, ...",
            "platform_name": "Telegraph"
        }

        Steps:
        1. Render template: template.format(**variables)
        2. Call generate_content(model_id, rendered_prompt)
        3. Return generated article HTML/text
        """

    async def fetch_available_models(self) -> list[dict]:
        """
        GET https://openrouter.ai/api/v1/models
        Parse response → return list of models with pricing info
        Each model: { id, name, pricing: { prompt, completion }, context_length }
        """
```

### 8.2 Content Fetcher (`app/services/content_fetcher.py`)

```python
class ContentFetcher:
    """Fetches and caches target page content for AI context."""

    async def fetch_page_content(self, url: str) -> dict:
        """
        Steps:
        1. HTTP GET the URL with browser-like User-Agent
        2. Parse HTML with BeautifulSoup
        3. Extract main content:
           - Remove <nav>, <header>, <footer>, <script>, <style>, <aside>
           - Extract text from <main>, <article>, or <body>
           - Clean up whitespace
        4. Extract title from <title> or <h1>
        5. Compute SHA-256 hash of content

        Returns: { "title": "...", "content": "...", "content_hash": "abc123..." }
        """

    async def fetch_and_cache(self, page_id: str, url: str, db: AsyncSession) -> None:
        """Fetch content and update the pages table cache fields."""
```

### 8.3 Full Link Building Pipeline

When a campaign is created, this is the full pipeline for each link:

```
1. CAMPAIGN CREATION (campaign_engine.py)
   - For each selected page:
     - For the first strategy in the chain:
       - For each platform assignment in the strategy:
         - Create `multiplier` number of link records
         - Set status='pending', tier=strategy.tier, target_url=page.url

2. CONTENT PREPARATION (runs on control server)
   For each pending link:
   a. Check if page has cached content (content_cache not null)
   b. If not → create 'fetch_content' task → fetch and cache content
   c. Select anchor text based on strategy's anchor_text_rules:
      - AI generates keyword list from page content
      - Pick anchor text type based on ratios (weighted random)
      - Set link.anchor_text
   d. Generate article content:
      - Get prompt template (custom > platform default)
      - Render template with variables (target_url, anchor_text, page_title, keywords, etc.)
      - Call OpenRouter with the rendered prompt
      - Store generated content in link.generated_content
   e. Update link status to 'content_ready'

3. TASK CREATION (task_scheduler.py)
   For each link with status='content_ready':
   a. Check rate limits (if strategy has daily_limit)
      - Redis counter: rate_limit:{strategy_id}:{date}
      - If under limit → proceed
      - If over limit → skip until tomorrow
   b. Create task record with full payload (content, config, target, anchor)
   c. Update link status to 'queued'

4. WORKER EXECUTION
   Worker polls → gets task → executes plugin → reports result

5. T2 CHAIN TRIGGER (runs on control server after T1 completion)
   When a link completes:
   a. Check strategy_chain: is there a next strategy?
   b. If yes:
      - Create new link records for T2:
        - parent_link_id = completed T1 link
        - target_url = T1 link's source_url (the created Telegraph article URL)
        - tier = next strategy's tier
      - For each platform in next strategy × multiplier
      - These new links go through steps 2-4 (content generation → task creation → execution)
   c. This cascades: T2 completion → T3 creation → etc.
```

### 8.4 Anchor Text Selection Logic

```python
def select_anchor_text(rules: dict, keywords: dict, target_url: str, site_name: str) -> str:
    """
    Select anchor text based on strategy rules and AI-generated keywords.

    rules: { "exact_match_ratio": 0.3, "partial_match_ratio": 0.25, ... }
    keywords: { "anchors": [...], "lsi_keywords": [...], "long_tail": [...] }

    Steps:
    1. Weighted random pick of anchor type based on ratios
    2. Based on type:
       - exact_match: pick from keywords["anchors"] (exact keyword matches)
       - partial_match: combine 2 keywords or use long_tail
       - branded: use site_name or domain name
       - generic: random from ["click here", "read more", "learn more", "visit site", "this article"]
       - url: use target_url directly as anchor text
    3. Return selected anchor text
    """
```

---

## 9. Deployment & Docker

### 9.1 Control Server (`docker-compose.yml`)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: linkmachine
      POSTGRES_USER: linkmachine
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"  # internal only in production

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  backend:
    build: ./backend
    depends_on: [postgres, redis]
    environment:
      DATABASE_URL: postgresql+asyncpg://linkmachine:${DB_PASSWORD}@postgres:5432/linkmachine
      REDIS_URL: redis://redis:6379/0
      CELERY_BROKER_URL: redis://redis:6379/1
      JWT_SECRET_KEY: ${JWT_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
    ports:
      - "8000:8000"

  celery-beat:
    build: ./backend
    command: celery -A app.celery_app.celery beat --loglevel=info
    depends_on: [postgres, redis]
    environment:
      # Same env as backend

  celery-worker:
    build: ./backend
    command: celery -A app.celery_app.celery worker --loglevel=info
    depends_on: [postgres, redis]
    environment:
      # Same env as backend

  frontend:
    build: ./frontend
    ports:
      - "3000:80"  # Nginx serving built React app

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - /etc/letsencrypt:/etc/letsencrypt
    depends_on: [backend, frontend]

volumes:
  postgres_data:
  redis_data:
```

### 9.2 Worker Node (`docker-compose.worker.yml`)

```yaml
services:
  worker-agent:
    build: ./worker
    environment:
      CONTROL_SERVER_URL: https://your-control-server.com
      WORKER_API_KEY: ${WORKER_API_KEY}
      MAX_CONCURRENT: 5
      POLL_INTERVAL: 5
      HEARTBEAT_INTERVAL: 30
    restart: unless-stopped
    # Playwright needs some system deps, included in Dockerfile
```

### 9.3 Worker Dockerfile

```dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y \
    # Playwright browser dependencies
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libasound2
WORKDIR /app
COPY pyproject.toml .
RUN pip install . && playwright install chromium
COPY . .
CMD ["python", "-m", "agent.main"]
```

### 9.4 Environment Variables (`.env.example`)

```bash
# Database
DB_PASSWORD=your-secure-password

# Security
JWT_SECRET=generate-64-char-random-hex
ENCRYPTION_KEY=generate-32-byte-base64-key

# OpenRouter (optional, can set in UI)
OPENROUTER_API_KEY=sk-or-...

# Worker (for docker-compose.worker.yml)
WORKER_API_KEY=wk-xxxxxxxxxxxxx
```

---

## 10. Implementation Phases

### Phase 1: Foundation (Priority: HIGH)
**Goal:** Running backend + basic UI shell

**Backend tasks:**
1. Initialize Python project with uv/Poetry, install FastAPI, SQLAlchemy, asyncpg, alembic, redis, bcrypt, pyjwt
2. Create `app/config.py` with Settings class
3. Create `app/database.py` with async engine and session factory
4. Create all SQLAlchemy models (`app/models/*.py`)
5. Run `alembic init` and create initial migration with all tables
6. Create `app/auth/` — JWT service, login endpoint, password hashing
7. Create `scripts/create_user.py` — CLI to create initial admin user
8. Create `app/dependencies.py` — `get_db`, `get_current_user` dependencies
9. Create CRUD routers: websites, pages, strategies, platforms
10. Create `app/services/sitemap_parser.py`:
    - `fetch_sitemap(url)` — HTTP GET the sitemap XML
    - `parse_sitemap(xml)` — Parse XML, handle sitemap index files
    - `scan_sitemap(website)` — Fetch, parse, upsert pages into DB
11. Create `scripts/seed_platforms.py` — Insert Telegraph platform record
12. Docker Compose setup: postgres + redis + backend

**Frontend tasks:**
1. Initialize React project with Vite + TypeScript + TailwindCSS
2. Install dependencies: react-router-dom, axios, zustand, lucide-react (icons)
3. Create `src/api/client.ts` — Axios instance with JWT interceptor
4. Create `src/stores/authStore.ts` — Login state management
5. Create layout components: Sidebar, Header, MainLayout
6. Create Login page
7. Create Website List page with "Add Website" modal
8. Create Website Detail page with page table + checkboxes
9. Create Strategy List page
10. Create Strategy Builder page (form with platform assignments)
11. Create Platform List page

**Verification:**
- Can login with created user
- Can add a website with sitemap URL
- Pages appear from sitemap parsing
- Can create strategies with platform assignments
- All data persists across server restarts

### Phase 2: Link Engine Core (Priority: HIGH)
**Goal:** End-to-end link building (Telegraph only)

**Backend tasks:**
1. Create `app/plugins/base.py` — PlatformPlugin ABC + LinkResult
2. Create `app/plugins/registry.py` — Plugin registration system
3. Create `app/plugins/telegraph.py` — Full Telegraph plugin with HTML→Node conversion
4. Create `app/services/ai_service.py`:
   - OpenRouter API client
   - `generate_content()` — text generation
   - `generate_keywords()` — anchor text + LSI keyword extraction
   - `generate_article()` — template rendering + generation
   - `fetch_available_models()` — sync models from OpenRouter
5. Create `app/services/content_fetcher.py` — page content extraction + caching
6. Create `app/services/campaign_engine.py`:
   - `expand_campaign(campaign)` — strategy chain → link records
   - `process_pending_links(campaign)` — content generation pipeline
   - `trigger_next_tier(link)` — create T2+ links when T1 completes
7. Create `app/services/task_scheduler.py`:
   - `queue_ready_links()` — move content_ready links to queued tasks
   - `check_rate_limits(strategy)` — Redis-based daily counter
8. Create campaign router with create, tree, stats endpoints
9. Create link router with list, detail, retry endpoints
10. Create task router with list, queue-stats endpoints
11. Create AI settings router with config, models, sync endpoints

**Frontend tasks:**
1. Create Campaign List page
2. Create Campaign Creation flow:
   - Select pages (from website detail) → opens modal
   - Pick strategy chain (ordered list of strategies)
   - Name the campaign → submit
3. Create Campaign Tree view component
4. Create Link Explorer page (data table with filters)
5. Create AI Settings page:
   - API key input
   - Model sync button
   - Model picker dropdown with search + pricing
   - Default model selectors

**Verification:**
- Can create a campaign with selected pages and strategy chain
- AI generates content for each link
- Tasks appear in queue
- Can see campaign tree with status indicators

### Phase 3: Worker System (Priority: HIGH)
**Goal:** Distributed execution on remote VPS

**Worker package tasks:**
1. Create worker Python package structure
2. Create `agent/config.py` — WorkerConfig settings
3. Create `agent/poller.py` — heartbeat + task polling loop
4. Create `agent/executor.py` — task dispatch to plugins
5. Create `agent/reporter.py` — result/failure reporting
6. Copy plugin base + telegraph to `agent/plugins/`
7. Create `agent/utils/browser.py` — Playwright browser pool
8. Create `agent/utils/http_client.py` — httpx with retry logic
9. Create `agent/main.py` — entry point
10. Create worker Dockerfile

**Backend tasks:**
1. Create `app/routers/worker_agent.py` — heartbeat, poll, start, complete, fail endpoints
2. Create `app/services/credential_vault.py`:
   - `encrypt(data)` — AES-256-GCM encryption
   - `decrypt(data)` — AES-256-GCM decryption
3. Create `app/routers/credentials.py` — CRUD for credentials vault
4. Create `app/routers/workers.py` — worker management endpoints
5. Create `app/services/worker_provisioner.py`:
   - `provision_worker(worker)` — SSH into VPS, install Python, Playwright, agent
   - Uses asyncssh or paramiko
6. Celery Beat tasks:
   - `check_worker_health()` — every 60s, mark offline workers
   - `recover_stale_tasks()` — every 5min, reset stuck tasks

**Frontend tasks:**
1. Create Worker List page with status indicators
2. Create Worker registration modal (SSH details + API key display)
3. Create Worker detail page (stats, task history)
4. Create Credentials Vault page
5. Create Job Queue page with tabs (pending/in_progress/completed/failed)

**Verification:**
- Can register a worker and see it come online
- Worker polls tasks and executes Telegraph plugin
- Links get built, source_url populated
- T2 links auto-created when T1 completes
- Failed tasks show error messages
- Stale tasks recovered after worker goes offline

### Phase 4: Intelligence Layer (Priority: MEDIUM)
**Goal:** Smart automation features

**Backend tasks:**
1. Full anchor text selection engine with weighted ratios
2. Content change detection (compare content_hash on refetch)
3. Sitemap watcher:
   - Celery Beat periodic task
   - Auto-detect new pages
   - Auto-create campaigns for new pages
4. Rate limiting engine:
   - Redis token bucket: `rate_limit:{strategy_id}:{YYYY-MM-DD}` counter
   - Increment on task creation, check on poll
5. Platform prompt template variable system with validation

**Frontend tasks:**
1. Sitemap Watcher configuration page
2. Prompt template editor with:
   - Syntax highlighting (basic)
   - Variable autocomplete ({target_url}, {anchor_text}, etc.)
   - Preview button (calls /api/ai/generate-preview)
3. Anchor text ratio sliders with pie chart visualization

**Verification:**
- Sitemap watcher detects new pages
- Rate limiting correctly throttles link building
- Anchor text distribution matches configured ratios
- Prompt editor preview works

### Phase 5: Scale & Polish (Priority: MEDIUM)
**Goal:** Production hardening

**Tasks:**
1. WebSocket event stream for real-time UI updates
2. Dashboard with summary cards + sparkline charts
3. Activity log display
4. Bulk operations: retry all failed, cancel all pending
5. Database query optimization (connection pooling, N+1 fixes)
6. Error handling refinement (retries with exponential backoff)
7. Worker auto-update mechanism (version check + pull new code)
8. Export/import strategies and campaigns (JSON format)
9. Nginx configuration with SSL (Let's Encrypt)

### Phase 6: Platform Expansion (Ongoing)
**Goal:** New platform plugins following the plugin guide

Each new platform follows the 4-step process from Section 5.4. Candidate platforms:
- WordPress.com (Playwright-based, needs account)
- Blogger (Google API or Playwright)
- Medium (API)
- Web 2.0 sites (Playwright)
- Reddit via SMM API
- Twitter/X via SMM API

---

## 11. Verification & Testing

### 11.1 Backend Tests
```bash
# Run all tests
pytest backend/tests/ -v

# Key test categories:
# - test_auth/ — login, JWT token lifecycle, protected routes
# - test_websites/ — CRUD, sitemap parsing
# - test_strategies/ — CRUD, platform assignment logic
# - test_campaigns/ — creation, strategy chain expansion, tree building
# - test_plugins/ — Telegraph plugin execution, HTML→Node conversion
# - test_services/ — AI service (mocked OpenRouter), content fetcher, campaign engine
# - test_worker_agent/ — poll, heartbeat, complete, fail endpoints
```

### 11.2 End-to-End Verification Steps

1. **Start the stack:** `docker-compose up`
2. **Create user:** `python scripts/create_user.py --username admin --password secret`
3. **Login** at the UI
4. **Add a website** with a sitemap URL → verify pages populate
5. **Configure AI settings** → enter OpenRouter key, sync models, select defaults
6. **Create a strategy** → assign Telegraph platform with multiplier 2
7. **Select pages** from the website → create a campaign with the strategy
8. **Watch the campaign tree** — links should go: pending → content_generating → queued
9. **Start a worker** (locally or on another VPS)
10. **Watch links complete** — source_urls should appear
11. **Visit the Telegraph URLs** — verify articles exist with correct anchor text links
12. **If T2 configured** — verify T2 links auto-created pointing to T1 source_urls
13. **Test failure handling** — kill a worker mid-task, verify task recovers
14. **Test rate limiting** — set daily limit, verify system respects it

### 11.3 Performance Targets
- Control server handles 100 concurrent worker connections
- Task poll response time < 200ms
- AI content generation < 30s per article (depends on model)
- Telegraph link creation < 5s per link
- Dashboard loads in < 2s with 100k+ links in database
- Worker memory < 500MB (single browser + 5 concurrent contexts)
