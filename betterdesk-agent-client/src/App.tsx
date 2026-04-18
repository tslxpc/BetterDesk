import { Component, createSignal, onMount, onCleanup, Show } from "solid-js";
import { Router, Route, useNavigate, useLocation } from "@solidjs/router";
import StatusPanel from "./components/StatusPanel";
import SetupWizard from "./components/SetupWizard";
import ChatPanel from "./components/ChatPanel";
import HelpRequest from "./components/HelpRequest";
import SettingsPanel from "./components/SettingsPanel";
import AdminRequired from "./components/AdminRequired";
import { initI18n, t } from "./lib/i18n";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Component that handles navigation events from the tray menu.
// Must be inside <Router> to access useNavigate().
const NavigationListener: Component = () => {
  const navigate = useNavigate();

  onMount(() => {
    const unlistenPromise = listen<string>("navigate", (event) => {
      try {
        const route = event.payload;
        if (typeof route === "string" && route.startsWith("/")) {
          navigate(route);
        }
      } catch {
        // Ignore malformed navigation payloads — safer to stay on current page.
      }
    });

    onCleanup(async () => {
      try {
        const un = await unlistenPromise;
        un();
      } catch {
        // Cleanup is best-effort on unmount.
      }
    });
  });

  return null;
};

// Bottom tab bar — provides in-app navigation for the small agent window.
const BottomNav: Component = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const tabs = [
    { path: "/", icon: "monitoring", label: () => t("sidebar.status") },
    { path: "/chat", icon: "chat", label: () => t("sidebar.chat") },
    { path: "/help", icon: "support_agent", label: () => t("sidebar.help") },
    { path: "/settings", icon: "settings", label: () => t("sidebar.settings") },
  ];

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  return (
    <nav class="bottom-nav">
      {tabs.map((tab) => (
        <button
          class={`bottom-nav-item ${isActive(tab.path) ? "active" : ""}`}
          onClick={() => navigate(tab.path)}
        >
          <span class="material-symbols-rounded">{tab.icon}</span>
          <span class="bottom-nav-label">{tab.label()}</span>
        </button>
      ))}
    </nav>
  );
};

const App: Component = () => {
  const [ready, setReady] = createSignal(false);
  const [registered, setRegistered] = createSignal(false);
  const [isAdmin, setIsAdmin] = createSignal(false);

  const checkRegistration = async (): Promise<boolean> => {
    try {
      // Hard 3-second timeout — the Tauri IPC round-trip should complete
      // in ~50 ms. If it hangs (webview/state-init issue, frozen config
      // lock, …) we still unblock the UI so the user can retry or
      // fall back to the setup wizard.
      const result = await Promise.race([
        invoke<{ registered: boolean }>("get_agent_status"),
        new Promise<{ registered: boolean } | null>((resolve) =>
          setTimeout(() => resolve(null), 3000)
        ),
      ]);
      return !!(result && result.registered);
    } catch {
      return false;
    }
  };

  onMount(async () => {
    await initI18n();

    // Run both probes in parallel with a hard timeout so the spinner is
    // never stuck indefinitely.
    const [reg, admin] = await Promise.all([
      checkRegistration(),
      Promise.race([
        invoke<boolean>("is_os_admin").catch(() => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
      ]),
    ]);

    setRegistered(reg);
    setIsAdmin(admin);
    setReady(true);
  });

  return (
    <div class="app-root">
      <Show
        when={ready()}
        fallback={
          <div class="app-loading">
            <span class="material-symbols-rounded spin">sync</span>
          </div>
        }
      >
        <Show
          when={registered()}
          fallback={<SetupWizard onComplete={async () => {
            // Re-read persisted registration state from backend to ensure
            // the wizard does not reappear on next app launch.
            const ok = await checkRegistration();
            setRegistered(ok || true); // optimistic: show main even if backend hiccups
          }} />}
        >
          <div class="app-layout app-layout-tray">
            <Router>
              <NavigationListener />
              <main class="app-main app-main-full">
                <Route path="/" component={StatusPanel} />
                <Route path="/chat" component={ChatPanel} />
                <Route path="/help" component={HelpRequest} />
                <Route
                  path="/settings"
                  component={() =>
                    isAdmin() ? <SettingsPanel /> : <AdminRequired />
                  }
                />
              </main>
              <BottomNav />
            </Router>
          </div>
        </Show>
      </Show>
    </div>
  );
};

export default App;
