import { Component, createSignal, onMount, onCleanup, Show } from "solid-js";
import { Router, Route, useNavigate } from "@solidjs/router";
import StatusPanel from "./components/StatusPanel";
import SetupWizard from "./components/SetupWizard";
import ChatPanel from "./components/ChatPanel";
import HelpRequest from "./components/HelpRequest";
import SettingsPanel from "./components/SettingsPanel";
import AdminRequired from "./components/AdminRequired";
import { initI18n } from "./lib/i18n";
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

const App: Component = () => {
  const [ready, setReady] = createSignal(false);
  const [registered, setRegistered] = createSignal(false);
  const [isAdmin, setIsAdmin] = createSignal(false);

  onMount(async () => {
    await initI18n();
    try {
      const status = await invoke<{ registered: boolean }>("get_agent_status");
      setRegistered(status.registered);
    } catch {
      setRegistered(false);
    }
    try {
      const admin = await invoke<boolean>("is_os_admin");
      setIsAdmin(admin);
    } catch {
      setIsAdmin(false);
    }
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
          fallback={<SetupWizard onComplete={() => setRegistered(true)} />}
        >
          <div class="app-layout app-layout-tray">
            <main class="app-main app-main-full">
              <Router>
                <NavigationListener />
                <Route path="/" component={StatusPanel} />
                <Route path="/chat" component={ChatPanel} />
                <Route path="/help" component={HelpRequest} />
                <Route
                  path="/settings"
                  component={() =>
                    isAdmin() ? <SettingsPanel /> : <AdminRequired />
                  }
                />
              </Router>
            </main>
          </div>
        </Show>
      </Show>
    </div>
  );
};

export default App;
