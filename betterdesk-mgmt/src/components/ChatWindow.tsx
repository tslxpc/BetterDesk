import { Component, createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t } from "../lib/i18n";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: number;
  from: string;
  from_name?: string;
  to?: string;
  conversation_id: string;
  text: string;
  timestamp: number;
  read: boolean;
}

interface ChatContact {
  id: string;
  name: string;
  hostname: string;
  online: boolean;
  last_seen: number;
  unread: number;
  avatar_color: string;
  role?: string;
}

interface ChatGroup {
  id: string;
  name: string;
  members: string[];
  created_by: string;
  unread: number;
}

interface ChatStatus {
  connected: boolean;
  unread_count: number;
  messages: ChatMessage[];
  contacts?: ChatContact[];
  groups?: ChatGroup[];
}

type FilterMode = "all" | "support" | "users";

// ---------------------------------------------------------------------------
//  Component
// ---------------------------------------------------------------------------

const ChatWindow: Component = () => {
  const [status, setStatus] = createSignal<ChatStatus>({
    connected: false, unread_count: 0, messages: [], contacts: [], groups: [],
  });
  const [contacts, setContacts] = createSignal<ChatContact[]>([]);
  const [groups, setGroups] = createSignal<ChatGroup[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [inputText, setInputText] = createSignal("");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [filterMode, setFilterMode] = createSignal<FilterMode>("all");
  const [sending, setSending] = createSignal(false);
  const [deviceName, setDeviceName] = createSignal("User");
  const [showNewGroup, setShowNewGroup] = createSignal(false);
  const [newGroupName, setNewGroupName] = createSignal("");
  const [newGroupMembers, setNewGroupMembers] = createSignal<string[]>([]);

  let messagesEndRef: HTMLDivElement | undefined;
  const scrollToBottom = () => messagesEndRef?.scrollIntoView({ behavior: "smooth" });

  // ---- Data ----

  const loadStatus = async () => {
    try {
      const s = await invoke<ChatStatus>("get_chat_status");
      setStatus(s);
      if (s.contacts) setContacts(s.contacts);
      if (s.groups) setGroups(s.groups);
    } catch (_) {}
  };

  const loadContacts = async () => {
    try {
      const result = await invoke<{ contacts: ChatContact[] }>("get_chat_contacts");
      setContacts(result.contacts || []);
    } catch (_) {}
  };

  // ---- Contacts categorized ----

  const supportContacts = () =>
    contacts().filter((c) => c.role === "operator" || c.id.startsWith("operator:"));

  const userContacts = () =>
    contacts().filter((c) => c.role !== "operator" && !c.id.startsWith("operator:"));

  const filteredContacts = () => {
    const q = searchQuery().toLowerCase().trim();
    let list: ChatContact[];

    switch (filterMode()) {
      case "support":
        list = supportContacts();
        break;
      case "users":
        list = userContacts();
        break;
      default:
        list = contacts();
    }

    if (q) {
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
      );
    }
    return list;
  };

  // ---- Messages ----

  const currentMessages = () => {
    const id = selectedId();
    if (!id) return [];
    return status().messages.filter(
      (m) => m.conversation_id === id ||
        (!m.conversation_id && id === "operator")
    );
  };

  const selectedContact = () =>
    contacts().find((c) => c.id === selectedId()) || null;

  const selectContact = (id: string) => {
    setSelectedId(id);
    invoke("load_chat_conversation", { conversationId: id }).catch(() => {});
    invoke("mark_chat_read", { conversationId: id }).catch(() => {});
  };

  // ---- Sending ----

  const sendMessage = async () => {
    const text = inputText().trim();
    if (!text || sending() || !selectedId()) return;
    setSending(true);
    try {
      await invoke("send_chat_message", {
        text,
        conversationId: selectedId(),
      });
      setInputText("");
      await loadStatus();
    } catch (e) {
      console.error("Send failed:", e);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ---- Group creation ----

  const createGroup = async () => {
    const name = newGroupName().trim();
    if (!name || newGroupMembers().length === 0) return;
    try {
      await invoke("create_chat_group", { name, memberIds: newGroupMembers() });
      setShowNewGroup(false);
      setNewGroupName("");
      setNewGroupMembers([]);
    } catch (_) {}
  };

  const toggleGroupMember = (id: string) => {
    setNewGroupMembers((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // ---- Helpers ----

  function stringToColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash) % 360}, 60%, 55%)`;
  }

  const getInitial = (name: string) => (name[0] || "?").toUpperCase();

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const formatFullTime = (ts: number) =>
    new Date(ts).toLocaleString([], {
      hour: "2-digit", minute: "2-digit", month: "short", day: "numeric",
    });

  // ---- Lifecycle ----

  onMount(async () => {
    await loadStatus();
    await loadContacts();

    try {
      const id = await invoke<string>("get_device_id");
      if (id) setDeviceName(id);
    } catch (_) {}

    const unsubs: (() => void)[] = [];

    unsubs.push(await listen<ChatMessage>("chat-message", (e) => {
      setStatus((p) => ({ ...p, messages: [...p.messages, e.payload] }));
      scrollToBottom();
    }));

    unsubs.push(await listen<ChatStatus>("chat-status", (e) => {
      setStatus(e.payload);
      if (e.payload.contacts) setContacts(e.payload.contacts);
      if (e.payload.groups) setGroups(e.payload.groups);
    }));

    unsubs.push(await listen<ChatMessage[]>("chat-history", (e) => {
      setStatus((p) => ({ ...p, messages: e.payload }));
      scrollToBottom();
    }));

    unsubs.push(await listen<ChatContact[]>("chat-contacts", (e) => {
      setContacts(e.payload);
    }));

    const poll = setInterval(() => { loadStatus(); loadContacts(); }, 15000);

    onCleanup(() => {
      unsubs.forEach((fn) => fn());
      clearInterval(poll);
    });
  });

  createEffect(() => {
    if (currentMessages().length > 0) setTimeout(scrollToBottom, 50);
  });

  // ---- Render ----

  return (
    <div class="cw">
      {/* ===== Left Sidebar ===== */}
      <div class="cw-sidebar">
        {/* User header */}
        <div class="cw-user-header">
          <div class="cw-user-avatar" style={`background: ${stringToColor(deviceName())}`}>
            <span class="mi">person</span>
          </div>
          <div class="cw-user-info">
            <div class="cw-user-greeting">Welcome</div>
            <div class="cw-user-name">{deviceName()}</div>
          </div>
        </div>

        {/* Search */}
        <div class="cw-search">
          <span class="mi mi-sm">search</span>
          <input
            type="text"
            placeholder="Search contacts..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
          />
        </div>

        {/* Contact list */}
        <div class="cw-contacts">
          {/* Support section */}
          <Show when={filterMode() !== "users" && supportContacts().length > 0}>
            <div class="cw-section-header">SUPPORT</div>
            <For each={filteredContacts().filter((c) => c.role === "operator" || c.id.startsWith("operator:"))}>
              {(contact) => (
                <button
                  class={`cw-contact-item ${selectedId() === contact.id ? "active" : ""}`}
                  onClick={() => selectContact(contact.id)}
                >
                  <div class="cw-contact-avatar" style={`background: ${contact.avatar_color || stringToColor(contact.id)}`}>
                    <span class="mi mi-sm">support_agent</span>
                  </div>
                  <div class="cw-contact-info">
                    <div class="cw-contact-name">{contact.name}</div>
                    <Show when={contact.online}>
                      <div class="cw-contact-status cw-contact-status--online">Online</div>
                    </Show>
                  </div>
                  <Show when={contact.online}>
                    <span class="cw-online-dot" />
                  </Show>
                  <Show when={contact.unread > 0}>
                    <span class="cw-unread-badge">{contact.unread}</span>
                  </Show>
                </button>
              )}
            </For>
          </Show>

          {/* Devices/Users section */}
          <Show when={filterMode() !== "support" && userContacts().length > 0}>
            <div class="cw-section-header">DEVICES</div>
            <For each={filteredContacts().filter((c) => c.role !== "operator" && !c.id.startsWith("operator:"))}>
              {(contact) => (
                <button
                  class={`cw-contact-item ${selectedId() === contact.id ? "active" : ""}`}
                  onClick={() => selectContact(contact.id)}
                >
                  <div class="cw-contact-avatar" style={`background: ${contact.avatar_color || stringToColor(contact.id)}`}>
                    <span>{getInitial(contact.name)}</span>
                  </div>
                  <div class="cw-contact-info">
                    <div class="cw-contact-name">{contact.name}</div>
                    <Show when={contact.hostname && contact.hostname !== contact.name}>
                      <div class="cw-contact-host">{contact.hostname}</div>
                    </Show>
                  </div>
                  <Show when={contact.online}>
                    <span class="cw-online-dot" />
                  </Show>
                  <Show when={contact.unread > 0}>
                    <span class="cw-unread-badge">{contact.unread}</span>
                  </Show>
                </button>
              )}
            </For>
          </Show>

          {/* Groups section */}
          <Show when={groups().length > 0}>
            <div class="cw-section-header">GROUPS</div>
            <For each={groups()}>
              {(group) => (
                <button
                  class={`cw-contact-item ${selectedId() === group.id ? "active" : ""}`}
                  onClick={() => selectContact(group.id)}
                >
                  <div class="cw-contact-avatar cw-contact-avatar--group" style={`background: ${stringToColor(group.id)}`}>
                    <span class="mi mi-sm">group</span>
                  </div>
                  <div class="cw-contact-info">
                    <div class="cw-contact-name">{group.name}</div>
                    <div class="cw-contact-host">{group.members.length} members</div>
                  </div>
                  <Show when={group.unread > 0}>
                    <span class="cw-unread-badge">{group.unread}</span>
                  </Show>
                </button>
              )}
            </For>
          </Show>

          {/* Empty state */}
          <Show when={contacts().length === 0}>
            <div class="cw-empty-contacts">
              <span class="mi" style="font-size:32px;opacity:0.3">person_off</span>
              <p>No contacts available</p>
              <p class="cw-text-muted">Waiting for server connection...</p>
            </div>
          </Show>
        </div>

        {/* Bottom filter tabs */}
        <div class="cw-filter-tabs">
          <button
            class={`cw-filter-tab ${filterMode() === "all" ? "active" : ""}`}
            onClick={() => setFilterMode("all")}
          >All</button>
          <button
            class={`cw-filter-tab ${filterMode() === "support" ? "active" : ""}`}
            onClick={() => setFilterMode("support")}
          >Support</button>
          <button
            class={`cw-filter-tab ${filterMode() === "users" ? "active" : ""}`}
            onClick={() => setFilterMode("users")}
          >Devices</button>
          <button
            class="cw-filter-tab"
            onClick={() => setShowNewGroup(true)}
            title="Create group"
          >
            <span class="mi mi-sm">group_add</span>
          </button>
        </div>

        {/* Connection indicator */}
        <div class="cw-connection-bar">
          <span class={`cw-conn-dot ${status().connected ? "online" : ""}`} />
          <span>{status().connected ? "Connected" : "Disconnected"}</span>
          <Show when={!status().connected}>
            <button
              class="cw-reconnect-btn"
              onClick={() => invoke("reconnect_chat").catch(() => {})}
              title="Reconnect to chat server"
            >
              <span class="mi mi-sm">refresh</span>
            </button>
          </Show>
        </div>
      </div>

      {/* ===== Main Chat Area ===== */}
      <div class="cw-main">
        <Show when={selectedId()} fallback={
          <div class="cw-welcome">
            <div class="cw-welcome-icon">
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                <rect width="80" height="80" rx="20" fill="var(--cw-primary)" opacity="0.15" />
                <text x="40" y="52" text-anchor="middle" fill="var(--cw-primary)" font-size="40" font-weight="700" font-family="Inter, sans-serif">B</text>
              </svg>
            </div>
            <h2>Welcome to BetterDesk Chat</h2>
            <p>Select a <strong>contact</strong> from the list to start a conversation.</p>
            <p class="cw-text-muted">Messages are stored on the server and will be restored after restart.</p>
          </div>
        }>
          {/* Chat header */}
          <div class="cw-chat-header">
            <Show when={selectedContact()}>
              {(contact) => (
                <>
                  <div class="cw-contact-avatar cw-contact-avatar--sm" style={`background: ${contact().avatar_color || stringToColor(contact().id)}`}>
                    {contact().role === "operator" || contact().id.startsWith("operator:") ? (
                      <span class="mi mi-sm">support_agent</span>
                    ) : (
                      <span>{getInitial(contact().name)}</span>
                    )}
                  </div>
                  <div class="cw-header-info">
                    <div class="cw-header-name">{contact().name}</div>
                    <div class={`cw-header-status ${contact().online ? "online" : ""}`}>
                      {contact().online ? "Online" : "Offline"}
                    </div>
                  </div>
                </>
              )}
            </Show>
          </div>

          {/* Messages */}
          <div class="cw-messages">
            <Show when={currentMessages().length > 0} fallback={
              <div class="cw-no-messages">
                <span class="mi" style="font-size:48px;opacity:0.15">chat</span>
                <p>No messages yet</p>
                <p class="cw-text-muted">Send a message to start the conversation</p>
              </div>
            }>
              <For each={currentMessages()}>
                {(msg) => (
                  <div class={`cw-msg ${msg.from === "agent" ? "cw-msg--self" : "cw-msg--other"}`}>
                    <div class="cw-msg-bubble">
                      <span class="cw-msg-text">{msg.text}</span>
                    </div>
                    <div class="cw-msg-meta">
                      <span class="cw-msg-sender">
                        {msg.from === "agent" ? "You" : msg.from_name || msg.from}
                      </span>
                      <span class="cw-msg-time">{formatFullTime(msg.timestamp)}</span>
                    </div>
                  </div>
                )}
              </For>
              <div ref={messagesEndRef} />
            </Show>
          </div>

          {/* Input */}
          <div class="cw-input-area">
            <Show when={status().connected} fallback={
              <div class="cw-disconnected">Not connected — messages cannot be sent</div>
            }>
              <textarea
                class="cw-input"
                placeholder="Type a message... (Enter to send)"
                value={inputText()}
                onInput={(e) => setInputText(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                disabled={sending()}
              />
              <button
                class="cw-send-btn"
                onClick={sendMessage}
                disabled={!inputText().trim() || sending()}
              >
                <span class="mi">send</span>
              </button>
            </Show>
          </div>
        </Show>
      </div>

      {/* ===== New Group Dialog ===== */}
      <Show when={showNewGroup()}>
        <div class="cw-dialog-overlay" onClick={() => setShowNewGroup(false)}>
          <div class="cw-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Create Group</h3>
            <div class="cw-form-group">
              <label>Group Name</label>
              <input
                type="text"
                value={newGroupName()}
                onInput={(e) => setNewGroupName(e.currentTarget.value)}
                placeholder="e.g. Support Team"
              />
            </div>
            <div class="cw-form-group">
              <label>Members</label>
              <div class="cw-member-list">
                <For each={contacts()}>
                  {(c) => (
                    <label class="cw-member-item">
                      <input
                        type="checkbox"
                        checked={newGroupMembers().includes(c.id)}
                        onChange={() => toggleGroupMember(c.id)}
                      />
                      <span>{c.name}</span>
                    </label>
                  )}
                </For>
              </div>
            </div>
            <div class="cw-dialog-actions">
              <button class="cw-btn" onClick={() => setShowNewGroup(false)}>Cancel</button>
              <button
                class="cw-btn cw-btn--primary"
                onClick={createGroup}
                disabled={!newGroupName().trim() || newGroupMembers().length === 0}
              >Create</button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default ChatWindow;
