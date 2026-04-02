import { Component, createSignal, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../lib/i18n";

const ORG_TOKEN_KEY = "betterdesk.org.token";
const ORG_ID_KEY = "betterdesk.org.id";
const ORG_USER_KEY = "betterdesk.org.user";

interface OrgUserInfo {
  username?: string;
  display_name?: string;
  role?: string;
}

interface StoredOrgSession {
  token: string;
  orgId: string;
  user: OrgUserInfo;
}

function deriveOrgApiUrl(config: any): string {
  const serverAddress = String(config?.server_address || "").trim();
  if (serverAddress) {
    const host = serverAddress.split(":")[0] || "localhost";
    return `http://${host}:21114`;
  }

  const consoleUrl = String(config?.console_url || "").trim();
  if (consoleUrl) {
    try {
      const parsed = new URL(consoleUrl.startsWith("http") ? consoleUrl : `http://${consoleUrl}`);
      return `${parsed.protocol}//${parsed.hostname}:21114`;
    } catch {
      return consoleUrl;
    }
  }

  return "";
}

/**
 * Organization Login Panel — allows users to log in to a BetterDesk organization.
 * 
 * Flow:
 * 1. Enter server address + organization slug
 * 2. Enter username + password
 * 3. On success: store JWT token + update display name for chat
 */
const OrgLoginPanel: Component = () => {
  const [serverUrl, setServerUrl] = createSignal("");
  const [orgSlug, setOrgSlug] = createSignal("");
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [loggedIn, setLoggedIn] = createSignal(false);
  const [userInfo, setUserInfo] = createSignal<OrgUserInfo | null>(null);

  onMount(async () => {
    try {
      const settings = await invoke<any>("get_config");
      const apiUrl = deriveOrgApiUrl(settings);
      if (apiUrl) {
        setServerUrl(apiUrl);
      }
    } catch {}

    try {
      const token = window.localStorage.getItem(ORG_TOKEN_KEY) || "";
      const orgId = window.localStorage.getItem(ORG_ID_KEY) || "";
      const rawUser = window.localStorage.getItem(ORG_USER_KEY) || "";

      if (token && orgId && rawUser) {
        const parsed = JSON.parse(rawUser) as OrgUserInfo;
        setUserInfo(parsed);
        setLoggedIn(true);
      }
    } catch {}
  });

  const handleLogin = async () => {
    setError("");
    if (!serverUrl() || !orgSlug() || !username() || !password()) {
      setError(t("org.all_fields_required"));
      return;
    }

    setLoading(true);
    try {
      const result = await invoke<any>("org_login", {
        serverUrl: serverUrl(),
        orgSlug: orgSlug(),
        username: username(),
        password: password(),
      });

      setUserInfo(result.user);
      setLoggedIn(true);

      try {
        const stored: StoredOrgSession = {
          token: String(result.token || ""),
          orgId: String(result.org_id || ""),
          user: result.user || {},
        };
        window.localStorage.setItem(ORG_TOKEN_KEY, stored.token);
        window.localStorage.setItem(ORG_ID_KEY, stored.orgId);
        window.localStorage.setItem(ORG_USER_KEY, JSON.stringify(stored.user));
      } catch {}
    } catch (e: any) {
      setError(typeof e === "string" ? e : e?.message || t("org.login_failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") handleLogin();
  };

  const handleLogout = () => {
    setLoggedIn(false);
    setUserInfo(null);
    setPassword("");
    try {
      window.localStorage.removeItem(ORG_TOKEN_KEY);
      window.localStorage.removeItem(ORG_ID_KEY);
      window.localStorage.removeItem(ORG_USER_KEY);
    } catch {}
  };

  return (
    <div class="org-login-panel">
      <Show
        when={!loggedIn()}
        fallback={
          <div class="org-login-success">
            <div class="org-login-avatar">
              <span class="material-icons" style="font-size:48px">account_circle</span>
            </div>
            <h2>{t("org.logged_in")}</h2>
            <p class="org-login-user-name">{userInfo()?.display_name || userInfo()?.username}</p>
            <p class="org-login-user-role">
              {t("org.role")}: <strong>{userInfo()?.role}</strong>
            </p>
            <button class="btn btn-secondary" onClick={handleLogout}>
              <span class="material-icons">logout</span> {t("org.logout")}
            </button>
          </div>
        }
      >
        <div class="org-login-card">
          <div class="org-login-header">
            <span class="material-icons" style="font-size:36px;color:var(--bd-accent,#4f6ef7)">corporate_fare</span>
            <h2>{t("org.login_title")}</h2>
            <p>{t("org.subtitle")}</p>
          </div>

          <Show when={error()}>
            <div class="org-login-error">
              <span class="material-icons">error_outline</span>
              {error()}
            </div>
          </Show>

          <div class="org-login-form">
            <div class="form-group">
              <label>{t("org.server_address")}</label>
              <input
                type="text"
                value={serverUrl()}
                onInput={(e) => setServerUrl(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("org.server_placeholder")}
                disabled={loading()}
              />
            </div>
            <div class="form-group">
              <label>{t("org.organization")}</label>
              <input
                type="text"
                value={orgSlug()}
                onInput={(e) => setOrgSlug(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("org.organization_placeholder")}
                disabled={loading()}
              />
            </div>
            <div class="form-group">
              <label>{t("org.username")}</label>
              <input
                type="text"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("org.username_placeholder")}
                disabled={loading()}
              />
            </div>
            <div class="form-group">
              <label>{t("org.password")}</label>
              <input
                type="password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("org.password_placeholder")}
                disabled={loading()}
              />
            </div>
            <button
              class="btn btn-primary btn-full"
              onClick={handleLogin}
              disabled={loading()}
            >
              {loading() ? t("org.signing_in") : t("org.sign_in")}
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default OrgLoginPanel;
