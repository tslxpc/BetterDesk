import { Component, createSignal, onMount, onCleanup, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t, onLocaleChange } from "../lib/i18n";
import { operatorStore } from "../stores/operator";
import bdIcon from "../assets/bd-icon.png";

interface TreeNode {
  id: string;
  label: string;
  icon?: string;
  href?: string;
  badge?: number;
  badgeType?: "info" | "warning" | "danger";
  indicator?: boolean;
  adminOnly?: boolean;
  children?: TreeNode[];
  action?: () => void;
}

interface SidebarProps {
  currentPath: string;
}

const Sidebar: Component<SidebarProps> = (props) => {
  const isActive = (path: string) => props.currentPath === path;
  const [chatUnread, setChatUnread] = createSignal(0);
  const [isAdmin, setIsAdmin] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({});
  const [search, setSearch] = createSignal("");
  const [, setLocaleVersion] = createSignal(0);
  const [deviceCounts, setDeviceCounts] = createSignal({ total: 0, online: 0, offline: 0 });

  const toggle = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const isCollapsed = (id: string) => collapsed()[id] ?? false;

  onMount(async () => {
    const unsubLocale = onLocaleChange(() => setLocaleVersion((v) => v + 1));

    try {
      const admin = await invoke<boolean>("is_admin");
      setIsAdmin(admin);
    } catch (_) {}

    const unsubChat = await listen<number>("chat-unread", (event) => {
      setChatUnread(event.payload);
    });

    const poll = setInterval(async () => {
      try {
        const s = await invoke<{ unread_count: number }>("get_chat_status");
        setChatUnread(s.unread_count);
      } catch (_) {}
    }, 30000);

    const devicePoll = setInterval(async () => {
      try {
        const devs = await invoke<any[]>("operator_get_devices");
        if (Array.isArray(devs)) {
          const online = devs.filter((d: any) => d.online).length;
          setDeviceCounts({ total: devs.length, online, offline: devs.length - online });
        }
      } catch (_) {}
    }, 15000);

    onCleanup(() => {
      unsubLocale();
      unsubChat();
      clearInterval(poll);
      clearInterval(devicePoll);
    });
  });

  const treeData = (): TreeNode[] => [
    {
      id: "overview",
      label: t("sidebar.overview"),
      icon: "dashboard",
      children: [
        { id: "dashboard", label: t("sidebar.dashboard"), icon: "space_dashboard", href: "/" },
        { id: "connection", label: t("sidebar.connection"), icon: "desktop_windows", href: "/connection" },
        { id: "notifications", label: t("sidebar.notifications"), icon: "notifications", href: "/notifications" },
      ],
    },
    {
      id: "remote",
      label: t("sidebar.remote_access"),
      icon: "connected_tv",
      children: [
        { id: "operator", label: t("sidebar.operator"), icon: "support_agent", href: "/operator", indicator: operatorStore.isLoggedIn },
        { id: "remote-desktop", label: t("sidebar.remote"), icon: "screen_share", href: "/remote" },
        {
          id: "chat",
          label: t("sidebar.chat"),
          icon: "chat",
          badge: chatUnread(),
          badgeType: "info" as const,
          action: () => invoke("open_chat_window").catch(() => {}),
        },
        { id: "help-request", label: t("sidebar.help"), icon: "help_center", href: "/help-request", badge: operatorStore.pendingHelpCount, badgeType: "warning" as const },
      ],
    },
    {
      id: "network",
      label: t("sidebar.network"),
      icon: "lan",
      children: [
        { id: "devices", label: t("sidebar.devices"), icon: "devices_other", href: "/inventory" },
        { id: "discovery", label: t("sidebar.discovery"), icon: "radar", href: "/discovery" },
        { id: "cdap", label: t("sidebar.cdap"), icon: "widgets", href: "/cdap" },
        { id: "org-login", label: t("sidebar.organizations"), icon: "corporate_fare", href: "/org-login" },
      ],
    },
    {
      id: "security",
      label: t("sidebar.security_tools"),
      icon: "shield",
      children: [
        { id: "dataguard", label: t("sidebar.dataguard"), icon: "security", href: "/dataguard" },
        { id: "automation", label: t("sidebar.automation"), icon: "smart_toy", href: "/automation" },
        { id: "activity", label: t("sidebar.activity"), icon: "history", href: "/activity" },
      ],
    },
    {
      id: "tools",
      label: t("sidebar.tools"),
      icon: "build",
      children: [
        { id: "files", label: t("sidebar.files"), icon: "folder_open", href: "/files" },
        ...(isAdmin()
          ? [
              { id: "management", label: t("sidebar.management"), icon: "admin_panel_settings", href: "/management", adminOnly: true },
              { id: "server", label: t("sidebar.server"), icon: "dns", href: "/server", adminOnly: true },
            ]
          : []),
      ],
    },
  ];

  const filterNodes = (nodes: TreeNode[], q: string): TreeNode[] => {
    if (!q) return nodes;
    const lq = q.toLowerCase();
    return nodes
      .map((node) => {
        if (node.children) {
          const filtered = node.children.filter((c) => c.label.toLowerCase().includes(lq));
          if (filtered.length > 0) return { ...node, children: filtered };
        }
        if (node.label.toLowerCase().includes(lq)) return node;
        return null;
      })
      .filter(Boolean) as TreeNode[];
  };

  const renderLeaf = (node: TreeNode) => {
    const isActiveNode = node.href ? isActive(node.href) : false;
    const cls = `nav-leaf ${isActiveNode ? "active" : ""}`;

    if (node.action) {
      return (
        <button class={cls} onClick={node.action}>
          <span class="mi mi-sm">{node.icon}</span>
          <span class="nav-leaf-label">{node.label}</span>
          {(node.badge ?? 0) > 0 && (
            <span class={`nav-badge nav-badge--${node.badgeType || "info"}`}>
              {(node.badge ?? 0) > 99 ? "99+" : node.badge}
            </span>
          )}
        </button>
      );
    }

    return (
      <A href={node.href || "/"} class={cls}>
        <span class="mi mi-sm">{node.icon}</span>
        <span class="nav-leaf-label">{node.label}</span>
        {node.indicator && <span class="nav-indicator nav-indicator--active" />}
        {(node.badge ?? 0) > 0 && (
          <span class={`nav-badge nav-badge--${node.badgeType || "info"}`}>
            {(node.badge ?? 0) > 99 ? "99+" : node.badge}
          </span>
        )}
        {node.adminOnly && <span class="mi mi-sm nav-admin-icon">shield_person</span>}
      </A>
    );
  };

  return (
    <nav class="sidebar">
      {/* Brand */}
      <div class="sidebar-brand">
        <img src={bdIcon} alt="BD" class="brand-icon" width="28" height="28" />
        <span class="brand-text">BetterDesk</span>
        <span class="brand-badge">MGMT</span>
      </div>

      {/* Search */}
      <div class="sidebar-search">
        <span class="mi mi-sm search-icon">search</span>
        <input
          type="text"
          placeholder={t("common.search")}
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          class="search-input"
        />
      </div>

      {/* Device counter strip */}
      <div class="sidebar-status">
        <div class="status-item" title={t("sidebar.online_devices")}>
          <span class="status-dot status-dot--online" />
          <span>{deviceCounts().online}</span>
        </div>
        <div class="status-item" title={t("sidebar.offline_devices")}>
          <span class="status-dot status-dot--offline" />
          <span>{deviceCounts().offline}</span>
        </div>
        <div class="status-item status-total" title={t("sidebar.total_devices")}>
          <span class="mi mi-sm">devices</span>
          <span>{deviceCounts().total}</span>
        </div>
      </div>

      {/* Tree navigation */}
      <div class="sidebar-tree">
        <For each={filterNodes(treeData(), search())}>
          {(section) => (
            <div class="tree-section">
              <button
                class="tree-header"
                onClick={() => toggle(section.id)}
              >
                <span class={`mi mi-sm tree-chevron ${isCollapsed(section.id) ? "" : "expanded"}`}>
                  chevron_right
                </span>
                <span class="mi mi-sm tree-section-icon">{section.icon}</span>
                <span class="tree-section-label">{section.label}</span>
              </button>

              <Show when={!isCollapsed(section.id)}>
                <div class="tree-children">
                  <For each={section.children || []}>
                    {(child) => renderLeaf(child)}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>

      {/* Footer */}
      <div class="sidebar-footer">
        <A href="/settings" class={`nav-leaf settings-link ${isActive("/settings") ? "active" : ""}`}>
          <span class="mi mi-sm">settings</span>
          <span class="nav-leaf-label">{t("sidebar.settings")}</span>
        </A>
        <div class="version-info">MGMT v1.0.0</div>
      </div>
    </nav>
  );
};

export default Sidebar;
