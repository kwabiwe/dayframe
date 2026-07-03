# Product Requirements Document: Link-in-Bio Page Builder

## 1. Executive Summary

Link-in-Bio Page Builder is a self-hosted, multi-user Linktree alternative that enables users to create a personal landing page with their name, bio, avatar, and a curated list of links. Users select from layout-varying visual themes, receive a shareable public URL based on their chosen slug (e.g., `/cole`), and access a dedicated analytics dashboard tracking clicks per link over time.

The application is built as a full-stack Next.js app deployed on Vercel, backed by Neon serverless Postgres with Neon Auth for authentication. The editor features a live preview with side-by-side layout on desktop and a toggle mode on mobile, with full drag-and-drop link reordering. Public pages are server-rendered for optimal SEO and social sharing.

**MVP Goal:** Deliver a fully functional, production-ready link-in-bio platform across 4 sequential phases — from profile editing through theming, public URLs with SEO, and click analytics — with comprehensive E2E testing validating every user journey.

---

## 2. Mission

**Mission Statement:** Provide creators and professionals with a beautiful, self-hosted link-in-bio page they fully control — no vendor lock-in, no premium paywalls for basic features, and complete ownership of their data and analytics.

**Core Principles:**

1. **Simplicity first** — The editor should be intuitive enough that a user can create and publish their page in under 2 minutes.
2. **Visual quality** — Public pages should look polished and professional out of the box, rivaling paid alternatives.
3. **Performance** — Server-rendered public pages load fast, score well on Lighthouse, and render correctly for social media crawlers.
4. **Self-service** — No admin intervention needed. Users sign up, build, publish, and track analytics independently.
5. **Test-driven confidence** — Every user journey is validated with E2E tests using agent-browser. No feature ships without comprehensive test coverage.

---

## 3. Target Users

### Primary Persona: Content Creators & Professionals

- **Who:** Social media creators, freelancers, small business owners, developers, designers — anyone who needs a single link to share across platforms.
- **Technical comfort:** Low to medium. They can fill out forms and pick themes but shouldn't need to write code or manage infrastructure.
- **Key needs:**
  - A single URL to put in their Instagram/TikTok/Twitter bio
  - A page that looks professional without design skills
  - Knowing which links get clicked and when
  - Ability to quickly update links as their content/projects change

### Secondary Persona: Self-Hosters / Developers

- **Who:** Developers who want to run their own Linktree alternative rather than depend on a SaaS.
- **Technical comfort:** High. They'll deploy to Vercel, configure Neon, and potentially customize themes.
- **Key needs:**
  - Full data ownership
  - Open-source codebase they can fork and extend
  - Clean, well-structured code they can understand and modify

---

## 4. MVP Scope

### In Scope

**Core Functionality:**
- ✅ User registration with username/slug selection
- ✅ Email/password authentication
- ✅ Google OAuth authentication
- ✅ Profile editor (name, bio, avatar URL)
- ✅ Link management (add, remove, reorder via drag-and-drop)
- ✅ Header and divider items between links
- ✅ Live preview alongside editor
- ✅ 4 layout-varying themes with instant preview
- ✅ Slug-based public pages (`/<username>`)
- ✅ OG meta tags for social sharing
- ✅ Click tracking per link with timestamps
- ✅ Analytics dashboard with click counts and time-series charts
- ✅ Marketing landing page at `/`

**Technical:**
- ✅ Server-side rendering for public pages
- ✅ Responsive design (mobile-first)
- ✅ TypeScript strict mode throughout
- ✅ Biome for linting and formatting
- ✅ Vitest for unit testing
- ✅ agent-browser for E2E testing of all user journeys
- ✅ Basic rate limiting on API routes
- ✅ Explicit save button (no auto-save)

**Deployment:**
- ✅ Vercel deployment
- ✅ Neon serverless Postgres
- ✅ Neon Auth integration
- ✅ Environment-based configuration

### Out of Scope

- ❌ Admin panel / moderation tools
- ❌ File upload for avatars (URL-only for MVP)
- ❌ Custom domains per user
- ❌ Embed support (YouTube, Spotify, etc.)
- ❌ Monetization features (tipping, paid links)
- ❌ Email notifications / transactional emails
- ❌ Auto-save / draft vs published states
- ❌ Link scheduling (show/hide by date)
- ❌ Geographic analytics (IP-based location data)
- ❌ Referrer tracking
- ❌ Custom CSS / theme editor per user
- ❌ Team/organization accounts
- ❌ API access for third-party integrations
- ❌ Mobile app
- ❌ Bot protection beyond basic rate limiting

---

## 5. User Stories

### Registration & Authentication

**US-1:** As a new user, I want to sign up with my email and choose a unique username, so that I get a personal URL like `/cole` for my link page.
> *Example: User visits `/`, clicks "Get Started", enters name, email, password, and desired slug `cole`. System checks slug availability in real-time. On success, user lands on the editor.*

**US-2:** As a returning user, I want to log in with my email/password or Google account, so that I can quickly access my editor.
> *Example: User clicks "Sign In", chooses "Continue with Google", authenticates via OAuth, and is redirected to their editor dashboard.*

### Profile Editing

**US-3:** As a logged-in user, I want to edit my name, bio, and avatar URL with a live preview, so that I can see exactly how my page will look before saving.
> *Example: User types in the bio field "Designer & coffee enthusiast" and the preview panel on the right instantly updates to show the new bio text.*

**US-4:** As a logged-in user, I want to add, remove, and reorder links using drag-and-drop, so that I can organize my page the way I want.
> *Example: User has 5 links. They grab the drag handle on "My Portfolio" and drag it from position 4 to position 1. The preview updates immediately. They click "Save" to persist the change.*

**US-5:** As a logged-in user, I want to add section headers and dividers between my links, so that I can visually group related links.
> *Example: User adds a header "Social Media" above their Twitter and Instagram links, and a divider before their "Projects" section.*

### Themes

**US-6:** As a logged-in user, I want to pick from 4 visual themes and see the result instantly in the preview, so that I can choose the look that best represents me.
> *Example: User clicks the "Colorful" theme thumbnail. The preview immediately switches to a vibrant gradient background with rounded, colorful link buttons. They try "Professional" next — the preview shifts to a clean, muted layout with serif typography.*

### Public Pages

**US-7:** As a visitor, I want to view someone's link page at their public URL and click their links, so that I can find their content.
> *Example: Visitor opens `example.com/cole` in their browser. They see Cole's avatar, bio, and list of links rendered with the "Dark" theme. They click "My YouTube Channel" and are redirected to YouTube.*

### Analytics

**US-8:** As a logged-in user, I want to see how many times each of my links has been clicked and view click trends over time, so that I can understand what content resonates with my audience.
> *Example: User navigates to their analytics dashboard. They see a bar chart showing "YouTube: 342 clicks, Portfolio: 128 clicks, Twitter: 89 clicks" and a line chart showing daily clicks over the past 30 days.*

---

## 6. Core Architecture & Patterns

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Vercel                           │
│  ┌───────────────────────────────────────────────────┐  │
│  │                   Next.js App                     │  │
│  │                                                   │  │
│  │  ┌─────────────┐  ┌──────────┐  ┌─────────────┐  │  │
│  │  │  SSR Public  │  │   API    │  │  SPA Editor  │  │  │
│  │  │   Pages      │  │  Routes  │  │  + Dashboard │  │  │
│  │  │  /<slug>     │  │ /api/*   │  │  /editor     │  │  │
│  │  └─────────────┘  └──────────┘  └─────────────┘  │  │
│  │                        │                          │  │
│  └────────────────────────┼──────────────────────────┘  │
│                           │                             │
└───────────────────────────┼─────────────────────────────┘
                            │
                  ┌─────────┴─────────┐
                  │   Neon Postgres   │
                  │  + Neon Auth      │
                  │  (Serverless)     │
                  └───────────────────┘
```

### Directory Structure

```
link-in-bio-page-builder/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (marketing)/              # Marketing/landing route group
│   │   │   └── page.tsx              # Landing page at /
│   │   ├── (auth)/                   # Auth route group
│   │   │   ├── login/page.tsx
│   │   │   └── signup/page.tsx
│   │   ├── (dashboard)/              # Authenticated route group
│   │   │   ├── editor/page.tsx       # Profile editor + live preview
│   │   │   ├── analytics/page.tsx    # Analytics dashboard
│   │   │   └── settings/page.tsx     # Account settings (slug change, etc.)
│   │   ├── [slug]/page.tsx           # Public profile pages (SSR)
│   │   ├── api/
│   │   │   ├── auth/[...all]/route.ts  # Neon Auth handlers
│   │   │   ├── profile/route.ts      # Profile CRUD
│   │   │   ├── links/route.ts        # Link management
│   │   │   ├── links/reorder/route.ts
│   │   │   ├── click/route.ts        # Click tracking endpoint
│   │   │   └── analytics/route.ts    # Analytics data
│   │   ├── layout.tsx                # Root layout
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                       # shadcn/ui components
│   │   ├── editor/                   # Editor-specific components
│   │   │   ├── profile-form.tsx
│   │   │   ├── link-list.tsx
│   │   │   ├── link-item.tsx
│   │   │   ├── add-link-dialog.tsx
│   │   │   └── theme-picker.tsx
│   │   ├── preview/                  # Live preview components
│   │   │   └── preview-panel.tsx
│   │   ├── themes/                   # Theme layout components
│   │   │   ├── minimal.tsx
│   │   │   ├── dark.tsx
│   │   │   ├── colorful.tsx
│   │   │   └── professional.tsx
│   │   ├── analytics/                # Analytics components
│   │   │   ├── click-chart.tsx
│   │   │   ├── top-links.tsx
│   │   │   └── time-series.tsx
│   │   └── marketing/                # Landing page components
│   │       ├── hero.tsx
│   │       └── features.tsx
│   ├── lib/
│   │   ├── auth.ts                   # Neon Auth server instance
│   │   ├── db/
│   │   │   ├── index.ts              # Drizzle client
│   │   │   ├── schema.ts             # Drizzle schema definitions
│   │   │   └── migrations/           # Drizzle migrations
│   │   ├── rate-limit.ts             # Rate limiting utility
│   │   └── utils.ts                  # Shared utilities
│   ├── hooks/                        # Custom React hooks
│   │   ├── use-profile.ts
│   │   └── use-analytics.ts
│   └── types/                        # Shared TypeScript types
│       └── index.ts
├── tests/
│   ├── unit/                         # Vitest unit tests
│   │   ├── lib/
│   │   └── components/
│   └── e2e/                          # agent-browser E2E tests
│       ├── auth.test.ts
│       ├── editor.test.ts
│       ├── public-page.test.ts
│       └── analytics.test.ts
├── public/                           # Static assets
├── drizzle.config.ts                 # Drizzle configuration
├── biome.json                        # Biome linter/formatter config
├── next.config.ts                    # Next.js configuration
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
└── package.json
```

### Key Design Patterns

1. **Route Groups** — Use Next.js route groups `(marketing)`, `(auth)`, `(dashboard)` to organize layouts without affecting URL structure.
2. **Server Components by default** — All pages and layouts are React Server Components unless they need interactivity. Client Components are used only in the editor, theme picker, and analytics charts.
3. **Server Actions for mutations** — Use Next.js Server Actions for profile saves, link CRUD, and settings changes. API routes for click tracking (called from public pages) and analytics data fetching.
4. **Optimistic UI** — The editor preview updates instantly on the client; the save button persists to the database.
5. **SSR for public pages** — The `[slug]` dynamic route fetches profile data server-side and renders the full HTML with OG meta tags.

---

## 7. Features

### 7.1 Marketing Landing Page

**Route:** `/`

A public homepage that explains the product and drives signups.

- Hero section with tagline, description, and CTA buttons ("Get Started" / "Sign In")
- Brief feature highlights (themes, analytics, custom URL)
- Example preview showing what a link page looks like
- Footer with minimal links

### 7.2 Authentication

**Routes:** `/login`, `/signup`

Powered by Neon Auth (built on Better Auth).

- **Signup flow:**
  1. User enters display name, email, password, and desired username/slug
  2. Real-time slug availability check (debounced API call)
  3. Slug validation: lowercase alphanumeric + hyphens, 3-30 characters, no reserved words
  4. On success → redirect to `/editor`
- **Login flow:**
  1. Email/password form OR "Continue with Google" button
  2. On success → redirect to `/editor`
- **Reserved slugs:** `login`, `signup`, `editor`, `analytics`, `settings`, `api`, `admin`, `about`, `help`, etc.

### 7.3 Profile Editor + Live Preview

**Route:** `/editor`

The core editing experience for building a link page.

**Editor Panel (left side on desktop):**
- **Profile section:**
  - Display name (text input, max 50 chars)
  - Bio (textarea, max 160 chars, with character counter)
  - Avatar URL (text input with URL validation, small preview thumbnail)
- **Links section:**
  - List of current links with drag handles (dnd-kit)
  - Each link item shows: drag handle, title, URL, delete button
  - "Add Link" button opens inline form (title + URL fields)
  - "Add Header" button adds a text header item
  - "Add Divider" button adds a visual divider item
  - Items are sortable via drag-and-drop
- **Save button** at the bottom — disabled when no changes, shows loading state during save, success/error feedback via toast notification

**Preview Panel (right side on desktop):**
- Renders the public page exactly as it will appear
- Updates in real-time as the user types/reorders (client-side state, not DB)
- Displayed inside a phone-frame mockup for context
- Shows the currently selected theme

**Layout Modes:**
- **Desktop (≥1024px):** Side-by-side with resizable panels. Toggle buttons in toolbar to: show both panels, show editor only, show preview only.
- **Mobile (<1024px):** Tab toggle between "Edit" and "Preview" views.

### 7.4 Theme System

**Accessible from:** Theme picker in the editor (above or within the editor panel)

4 themes that vary in both visual style and layout structure:

| Theme | Vibe | Layout Notes |
|---|---|---|
| **Minimal** | Clean, white/light gray, sans-serif, lots of whitespace | Centered single-column, simple rectangular link buttons, small avatar |
| **Dark** | Dark backgrounds, light text, neon/accent colors, modern feel | Centered column, rounded pill-shaped link buttons, larger avatar with glow effect |
| **Colorful** | Vibrant gradients, playful, rounded shapes, bold typography | Wider card-based links, avatar with colored border ring, gradient background |
| **Professional** | Muted tones, serif headings, structured, business-card feel | Two-column layout on desktop (avatar/bio left, links right), subtle shadows, traditional buttons |

**Theme Picker UI:**
- Horizontal row of theme thumbnail cards
- Clicking a theme instantly updates the preview panel
- Selected theme is visually highlighted
- Theme selection is saved with the profile

### 7.5 Public Pages + SEO

**Route:** `/[slug]` (dynamic, server-rendered)

- Fetches user profile, links, and theme from the database at request time
- Renders the full page server-side with the selected theme component
- Injects OG meta tags into `<head>`:
  - `og:title` → User's display name
  - `og:description` → User's bio
  - `og:image` → User's avatar URL (or a generated fallback)
  - `og:url` → Full canonical URL
  - `twitter:card` → `summary`
- Each link is a clickable `<a>` tag that:
  1. Fires a click-tracking request to `/api/click` (via `navigator.sendBeacon` or fetch)
  2. Then navigates to the target URL
- Returns 404 for non-existent slugs with a friendly "Page not found" message

### 7.6 Click Analytics

**Tracking endpoint:** `POST /api/click`

- Accepts: `{ linkId: string }`
- Records: link ID, timestamp, (IP hash for rate limiting — not stored for analytics)
- Rate limited: max 1 click per link per IP per 10 seconds (prevent spam)

**Dashboard route:** `/analytics`

- **Summary cards:** Total clicks (all time), clicks this week, number of active links
- **Top links table:** Ranked list of links by total clicks, showing title, URL, click count
- **Time-series chart:** Line chart showing total clicks per day over the last 30 days
  - Toggle between 7-day / 30-day / 90-day views
  - Uses a lightweight chart library (e.g., Recharts, which works well with shadcn)
- **Per-link breakdown:** Expandable rows in the top links table showing that link's daily clicks

---

## 8. Technology Stack

### Core Framework
| Technology | Version | Purpose |
|---|---|---|
| **Next.js** | 15.x | Full-stack React framework (App Router, SSR, API Routes) |
| **React** | 19.x | UI library |
| **TypeScript** | 5.x | Type safety (strict mode) |

### Styling & UI
| Technology | Purpose |
|---|---|
| **Tailwind CSS** 4.x | Utility-first CSS framework |
| **shadcn/ui** | Accessible, customizable component library |
| **CSS Transitions** | Animations (no extra motion libraries) |

### Database & Auth
| Technology | Purpose |
|---|---|
| **Neon** | Serverless Postgres (database hosting) |
| **Neon Auth** | Managed authentication (Better Auth-based) |
| **@neondatabase/auth** | Neon Auth SDK for Next.js |
| **Drizzle ORM** | Type-safe database queries and migrations |
| **drizzle-kit** | Schema migration tooling |

### Key Libraries
| Library | Purpose |
|---|---|
| **@dnd-kit/core** + **@dnd-kit/sortable** | Drag-and-drop link reordering |
| **Recharts** | Charts for analytics dashboard |
| **zod** | Runtime schema validation (forms, API inputs) |

### Dev Tooling
| Tool | Purpose |
|---|---|
| **Biome** | Linting + formatting (replaces ESLint + Prettier) |
| **Vitest** | Unit testing |
| **agent-browser** | E2E testing (Playwright-based CLI) |

### Deployment
| Service | Purpose |
|---|---|
| **Vercel** | Hosting, CI/CD, edge functions |
| **Neon** | Managed Postgres (serverless, auto-scaling) |

---

## 9. Security & Configuration

### Authentication & Authorization

- **Neon Auth** handles all authentication flows:
  - Email/password registration and login
  - Google OAuth (using Neon Auth's built-in Google credentials for dev, custom credentials for production)
  - Session management via signed cookies (cached for 5 minutes by default)
- **Authorization:** Middleware protects `/editor`, `/analytics`, `/settings` routes — redirects to `/login` if unauthenticated
- **Data isolation:** All queries filter by the authenticated user's ID. Users can only read/write their own profile and links.

### Rate Limiting

- **API routes:** Simple in-memory rate limiting (or Vercel KV if needed)
  - `/api/click`: 60 requests/minute per IP
  - `/api/profile`, `/api/links`: 30 requests/minute per user
  - `/api/auth/*`: 10 requests/minute per IP (login/signup)
- **Click deduplication:** Ignore duplicate clicks on the same link from the same IP within 10 seconds

### Configuration (Environment Variables)

```env
# Neon Database
DATABASE_URL=                    # Neon Postgres connection string

# Neon Auth
NEON_AUTH_BASE_URL=              # Neon Auth endpoint URL
NEON_AUTH_COOKIE_SECRET=         # Secret for signing session cookies

# Google OAuth (production)
GOOGLE_CLIENT_ID=                # Google OAuth client ID
GOOGLE_CLIENT_SECRET=            # Google OAuth client secret

# App
NEXT_PUBLIC_APP_URL=             # Public app URL (e.g., https://yourdomain.com)
```

### Security Scope

**In scope:**
- ✅ Input sanitization (XSS prevention on bio, link titles/URLs)
- ✅ URL validation for links (must be valid HTTP/HTTPS URLs)
- ✅ Slug validation (alphanumeric + hyphens only)
- ✅ CSRF protection (built into Neon Auth / Next.js)
- ✅ Rate limiting on all API endpoints

**Out of scope for MVP:**
- ❌ Content moderation / link scanning
- ❌ Two-factor authentication
- ❌ IP allowlisting
- ❌ Advanced bot protection (CAPTCHA, etc.)

---

## 10. Database Schema

### Tables

```sql
-- Users table is managed by Neon Auth (neon_auth schema)
-- It provides: id, email, name, image, created_at, updated_at

-- Profiles (extends Neon Auth user)
CREATE TABLE profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL UNIQUE REFERENCES neon_auth.users(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL DEFAULT '',
  bio           TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT NOT NULL DEFAULT '',
  theme         TEXT NOT NULL DEFAULT 'minimal',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_profiles_slug ON profiles(slug);
CREATE INDEX idx_profiles_user_id ON profiles(user_id);

-- Link items (links, headers, dividers)
CREATE TABLE link_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type          TEXT NOT NULL DEFAULT 'link',  -- 'link' | 'header' | 'divider'
  title         TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL DEFAULT '',       -- empty for headers/dividers
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_link_items_profile_id ON link_items(profile_id);

-- Click events
CREATE TABLE click_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_item_id  UUID NOT NULL REFERENCES link_items(id) ON DELETE CASCADE,
  clicked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_click_events_link_item_id ON click_events(link_item_id);
CREATE INDEX idx_click_events_clicked_at ON click_events(clicked_at);
```

### Drizzle Schema (TypeScript)

The above SQL will be represented as Drizzle schema definitions in `src/lib/db/schema.ts`, using `pgTable`, with proper TypeScript types inferred via `InferSelectModel` and `InferInsertModel`.

---

## 11. API Specification

### Profile

**GET `/api/profile`** — Get current user's profile
- Auth: Required
- Response: `{ profile: Profile, links: LinkItem[] }`

**PUT `/api/profile`** — Update current user's profile
- Auth: Required
- Body: `{ displayName: string, bio: string, avatarUrl: string, theme: string }`
- Validation: Zod schema
- Response: `{ profile: Profile }`

### Links

**POST `/api/links`** — Add a new link item
- Auth: Required
- Body: `{ type: 'link' | 'header' | 'divider', title?: string, url?: string }`
- Response: `{ link: LinkItem }`

**DELETE `/api/links/[id]`** — Remove a link item
- Auth: Required
- Response: `{ success: true }`

**PUT `/api/links/reorder`** — Reorder all link items
- Auth: Required
- Body: `{ items: { id: string, sortOrder: number }[] }`
- Response: `{ success: true }`

### Click Tracking

**POST `/api/click`** — Record a link click (called from public pages)
- Auth: None (public)
- Body: `{ linkId: string }`
- Rate limited: 60/min per IP, 10-second dedup per link per IP
- Response: `{ success: true }`

### Analytics

**GET `/api/analytics`** — Get analytics for current user's links
- Auth: Required
- Query params: `?period=7d|30d|90d`
- Response:
```json
{
  "summary": {
    "totalClicks": 1234,
    "clicksThisWeek": 89,
    "activeLinks": 8
  },
  "topLinks": [
    { "id": "...", "title": "YouTube", "url": "...", "clicks": 342 }
  ],
  "timeSeries": [
    { "date": "2026-02-19", "clicks": 45 },
    { "date": "2026-02-20", "clicks": 52 }
  ]
}
```

### Slug Availability

**GET `/api/slug/check?slug=cole`** — Check if slug is available
- Auth: None (used during signup)
- Response: `{ available: boolean }`

---

## 12. Success Criteria

### MVP Success Definition

The MVP is complete when a user can sign up, build a link page with a chosen theme, share their public URL, and view click analytics — all validated by passing E2E tests covering every user journey.

### Functional Requirements

- ✅ User can sign up with email/password and choose a unique slug
- ✅ User can sign in with Google OAuth
- ✅ User can edit display name, bio, and avatar URL
- ✅ User can add, remove, and reorder links via drag-and-drop
- ✅ User can add section headers and dividers
- ✅ User can select from 4 themes with instant live preview
- ✅ Editor shows side-by-side layout on desktop with toggle options
- ✅ Editor shows toggle mode on mobile
- ✅ Saving profile persists all changes to database
- ✅ Public page at `/<slug>` renders with selected theme (SSR)
- ✅ Public page includes correct OG meta tags
- ✅ Clicking a link on the public page tracks the click
- ✅ Analytics dashboard shows click counts per link
- ✅ Analytics dashboard shows time-series chart (7d/30d/90d)
- ✅ Marketing landing page exists at `/`
- ✅ All protected routes redirect to login when unauthenticated
- ✅ Rate limiting prevents abuse on API endpoints

### Quality Indicators

- TypeScript strict mode with zero type errors
- Biome passes with zero lint/format warnings
- Vitest unit test coverage on all utility functions and API logic
- agent-browser E2E tests pass for every user journey
- Lighthouse performance score ≥ 90 on public pages
- All pages responsive from 320px to 1920px

### User Experience Goals

- Signup-to-published page in under 2 minutes
- Theme switching feels instant (no loading states)
- Drag-and-drop reordering is smooth and intuitive
- Public page loads in under 1 second (server-rendered)

---

## 13. Implementation Phases

### Phase 1: Profile Editor + Live Preview

**Goal:** Users can sign up, log in, and build their link page with a live preview.

**Deliverables:**
- ✅ Project scaffolding (Next.js + Tailwind + shadcn/ui + Biome + Vitest)
- ✅ Neon database setup + Drizzle schema + migrations
- ✅ Neon Auth integration (email/password + Google OAuth)
- ✅ Signup page with slug selection and real-time availability check
- ✅ Login page (email/password + Google OAuth)
- ✅ Auth middleware protecting dashboard routes
- ✅ Profile editor form (name, bio, avatar URL)
- ✅ Link management (add, remove, reorder with dnd-kit)
- ✅ Header and divider support
- ✅ Live preview panel (default "Minimal" theme)
- ✅ Side-by-side layout (desktop) with editor-only/preview-only toggles
- ✅ Toggle mode (mobile)
- ✅ Explicit save button with toast feedback
- ✅ Unit tests for validation logic, API handlers
- ✅ E2E tests: signup flow, login flow, profile editing, link CRUD, drag-and-drop reorder

**Validation:**
- User can sign up, add 5 links + 1 header + 1 divider, reorder them, save, refresh, and see persisted data
- Preview updates in real-time without saving
- All E2E tests pass via agent-browser

---

### Phase 2: Theme System

**Goal:** Users can choose from 4 distinct, layout-varying themes with instant preview.

**Deliverables:**
- ✅ 4 theme components: Minimal, Dark, Colorful, Professional
- ✅ Each theme has its own layout structure and visual style
- ✅ Theme picker UI with thumbnail previews
- ✅ Instant theme switching in the live preview
- ✅ Theme selection persisted to database
- ✅ All themes responsive (320px – 1920px)
- ✅ Smooth CSS transitions between themes
- ✅ Unit tests for theme rendering logic
- ✅ E2E tests: theme selection, preview updates, persistence after save and reload

**Validation:**
- Switching between all 4 themes updates the preview instantly
- Theme persists after save → reload
- Each theme looks correct and distinct on mobile and desktop
- All E2E tests pass via agent-browser

---

### Phase 3: Public URLs + SEO

**Goal:** Each user gets a public page at `/<slug>` with proper SEO and social sharing support.

**Deliverables:**
- ✅ Dynamic `[slug]` route with server-side rendering
- ✅ Public page renders profile + links with the selected theme
- ✅ OG meta tags (`og:title`, `og:description`, `og:image`, `og:url`, `twitter:card`)
- ✅ 404 handling for non-existent slugs
- ✅ Reserved slug protection (prevent registration of system routes)
- ✅ Marketing landing page at `/` (hero, features, CTAs)
- ✅ Slug change in user settings
- ✅ Canonical URL in `<head>`
- ✅ Unit tests for slug validation, OG tag generation
- ✅ E2E tests: public page rendering, correct theme display, OG tag verification, 404 page, landing page navigation, slug change flow

**Validation:**
- Visiting `/<slug>` renders the correct profile with the correct theme
- Sharing the URL on social media shows correct preview (OG tags)
- Non-existent slugs show a 404 page
- Landing page loads and CTAs navigate correctly
- All E2E tests pass via agent-browser

---

### Phase 4: Click Analytics

**Goal:** Track clicks on public page links and display analytics in a dashboard.

**Deliverables:**
- ✅ Click tracking endpoint (`POST /api/click`)
- ✅ Click recording on public page link clicks (via `sendBeacon` or fetch)
- ✅ Rate limiting on click endpoint (60/min per IP, 10-sec dedup)
- ✅ Analytics API endpoint with period filtering
- ✅ Analytics dashboard page (`/analytics`)
- ✅ Summary cards (total clicks, this week, active links)
- ✅ Top links table with click counts
- ✅ Time-series line chart (7d / 30d / 90d toggle)
- ✅ Per-link daily breakdown (expandable rows)
- ✅ Unit tests for analytics aggregation queries, rate limiting logic
- ✅ E2E tests: click tracking fires on public page, analytics dashboard shows correct data, period toggle works, chart renders

**Validation:**
- Clicking links on a public page increments the count
- Analytics dashboard reflects clicks accurately
- Time-series chart displays correctly for all period options
- Rate limiting prevents click spam
- All E2E tests pass via agent-browser

---

## 14. Future Considerations

### Post-MVP Enhancements
- **File upload for avatars** — Use Vercel Blob or Cloudflare R2 for image storage
- **Custom domains** — Allow users to point their own domain to their page
- **Embed support** — YouTube, Spotify, SoundCloud embeds inline in the link list
- **Auto-save with draft/publish** — Auto-save changes as draft, explicit publish to go live
- **Link scheduling** — Show/hide links based on date ranges
- **More themes** — Community-contributed themes, custom color overrides

### Integration Opportunities
- **Social login expansion** — GitHub, Twitter/X, Discord OAuth
- **Analytics export** — CSV/JSON download of click data
- **Webhook notifications** — Notify external services on click milestones
- **API access** — Public API for programmatic profile management

### Advanced Features
- **Admin panel** — User management, content moderation, system stats
- **A/B testing** — Test different link orders or themes for click optimization
- **Rich analytics** — Referrer tracking, geographic data, device breakdown
- **Custom CSS** — Per-user CSS overrides for advanced customization
- **Team accounts** — Shared pages managed by multiple users

---

## 15. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Neon Auth is relatively new** — Less community support and documentation compared to established auth solutions. | Medium | Neon Auth is built on Better Auth, which has extensive docs. Fall back to Better Auth docs when Neon-specific docs are sparse. Keep auth logic isolated so it can be swapped if needed. |
| **Click tracking volume** — Popular pages could generate high write volume to the `click_events` table. | Medium | Use `navigator.sendBeacon` (non-blocking). Rate limit aggressively. Consider batching writes or a summary table for high-volume pages in a future phase. Neon's serverless auto-scaling helps absorb bursts. |
| **Slug collisions with app routes** — User-chosen slugs could conflict with app routes like `/login` or `/api`. | High | Maintain a strict reserved-slugs list checked at signup. The `[slug]` catch-all route should be the lowest priority in Next.js routing (place it last). |
| **Theme layout complexity** — 4 themes with different layouts is significantly more work than CSS-only themes. | Medium | Start with shared base components and have each theme compose them differently. Define a clear `ThemeProps` interface so all themes receive the same data. Build Minimal first as the reference, then diverge. |
| **E2E test reliability** — Browser-based E2E tests can be flaky, especially with auth flows and drag-and-drop. | Medium | Use agent-browser's `wait` commands extensively. Isolate test data per run. For drag-and-drop, test the reorder API directly as a unit test and use E2E only for the happy path. |

---

## 16. Appendix

### Key Dependencies

| Package | Docs |
|---|---|
| Next.js | https://nextjs.org/docs |
| Tailwind CSS | https://tailwindcss.com/docs |
| shadcn/ui | https://ui.shadcn.com |
| Drizzle ORM | https://orm.drizzle.team/docs |
| Neon | https://neon.com/docs |
| Neon Auth | https://neon.com/docs/auth/overview |
| dnd-kit | https://dndkit.com |
| Recharts | https://recharts.org |
| Zod | https://zod.dev |
| Biome | https://biomejs.dev |
| Vitest | https://vitest.dev |

### Reference Implementations

- [LinkStack](https://linkstack.org/) — Full-featured self-hosted Linktree alternative (PHP/Laravel)
- [LittleLink-Server](https://github.com/techno-tim/littlelink-server) — Lightweight Node.js alternative
- [LibreLinks](https://github.com/urdadx/librelinks) — Open-source Next.js link-in-bio tool
- [OpenBento](https://github.com/syntax-syndicate/openbento-linkedin-bio-builder) — Bento-grid style bio page builder
