# BetterDesk 3.0 — Implementation Roadmap

> **Created:** 2026-03-25
> **Status:** Planning phase — awaiting implementation approval
> **Vision:** BetterDesk evolves from a remote desktop tool into a full-scale device fleet management ecosystem, comparable to Windows Server domain services but cross-platform and open.

---

## Phase 0 — Immediate Bug Fixes & Code Cleanup

### 0.1 Chat — Tray Menu Opens Main Window Instead of Chat
**Problem:** Clicking "Chat" in the tray context menu opens the default BetterDesk window first, then the user has to click Chat inside it.
- Tauri: create a dedicated `chat` WebviewWindow opened directly from tray menu handler
- Remove the intermediate step through the main window
- Chat WebSocket should auto-connect on window open

### 0.2 Chat — Shows "Disconnected"
**Problem:** Chat UI displays disconnected status after opening.
- Diagnose whether `ws://server:5000/ws/chat/<device_id>` is reachable from the client
- Likely cause: client connects to wrong port/host or device_id is not set at connection time
- Add reconnect logic with exponential backoff (1s → 2s → 4s → 30s cap)

### 0.3 Rust Compilation Warnings (betterdesk-client)
Current warnings:
- 10 warnings in `bd_registration.rs` — unused variables (`device_id`, `status_tx`, etc.)
- Unused imports across modules
- Fix: prefix intentionally unused variables with `_`, remove dead imports
- Run `cargo fix --lib -p betterdesk-client` for auto-fixable suggestions

### 0.4 Go Compilation Warnings (betterdesk-server)
- Run `go vet ./...` and `staticcheck ./...`
- Remove unused imports, variables, dead code paths
- Fix deprecation warnings

### 0.5 Dependency Audit
- `npm audit --omit=dev` for web-nodejs (target: 0 vulnerabilities)
- `cargo audit` for betterdesk-client
- Update outdated packages to latest stable versions

---

## Phase 1 — Organization & User Account System

### 1.1 Data Model (Go Server — PostgreSQL + SQLite)

```sql
-- Organizations
CREATE TABLE organizations (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    logo_url    TEXT DEFAULT '',
    settings    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Organization users
CREATE TABLE org_users (
    id              TEXT PRIMARY KEY,
    org_id          TEXT REFERENCES organizations(id),
    username        TEXT NOT NULL,
    display_name    TEXT DEFAULT '',
    email           TEXT DEFAULT '',
    password_hash   TEXT NOT NULL,
    role            TEXT DEFAULT 'user',  -- owner, admin, operator, user
    totp_secret     TEXT DEFAULT '',
    avatar_url      TEXT DEFAULT '',
    last_login      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, username)
);

-- Device-to-organization binding
CREATE TABLE org_devices (
    org_id          TEXT REFERENCES organizations(id),
    device_id       TEXT NOT NULL,
    assigned_user_id TEXT DEFAULT '',
    department      TEXT DEFAULT '',
    location        TEXT DEFAULT '',
    building        TEXT DEFAULT '',
    tags            TEXT DEFAULT '',
    PRIMARY KEY(org_id, device_id)
);

-- Invitations
CREATE TABLE org_invitations (
    id          TEXT PRIMARY KEY,
    org_id      TEXT REFERENCES organizations(id),
    token       TEXT UNIQUE NOT NULL,
    email       TEXT DEFAULT '',
    role        TEXT DEFAULT 'user',
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ
);

-- Organization-level settings (policies, mappings)
CREATE TABLE org_settings (
    org_id  TEXT REFERENCES organizations(id),
    key     TEXT NOT NULL,
    value   TEXT DEFAULT '',
    PRIMARY KEY(org_id, key)
);
```

**Roles:** `owner` → `admin` → `operator` → `user` (read-only)

### 1.2 REST API Endpoints (Go Server)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/org` | Create organization |
| `GET` | `/api/org/{id}` | Get organization details |
| `PUT` | `/api/org/{id}` | Update organization |
| `DELETE` | `/api/org/{id}` | Delete organization |
| `GET` | `/api/org/{id}/users` | List org users |
| `POST` | `/api/org/{id}/users` | Add user to org |
| `PUT` | `/api/org/{id}/users/{uid}` | Update user |
| `DELETE` | `/api/org/{id}/users/{uid}` | Remove user |
| `POST` | `/api/org/{id}/invite` | Generate invitation link |
| `POST` | `/api/org/{id}/devices` | Assign device to org |
| `GET` | `/api/org/{id}/devices` | List org devices |
| `POST` | `/api/org/login` | User login (returns JWT) |
| `POST` | `/api/org/logout` | User logout |

### 1.3 Client-Side Login (BetterDesk Desktop)
- Login screen: server address + username + password (or org invitation token)
- After login: automatic chat name setup from `display_name`
- Device automatically assigned to organization on first login
- Persistent session via secure token storage (Tauri keyring / OS credential manager)
- Token refresh mechanism (short-lived access + long-lived refresh)

### 1.4 Web Panel — Organization Management
- New "Organizations" tab in the panel sidebar
- CRUD for organizations, users, invitations
- Device list filterable by organization
- Sorting/grouping: organization → building → department
- Bulk operations: assign 50 devices to org at once

### 1.5 Organization Discovery Protocol (Enhancement)
Client auto-discovers BetterDesk server on LAN via mDNS/DNS-SD (`_betterdesk._tcp`).
User sees: "BetterDesk server found: office.example.com — Join?" → login → done.
Zero manual configuration for corporate deployments.

---

## Phase 2 — Chat 2.0 (Encrypted, Organization-Aware)

### 2.1 End-to-End Message Encryption
- Per-conversation AES-256-GCM key
- Key exchange via X25519 Diffie-Hellman between participants
- Server stores only encrypted ciphertexts (zero-knowledge)
- Forward secrecy: key rotation every 24h or every 1000 messages
- Key backup: encrypted key export for admin recovery

### 2.2 Chat Features
| Feature | Priority | Description |
|---------|----------|-------------|
| 1:1 conversations | 🔴 Critical | Operator ↔ user direct messaging |
| Organization groups | 🔴 Critical | Auto-created groups per org/department |
| Custom groups | 🟡 High | Operator-created groups with invite |
| File sharing | 🟡 High | Up to 50MB, encrypted, with preview |
| System messages | 🟡 High | Alert, restart pending, update available |
| Typing indicator | 🟢 Medium | Real-time "typing..." status |
| Read receipts | 🟢 Medium | Double-check marks |
| Online presence | 🟢 Medium | Green/yellow/red dots |
| Message search | 🟢 Medium | Full-text search across conversations |
| Push notifications | 🟢 Medium | Desktop notifications via OS APIs |
| Message reactions | 🔵 Low | Emoji reactions on messages |

### 2.3 Chat Window in Desktop Client
- Dedicated window (not embedded in main window)
- Minimize to tray with unread badge counter
- Compact overlay mode (attachable to screen edge)
- Keyboard shortcut: Ctrl+Shift+C to toggle chat

### 2.4 Quick Commands in Chat (Enhancement)
Operator sends command in chat: `/screenshot`, `/restart`, `/lock`, `/deploy script.bat`.
User sees: "Operator Jan Kowalski requests: Restart computer [Accept] [Reject] [Accept for 5 min]".
Combines communication with remote actions.

---

## Phase 3 — Web Remote Client (Full Functionality)

### 3.1 Fix Current Issues
- **0 FPS**: Diagnose — likely missing `video_received` ACK or MSE buffer issue. Check `video.js` decode pipeline, verify H264 NALUs arrive intact, check JMuxer vs WebCodecs path.
- **No cursor**: Cursor data from `CursorData` protobuf not rendered — verify `renderer.js` `updateCursor()` is called, check zstd decompression path.
- **No interaction**: Input events not reaching remote — debug WebSocket relay path in `input.js`, verify mouse mask encoding (`TYPE | (BUTTON << 3)`).

### 3.2 Features to Implement

| Feature | Priority | Description |
|---------|----------|-------------|
| Image scaling | 🔴 Critical | Fit-to-window, 1:1 pixel, custom zoom (50%-200%) |
| Monitor switching | 🔴 Critical | Dropdown with monitor list from `PeerInfo.displays` |
| Fullscreen mode | 🔴 Critical | F11 / button, exit with Esc |
| Clipboard sync | 🟡 High | Bidirectional text copy/paste via `navigator.clipboard` |
| File transfer | 🟡 High | Drag & drop + file browser panel |
| Special keys | 🟡 High | Ctrl+Alt+Del, Win key, PrintScreen |
| Image quality slider | 🟢 Medium | Balanced / Quality / Speed presets |
| Session recording | 🟢 Medium | WebM recording with timestamps |
| Audio forwarding | 🟢 Medium | Remote audio → local speaker via WebAudio |
| Multi-session tabs | 🟢 Medium | Multiple connections in browser tabs |
| Floating toolbar | 🟢 Medium | Collapsible toolbar overlay at top |
| Touch support | 🔵 Low | Tablet / mobile touch-to-mouse mapping |
| Whiteboard overlay | 🔵 Low | Draw annotations over remote screen |

### 3.3 Connection Mode — Attended vs Unattended
- **Unattended (instant):** Device password → full access (current behavior)
- **Attended (with confirmation):** Operator clicks "Connect" → user sees popup:
  ```
  ┌─────────────────────────────────────────────┐
  │  🔔 Remote Access Request                    │
  │                                               │
  │  Operator: Jan Kowalski (Helpdesk IT)         │
  │  Organization: ACME Corp                      │
  │  Reason: Software installation                │
  │                                               │
  │  [Accept]  [Accept 5min]  [Reject]           │
  └─────────────────────────────────────────────┘
  ```
- Configurable per-organization: `connection_policy: unattended | attended | ask_always`

### 3.4 Session Recording & Playback (Enhancement)
Every remote session recorded as lightweight event stream (not raw video).
Operator/admin can replay exactly what happened. Audit trail at keystroke + mouse + screen level.
Critical for compliance (GDPR, SOX, HIPAA).

---

## Phase 4 — Background Client & Security Hardening

### 4.1 Background Service Mode
- Client installs as Windows Service (NSSM/sc.exe) + GUI tray component
- Closing GUI does not stop service → device remains accessible for remote
- Full shutdown (service stop) requires administrator privileges
- Auto-start with system (via service, not startup folder)
- Linux: systemd service + tray applet
- macOS: launchd daemon + menu bar app

### 4.2 Locked Settings (Organization Policy)
- Client settings protected by organization admin password
- Configuration pushed from web panel → client receives and applies
- User CANNOT change: server address, device password, connection policies
- User CAN change: theme, language (if policy allows)
- Policy enforcement checked on every client startup

### 4.3 Encryption Matrix

| Connection | Method | Status |
|-----------|--------|--------|
| Client ↔ Signal Server | TLS (`--tls-signal`) | ✅ Done |
| Client ↔ Relay Server | TLS (`--tls-relay`) | ✅ Done |
| Client ↔ Client (P2P) | NaCl box (X25519 + XSalsa20) | ✅ Done |
| Console ↔ Go Server API | HTTP localhost | ⚠️ Add mTLS or Unix socket |
| Chat messages | AES-256-GCM E2E | 📋 Phase 2 |
| Config push | TLS + signed payload | 📋 This phase |
| File transfer | ChaCha20-Poly1305 stream | 📋 Phase 3 |

### 4.4 Device Attestation (Enhancement)
Client sends TPM-based attestation (Windows) or hardware fingerprint (serial, MAC, BIOS UUID) during registration. Server verifies it is a known device. Prevents device_id spoofing. Critical for fleet security.

---

## Phase 5 — Fleet Management (Domain-like)

### 5.1 Organization Policies (Pushed to Clients)
```json
{
    "connection_policy": "attended",
    "allow_file_transfer": true,
    "allow_clipboard": true,
    "allow_audio": false,
    "max_session_duration_min": 120,
    "require_2fa_for_unattended": true,
    "allowed_operators": ["admin", "helpdesk"],
    "auto_update": true,
    "auto_update_channel": "stable",
    "wallpaper_policy": "hide_during_session",
    "idle_lock_timeout_min": 15,
    "password_policy": {
        "min_length": 12,
        "require_special": true,
        "max_age_days": 90
    },
    "network_policy": {
        "allowed_relay_servers": ["relay1.example.com", "relay2.example.com"],
        "block_direct_p2p": false
    }
}
```

### 5.2 Resource Mapping
- **Printers:** Operator configures printer mappings per device/group. Agent applies via OS APIs (Windows: `Add-Printer`, Linux: `lpadmin`).
- **Network drives:** Mount network shares via script push. Support for credential pass-through.
- **Network config:** DNS, proxy, VPN profiles pushed to client.
- Web panel: dedicated UI for managing mappings per org/department/device.

### 5.3 Task Scheduler
- Operator creates task → assigns to device/group → sets schedule (cron-like)
- Task types: PowerShell/Bash script, restart, update, install MSI/DEB/RPM, file deploy, registry edit
- Execution status: `pending` → `running` → `success` / `failed`
- Output log returned to panel in real-time via WebSocket
- Retry policy: configurable (0-3 retries, with backoff)

### 5.4 Visual Task Builder Module

Canvas-based visual workflow editor in the web panel:

```
┌──────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────┐
│ 🔵 Trigger│───▶│ 🟡 Condition  │───▶│ 🟢 Action    │───▶│ 🔴 Result │
│ Schedule  │    │ OS=Windows   │    │ Run Script   │    │ Log+Alert│
│ Daily 2AM │    │ RAM < 4GB    │    │ cleanup.ps1  │    │ Email    │
└──────────┘    └──────────────┘    └─────────────┘    └──────────┘
```

**Node types:**
| Color | Type | Examples |
|-------|------|----------|
| 🔵 Blue | Trigger | Manual, Schedule (cron), Event (disk full, CPU>90%, user login) |
| 🟡 Yellow | Condition | OS check, RAM/CPU threshold, user logged in, time window |
| 🟢 Green | Action | Run script, install software, copy file, restart service, send message |
| 🔴 Red | Result | Log output, send alert, email notification, chain to next workflow |
| 🟣 Purple | Transform | Parse JSON, filter list, set variable, delay/wait |

**Features:**
- Drag & drop canvas with zoom/pan
- Connection lines between nodes (directional)
- Conditional branching (if/else paths)
- Loop support (retry N times, for-each device)
- Export/import as JSON workflow definitions
- Template library (pre-built common workflows)
- Execution history with per-node status visualization
- Dry-run mode (simulate without executing)

### 5.5 Software Inventory & Compliance (Enhancement)
Agent regularly scans installed software (Windows: registry, Linux: dpkg/rpm, macOS: brew/apps).
Web panel shows:
- Which devices have Chrome v120 (outdated!)
- Which devices lack antivirus
- Compliance score per organization (0-100%)
- Auto-remediation: "Update Chrome on all devices" → one click

---

## Phase 6 — Scaling (Proxy/Relay Servers)

### 6.1 Distributed Architecture

```
                        ┌──────────────────────┐
                        │    Master Server      │
                        │    (Go, central)      │
                        │    PostgreSQL          │
                        │    Web Console         │
                        └──────────┬───────────┘
                                   │ gRPC / WS Federation
                  ┌────────────────┼────────────────┐
                  │                │                │
           ┌──────▼──────┐  ┌─────▼──────┐  ┌─────▼──────┐
           │ Building A   │  │ Building B  │  │ Building C  │
           │ Relay Node   │  │ Relay Node  │  │ Relay Node  │
           │ (Go lite)    │  │ (Go lite)   │  │ (Go lite)   │
           │ SQLite cache │  │ SQLite cache│  │ SQLite cache│
           └──────┬──────┘  └─────┬──────┘  └─────┬──────┘
                  │                │                │
            100 devices      200 devices      200 devices
```

### 6.2 Relay Node (Go Lite Binary)
- Lightweight binary: relay + local signal cache only
- Registers with Master Server on startup
- Routes local traffic (same building) without leaving LAN
- Fallback to Master if target is in another building
- Health reporting to Master (CPU, RAM, bandwidth, connected devices count)
- Auto-discovery: relay nodes find each other via Master's registry
- Failover: if relay node goes down, devices auto-reconnect to Master or another relay

### 6.3 Capacity Planning

| Configuration | Registered Devices | Concurrent Remote Sessions | Notes |
|--------------|-------------------|--------------------------|-------|
| Single Go server (SQLite) | ~200 | ~30 | Development/small office |
| Single Go server (PostgreSQL) | ~500-1000 | ~50 | Medium business |
| Master + 3 Relay Nodes | ~5000 | ~150 (50 per relay) | Multi-building enterprise |
| Master + 10 Relay Nodes | ~20000 | ~500 | Large enterprise |

**Bottleneck:** Relay bandwidth. One relay ≈ 50 concurrent sessions @ 2Mbps = 100Mbps sustained.

### 6.4 Intelligent Relay Selection (Enhancement)
Client measures latency to each relay node. Server assigns optimal relay based on:
- Physical location (same building = local relay, lowest latency)
- Relay load (weighted round-robin load balancing)
- Available bandwidth
- If both devices on same LAN → direct P2P (hole punch), zero relay overhead
- Failover chain: local relay → nearest relay → master relay

---

## Phase 7 — Cross-Platform Support

### 7.1 Compatibility Matrix

| Platform | Desktop Client | Background Agent | Remote Target (controlled) | Status |
|----------|---------------|-----------------|---------------------------|--------|
| **Windows 10/11** | ✅ Tauri (ready) | ✅ NSSM service | ✅ DXGI capture + enigo | Production |
| **Linux x86_64** | ✅ Tauri | ✅ systemd service | ✅ X11 capture + enigo | Requires testing |
| **Linux ARM64** | ✅ Tauri | ✅ systemd service | ⚠️ X11/Wayland | Raspberry Pi |
| **macOS ARM** | ✅ Tauri | ⚠️ launchd | ⚠️ Screen Recording perm | Requires signing |
| **macOS x64** | ✅ Tauri | ⚠️ launchd | ⚠️ Screen Recording perm | Legacy Intel |
| **Android** | 📱 Tauri Mobile | ⚠️ Foreground service | ❌ Viewer only | Planned |
| **iOS** | 📱 Tauri Mobile | ❌ Apple restrictions | ❌ Viewer only | Limited |
| **Web Browser** | ✅ Browser (exists) | N/A | N/A | In development |
| **ChromeOS** | ✅ Web + PWA | ⚠️ Linux container | ⚠️ Crostini only | Experimental |

### 7.2 Platform Limitations
- **iOS:** Apple prohibits background screen capture and input injection. Viewer + chat only. Must be distributed via App Store (review process).
- **Android:** Screen capture requires `MediaProjection` API + user consent every time. Input injection requires `AccessibilityService` approval. Mark as "Viewer + limited control".
- **macOS:** Requires Screen Recording permission (System Preferences → Privacy). Agent must be signed with Apple Developer ID. Notarization required for distribution.
- **Linux Wayland:** Capture via PipeWire portal API. More restricted than X11. Some compositors may block programmatic input.

### 7.3 Unified Protocol Layer (Enhancement)
Single protobuf schema for all platforms with capability negotiation at connect:

```protobuf
message ClientCapabilities {
    bool can_capture_screen = 1;
    bool can_inject_input = 2;
    bool can_transfer_files = 3;
    bool can_capture_audio = 4;
    bool supports_clipboard = 5;
    repeated string supported_codecs = 6;  // ["h264", "vp9", "av1"]
    string platform = 7;                   // "windows", "linux", "macos", "android", "ios", "web"
    string arch = 8;                       // "x86_64", "arm64", "armv7"
    string client_version = 9;
    repeated string supported_features = 10; // ["file_transfer", "chat", "audio", "printer_mapping"]
}
```

Server adapts behavior based on capabilities — never sends unsupported commands to limited clients.

---

## Phase 8 — Security Hardening & Continuous Auditing

### 8.1 Automated Auditing Pipeline
- `cargo audit` + `npm audit` in CI/CD on every PR
- SAST: `semgrep` custom rules for Go + JavaScript
- Dependency bot (Dependabot or Renovate) for automatic PR creation
- Pentest checklist executed before every major release
- `gosec` for Go-specific security issues

### 8.2 Security Documentation
| File | Purpose |
|------|---------|
| `docs/security/AUDIT_LOG.md` | History of audits with dates, findings, and resolutions |
| `docs/security/THREAT_MODEL.md` | Threat model (STRIDE methodology) |
| `docs/security/ENCRYPTION_SPEC.md` | Encryption specification (algorithms, key management, rotation) |
| `.github/SECURITY.md` | Responsible disclosure policy |
| `docs/security/COMPLIANCE.md` | GDPR, SOX, HIPAA compliance notes |

### 8.3 Hardening Priorities
1. Mutual TLS between Console ↔ Go Server (replace plain HTTP localhost)
2. API key rotation mechanism (auto-rotate every 30 days, grace period)
3. Audit log tamper detection (HMAC chain — each entry signs the previous)
4. Session timeout policies (configurable per-organization)
5. IP allowlisting per organization
6. Certificate pinning in desktop client (prevent MITM on TLS)
7. Memory-safe credential handling (zeroize secrets after use)
8. CSP headers hardening for web console
9. Rate limiting review for all public endpoints
10. Automated vulnerability scanning in Docker images (Trivy)

---

## Phase 9 — Internationalization (Multi-Language Support)

### 9.1 Current State

**Node.js Web Console** — 9 languages via JSON i18n files:

| Code | Language | Status |
|------|----------|--------|
| `en` | English | ✅ Complete (reference) |
| `pl` | Polish | ✅ Complete |
| `zh` | Chinese (Simplified) | ✅ Complete |
| `de` | German | ✅ Added |
| `es` | Spanish | ✅ Added |
| `fr` | French | ✅ Added |
| `it` | Italian | ✅ Added |
| `nl` | Dutch | ✅ Added |
| `pt` | Portuguese | ✅ Added |

**BetterDesk Desktop Client** — `language` field exists in Settings struct but no i18n framework is implemented yet. All UI strings are hardcoded in English.

### 9.2 New Languages to Add (Both Console and Client)

| Code | Language | Region Priority | Notes |
|------|----------|----------------|-------|
| `ja` | Japanese | 🟡 High | Large IT market, enterprise demand |
| `ko` | Korean | 🟡 High | Growing tech sector |
| `ru` | Russian | 🟡 High | Large user base, CIS region |
| `uk` | Ukrainian | 🟢 Medium | Distinct from Russian |
| `tr` | Turkish | 🟢 Medium | Growing IT sector |
| `ar` | Arabic | 🟢 Medium | RTL layout support required |
| `hi` | Hindi | 🟢 Medium | Largest population, growing IT |
| `sv` | Swedish | 🔵 Low | Nordic region |
| `nb` | Norwegian (Bokmål) | 🔵 Low | Nordic region |
| `da` | Danish | 🔵 Low | Nordic region |
| `fi` | Finnish | 🔵 Low | Nordic region |
| `cs` | Czech | 🔵 Low | Central Europe |
| `hu` | Hungarian | 🔵 Low | Central Europe |
| `ro` | Romanian | 🔵 Low | Eastern Europe |
| `th` | Thai | 🔵 Low | Southeast Asia |
| `vi` | Vietnamese | 🔵 Low | Southeast Asia |
| `id` | Indonesian | 🔵 Low | Large population |

### 9.3 Desktop Client i18n Architecture

#### System Language Auto-Detection
```rust
// Rust-side: detect OS locale on startup
fn detect_system_locale() -> String {
    // Windows: GetUserDefaultLocaleName() → "en-US", "pl-PL", etc.
    // Linux:   $LANG / $LC_MESSAGES → "pl_PL.UTF-8"
    // macOS:   CFLocaleCopyCurrent() → "en_US"
    sys_locale::get_locale().unwrap_or("en".into())
}
```

#### Language Selection Flow
1. **First launch / installer:** Detect system locale → map to nearest supported language → apply
2. **NSIS installer:** Language selection page during installation (NSIS built-in multilingual support)
3. **Settings UI:** Language dropdown with flag icons → change takes effect immediately (no restart)
4. **Organization policy override:** If org policy sets `forced_language: "en"`, user cannot change it

#### Client-Side i18n Implementation
- JSON translation files bundled in Tauri app resources (`src/locales/en.json`, `src/locales/pl.json`, ...)
- TypeScript i18n module with `t('key')` function and fallback chain: `user_language → system_language → en`
- Plural forms support (e.g., "1 device" vs "5 devices" — critical for Slavic languages)
- Date/time/number formatting via `Intl` API (respects locale conventions)
- RTL layout support for Arabic (CSS `direction: rtl` + mirrored UI)

```typescript
// Frontend usage example
import { t, setLocale } from './i18n';

// Auto-detect on startup
const systemLocale = await invoke('get_system_locale');
setLocale(settings.language || systemLocale || 'en');

// Usage in components
statusText.textContent = t('connection.connected_to', { name: peerName });
// en: "Connected to Office-PC"
// pl: "Połączono z Office-PC"
// ja: "Office-PC に接続しました"
```

### 9.4 Node.js Console i18n Improvements
- **Key completeness audit:** Automated CI check that all `lang/*.json` files have 100% key coverage vs `en.json`
- **Missing key fallback:** If a key is missing in current locale, fall back to English (already implemented, but add console warning)
- **Contributor workflow:** `npm run i18n:check` script that reports missing/extra keys per language
- **Machine translation baseline:** Use initial machine translation for new languages, then mark for human review with `"__needs_review": true` flag
- **Dynamic loading:** Load language files on demand (not all at startup) to reduce memory for 20+ languages

### 9.5 NSIS Installer Multilingual Support
```nsi
; Languages supported in installer UI
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Polish"
!insertmacro MUI_LANGUAGE "German"
!insertmacro MUI_LANGUAGE "Spanish"
!insertmacro MUI_LANGUAGE "French"
!insertmacro MUI_LANGUAGE "Italian"
!insertmacro MUI_LANGUAGE "Dutch"
!insertmacro MUI_LANGUAGE "Portuguese"
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "Japanese"
!insertmacro MUI_LANGUAGE "Korean"
!insertmacro MUI_LANGUAGE "Russian"
```

Tauri NSIS config in `tauri.conf.json`:
```json
{
  "bundle": {
    "windows": {
      "nsis": {
        "languages": ["English", "Polish", "German", "Spanish", "French",
                      "Italian", "Dutch", "Portuguese", "SimpChinese",
                      "Japanese", "Korean", "Russian"],
        "displayLanguageSelector": true
      }
    }
  }
}
```

### 9.6 Translation Workflow for Contributors
1. Copy `web-nodejs/lang/en.json` → `web-nodejs/lang/{code}.json`
2. Copy `betterdesk-client/src/locales/en.json` → `betterdesk-client/src/locales/{code}.json`
3. Translate all values (keep keys in English)
4. Run `npm run i18n:check` to verify 100% coverage
5. Submit PR with both console + client translations
6. CI validates: no missing keys, valid JSON, no duplicate keys

---

## Priority Summary

| Phase | Name | Estimated Time | Priority |
|-------|------|---------------|----------|
| **0** | Bug Fixes + Code Cleanup | 1-2 days | 🔴 Immediate |
| **1** | Organizations + User Accounts | 1-2 weeks | 🔴 Critical |
| **2** | Chat 2.0 (Encrypted) | 1 week | 🟡 High |
| **3** | Web Remote Client (Full) | 2 weeks | 🔴 Critical |
| **4** | Background Client + Security | 1 week | 🔴 Critical |
| **5** | Fleet Management | 2-3 weeks | 🟡 High |
| **6** | Distributed Scaling | 2 weeks | 🟢 Medium |
| **7** | Cross-Platform | 3-4 weeks | 🟢 Medium |
| **8** | Security Hardening | Ongoing | 🔴 Continuous |
| **9** | Internationalization | 1-2 weeks | 🟡 High |

**Total estimated timeline:** ~14-18 weeks for all phases (parallel work possible on independent phases).

---

## Additional Enhancement Ideas

| # | Idea | Phase | Description |
|---|------|-------|-------------|
| 1 | **Wake-on-LAN** | 6 | Operator wakes powered-off computer via relay node on same LAN |
| 2 | **Remote Print** | 5 | Print document from panel on printer connected to remote device |
| 3 | **Asset QR Codes** | 5 | Each device gets a QR code. Phone scan → opens device panel page |
| 4 | **Maintenance Windows** | 5 | "Every Saturday 22:00-06:00 = service window". Auto-restart, updates |
| 5 | **Dashboard KPIs** | 5 | Uptime SLA per org, avg operator response time, sessions/day graphs |
| 6 | **Plugin System** | 5 | Third-party plugins for visual task builder (JIRA, ServiceNow, Slack) |
| 7 | **Emergency Broadcast** | 2 | Send message to ALL device screens in org (security alert, evacuation) |
| 8 | **Geo Map View** | 6 | World map showing device locations by building/office |
| 9 | **Bandwidth Monitor** | 6 | Per-device network usage tracking and alerts |
| 10 | **Auto-Scaling Relay** | 6 | Spin up cloud relay nodes automatically when load exceeds threshold |

---

## Long-Term Vision (v4.0)

BetterDesk as a Linux-native domain controller alternative:
- Deep OS integration via BetterDesk SDK/agent
- Group Policy equivalent for Linux (pushed via agent)
- User provisioning across fleet (create Linux users on 500 machines in one click)
- Centralized authentication (BetterDesk as identity provider, LDAP/SAML bridge)
- Package management across fleet (apt/dnf/pacman unified)
- Kernel-level integration for maximum security and performance

---

*Last updated: 2026-03-25 by GitHub Copilot*
