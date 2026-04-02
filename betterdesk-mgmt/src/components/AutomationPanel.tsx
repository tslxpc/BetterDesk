import { Component, For, Show, createSignal, onMount, onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { invoke } from "../lib/tauri";
import { t, onLocaleChange } from "../lib/i18n";
import { operatorStore } from "../stores/operator";

interface AutomationRule {
  id?: number;
  name: string;
  description?: string;
  enabled?: boolean | number;
  condition_type?: string;
  condition_op?: string;
  condition_value?: number;
  severity?: string;
  scope_device_id?: string | null;
  cooldown_secs?: number;
  notify_emails?: string;
}

interface AutomationAlert {
  id: number;
  rule_name?: string;
  device_id?: string;
  severity?: string;
  message?: string;
  acknowledged?: boolean | number;
  triggered_at?: string;
}

interface AutomationCommand {
  id: number;
  device_id: string;
  command_type: string;
  payload: string;
  status: string;
  created_at?: string;
  result?: string | null;
}

interface RemoteDeviceOption {
  id: string;
  hostname: string;
  online: boolean;
}

const AutomationPanel: Component = () => {
  const navigate = useNavigate();

  const [rules, setRules] = createSignal<AutomationRule[]>([]);
  const [alerts, setAlerts] = createSignal<AutomationAlert[]>([]);
  const [commands, setCommands] = createSignal<AutomationCommand[]>([]);
  const [devices, setDevices] = createSignal<RemoteDeviceOption[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [savingRule, setSavingRule] = createSignal(false);
  const [queueingCommand, setQueueingCommand] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);

  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [conditionType, setConditionType] = createSignal("cpu_usage");
  const [conditionOp, setConditionOp] = createSignal("gt");
  const [conditionValue, setConditionValue] = createSignal("90");
  const [severity, setSeverity] = createSignal("warning");
  const [scopeDeviceId, setScopeDeviceId] = createSignal("");
  const [cooldownSecs, setCooldownSecs] = createSignal("300");
  const [notifyEmails, setNotifyEmails] = createSignal("");
  const [enabled, setEnabled] = createSignal(true);

  const [commandDeviceId, setCommandDeviceId] = createSignal("");
  const [commandType, setCommandType] = createSignal("shell");
  const [commandPayload, setCommandPayload] = createSignal("");
  const [, setLocaleVer] = createSignal(0);

  const session = () => operatorStore.session();

  const normalizeRules = (payload: any): AutomationRule[] => {
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.rules)
        ? payload.rules
        : [];
    return items.map((rule: any) => ({
      id: typeof rule?.id === "number" ? rule.id : undefined,
      name: String(rule?.name || ""),
      description: String(rule?.description || ""),
      enabled: rule?.enabled === true || rule?.enabled === 1,
      condition_type: String(rule?.condition_type || "cpu_usage"),
      condition_op: String(rule?.condition_op || "gt"),
      condition_value: Number(rule?.condition_value || 0),
      severity: String(rule?.severity || "warning"),
      scope_device_id: rule?.scope_device_id ? String(rule.scope_device_id) : "",
      cooldown_secs: Number(rule?.cooldown_secs || 300),
      notify_emails: String(rule?.notify_emails || ""),
    }));
  };

  const normalizeAlerts = (payload: any): AutomationAlert[] => {
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.alerts)
        ? payload.alerts
        : [];
    return items.map((alert: any) => ({
      id: Number(alert?.id || 0),
      rule_name: String(alert?.rule_name || ""),
      device_id: String(alert?.device_id || ""),
      severity: String(alert?.severity || "warning"),
      message: String(alert?.message || ""),
      acknowledged: alert?.acknowledged === true || alert?.acknowledged === 1,
      triggered_at: String(alert?.triggered_at || ""),
    }));
  };

  const normalizeCommands = (payload: any): AutomationCommand[] => {
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.commands)
        ? payload.commands
        : [];
    return items.map((command: any) => ({
      id: Number(command?.id || 0),
      device_id: String(command?.device_id || ""),
      command_type: String(command?.command_type || "shell"),
      payload: String(command?.payload || ""),
      status: String(command?.status || "pending"),
      created_at: String(command?.created_at || ""),
      result: command?.result ? String(command.result) : null,
    }));
  };

  const resetRuleForm = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setConditionType("cpu_usage");
    setConditionOp("gt");
    setConditionValue("90");
    setSeverity("warning");
    setScopeDeviceId("");
    setCooldownSecs("300");
    setNotifyEmails("");
    setEnabled(true);
  };

  const loadRule = (rule: AutomationRule) => {
    setEditingId(rule.id ?? null);
    setName(rule.name || "");
    setDescription(rule.description || "");
    setConditionType(rule.condition_type || "cpu_usage");
    setConditionOp(rule.condition_op || "gt");
    setConditionValue(String(rule.condition_value ?? 0));
    setSeverity(rule.severity || "warning");
    setScopeDeviceId(rule.scope_device_id || "");
    setCooldownSecs(String(rule.cooldown_secs ?? 300));
    setNotifyEmails(rule.notify_emails || "");
    setEnabled(rule.enabled === true || rule.enabled === 1);
    setError(null);
    setSuccess(null);
  };

  const loadData = async () => {
    const accessToken = session()?.access_token;
    if (!accessToken) return;

    setLoading(true);
    setError(null);
    try {
      const [ruleResult, alertResult, commandResult, deviceResult] = await Promise.all([
        invoke<any>("operator_automation_get_rules", { accessToken }),
        invoke<any>("operator_automation_get_alerts", { accessToken }),
        invoke<any>("operator_automation_get_commands", { accessToken }),
        invoke<any>("operator_get_devices", { accessToken }),
      ]);

      setRules(normalizeRules(ruleResult));
      setAlerts(normalizeAlerts(alertResult));
      setCommands(normalizeCommands(commandResult));
      setDevices(
        Array.isArray(deviceResult?.devices)
          ? deviceResult.devices.map((device: any) => ({
              id: String(device?.id || ""),
              hostname: String(device?.hostname || device?.id || ""),
              online: device?.online === true,
            }))
          : []
      );
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const saveRule = async () => {
    const accessToken = session()?.access_token;
    if (!accessToken) return;

    if (!name().trim()) {
      setError(t("automation.rule_name_required"));
      return;
    }

    setSavingRule(true);
    setError(null);
    setSuccess(null);
    try {
      await invoke("operator_automation_save_rule", {
        accessToken,
        rule: {
          id: editingId(),
          name: name().trim(),
          description: description().trim(),
          enabled: enabled(),
          condition_type: conditionType(),
          condition_op: conditionOp(),
          condition_value: Number(conditionValue() || 0),
          severity: severity(),
          scope_device_id: scopeDeviceId().trim() || null,
          cooldown_secs: Number(cooldownSecs() || 300),
          notify_emails: notifyEmails().trim(),
        },
      });
      setSuccess(t("automation.rule_saved"));
      resetRuleForm();
      await loadData();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSavingRule(false);
    }
  };

  const deleteRule = async (ruleId: number) => {
    const accessToken = session()?.access_token;
    if (!accessToken) return;
    if (!window.confirm(t("automation.delete_confirm"))) return;

    setError(null);
    setSuccess(null);
    try {
      await invoke("operator_automation_delete_rule", { accessToken, ruleId });
      setSuccess(t("automation.rule_deleted"));
      if (editingId() === ruleId) resetRuleForm();
      await loadData();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const acknowledgeAlert = async (alertId: number) => {
    const accessToken = session()?.access_token;
    if (!accessToken) return;

    setError(null);
    setSuccess(null);
    try {
      await invoke("operator_automation_ack_alert", { accessToken, alertId });
      setSuccess(t("automation.alert_acknowledged"));
      await loadData();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const queueCommand = async () => {
    const accessToken = session()?.access_token;
    if (!accessToken) return;

    if (!commandDeviceId().trim() || !commandPayload().trim()) {
      setError(t("automation.command_required"));
      return;
    }

    setQueueingCommand(true);
    setError(null);
    setSuccess(null);
    try {
      await invoke("operator_automation_create_command", {
        accessToken,
        command: {
          device_id: commandDeviceId().trim(),
          command_type: commandType(),
          payload: commandPayload().trim(),
        },
      });
      setSuccess(t("automation.command_queued"));
      setCommandPayload("");
      await loadData();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setQueueingCommand(false);
    }
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
          <span class="mi">smart_toy</span>
          {t("automation.title")}
        </h2>
        <span class="badge badge-success">{t("automation.status_live")}</span>
      </div>

      <div class="panel-body" style="padding:24px">
        <Show
          when={session()}
          fallback={
            <div class="card" style="padding:24px;text-align:center">
              <span class="mi" style="font-size:48px;color:var(--text-secondary)">smart_toy</span>
              <h3 style="margin:16px 0 8px">{t("automation.sign_in_required")}</h3>
              <p style="color:var(--text-secondary);max-width:420px;margin:0 auto 20px">
                {t("automation.sign_in_hint")}
              </p>
              <button class="btn btn-primary" onClick={() => navigate("/operator")}>
                <span class="mi">login</span>
                {t("automation.open_operator")}
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

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px">
            <div class="card" style="padding:16px">
              <div class="text-muted" style="font-size:12px">{t("automation.summary_rules")}</div>
              <div style="font-size:28px;font-weight:700">{rules().length}</div>
            </div>
            <div class="card" style="padding:16px">
              <div class="text-muted" style="font-size:12px">{t("automation.summary_alerts")}</div>
              <div style="font-size:28px;font-weight:700">{alerts().filter((alert) => !alert.acknowledged).length}</div>
            </div>
            <div class="card" style="padding:16px">
              <div class="text-muted" style="font-size:12px">{t("automation.summary_commands")}</div>
              <div style="font-size:28px;font-weight:700">{commands().filter((command) => command.status === "pending").length}</div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:minmax(340px,1fr) minmax(320px,1fr);gap:16px;align-items:start">
            <div class="card" style="padding:18px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px">
                <div>
                  <h3 style="margin:0">{t("automation.editor_title")}</h3>
                  <p class="text-secondary" style="margin:6px 0 0;font-size:13px">{t("automation.editor_hint")}</p>
                </div>
                <button class="btn btn-secondary btn-sm" onClick={resetRuleForm}>
                  <span class="mi">restart_alt</span>
                  {t("automation.reset_form")}
                </button>
              </div>

              <div style="display:grid;gap:12px">
                <label style="display:grid;gap:6px">
                  <span>{t("automation.rule_name")}</span>
                  <input type="text" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
                </label>

                <label style="display:grid;gap:6px">
                  <span>{t("automation.rule_description")}</span>
                  <textarea rows={3} value={description()} onInput={(e) => setDescription(e.currentTarget.value)} />
                </label>

                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
                  <label style="display:grid;gap:6px">
                    <span>{t("automation.condition_type")}</span>
                    <select value={conditionType()} onChange={(e) => setConditionType(e.currentTarget.value)}>
                      <option value="cpu_usage">CPU Usage</option>
                      <option value="memory_usage">Memory Usage</option>
                      <option value="disk_usage">Disk Usage</option>
                      <option value="offline_duration">Offline Duration</option>
                      <option value="idle_duration">Idle Duration</option>
                      <option value="custom">Custom</option>
                    </select>
                  </label>

                  <label style="display:grid;gap:6px">
                    <span>{t("automation.condition_operator")}</span>
                    <select value={conditionOp()} onChange={(e) => setConditionOp(e.currentTarget.value)}>
                      <option value="gt">&gt;</option>
                      <option value="gte">&gt;=</option>
                      <option value="lt">&lt;</option>
                      <option value="lte">&lt;=</option>
                      <option value="eq">=</option>
                      <option value="neq">!=</option>
                    </select>
                  </label>
                </div>

                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
                  <label style="display:grid;gap:6px">
                    <span>{t("automation.condition_value")}</span>
                    <input type="number" value={conditionValue()} onInput={(e) => setConditionValue(e.currentTarget.value)} />
                  </label>

                  <label style="display:grid;gap:6px">
                    <span>{t("automation.severity")}</span>
                    <select value={severity()} onChange={(e) => setSeverity(e.currentTarget.value)}>
                      <option value="info">Info</option>
                      <option value="warning">Warning</option>
                      <option value="critical">Critical</option>
                    </select>
                  </label>
                </div>

                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
                  <label style="display:grid;gap:6px">
                    <span>{t("automation.scope_device")}</span>
                    <select value={scopeDeviceId()} onChange={(e) => setScopeDeviceId(e.currentTarget.value)}>
                      <option value="">All devices</option>
                      <For each={devices()}>
                        {(device) => (
                          <option value={device.id}>{device.hostname || device.id}</option>
                        )}
                      </For>
                    </select>
                  </label>

                  <label style="display:grid;gap:6px">
                    <span>{t("automation.cooldown")}</span>
                    <input type="number" value={cooldownSecs()} onInput={(e) => setCooldownSecs(e.currentTarget.value)} />
                  </label>
                </div>

                <label style="display:grid;gap:6px">
                  <span>{t("automation.notify_emails")}</span>
                  <input type="text" value={notifyEmails()} onInput={(e) => setNotifyEmails(e.currentTarget.value)} placeholder="ops@example.com, admin@example.com" />
                </label>

                <label style="display:flex;align-items:center;gap:10px">
                  <input type="checkbox" checked={enabled()} onChange={(e) => setEnabled(e.currentTarget.checked)} />
                  <span>{t("automation.rule_enabled")}</span>
                </label>

                <button class="btn btn-primary" onClick={saveRule} disabled={savingRule()}>
                  <span class="mi">save</span>
                  {editingId() ? t("automation.update_rule") : t("automation.create_rule")}
                </button>
              </div>
            </div>

            <div class="card" style="padding:18px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px">
                <div>
                  <h3 style="margin:0">{t("automation.commands_title")}</h3>
                  <p class="text-secondary" style="margin:6px 0 0;font-size:13px">{t("automation.commands_hint")}</p>
                </div>
                <button class="btn btn-secondary btn-sm" onClick={loadData} disabled={loading()}>
                  <span class="mi">refresh</span>
                  {t("common.refresh")}
                </button>
              </div>

              <div style="display:grid;gap:12px;margin-bottom:16px">
                <label style="display:grid;gap:6px">
                  <span>{t("automation.command_device")}</span>
                  <select value={commandDeviceId()} onChange={(e) => setCommandDeviceId(e.currentTarget.value)}>
                    <option value="">Select device</option>
                    <For each={devices()}>
                      {(device) => (
                        <option value={device.id}>{device.hostname || device.id}</option>
                      )}
                    </For>
                  </select>
                </label>

                <label style="display:grid;gap:6px">
                  <span>{t("automation.command_type")}</span>
                  <select value={commandType()} onChange={(e) => setCommandType(e.currentTarget.value)}>
                    <option value="shell">Shell</option>
                    <option value="powershell">PowerShell</option>
                    <option value="script">Script</option>
                    <option value="restart_service">Restart Service</option>
                    <option value="reboot">Reboot</option>
                  </select>
                </label>

                <label style="display:grid;gap:6px">
                  <span>{t("automation.command_payload")}</span>
                  <textarea rows={5} value={commandPayload()} onInput={(e) => setCommandPayload(e.currentTarget.value)} style="font-family:Consolas, monospace" />
                </label>

                <button class="btn btn-primary" onClick={queueCommand} disabled={queueingCommand()}>
                  <span class="mi">send</span>
                  {t("automation.queue_command")}
                </button>
              </div>

              <Show when={commands().length > 0} fallback={
                <div class="operator-empty" style="padding:12px 0 0">
                  <span class="mi" style="font-size:40px;color:var(--text-muted)">terminal</span>
                  <p>{t("automation.no_commands")}</p>
                </div>
              }>
                <div style="display:grid;gap:10px;max-height:280px;overflow:auto">
                  <For each={commands()}>
                    {(command) => (
                      <div class="card" style="padding:12px;background:var(--surface-2)">
                        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
                          <div>
                            <div style="font-weight:600">{command.device_id}</div>
                            <div class="text-secondary" style="font-size:12px;margin-top:4px">
                              {command.command_type} • {command.status}
                            </div>
                          </div>
                          <div class="text-secondary" style="font-size:12px;white-space:nowrap">
                            {command.created_at ? new Date(command.created_at).toLocaleString() : "-"}
                          </div>
                        </div>
                        <p class="text-secondary" style="margin:10px 0 0">{command.payload}</p>
                        <Show when={command.result}>
                          <p class="text-secondary" style="margin:8px 0 0">{command.result}</p>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:minmax(320px,1fr) minmax(320px,1fr);gap:16px;align-items:start;margin-top:16px">
            <div class="card" style="padding:18px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px">
                <div>
                  <h3 style="margin:0">{t("automation.rules_title")}</h3>
                  <p class="text-secondary" style="margin:6px 0 0;font-size:13px">{t("automation.rules_hint")}</p>
                </div>
              </div>

              <Show when={rules().length > 0} fallback={
                <div class="operator-empty" style="padding:24px 0">
                  <span class="mi" style="font-size:40px;color:var(--text-muted)">rule</span>
                  <p>{t("automation.no_rules")}</p>
                </div>
              }>
                <div style="display:grid;gap:12px;max-height:360px;overflow:auto">
                  <For each={rules()}>
                    {(rule) => (
                      <div class="card" style="padding:14px;background:var(--surface-2)">
                        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
                          <div>
                            <div style="font-weight:600">{rule.name}</div>
                            <div class="text-secondary" style="font-size:12px;margin-top:4px">
                              {rule.condition_type} {rule.condition_op} {rule.condition_value} • {rule.severity} • {rule.enabled ? "enabled" : "disabled"}
                            </div>
                          </div>
                          <div style="display:flex;gap:8px">
                            <button class="btn btn-secondary btn-sm" onClick={() => loadRule(rule)}>
                              <span class="mi">edit</span>
                              {t("common.edit")}
                            </button>
                            <Show when={rule.id != null}>
                              <button class="btn btn-secondary btn-sm" onClick={() => deleteRule(rule.id!)}>
                                <span class="mi">delete</span>
                                {t("common.delete")}
                              </button>
                            </Show>
                          </div>
                        </div>
                        <Show when={rule.description}>
                          <p class="text-secondary" style="margin:10px 0 0">{rule.description}</p>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            <div class="card" style="padding:18px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px">
                <div>
                  <h3 style="margin:0">{t("automation.alerts_title")}</h3>
                  <p class="text-secondary" style="margin:6px 0 0;font-size:13px">{t("automation.alerts_hint")}</p>
                </div>
              </div>

              <Show when={alerts().length > 0} fallback={
                <div class="operator-empty" style="padding:24px 0">
                  <span class="mi" style="font-size:40px;color:var(--text-muted)">notifications</span>
                  <p>{t("automation.no_alerts")}</p>
                </div>
              }>
                <div style="display:grid;gap:12px;max-height:360px;overflow:auto">
                  <For each={alerts()}>
                    {(alert) => (
                      <div class="card" style="padding:14px;background:var(--surface-2)">
                        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
                          <div>
                            <div style="font-weight:600">{alert.rule_name || alert.message || "Alert"}</div>
                            <div class="text-secondary" style="font-size:12px;margin-top:4px">
                              {alert.device_id || "all-devices"} • {alert.severity} • {alert.acknowledged ? "acknowledged" : "pending"}
                            </div>
                          </div>
                          <div class="text-secondary" style="font-size:12px;white-space:nowrap">
                            {alert.triggered_at ? new Date(alert.triggered_at).toLocaleString() : "-"}
                          </div>
                        </div>
                        <Show when={alert.message}>
                          <p class="text-secondary" style="margin:10px 0 0">{alert.message}</p>
                        </Show>
                        <Show when={!alert.acknowledged}>
                          <button class="btn btn-secondary btn-sm" style="margin-top:10px" onClick={() => acknowledgeAlert(alert.id)}>
                            <span class="mi">done</span>
                            {t("automation.acknowledge")}
                          </button>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default AutomationPanel;
