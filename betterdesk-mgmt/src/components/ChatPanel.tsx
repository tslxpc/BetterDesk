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

type ConversationType = "direct" | "group" | "operator";

interface Conversation {
  id: string;
  type: ConversationType;
  name: string;
  online?: boolean;
  unread: number;
  last_message?: string;
  last_time?: number;
  avatar_color: string;
}

// ---------------------------------------------------------------------------
//  Component
// ---------------------------------------------------------------------------

const ChatPanel: Component = () => {
  const [status, setStatus] = createSignal<ChatStatus>({
    connected: false,
    unread_count: 0,
    messages: [],
    contacts: [],
    groups: [],
  });
  const [inputText, setInputText] = createSignal("");
  const [sending, setSending] = createSignal(false);

  // Contact list and conversations
  const [contacts, setContacts] = createSignal<ChatContact[]>([]);
  const [groups, setGroups] = createSignal<ChatGroup[]>([]);
  const [selectedConversation, setSelectedConversation] = createSignal<string | null>(null);
  const [searchQuery, setSearchQuery] = createSignal("");

  // New group dialog
  const [showNewGroup, setShowNewGroup] = createSignal(false);
  const [newGroupName, setNewGroupName] = createSignal("");
  const [newGroupMembers, setNewGroupMembers] = createSignal<string[]>([]);

  // Sidebar tab
  const [sidebarTab, setSidebarTab] = createSignal<"contacts" | "groups">("contacts");

  let messagesEndRef: HTMLDivElement | undefined;

  const scrollToBottom = () => {
    messagesEndRef?.scrollIntoView({ behavior: "smooth" });
  };

  // ---- Data loading ----

  const loadStatus = async () => {
    try {
      const s = await invoke<ChatStatus>("get_chat_status");
      setStatus(s);
      if (s.contacts) setContacts(s.contacts);
      if (s.groups) setGroups(s.groups);
    } catch (e) {
      console.error("Failed to load chat status:", e);
    }
  };

  const loadContacts = async () => {
    try {
      const result = await invoke<{ contacts: ChatContact[] }>("get_chat_contacts");
      setContacts(result.contacts || []);
    } catch (e) {
      // Fallback — contacts not yet supported in backend
      console.debug("Chat contacts not available:", e);
    }
  };

  const loadGroups = async () => {
    try {
      const result = await invoke<{ groups: ChatGroup[] }>("get_chat_groups");
      setGroups(result.groups || []);
    } catch (e) {
      console.debug("Chat groups not available:", e);
    }
  };

  const loadConversationHistory = async (conversationId: string) => {
    try {
      await invoke("load_chat_conversation", { conversationId });
    } catch (e) {
      console.debug("Conversation history not available:", e);
    }
  };

  // ---- Sending ----

  const sendMessage = async () => {
    const text = inputText().trim();
    if (!text || sending()) return;
    setSending(true);
    try {
      const convId = selectedConversation();
      await invoke("send_chat_message", {
        text,
        conversationId: convId || undefined,
      });
      setInputText("");
      await loadStatus();
    } catch (e) {
      console.error("Failed to send message:", e);
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

  const markRead = async () => {
    try {
      const convId = selectedConversation();
      await invoke("mark_chat_read", { conversationId: convId || undefined });
      setStatus((prev) => ({ ...prev, unread_count: 0 }));
    } catch (_) {}
  };

  // ---- Group creation ----

  const createGroup = async () => {
    const name = newGroupName().trim();
    if (!name || newGroupMembers().length === 0) return;

    try {
      await invoke("create_chat_group", {
        name,
        memberIds: newGroupMembers(),
      });
      setShowNewGroup(false);
      setNewGroupName("");
      setNewGroupMembers([]);
      await loadGroups();
    } catch (e) {
      console.error("Failed to create group:", e);
    }
  };

  const toggleGroupMember = (contactId: string) => {
    setNewGroupMembers((prev) =>
      prev.includes(contactId)
        ? prev.filter((id) => id !== contactId)
        : [...prev, contactId]
    );
  };

  // ---- Conversation helpers ----

  const allConversations = (): Conversation[] => {
    const convs: Conversation[] = [];

    // Operator conversation (always present)
    const operatorMsgs = status().messages.filter(
      (m) => !m.conversation_id || m.conversation_id === "operator"
    );
    convs.push({
      id: "operator",
      type: "operator",
      name: "Support Operator",
      online: status().connected,
      unread: operatorMsgs.filter((m) => !m.read && m.from !== "agent").length,
      last_message: operatorMsgs[operatorMsgs.length - 1]?.text,
      last_time: operatorMsgs[operatorMsgs.length - 1]?.timestamp,
      avatar_color: "var(--primary)",
    });

    // Direct contacts
    for (const contact of contacts()) {
      convs.push({
        id: contact.id,
        type: "direct",
        name: contact.name || contact.hostname || contact.id,
        online: contact.online,
        unread: contact.unread,
        avatar_color: contact.avatar_color || stringToColor(contact.id),
      });
    }

    // Groups
    for (const group of groups()) {
      convs.push({
        id: group.id,
        type: "group",
        name: group.name,
        unread: group.unread,
        avatar_color: stringToColor(group.id),
      });
    }

    // Sort: unread first, then by last activity
    convs.sort((a, b) => {
      if (a.unread > 0 && b.unread === 0) return -1;
      if (b.unread > 0 && a.unread === 0) return 1;
      return (b.last_time || 0) - (a.last_time || 0);
    });

    return convs;
  };

  const filteredConversations = () => {
    const q = searchQuery().toLowerCase().trim();
    if (!q) return allConversations();
    return allConversations().filter((c) => c.name.toLowerCase().includes(q));
  };

  const currentMessages = () => {
    const convId = selectedConversation();
    if (!convId || convId === "operator") {
      return status().messages.filter(
        (m) => !m.conversation_id || m.conversation_id === "operator"
      );
    }
    return status().messages.filter((m) => m.conversation_id === convId);
  };

  const currentConversation = () => {
    const convId = selectedConversation();
    return allConversations().find((c) => c.id === convId) || null;
  };

  const selectConversation = (id: string) => {
    setSelectedConversation(id);
    loadConversationHistory(id);
    markRead();
  };

  // ---- Color helper ----

  function stringToColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 65%, 55%)`;
  }

  // ---- Lifecycle ----

  onMount(async () => {
    await loadStatus();
    await loadContacts();
    await loadGroups();
    await markRead();

    // Default to operator conversation
    if (!selectedConversation()) {
      setSelectedConversation("operator");
    }

    const unsubMsg = await listen<ChatMessage>("chat-message", (event) => {
      setStatus((prev) => ({
        ...prev,
        messages: [...prev.messages, event.payload],
      }));
      scrollToBottom();
    });

    const unsubStatus = await listen<ChatStatus>("chat-status", (event) => {
      setStatus(event.payload);
      if (event.payload.contacts) setContacts(event.payload.contacts);
      if (event.payload.groups) setGroups(event.payload.groups);
    });

    const unsubHistory = await listen<ChatMessage[]>("chat-history", (event) => {
      setStatus((prev) => ({ ...prev, messages: event.payload }));
      scrollToBottom();
    });

    const unsubContacts = await listen<ChatContact[]>("chat-contacts", (event) => {
      setContacts(event.payload);
    });

    // Poll for status and contacts every 10s
    const pollInterval = setInterval(() => {
      loadStatus();
      loadContacts();
    }, 10000);

    onCleanup(() => {
      unsubMsg();
      unsubStatus();
      unsubHistory();
      unsubContacts();
      clearInterval(pollInterval);
    });
  });

  createEffect(() => {
    if (currentMessages().length > 0) {
      setTimeout(scrollToBottom, 50);
    }
  });

  // ---- Formatters ----

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const formatFullTime = (ts: number) => {
    return new Date(ts).toLocaleString([], {
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    });
  };

  const getMessageClass = (msg: ChatMessage) => {
    if (msg.from === "agent") return "chat-msg chat-msg--agent";
    if (msg.from === "system") return "chat-msg chat-msg--system";
    return "chat-msg chat-msg--operator";
  };

  const getInitial = (name: string) => {
    return (name[0] || "?").toUpperCase();
  };

  // ---- Render ----

  return (
    <div class="chat-panel chat-panel--ecosystem">
      {/* ---- Contact sidebar ---- */}
      <div class="chat-sidebar">
        <div class="chat-sidebar-header">
          <h2>Messages</h2>
          <div class="chat-sidebar-actions">
            <button
              class="btn-icon"
              onClick={() => setShowNewGroup(true)}
              title="Create group"
            >
              <span class="mi mi-sm">group_add</span>
            </button>
          </div>
        </div>

        {/* Search */}
        <div class="chat-search">
          <span class="mi mi-sm">search</span>
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
          />
        </div>

        {/* Tab bar */}
        <div class="chat-sidebar-tabs">
          <button
            class={`chat-sidebar-tab ${sidebarTab() === "contacts" ? "active" : ""}`}
            onClick={() => setSidebarTab("contacts")}
          >
            All
          </button>
          <button
            class={`chat-sidebar-tab ${sidebarTab() === "groups" ? "active" : ""}`}
            onClick={() => setSidebarTab("groups")}
          >
            Groups
          </button>
        </div>

        {/* Conversation list */}
        <div class="chat-conversation-list">
          <For each={filteredConversations().filter(
            (c) => sidebarTab() === "contacts" || c.type === "group"
          )}>
            {(conv) => (
              <button
                class={`chat-conversation-item ${selectedConversation() === conv.id ? "active" : ""}`}
                onClick={() => selectConversation(conv.id)}
              >
                <div
                  class="chat-avatar"
                  style={`background: ${conv.avatar_color}`}
                >
                  {conv.type === "group" ? (
                    <span class="mi mi-sm">group</span>
                  ) : conv.type === "operator" ? (
                    <span class="mi mi-sm">support_agent</span>
                  ) : (
                    <span>{getInitial(conv.name)}</span>
                  )}
                </div>
                <div class="chat-conv-info">
                  <div class="chat-conv-name">
                    {conv.name}
                    {conv.online !== undefined && (
                      <span class={`status-dot-sm ${conv.online ? "online" : "offline"}`} />
                    )}
                  </div>
                  <Show when={conv.last_message}>
                    <div class="chat-conv-preview">
                      {conv.last_message!.slice(0, 50)}
                    </div>
                  </Show>
                </div>
                <div class="chat-conv-meta">
                  <Show when={conv.last_time}>
                    <span class="chat-conv-time">{formatTime(conv.last_time!)}</span>
                  </Show>
                  <Show when={conv.unread > 0}>
                    <span class="chat-conv-badge">{conv.unread}</span>
                  </Show>
                </div>
              </button>
            )}
          </For>
        </div>

        {/* Connection status */}
        <div class="chat-sidebar-footer">
          <span class={`status-dot-sm ${status().connected ? "online" : "offline"}`} />
          <span class="text-muted">
            {status().connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* ---- Main chat area ---- */}
      <div class="chat-main">
        <Show when={selectedConversation()} fallback={
          <div class="chat-empty-state">
            <span class="mi" style="font-size:64px;color:var(--text-muted)">forum</span>
            <h3>Select a conversation</h3>
            <p class="text-muted">
              Choose a contact or group from the sidebar to start messaging
            </p>
          </div>
        }>
          {/* Chat header */}
          <div class="chat-main-header">
            <Show when={currentConversation()}>
              {(conv) => (
                <>
                  <div
                    class="chat-avatar chat-avatar--sm"
                    style={`background: ${conv().avatar_color}`}
                  >
                    {conv().type === "group" ? (
                      <span class="mi mi-sm">group</span>
                    ) : conv().type === "operator" ? (
                      <span class="mi mi-sm">support_agent</span>
                    ) : (
                      <span>{getInitial(conv().name)}</span>
                    )}
                  </div>
                  <div class="chat-header-info">
                    <span class="chat-header-name">{conv().name}</span>
                    {conv().online !== undefined && (
                      <span class="chat-header-status">
                        {conv().online ? "Online" : "Offline"}
                      </span>
                    )}
                  </div>
                </>
              )}
            </Show>
          </div>

          {/* Messages area */}
          <div class="chat-messages" onClick={markRead}>
            <Show
              when={currentMessages().length > 0}
              fallback={
                <div class="chat-empty">
                  <span class="mi" style="font-size:48px">chat_bubble_outline</span>
                  <p>No messages yet</p>
                  <p class="text-muted">Send a message to start the conversation</p>
                </div>
              }
            >
              <For each={currentMessages()}>
                {(msg) => (
                  <div class={getMessageClass(msg)}>
                    <div class="chat-msg__bubble">
                      <span class="chat-msg__text">{msg.text}</span>
                    </div>
                    <div class="chat-msg__meta">
                      <span class="chat-msg__from">
                        {msg.from === "agent"
                          ? "You"
                          : msg.from === "system"
                          ? "System"
                          : msg.from}
                      </span>
                      <span class="chat-msg__time">{formatFullTime(msg.timestamp)}</span>
                      <Show when={!msg.read && msg.from !== "agent"}>
                        <span class="chat-msg__unread-dot" />
                      </Show>
                    </div>
                  </div>
                )}
              </For>
              <div ref={messagesEndRef} />
            </Show>
          </div>

          {/* Input area */}
          <div class="chat-input-area">
            <Show
              when={status().connected}
              fallback={
                <div class="chat-disconnected-notice">
                  Not connected to server — messages cannot be sent
                </div>
              }
            >
              <textarea
                class="chat-input"
                placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
                value={inputText()}
                onInput={(e) => setInputText(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                disabled={sending()}
              />
              <button
                class="btn btn--primary chat-send-btn"
                onClick={sendMessage}
                disabled={!inputText().trim() || sending()}
              >
                <span class="mi">send</span>
              </button>
            </Show>
          </div>
        </Show>
      </div>

      {/* ---- New Group Dialog ---- */}
      <Show when={showNewGroup()}>
        <div class="chat-dialog-overlay" onClick={() => setShowNewGroup(false)}>
          <div class="chat-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Create Group</h3>
            <div class="form-group">
              <label>Group Name</label>
              <input
                type="text"
                class="form-input"
                placeholder="Enter group name"
                value={newGroupName()}
                onInput={(e) => setNewGroupName(e.currentTarget.value)}
                maxLength={50}
              />
            </div>
            <div class="form-group">
              <label>Members</label>
              <div class="chat-member-picker">
                <For each={contacts()}>
                  {(contact) => (
                    <label class="chat-member-option">
                      <input
                        type="checkbox"
                        checked={newGroupMembers().includes(contact.id)}
                        onChange={() => toggleGroupMember(contact.id)}
                      />
                      <span
                        class="chat-avatar chat-avatar--xs"
                        style={`background: ${contact.avatar_color || stringToColor(contact.id)}`}
                      >
                        {getInitial(contact.name || contact.id)}
                      </span>
                      <span>{contact.name || contact.hostname || contact.id}</span>
                      <span class={`status-dot-sm ${contact.online ? "online" : "offline"}`} />
                    </label>
                  )}
                </For>
                <Show when={contacts().length === 0}>
                  <p class="text-muted">No contacts available</p>
                </Show>
              </div>
            </div>
            <div class="chat-dialog-actions">
              <button class="btn-secondary" onClick={() => setShowNewGroup(false)}>
                Cancel
              </button>
              <button
                class="btn-primary"
                onClick={createGroup}
                disabled={!newGroupName().trim() || newGroupMembers().length === 0}
              >
                Create Group
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default ChatPanel;
