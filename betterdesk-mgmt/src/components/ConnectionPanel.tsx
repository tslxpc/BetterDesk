import { Component, Show, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { connectionStore } from "../stores/connection";
import { t } from "../lib/i18n";
import PasswordDialog from "./PasswordDialog";

const ConnectionPanel: Component = () => {
  const [peerId, setPeerId] = createSignal("");
  const [showPassword, setShowPassword] = createSignal(false);
  const navigate = useNavigate();

  const handleConnect = async () => {
    const id = peerId().trim();
    if (!id) return;

    try {
      await connectionStore.connect(id);
    } catch (e) {
      console.error("Connection failed:", e);
    }
  };

  const handlePasswordSubmit = async (password: string) => {
    setShowPassword(false);
    try {
      await connectionStore.authenticate(password);
      navigate("/remote");
    } catch (e) {
      console.error("Authentication failed:", e);
    }
  };

  // Watch for state changes that require password
  const needsPassword = () =>
    connectionStore.state().state === "authenticating";

  const reg = () => connectionStore.regStatus();

  return (
    <div class="connection-panel">
      <div class="panel-header">
        <h1>{t('remote.connect')}</h1>
        <p class="subtitle">{t('connection.connected_to', { name: '' }).replace(' ', '') || 'Connect to a remote device'}</p>
      </div>

      <div class="connect-form">
        <div class="device-id-section">
          <label for="device-id">{t('connection.device_id')}</label>
          <div class="device-id-display">
            <span class="device-id-value">
              {connectionStore.deviceId() || "Loading..."}
            </span>
            <span
              class={`reg-status-dot ${reg().registered ? "online" : "offline"}`}
              title={
                reg().registered
                  ? `Registered — ${reg().heartbeat_count} heartbeats`
                  : reg().last_error || "Not registered"
              }
            />
            <button
              class="btn-icon"
              title={t('common.copy')}
              onClick={() => {
                const id = connectionStore.deviceId();
                if (id) navigator.clipboard.writeText(id);
              }}
            >
              <span class="mi mi-sm">content_copy</span>
            </button>
          </div>

          {/* Registration status indicator */}
          <div class="reg-status-bar">
            <Show
              when={reg().registered}
              fallback={
                <span class="reg-status-text offline">
                  <Show when={reg().last_error} fallback={t('connection.connecting')}>
                    {reg().last_error}
                  </Show>
                </span>
              }
            >
              <span class="reg-status-text online">
                Online — {reg().server_address}
              </span>
            </Show>
          </div>
        </div>

        <div class="connect-section">
          <label for="peer-id">{t('remote.enter_id')}</label>
          <div class="connect-input-group">
            <input
              id="peer-id"
              type="text"
              placeholder={t('remote.enter_id')}
              value={peerId()}
              onInput={(e) => setPeerId(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConnect();
              }}
              maxLength={16}
              class="connect-input"
            />
            <button
              class="btn-primary"
              onClick={handleConnect}
              disabled={
                !peerId().trim() ||
                connectionStore.state().state === "connecting"
              }
            >
              <Show
                when={connectionStore.state().state !== "connecting"}
                fallback={<span class="spinner" />}
              >
                {t('remote.connect')}
              </Show>
            </button>
          </div>
        </div>

        <Show when={connectionStore.state().error}>
          <div class="error-banner">
            <span class="mi mi-sm">error</span>
            <span>{connectionStore.state().error}</span>
          </div>
        </Show>

        <Show when={connectionStore.state().state === "connected"}>
          <div class="success-banner">
            <span class="mi mi-sm">check_circle</span>
            <span>Connected to {connectionStore.state().peer_id}</span>
          </div>
        </Show>
      </div>

      <Show when={needsPassword()}>
        <PasswordDialog
          peerId={peerId()}
          onSubmit={handlePasswordSubmit}
          onCancel={() => connectionStore.disconnect()}
        />
      </Show>
    </div>
  );
};

export default ConnectionPanel;
