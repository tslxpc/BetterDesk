import { createSignal } from "solid-js";
import { api, type Settings } from "../lib/tauri";

function createSettingsStore() {
  const [settings, setSettings] = createSignal<Settings | null>(null);
  const [loading, setLoading] = createSignal(false);

  return {
    settings,
    loading,

    async load() {
      setLoading(true);
      try {
        const config = await api.getConfig();
        setSettings(config);
      } catch (e) {
        console.error("Failed to load settings:", e);
        // Set defaults for browser dev mode
        setSettings({
          server_address: "",
          relay_address: "",
          server_key: "",
          api_port: 21114,
          rustdesk_compat: true,
          native_protocol: true,
          force_relay: true,
          preferred_codec: "auto",
          max_fps: 30,
          image_quality: 0,
          disable_audio: false,
          language: "en",
          theme: "dark",
          start_minimized: false,
          run_as_service: false,
          device_password: "",
          pinned_certificates: [],
          console_url: "",
          access_token: null,
        });
      } finally {
        setLoading(false);
      }
    },

    async save(newSettings: Settings) {
      try {
        await api.saveConfig(newSettings);
        setSettings(newSettings);
      } catch (e) {
        console.error("Failed to save settings:", e);
        throw e;
      }
    },
  };
}

export const settingsStore = createSettingsStore();
