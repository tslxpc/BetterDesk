# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [3.0.0-alpha] — 2026-04-01

### Added
- **Organization & User Account System** — Multi-tenant organizations with owner/admin/operator/user roles (Go server + Node.js panel)
- **Organization REST API** — 18 endpoints for CRUD orgs, users, devices, invitations, settings, login
- **Client Organization Login** — `OrgLoginPanel.tsx` with server address + username/password
- **mDNS/DNS-SD Discovery** — Auto-discover BetterDesk servers on LAN (`_betterdesk._tcp`)
- **Desktop Widget UI Overhaul** — New window management, taskbar redesign, wallpaper picker with tabs
- **6 New Console Languages** — German, Spanish, French, Italian, Dutch, Portuguese
- **3 High-Priority Languages** — Japanese, Korean, Russian
- **Desktop Client i18n Framework** — `src/lib/i18n.ts` with `t()` function, plural forms, locale detection
- **NSIS Multilingual Installer** — 12 languages in NSIS language selector
- **Light Theme** — `themes/light.json` with WCAG-compliant light colors
- **Theme API** — `GET /api/settings/themes`, `POST /api/settings/themes/:id/apply`
- **Page Transition Animations** — `transitions.css` with page enter/exit, stagger, skeleton loading
- **i18n Check Script** — `npm run i18n:check` / `npm run i18n:fix` for language coverage auditing
- **GitHub Actions: Client Releases** — Multi-platform Tauri builds (Windows/Linux/macOS)
- **GitHub Actions: Server Releases** — Go cross-compile (linux-amd64/arm64, windows-amd64)
- **Security Documentation** — THREAT_MODEL.md, ENCRYPTION_SPEC.md, COMPLIANCE.md, AUDIT_LOG.md
- **Responsible Disclosure Policy** — `.github/SECURITY.md`
- **Web Remote Toolbar** — Scale mode selector, monitor switcher, clipboard sync, special keys menu
- **Fullscreen Mode** — F11 keyboard shortcut + button toggle
- **Bidirectional Clipboard** — `navigator.clipboard` API integration in remote viewer
- **Special Keys Menu** — Ctrl+Alt+Del, Win, PrintScreen, Alt+Tab, Alt+F4, Task Manager
- **Beta Banner** — Replaced WIP banner with slim dismissible beta indicator

### Changed
- **CSP Headers Hardened** — Added `frame-ancestors`, `worker-src`, `child-src`; expanded Permissions-Policy
- **X-Frame-Options** — Changed from `DENY` to `SAMEORIGIN` for desktop widget embed mode
- **WebSocket CSP** — Added `ws:` to `connect-src` for HTTP mode (was missing)
- **Cross-Origin Resource Policy** — Enabled `same-origin` (was disabled)

### Fixed
- **Chat: Tray opens wrong window** — Tray "Chat" now opens dedicated chat WebviewWindow directly
- **Chat: Shows "Disconnected"** — WebSocket URL now uses dynamic `ws://`/`wss://` based on console_url
- **Rust warnings** — All 10 compilation warnings fixed (unused imports, variables, labels)
- **Go warnings** — `go vet` clean, 0 issues

---

## [2.4.0] — 2026-03-21

### Added
- **PostgreSQL Support** — Full PostgreSQL database backend for Go server and Node.js console
- **SQLite → PostgreSQL Migration** — Built-in migration tool (menu option M/P)
- **CDAP v0.3.0** — Widget rendering, device detail page, REST API, 8 widget types
- **Native BetterDesk Agent** — Go binary for system management, 14 flags, 9 widgets
- **Bridge SDK** — Python + Node.js SDKs for CDAP bridges (Modbus, SNMP, REST)
- **Device Revocation** — `DELETE /api/peers/{id}?revoke=true&cascade=true`
- **Peer Metrics** — `peer_metrics` table, `GET /api/peers/{id}/metrics`
- **CDAP Audio** — Bidirectional audio streaming via WebSocket
- **Devices Page Redesign** — Horizontal folder chips, kebab menu, responsive layout
- **Docker GHCR** — Pre-built images on GitHub Container Registry

### Fixed
- **Empty UUID in Relay** — Generate UUID when `RequestRelay{uuid=""}` received
- **ForceRelay TCP UUID Mismatch** — Return `PunchHoleResponse` instead of `RelayResponse`
- **Docker Port 5000 Conflict** — Added `SIGNAL_PORT` env var, priority over `PORT`
- **PS1 RandomNumberGenerator Crash** — Replaced .NET 6+ method with .NET 4.x compatible
- **API TLS Breaking Clients** — Separated `--tls-api` flag from signal/relay TLS
- **PostgreSQL Config Lost on Update** — Added `preserve_database_config()` function
- **Auth.db Destroyed on Update** — Detect existing `.env` as UPDATE indicator
- **Address Book Sync** — Real `address_books` table replacing stub handlers
- **Settings Password** — Fixed snake_case vs camelCase field name mismatch

---

## [2.3.0] — 2026-02-17

### Added
- **CSRF Protection** — Double-submit cookie pattern with `csrf-csrf`
- **TOTP 2FA** — Two-factor authentication with `otplib`
- **RustDesk Client API** — Dedicated WAN-facing port 21121 with 7-layer security
- **Address Book Sync** — Full AB storage with `address_books` table
- **Operator Role** — Admin/operator role separation with different permissions
- **SSL Certificate Configuration** — New menu option C in installer scripts
- **Desktop Connect Button** — Connect to devices from browser via RustDesk URI handler

### Fixed
- **Session Fixation** — Session regeneration after login
- **Timing-Safe Auth** — Pre-computed dummy bcrypt hash for non-existent users
- **WebSocket Auth** — Session cookie required for upgrade
- **Web Remote Client** — 5 Critical, 2 High, 3 Low bugs fixed

---

## [2.2.0] — 2026-02-06

### Added
- **Node.js Console** — Express.js web console replacing Flask
- **Migration Tool** — Migrate between console types
- **Automatic Node.js Installation** — Installer detects and installs Node.js

---

## [2.1.0] — 2026-02-04

### Added
- **Go Server** — Single binary replacing hbbs + hbbr (~20K LOC)
- **ALL-IN-ONE Scripts** — `betterdesk.sh` + `betterdesk.ps1` + `betterdesk-docker.sh`
- **Automatic Mode** — `--auto` flag for non-interactive installation
- **SHA256 Verification** — Automatic checksum verification of binaries

---

[3.0.0-alpha]: https://github.com/UNITRONIX/BetterDesk/compare/v2.4.0...HEAD
[2.4.0]: https://github.com/UNITRONIX/BetterDesk/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/UNITRONIX/BetterDesk/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/UNITRONIX/BetterDesk/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/UNITRONIX/BetterDesk/releases/tag/v2.1.0
