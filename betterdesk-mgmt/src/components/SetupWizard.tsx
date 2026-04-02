import { Component, Show, createSignal, createEffect, onCleanup, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { settingsStore } from "../stores/settings";
import { t } from "../lib/i18n";
import type { RegistrationStatus, BrandingConfig } from "../lib/tauri";

type WizardStep = "address" | "connecting" | "pending" | "syncing" | "ready";

const SetupWizard: Component<{ onComplete: () => void }> = (props) => {
  const [step, setStep] = createSignal<WizardStep>("address");
  const [address, setAddress] = createSignal("");
  const [error, setError] = createSignal("");
  const [branding, setBranding] = createSignal<BrandingConfig | null>(null);
  const [syncMode, setSyncMode] = createSignal<string | null>(null);
  const [displayName, setDisplayName] = createSignal<string | null>(null);
  const [enrollPhase, setEnrollPhase] = createSignal("");
  const [dots, setDots] = createSignal("");

  let pollTimer: ReturnType<typeof setInterval> | undefined;

  // Animated dots for loading states
  createEffect(() => {
    const s = step();
    if (s === "connecting" || s === "pending" || s === "syncing") {
      const iv = setInterval(() => {
        setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
      }, 500);
      onCleanup(() => clearInterval(iv));
    }
  });

  // Poll registration status while connecting/pending/syncing
  createEffect(() => {
    const s = step();
    if (s === "connecting" || s === "pending" || s === "syncing") {
      pollTimer = setInterval(async () => {
        try {
          const status = await invoke<RegistrationStatus>("get_registration_status");
          setEnrollPhase(status.enrollment_phase || "");

          if (status.branding) {
            setBranding(status.branding);
            applyBranding(status.branding);
          }
          if (status.sync_mode) setSyncMode(status.sync_mode);
          if (status.display_name) setDisplayName(status.display_name);

          const phase = status.enrollment_phase || "";

          if (phase === "Approved" || phase === "Syncing") {
            setStep("syncing");
          }
          if (phase === "Active") {
            setStep("ready");
            clearInterval(pollTimer);
            // Auto-proceed after brief celebration
            setTimeout(() => props.onComplete(), 2000);
          }
          if (phase === "Rejected") {
            setError("Enrollment rejected by operator");
            setStep("address");
            clearInterval(pollTimer);
          }
          if (phase === "Error") {
            setError(status.last_error || "Connection failed");
            setStep("address");
            clearInterval(pollTimer);
          }
        } catch (e) {
          console.error("Poll failed:", e);
        }
      }, 1500);

      onCleanup(() => {
        if (pollTimer) clearInterval(pollTimer);
      });
    }
  });

  const handleConnect = async () => {
    const addr = address().trim();
    if (!addr) {
      setError("Enter server address");
      return;
    }
    setError("");
    setStep("connecting");

    try {
      // Save server address + enable native protocol
      const currentSettings = settingsStore.settings();
      if (currentSettings) {
        const newSettings = {
          ...currentSettings,
          server_address: addr,
          native_protocol: true,
        };
        await invoke("save_config", { config: newSettings });
        await settingsStore.load();
      }

      // Start registration (which now enrolls with Go server)
      await invoke("start_registration");

      // The poll effect above will track progress
    } catch (e: any) {
      setError(e?.toString() || "Connection failed");
      setStep("address");
    }
  };

  const applyBranding = (b: BrandingConfig) => {
    if (b.accent_color) {
      document.documentElement.style.setProperty("--primary", b.accent_color);
    }
    if (b.colors) {
      for (const [key, value] of Object.entries(b.colors)) {
        document.documentElement.style.setProperty(`--${key}`, value);
      }
    }
  };

  return (
    <div class="wizard-overlay">
      <div class="wizard-card">
        {/* Logo */}
        <div class="wizard-logo">
          <span class="mi mi-lg" style="font-size: 48px; color: var(--primary)">
            devices
          </span>
        </div>

        <h1 class="wizard-title">
          {branding()?.company_name || "BetterDesk"}
        </h1>

        {/* Step: Enter Address */}
        <Show when={step() === "address"}>
          <p class="wizard-subtitle">{t('setup.enter_address')}</p>

          <div class="wizard-input-group">
            <input
              type="text"
              class="wizard-input"
              placeholder={t('setup.address_placeholder')}
              value={address()}
              onInput={(e) => setAddress(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              autofocus
            />
            <button class="wizard-btn-primary" onClick={handleConnect}>
              <span class="mi mi-sm">arrow_forward</span>
              {t('remote.connect')}
            </button>
          </div>

          <Show when={error()}>
            <div class="wizard-error">
              <span class="mi mi-sm">error</span>
              {error()}
            </div>
          </Show>
        </Show>

        {/* Step: Connecting */}
        <Show when={step() === "connecting"}>
          <div class="wizard-status connecting">
            <div class="wizard-spinner" />
            <p class="wizard-status-text">{t('setup.connecting_server')}{dots()}</p>
            <p class="wizard-status-detail">{t('setup.validating')}</p>
          </div>
        </Show>

        {/* Step: Pending Approval */}
        <Show when={step() === "pending"}>
          <div class="wizard-status pending">
            <div class="wizard-pulse" />
            <p class="wizard-status-text">{t('setup.waiting_approval')}{dots()}</p>
            <p class="wizard-status-detail">
              {t('setup.approval_detail')}
            </p>
          </div>
        </Show>

        {/* Step: Syncing */}
        <Show when={step() === "syncing"}>
          <div class="wizard-status syncing">
            <div class="wizard-spinner fast" />
            <p class="wizard-status-text">
              {syncMode() === "turbo" ? t('setup.turbo_sync') : t('setup.syncing')}{dots()}
            </p>
            <Show when={syncMode()}>
              <div class={`wizard-sync-badge ${syncMode()}`}>
                <span class="mi mi-sm">
                  {syncMode() === "turbo" ? "bolt" : syncMode() === "silent" ? "volume_off" : "sync"}
                </span>
                {syncMode()?.toUpperCase()} mode
              </div>
            </Show>
            <p class="wizard-status-detail">{t('setup.syncing_detail')}</p>
          </div>
        </Show>

        {/* Step: Ready */}
        <Show when={step() === "ready"}>
          <div class="wizard-status ready">
            <div class="wizard-check">
              <span class="mi" style="font-size: 48px">check_circle</span>
            </div>
            <p class="wizard-status-text">{t('setup.all_set')}</p>
            <Show when={displayName()}>
              <p class="wizard-status-detail">
                {t('setup.registered_as')} <strong>{displayName()}</strong>
              </p>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default SetupWizard;
