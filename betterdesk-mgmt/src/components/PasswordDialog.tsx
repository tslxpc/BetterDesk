import { Component, createSignal, onMount } from "solid-js";
import { t } from "../lib/i18n";

interface PasswordDialogProps {
  peerId: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

const PasswordDialog: Component<PasswordDialogProps> = (props) => {
  const [password, setPassword] = createSignal("");
  const [showPassword, setShowPassword] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    inputRef?.focus();
  });

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const pw = password().trim();
    if (pw) {
      props.onSubmit(pw);
    }
  };

  return (
    <div class="dialog-overlay" onClick={props.onCancel}>
      <div class="dialog" onClick={(e) => e.stopPropagation()}>
        <div class="dialog-header">
          <h2>{t('auth.required')}</h2>
          <p>{t('auth.enter_password', { id: props.peerId })}</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div class="dialog-body">
            <div class="input-group">
              <input
                ref={inputRef}
                type={showPassword() ? "text" : "password"}
                placeholder={t('auth.login')}
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                class="dialog-input"
                autocomplete="off"
              />
              <button
                type="button"
                class="btn-icon toggle-password"
                onClick={() => setShowPassword(!showPassword())}
                title={showPassword() ? t('auth.hide_password') : t('auth.show_password')}
              >
                <span class="mi mi-sm">{showPassword() ? "visibility_off" : "visibility"}</span>
              </button>
            </div>
          </div>

          <div class="dialog-footer">
            <button type="button" class="btn-secondary" onClick={props.onCancel}>
              {t('common.cancel')}
            </button>
            <button type="submit" class="btn-primary" disabled={!password().trim()}>
              {t('auth.login')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PasswordDialog;
