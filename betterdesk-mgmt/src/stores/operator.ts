import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export interface OperatorSession {
  access_token: string;
  username: string;
  role: string;
  logged_in_at: number;
}

export interface OperatorHelpRequest {
  id: string;
  device_id: string;
  hostname: string;
  message: string;
  timestamp: number;
  status: string;
}

export interface OperatorDeviceGroup {
  id: number;
  name: string;
  color: string;
  device_count: number;
}

// ---------------------------------------------------------------------------
//  Store
// ---------------------------------------------------------------------------

function createOperatorStore() {
  const [session, setSession] = createSignal<OperatorSession | null>(null);
  const [helpRequests, setHelpRequests] = createSignal<OperatorHelpRequest[]>([]);
  const [groups, setGroups] = createSignal<OperatorDeviceGroup[]>([]);

  return {
    session,
    helpRequests,
    groups,

    get isLoggedIn() {
      return session() !== null;
    },

    get token() {
      return session()?.access_token ?? null;
    },

    login(token: string, username: string, role: string) {
      setSession({
        access_token: token,
        username,
        role,
        logged_in_at: Date.now(),
      });
    },

    logout() {
      setSession(null);
      setHelpRequests([]);
      setGroups([]);
    },

    updateHelpRequests(requests: OperatorHelpRequest[]) {
      setHelpRequests(requests);
    },

    updateGroups(groupList: OperatorDeviceGroup[]) {
      setGroups(groupList);
    },

    get pendingHelpCount() {
      return helpRequests().filter((r) => r.status === "pending").length;
    },
  };
}

export const operatorStore = createOperatorStore();
