import { Component, For, Show, createSignal, onMount, onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { invoke } from "../lib/tauri";
import { t, onLocaleChange } from "../lib/i18n";
import { operatorStore } from "../stores/operator";

interface DlpPolicy {
  id?: number;
  name: string;
  description?: string;
  policy_type?: string;
  action?: string;
  scope?: string;
  enabled?: boolean | number;
  rules?: unknown[];
}

interface DlpEvent {
  id: number;
  device_id: string;
  event_source: string;
  event_type: string;
  policy_name?: string;
  action?: string;
  details?: Record<string, unknown>;
  created_at: string;
}

interface DlpStats {
  total?: number;
  blocked?: number;
  logged?: number;
  usb_events?: number;
  file_events?: number;
}

const DEFAULT_RULES = JSON.stringify(
  [
    {
      rule_type: "usb_device",
      action: "block",
      filter: "*",
    },
  ],
  null,
  2
);

const DataGuardPanel: Component = () => {
  const navigate = useNavigate();

  const [policies, setPolicies] = createSignal<DlpPolicy[]>([]);
  const [events, setEvents] = createSignal<DlpEvent[]>([]);
  const [stats, setStats] = createSignal<DlpStats>({
    total: 0,
    blocked: 0,
    logged: 0,
    usb_events: 0,
    file_events: 0,
  });
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);

  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [policyType, setPolicyType] = createSignal("usb_control");
  const [action, setAction] = createSignal("block");
  const [scope, setScope] = createSignal("");
  const [enabled, setEnabled] = createSignal(true);
  const [rulesText, setRulesText] = createSignal(DEFAULT_RULES);
  const [, setLocaleVer] = createSignal(0);

  const session = () => operatorStore.session();
  const isAdmin = () => session()?.role === "admin";

  const normalizePolicies = (payload: any): DlpPolicy[] => {
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.policies)
        ? payload.policies
        : [];
    return items.map((policy: any) => ({
      id: typeof policy?.id === "number" ? policy.id : undefined,
      name: String(policy?.name || ""),
      description: String(policy?.description || ""),
      policy_type: String(policy?.policy_type || "custom"),
      action: String(policy?.action || "log"),
      scope: String(policy?.scope || ""),
      enabled: policy?.enabled === true || policy?.enabled === 1,
      rules: Array.isArray(policy?.rules) ? policy.rules : [],
    }));
  };

  const normalizeEvents = (payload: any): DlpEvent[] => {
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.events)
        ? payload.events
        : [];
    return items.map((event: any) => ({
      id: Number(event?.id || 0),
      device_id: String(event?.device_id || ""),
      event_source: String(event?.event_source || "unknown"),
      event_type: String(event?.event_type || "info"),
      policy_name: String(event?.policy_name || ""),
      action: String(event?.action || "log"),
      details: typeof event?.details === "object" && event.details ? event.details : {},
      created_at: String(event?.created_at || ""),
    }));
  };

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setPolicyType("usb_control");
    setAction("block");
    setScope("");
    setEnabled(true);
    setRulesText(DEFAULT_RULES);
  };

  const loadPolicy = (policy: DlpPolicy) => {
    setEditingId(policy.id ?? null);
    setName(policy.name || "");
    setDescription(policy.description || "");
    setPolicyType(policy.policy_type || "custom");
    setAction(policy.action || "log");
    setScope(policy.scope || "");
    setEnabled(policy.enabled === true || policy.enabled === 1);
    setRulesText(JSON.stringify(policy.rules || [], null, 2));
    setSuccess(null);
    setError(null);
  };

  const loadData = async () => {
    const accessToken = session()?.access_token;
    if (!accessToken) return;

    setLoading(true);
    setError(null);
    try {
      const [policyResult, eventResult, statsResult] = await Promise.all([
        invoke<any>("operator_dataguard_get_policies", { accessToken }),
        invoke<any>("operator_dataguard_get_events", { accessToken }),
        invoke<any>("operator_dataguard_get_stats", { accessToken }),
      ]);

      setPolicies(normalizePolicies(policyResult));
      setEvents(normalizeEvents(eventResult));
      setStats({
        total: Number(statsResult?.total || 0),
        blocked: Number(statsResult?.blocked || 0),
        logged: Number(statsResult?.logged || 0),
        usb_events: Number(statsResult?.usb_events || 0),
        file_events: Number(statsResult?.file_events || 0),
      });
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const savePolicy = async () => {
    const accessToken = session()?.access_token;
    if (!accessToken || !isAdmin()) {
      setError(t("dataguard.admin_required"));
      return;
    }

    if (!name().trim()) {
      setError(t("dataguard.policy_name_required"));
      return;
    }

    let parsedRules: unknown[] = [];
    try {
      const parsed = JSON.parse(rulesText() || "[]");
      if (!Array.isArray(parsed)) {
        throw new Error("rules must be an array");
      }
      parsedRules = parsed;
    } catch (_) {
      setError(t("dataguard.invalid_rules_json"));
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await invoke("operator_dataguard_save_policy", {
        accessToken,
        policy: {
          id: editingId(),
          name: name().trim(),
          description: description().trim(),
          policy_type: policyType(),
          action: action(),
          scope: scope().trim(),
          enabled: enabled(),
          rules: parsedRules,
        },
      });
      setSuccess(t("dataguard.save_success"));
      resetForm();
      await loadData();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const deletePolicy = async (policyId: number) => {
    const accessToken = session()?.access_token;
    if (!accessToken || !isAdmin()) {
      setError(t("dataguard.admin_required"));
      return;
    }
    if (!window.confirm(t("dataguard.delete_confirm"))) return;

    setError(null);
    setSuccess(null);
    try {
      await invoke("operator_dataguard_delete_policy", {
        accessToken,
        policyId,
      });
      setSuccess(t("dataguard.delete_success"));
      if (editingId() === policyId) resetForm();
      await loadData();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const formatDetails = (details?: Record<string, unknown>) => {
    if (!details || Object.keys(details).length === 0) return "";
    const text = JSON.stringify(details);
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
  };

  onMount(() => {
    const unsub = onLocaleChange(() => setLocaleVer((v) => v + 1));
    loadData();
    const interval = setInterval(loadData, 20000);
    onCleanup(() => {
      unsub();
      clearInterval(interval);
    });
  });

  return (
    <div class="panel">
      <div class="panel-header">
        <h2>
          <span class="mi">security</span>
          {t("dataguard.title")}
        </h2>
        <span class={`badge ${isAdmin() ? "badge-success" : "badge-info"}`}>
          {isAdmin() ? t("dataguard.status_live") : t("dataguard.status_read_only")}
        </span>
      </div>

      <div class="panel-body" style="padding:24px">
        <Show
          when={session()}
          fallback={
            <div class="card" style="padding:24px;text-align:center">
              <span class="mi" style="font-size:48px;color:var(--text-secondary)">shield</span>
              <h3 style="margin:16px 0 8px">{t("dataguard.sign_in_required")}</h3>
              <p style="color:var(--text-secondary);max-width:420px;margin:0 auto 20px">
                {t("dataguard.sign_in_hint")}
              </p>
              <button class="btn btn-primary" onClick={() => navigate("/operator")}>
                <span class="mi">login</span>
                {t("dataguard.open_operator")}
              </button>
            </div>
          }
        >
          <Show when={error()}>
            <div class="card" style="padding:12px 16px;margin-bottom:16px;border-color:var(--danger);color:var(--danger)">
              {error()}
            </div>
          </Show>

          <Show when={success()}>
            <div class="card" style="padding:12px 16px;margin-bottom:16px;border-color:var(--success);color:var(--success)">
              {success()}
            </div>
          </Show>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px">
            <div class="card" style="padding:16px">
              <div class="text-muted" style="font-size:12px">{t("dataguard.total_events")}</div>
              <div style="font-size:28px;font-weight:700">{stats().total || 0}</div>
            </div>
            <div class="card" style="padding:16px">
              <div class="text-muted" style="font-size:12px">{t("dataguard.blocked_events")}</div>
              <div style="font-size:28px;font-weight:700">{stats().blocked || 0}</div>
            </div>
            <div class="card" style="padding:16px">
              <div class="text-muted" style="font-size:12px">{t("dataguard.logged_events")}</div>
              <div style="font-size:28px;font-weight:700">{stats().logged || 0}</div>
            </div>
            <div class="card" style="padding:16px">
              <div class="text-muted" style="font-size:12px">{t("dataguard.usb_events")}</div>
              <div style="font-size:28px;font-weight:700">{stats().usb_events || 0}</div>
            </div>
            <div class="card" style="padding:16px">
              <div class="text-muted" style="font-size:12px">{t("dataguard.file_events")}</div>
              <div style="font-size:28px;font-weight:700">{stats().file_events || 0}</div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:minmax(320px,1fr) minmax(320px,1fr);gap:16px;align-items:start">
            <div class="card" style="padding:18px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px">
                <div>
                  <h3 style="margin:0">{t("dataguard.editor_title")}</h3>
                  <p class="text-secondary" style="margin:6px 0 0;font-size:13px">
                    {isAdmin() ? t("dataguard.editor_hint") : t("dataguard.read_only")}
                  </p>
                </div>
                <button class="btn btn-secondary btn-sm" onClick={resetForm}>
                  <span class="mi">restart_alt</span>
                  {t("dataguard.reset_form")}
                </button>
              </div>

              <Show when={isAdmin()} fallback={
                <div class="card" style="padding:16px;background:var(--surface-2)">
                  <strong>{t("dataguard.read_only")}</strong>
                  <p class="text-secondary" style="margin:8px 0 0">{t("dataguard.admin_required")}</p>
                </div>
              }>
                <div style="display:grid;gap:12px">
                  <label style="display:grid;gap:6px">
                    <span>{t("dataguard.policy_name")}</span>
                    <input type="text" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
                  </label>

                  <label style="display:grid;gap:6px">
                    <span>{t("dataguard.policy_description")}</span>
                    <textarea rows={3} value={description()} onInput={(e) => setDescription(e.currentTarget.value)} />
                  </label>

                  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
                    <label style="display:grid;gap:6px">
                      <span>{t("dataguard.policy_type")}</span>
                      <select value={policyType()} onChange={(e) => setPolicyType(e.currentTarget.value)}>
                        <option value="usb_control">USB Control</option>
                        <option value="file_monitoring">File Monitoring</option>
                        <option value="content_inspection">Content Inspection</option>
                        <option value="custom">Custom</option>
                      </select>
                    </label>

                    <label style="display:grid;gap:6px">
                      <span>{t("dataguard.policy_action")}</span>
                      <select value={action()} onChange={(e) => setAction(e.currentTarget.value)}>
                        <option value="block">Block</option>
                        <option value="log">Log</option>
                        <option value="allow">Allow</option>
                      </select>
                    </label>
                  </div>

                  <label style="display:grid;gap:6px">
                    <span>{t("dataguard.policy_scope")}</span>
                    <input type="text" value={scope()} onInput={(e) => setScope(e.currentTarget.value)} placeholder="all-devices" />
                  </label>

                  <label style="display:flex;align-items:center;gap:10px">
                    <input type="checkbox" checked={enabled()} onChange={(e) => setEnabled(e.currentTarget.checked)} />
                    <span>{t("dataguard.policy_enabled")}</span>
                  </label>

                  <label style="display:grid;gap:6px">
                    <span>{t("dataguard.rules_json")}</span>
                    <textarea rows={10} value={rulesText()} onInput={(e) => setRulesText(e.currentTarget.value)} style="font-family:Consolas, monospace" />
                  </label>

                  <button class="btn btn-primary" onClick={savePolicy} disabled={saving()}>
                    <span class="mi">save</span>
                    {editingId() ? t("dataguard.update_policy") : t("dataguard.create_policy")}
                  </button>
                </div>
              </Show>
            </div>

            <div class="card" style="padding:18px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px">
                <div>
                  <h3 style="margin:0">{t("dataguard.policies_title")}</h3>
                  <p class="text-secondary" style="margin:6px 0 0;font-size:13px">{policies().length} configured</p>
                </div>
                <button class="btn btn-secondary btn-sm" onClick={loadData} disabled={loading()}>
                  <span class="mi">refresh</span>
                  {t("common.refresh")}
                </button>
              </div>

              <Show when={policies().length > 0} fallback={
                <div class="operator-empty" style="padding:24px 0">
                  <span class="mi" style="font-size:40px;color:var(--text-muted)">policy</span>
                  <p>{t("dataguard.no_policies")}</p>
                </div>
              }>
                <div style="display:grid;gap:12px;max-height:420px;overflow:auto">
                  <For each={policies()}>
                    {(policy) => (
                      <div class="card" style="padding:14px;background:var(--surface-2)">
                        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
                          <div>
                            <div style="font-weight:600">{policy.name}</div>
                            <div class="text-secondary" style="font-size:12px;margin-top:4px">
                              {policy.policy_type || "custom"} • {policy.action || "log"} • {policy.enabled ? "enabled" : "disabled"}
                            </div>
                          </div>
                          <div style="display:flex;gap:8px">
                            <Show when={isAdmin()}>
                              <button class="btn btn-secondary btn-sm" onClick={() => loadPolicy(policy)}>
                                <span class="mi">edit</span>
                                {t("dataguard.edit_policy")}
                              </button>
                              <Show when={policy.id != null}>
                                <button class="btn btn-secondary btn-sm" onClick={() => deletePolicy(policy.id!)}>
                                  <span class="mi">delete</span>
                                  {t("dataguard.delete_policy")}
                                </button>
                              </Show>
                            </Show>
                          </div>
                        </div>
                        <Show when={policy.description}>
                          <p class="text-secondary" style="margin:10px 0 0">{policy.description}</p>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>

          <div class="card" style="padding:18px;margin-top:16px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px">
              <div>
                <h3 style="margin:0">{t("dataguard.events_title")}</h3>
                <p class="text-secondary" style="margin:6px 0 0;font-size:13px">{t("dataguard.events_hint")}</p>
              </div>
              <button class="btn btn-secondary btn-sm" onClick={loadData} disabled={loading()}>
                <span class="mi">refresh</span>
                {t("common.refresh")}
              </button>
            </div>

            <Show when={events().length > 0} fallback={
              <div class="operator-empty" style="padding:24px 0">
                <span class="mi" style="font-size:40px;color:var(--text-muted)">inventory_2</span>
                <p>{t("dataguard.no_events")}</p>
              </div>
            }>
              <div style="display:grid;gap:12px;max-height:360px;overflow:auto">
                <For each={events()}>
                  {(event) => (
                    <div class="card" style="padding:14px;background:var(--surface-2)">
                      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
                        <div>
                          <div style="font-weight:600">{event.policy_name || event.event_type}</div>
                          <div class="text-secondary" style="font-size:12px;margin-top:4px">
                            {event.device_id || "unknown-device"} • {event.event_source} • {event.action || "log"}
                          </div>
                        </div>
                        <div class="text-secondary" style="font-size:12px;white-space:nowrap">
                          {event.created_at ? new Date(event.created_at).toLocaleString() : "-"}
                        </div>
                      </div>
                      <Show when={formatDetails(event.details)}>
                        <p class="text-secondary" style="margin:10px 0 0">{formatDetails(event.details)}</p>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default DataGuardPanel;
