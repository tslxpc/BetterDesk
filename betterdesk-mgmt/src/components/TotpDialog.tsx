import { Component, createSignal, Show } from "solid-js";
import { t } from "../lib/i18n";

interface TotpDialogProps {
  onSubmit: (code: string) => void;
  onCancel: () => void;
  error?: string | null;
  loading?: boolean;
}

/**
 * TOTP 2FA verification dialog — shown after initial password
 * authentication when the operator account has 2FA enabled.
 */
const TotpDialog: Component<TotpDialogProps> = (props) => {
  const [code, setCode] = createSignal("");

  const handleSubmit = () => {
    const trimmed = code().replace(/\s/g, "");
    if (trimmed.length === 6 && /^\d{6}$/.test(trimmed)) {
      props.onSubmit(trimmed);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
    if (e.key === "Escape") props.onCancel();
  };

  const handleInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    // Allow only digits, max 6 characters
    const raw = e.currentTarget.value.replace(/\D/g, "").slice(0, 6);
    setCode(raw);
    e.currentTarget.value = raw;
  };

  return (
    <div class="totp-overlay">
      <div class="totp-dialog">
        <div class="totp-header">
          <span class="mi" style="font-size:36px;color:var(--primary)">security</span>
          <h2>{t('auth.totp_title')}</h2>
          <p class="text-secondary">
            {t('auth.totp_prompt')}
          </p>
        </div>

        <div class="totp-input-group">
          <input
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            class="totp-input"
            placeholder="000000"
            value={code()}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            maxLength={6}
            disabled={props.loading}
            autofocus
          />
        </div>

        <Show when={props.error}>
          <div class="totp-error">
            <span class="mi mi-sm">error</span>
            <span>{props.error}</span>
          </div>
        </Show>

        <div class="totp-actions">
          <button
            class="btn-secondary"
            onClick={props.onCancel}
            disabled={props.loading}
          >
            {t('common.cancel')}
          </button>
          <button
            class="btn-primary"
            onClick={handleSubmit}
            disabled={code().length !== 6 || props.loading}
          >
            <Show when={props.loading} fallback={t('auth.verify')}>
              <span class="spinner" />
              {t('auth.verifying')}
            </Show>
          </button>
        </div>
      </div>
    </div>
  );
};

export default TotpDialog;
