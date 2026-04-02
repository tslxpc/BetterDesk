import {
  Component,
  createSignal,
  onMount,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t } from "../lib/i18n";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

interface Notification {
  id: string;
  type: "help_request" | "alert" | "connection" | "system" | "chat";
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  device_id?: string;
  action?: string;
}

// ---------------------------------------------------------------------------
//  Component
// ---------------------------------------------------------------------------

const NotificationCenter: Component = () => {
  const [notifications, setNotifications] = createSignal<Notification[]>([]);
  const [filter, setFilter] = createSignal<string>("all");
  const [loading, setLoading] = createSignal(true);

  const unreadCount = () => notifications().filter((n) => !n.read).length;

  const filteredNotifications = () => {
    const f = filter();
    const all = notifications();
    if (f === "all") return all;
    if (f === "unread") return all.filter((n) => !n.read);
    return all.filter((n) => n.type === f);
  };

  const fetchNotifications = async () => {
    try {
      const data = await invoke<Notification[]>("get_notifications");
      setNotifications(data);
    } catch (_) {
      // Fallback: empty list on error
    }
    setLoading(false);
  };

  const markRead = async (id: string) => {
    try {
      await invoke("mark_notification_read", { notifId: id });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch (_) {}
  };

  const markAllRead = async () => {
    try {
      await invoke("mark_all_notifications_read");
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (_) {}
  };

  const dismissNotification = async (id: string) => {
    try {
      await invoke("dismiss_notification", { notifId: id });
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch (_) {}
  };

  const getIcon = (type: string): string => {
    switch (type) {
      case "help_request": return "help";
      case "alert": return "warning";
      case "connection": return "link";
      case "system": return "info";
      case "chat": return "chat";
      default: return "notifications";
    }
  };

  const getTypeClass = (type: string): string => {
    switch (type) {
      case "help_request": return "notif--help";
      case "alert": return "notif--alert";
      case "connection": return "notif--connection";
      case "system": return "notif--system";
      case "chat": return "notif--chat";
      default: return "";
    }
  };

  const formatTime = (ts: number): string => {
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return t("notif.just_now");
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return new Date(ts).toLocaleDateString();
  };

  onMount(async () => {
    await fetchNotifications();

    // Listen for real-time notifications
    const unlisten = await listen<Notification>("notification-push", (event) => {
      setNotifications((prev) => [event.payload, ...prev]);
    });

    // Refresh every 30s
    const interval = setInterval(fetchNotifications, 30000);

    onCleanup(() => {
      unlisten();
      clearInterval(interval);
    });
  });

  return (
    <div class="panel notification-panel">
      <div class="panel-header">
        <h2>
          <span class="mi">notifications</span>
          {t("notif.title")}
          <Show when={unreadCount() > 0}>
            <span class="header-badge">{unreadCount()}</span>
          </Show>
        </h2>
        <Show when={unreadCount() > 0}>
          <button class="btn btn-sm btn-ghost" onClick={markAllRead}>
            <span class="mi">done_all</span>
            {t("notif.mark_all_read")}
          </button>
        </Show>
      </div>

      <div class="filter-bar">
        <For each={["all", "unread", "help_request", "alert", "connection", "system", "chat"]}>
          {(f) => (
            <button
              class={`filter-chip ${filter() === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {t(`notif.filter_${f}`)}
            </button>
          )}
        </For>
      </div>

      <div class="panel-body">
        <Show when={!loading()} fallback={<div class="loading-state">{t("common.loading")}</div>}>
          <Show when={filteredNotifications().length > 0} fallback={
            <div class="empty-state">
              <span class="mi mi-lg">notifications_off</span>
              <p>{t("notif.empty")}</p>
            </div>
          }>
            <div class="notification-list">
              <For each={filteredNotifications()}>
                {(notif) => (
                  <div
                    class={`notification-item ${getTypeClass(notif.type)} ${!notif.read ? "unread" : ""}`}
                    onClick={() => markRead(notif.id)}
                  >
                    <div class="notif-icon">
                      <span class="mi">{getIcon(notif.type)}</span>
                    </div>
                    <div class="notif-content">
                      <div class="notif-title">{notif.title}</div>
                      <div class="notif-message">{notif.message}</div>
                      <div class="notif-meta">
                        <span class="notif-time">{formatTime(notif.timestamp)}</span>
                        {notif.device_id && (
                          <span class="notif-device">{notif.device_id}</span>
                        )}
                      </div>
                    </div>
                    <button
                      class="notif-dismiss"
                      onClick={(e) => {
                        e.stopPropagation();
                        dismissNotification(notif.id);
                      }}
                    >
                      <span class="mi">close</span>
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default NotificationCenter;
