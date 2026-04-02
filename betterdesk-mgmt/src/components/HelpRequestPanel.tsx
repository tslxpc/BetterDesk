import { Component, createSignal, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../lib/i18n";

interface Branding {
  company_name: string;
  accent_color: string;
  support_contact: string;
}

interface HelpResponse {
  success: boolean;
  request_id: string;
}

const HelpRequestPanel: Component = () => {
  const [message, setMessage] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [sent, setSent] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [branding, setBranding] = createSignal<Branding | null>(null);

  // Load branding on mount for support contact info
  (async () => {
    try {
      const b = await invoke<Branding>("get_branding");
      setBranding(b);
    } catch (_) {}
  })();

  const handleSend = async () => {
    const text = message().trim();
    if (!text || sending()) return;

    setSending(true);
    setError(null);

    try {
      await invoke<HelpResponse>("request_help", { message: text });
      setSent(true);
      setMessage("");
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSending(false);
    }
  };

  const handleReset = () => {
    setSent(false);
    setError(null);
    setMessage("");
  };

  return (
    <div class="help-request-panel">
      <div class="panel-header">
        <h1>{t('help.request')}</h1>
        <p class="subtitle">{t('help.description')}</p>
      </div>

      <Show when={!sent()} fallback={
        <div class="help-success">
          <div class="help-success-icon">
            <span class="mi" style="font-size:48px;color:var(--success)">check_circle</span>
          </div>
          <h2>{t('common.success')}</h2>
          <p class="text-secondary">
            An operator has been notified and will assist you shortly.
          </p>
          <Show when={branding()?.support_contact}>
            <p class="support-contact">
              You can also reach support at: <strong>{branding()!.support_contact}</strong>
            </p>
          </Show>
          <button class="btn-secondary" onClick={handleReset} style="margin-top: 24px">
            Send Another Request
          </button>
        </div>
      }>
        <div class="help-form">
          <Show when={branding()?.support_contact}>
            <div class="help-contact-card">
              <span class="mi mi-sm">call</span>
              <span>Direct support: <strong>{branding()!.support_contact}</strong></span>
            </div>
          </Show>

          <div class="help-message-section">
            <label for="help-message">Describe your issue</label>
            <textarea
              id="help-message"
              class="help-textarea"
              rows={5}
              placeholder="What do you need help with?"
              value={message()}
              onInput={(e) => setMessage(e.currentTarget.value)}
              disabled={sending()}
              maxLength={500}
            />
            <div class="help-char-count">
              <span class={message().length >= 450 ? "text-warning" : ""}>{message().length}</span> / 500
            </div>
          </div>

          <Show when={error()}>
            <div class="help-error">
              <span class="mi mi-sm">error</span>
              <span>{error()}</span>
            </div>
          </Show>

          <button
            class="btn-primary help-send-btn"
            onClick={handleSend}
            disabled={!message().trim() || sending()}
          >
            <Show when={sending()} fallback={
              <>
                <span class="mi mi-sm">send</span>
                {t('help.submit')}
              </>
            }>
              <span class="spinner" />
              Sending...
            </Show>
          </button>
        </div>
      </Show>
    </div>
  );
};

export default HelpRequestPanel;
