import { Component, createSignal, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { settingsStore } from "../stores/settings";
import { connectionStore } from "../stores/connection";
import { t, setLocale, getLocale, SUPPORTED_LOCALES } from "../lib/i18n";

type TestState = "idle" | "testing" | "success" | "error";

const SettingsPanel: Component = () => {
  const [serverAddress, setServerAddress] = createSignal("");
  const [serverKey, setServerKey] = createSignal("");
  const [consoleUrl, setConsoleUrl] = createSignal("");
  const [accessToken, setAccessToken] = createSignal("");
  const [nativeProtocol, setNativeProtocol] = createSignal(true);
  const [forceRelay, setForceRelay] = createSignal(false);
  const [imageQuality, setImageQuality] = createSignal(0);
  const [maxFps, setMaxFps] = createSignal(30);
  const [disableAudio, setDisableAudio] = createSignal(false);
  const [theme, setTheme] = createSignal("dark");
  const [language, setLanguage] = createSignal("en");
  const [saved, setSaved] = createSignal(false);
  const [isAdmin, setIsAdmin] = createSignal(false);
  const [elevating, setElevating] = createSignal(false);
  const [testState, setTestState] = createSignal<TestState>("idle");
  const [testError, setTestError] = createSignal("");

  onMount(async () => {
    try {
      const admin = await invoke<boolean>("is_admin");
      setIsAdmin(admin);
    } catch (_) {}

    const s = settingsStore.settings();
    if (s) {
      setServerAddress(s.server_address || "");
      setServerKey(s.server_key || "");
      setConsoleUrl(s.console_url || "");
      setAccessToken(s.access_token || "");
      setNativeProtocol(s.native_protocol ?? true);
      setForceRelay(s.force_relay || false);
      setImageQuality(s.image_quality || 0);
      setMaxFps(s.max_fps || 30);
      setDisableAudio(s.disable_audio || false);
      setTheme(s.theme || "dark");
      setLanguage(s.language || getLocale());
    }
  });

  const testConnection = async () => {
    const addr = serverAddress().trim();
    if (!addr) return;

    setTestState("testing");
    setTestError("");

    try {
      const fullAddr = addr.includes(":") ? addr : `${addr}:21116`;
      const effectiveConsole = consoleUrl().trim() || "";

      const result: any = await invoke("test_server_connection", {
        serverAddress: fullAddr,
        consoleUrl: effectiveConsole,
      });

      if (result.success) {
        setTestState("success");
        if (result.server_key && !serverKey()) {
          setServerKey(result.server_key);
        }
      } else {
        setTestState("error");
        setTestError(result.error || "Connection test failed");
      }
    } catch (e: any) {
      setTestState("error");
      setTestError(e.toString());
    }
  };

  const doElevate = async () => {
    setElevating(true);
    try {
      await invoke("elevate_restart");
    } catch (e: any) {
      setTestError(e.toString());
      setTestState("error");
      setElevating(false);
    }
  };

  const handleSave = async () => {
    if (!isAdmin()) {
      setTestError("Administrator privileges required to modify settings");
      setTestState("error");
      return;
    }

    await settingsStore.save({
      ...settingsStore.settings()!,
      server_address: serverAddress(),
      server_key: serverKey(),
      console_url: consoleUrl(),
      access_token: accessToken() || null,
      native_protocol: nativeProtocol(),
      force_relay: forceRelay(),
      image_quality: imageQuality(),
      max_fps: maxFps(),
      disable_audio: disableAudio(),
      theme: theme(),
      language: language(),
    });
    setSaved(true);
    setTestState("idle");
    setTimeout(() => setSaved(false), 2000);

    // Apply language change immediately
    await setLocale(language());

    if (serverAddress()) {
      await connectionStore.startRegistration();
    }
  };

  return (
    <div class="settings-panel">
      <div class="panel-header">
        <h1>
          {t('settings.title')}
          <Show when={!isAdmin()}>
            <span class="admin-badge" title="Administrator required">
              <span class="mi mi-sm">lock</span>
            </span>
          </Show>
        </h1>
        <p class="subtitle">{t('app.tagline')}</p>
      </div>

      {/* Full-page admin gate */}
      <Show when={!isAdmin()}>
        <div class="admin-gate">
          <div class="admin-gate-icon">
            <span class="mi" style="font-size:56px;color:var(--warning)">admin_panel_settings</span>
          </div>
          <h2>{t('auth.admin_required')}</h2>
          <p class="text-secondary">
            {t('auth.admin_detail')}
          </p>
          <button class="btn-primary elevation-btn-lg" onClick={doElevate} disabled={elevating()}>
            <Show when={!elevating()} fallback={<span class="spinner" />}>
              <span class="mi mi-sm">shield</span>
            </Show>
            <span>{elevating() ? t('auth.restarting_admin') : t('auth.restart_admin')}</span>
          </button>
          <Show when={testState() === "error"}>
            <div class="admin-gate-error">
              <span class="mi mi-sm">error</span>
              <span>{testError()}</span>
            </div>
          </Show>

          {/* Read-only summary of current settings */}
          <div class="settings-readonly-summary">
            <h3>Current Configuration</h3>
            <div class="readonly-row">
              <span class="readonly-label">Server</span>
              <span class="readonly-value">{serverAddress() || "Not configured"}</span>
            </div>
            <div class="readonly-row">
              <span class="readonly-label">Console</span>
              <span class="readonly-value">{consoleUrl() || "Not configured"}</span>
            </div>
            <div class="readonly-row">
              <span class="readonly-label">Protocol</span>
              <span class="readonly-value">{nativeProtocol() ? "BetterDesk Native" : "Legacy RustDesk"}</span>
            </div>
            <div class="readonly-row">
              <span class="readonly-label">Theme</span>
              <span class="readonly-value">{theme()}</span>
            </div>
          </div>
        </div>
      </Show>

      {/* Admin-only settings sections */}
      <Show when={isAdmin()}>
        <div class="settings-sections">
          {/* Server */}
          <section class="settings-section">
            <h2>Server</h2>
            <div class="setting-row">
              <label for="server-address">Server Address</label>
              <input
                id="server-address"
                type="text"
                placeholder="hostname:21116"
                value={serverAddress()}
                onInput={(e) => setServerAddress(e.currentTarget.value)}
                class="setting-input"
              />
            </div>
            <div class="setting-row">
              <label for="console-url">Console URL</label>
              <input
                id="console-url"
                type="text"
                placeholder="http://hostname:5000"
                value={consoleUrl()}
                onInput={(e) => setConsoleUrl(e.currentTarget.value)}
                class="setting-input"
              />
            </div>
            <div class="setting-row">
              <label for="access-token">Access Token</label>
              <input
                id="access-token"
                type="password"
                placeholder="Bearer token for API auth"
                value={accessToken()}
                onInput={(e) => setAccessToken(e.currentTarget.value)}
                class="setting-input"
              />
            </div>
            <div class="setting-row">
              <label for="server-key">Server Key</label>
              <input
                id="server-key"
                type="text"
                placeholder="Base64 public key"
                value={serverKey()}
                onInput={(e) => setServerKey(e.currentTarget.value)}
                class="setting-input"
              />
            </div>
            <div class="setting-row">
              <button
                class="btn-secondary"
                onClick={testConnection}
                disabled={!serverAddress().trim() || testState() === "testing"}
              >
                <Show when={testState() !== "testing"} fallback={<span class="spinner" />}>
                  Test Connection
                </Show>
              </button>
              <Show when={testState() === "success"}>
                <span class="save-feedback"><span class="mi mi-sm">check_circle</span> Server reachable</span>
              </Show>
              <Show when={testState() === "error"}>
                <span class="error-text">{testError()}</span>
              </Show>
            </div>
            <div class="setting-row">
              <label for="native-protocol">
                <input
                  id="native-protocol"
                  type="checkbox"
                  checked={nativeProtocol()}
                  onChange={(e) => setNativeProtocol(e.currentTarget.checked)}
                />
                <span>BetterDesk native protocol (HTTP + WebSocket)</span>
              </label>
            </div>
            <div class="setting-row">
              <label for="force-relay">
                <input
                  id="force-relay"
                  type="checkbox"
                  checked={forceRelay()}
                  onChange={(e) => setForceRelay(e.currentTarget.checked)}
                />
                <span>Force relay connection</span>
              </label>
            </div>
          </section>

          {/* Display */}
          <section class="settings-section">
            <h2>Display</h2>
            <div class="setting-row">
              <label for="image-quality">Image Quality</label>
              <select
                id="image-quality"
                value={imageQuality()}
                onChange={(e) => setImageQuality(parseInt(e.currentTarget.value))}
                class="setting-select"
              >
                <option value="0">Auto</option>
                <option value="1">Low</option>
                <option value="2">Balanced</option>
                <option value="3">Best</option>
              </select>
            </div>
            <div class="setting-row">
              <label for="max-fps">Max FPS</label>
              <div class="range-group">
                <input
                  id="max-fps"
                  type="range"
                  min="5"
                  max="60"
                  value={maxFps()}
                  onInput={(e) => setMaxFps(parseInt(e.currentTarget.value))}
                  class="setting-range"
                />
                <span class="range-value">{maxFps()}</span>
              </div>
            </div>
          </section>

          {/* Audio */}
          <section class="settings-section">
            <h2>Audio</h2>
            <div class="setting-row">
              <label for="disable-audio">
                <input
                  id="disable-audio"
                  type="checkbox"
                  checked={disableAudio()}
                  onChange={(e) => setDisableAudio(e.currentTarget.checked)}
                />
                <span>Disable audio</span>
              </label>
            </div>
          </section>

          {/* Appearance */}
          <section class="settings-section">
            <h2>{t('settings.display')}</h2>
            <div class="setting-row">
              <label for="language">{t('settings.language')}</label>
              <select
                id="language"
                value={language()}
                onChange={(e) => setLanguage(e.currentTarget.value)}
                class="setting-select"
              >
                {SUPPORTED_LOCALES.map((loc) => (
                  <option value={loc.code}>{loc.flag} {loc.name}</option>
                ))}
              </select>
            </div>
            <div class="setting-row">
              <label for="theme">{t('settings.theme')}</label>
              <select
                id="theme"
                value={theme()}
                onChange={(e) => setTheme(e.currentTarget.value)}
                class="setting-select"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </div>
          </section>
        </div>

        <div class="settings-actions">
          <button class="btn-primary" onClick={handleSave}>
            {t('settings.save')}
          </button>
          <Show when={saved()}>
            <span class="save-feedback">{t('settings.saved')}</span>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default SettingsPanel;
