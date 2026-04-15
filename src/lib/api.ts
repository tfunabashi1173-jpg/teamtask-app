import { mobileEnv } from "../config/env";

export type TaskPhotoRecord = {
  id: string;
  task_id: string;
  file_name: string;
  mime_type: string;
  storage_path: string;
  preview_url: string | null;
  created_at: string;
};

export type MobileTaskRecord = {
  id: string;
  title: string;
  description: string | null;
  priority: "urgent" | "high" | "medium" | "low";
  status: "pending" | "in_progress" | "awaiting_confirmation" | "done" | "skipped";
  scheduled_date: string;
  scheduled_time: string | null;
  visibility_type: "group" | "personal";
  group_id: string | null;
  owner_user_id: string | null;
  deleted_at: string | null;
  photos?: TaskPhotoRecord[];
  reference_photos?: TaskPhotoRecord[];
  recurrence_rule_id?: string | null;
  recurrence?: {
    frequency: "daily" | "weekly" | "monthly";
    interval_value: number;
    days_of_week: number[] | null;
    day_of_month: number | null;
    start_date: string;
    end_date: string | null;
    is_active: boolean;
  } | null;
};

export type MobileGroup = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

export type MobileAppUser = {
  id: string;
  line_user_id: string;
  display_name: string;
  line_picture_url?: string | null;
  role: "admin" | "member";
  is_active: boolean;
};

export type MobileWorkspace = {
  id: string;
  name: string;
  timezone: string;
  notification_time: string;
};

export type MobileLogRecord = {
  id: string;
  action_type: string;
  created_at: string;
  actor: {
    display_name: string;
    line_picture_url?: string | null;
  } | null;
  task: {
    title: string;
  } | null;
};

export type MobileMemberRecord = {
  id: string;
  display_name: string;
  line_picture_url?: string | null;
  role: "admin" | "member";
  is_active: boolean;
};

export type MobileMembershipRequestRecord = {
  id: string;
  group_id: string;
  requested_name: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  line_user_id: string;
};

export type MobileInviteRecord = {
  id: string;
  group_id: string;
  invite_token: string;
  expires_at: string;
  is_active: boolean;
};

export type MobileAppState = {
  sessionLineUserId: string | null;
  appUser: MobileAppUser | null;
  workspace: MobileWorkspace | null;
  groups: MobileGroup[];
  tasks: MobileTaskRecord[];
  logs: MobileLogRecord[];
  members: MobileMemberRecord[];
  pendingRequests: MobileMembershipRequestRecord[];
  activeInvite: MobileInviteRecord | null;
  needsBootstrap: boolean;
  authConfigured: boolean;
};

export type AppStateResponse = {
  ok: boolean;
  state: MobileAppState;
};

export type BootstrapResponse = {
  ok: boolean;
};

export type SessionExchangeResponse = {
  sessionToken: string;
  user: {
    lineUserId: string;
    displayName: string | null;
    pictureUrl?: string | null;
  };
};

export type TaskAction = "start" | "confirm" | "complete" | "pause" | "postpone";
export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export type CreateTaskPayload = {
  workspaceId: string;
  title: string;
  description?: string;
  priority: "urgent" | "high" | "medium" | "low";
  scheduledDate: string;
  scheduledTime?: string | null;
  visibilityType: "group" | "personal";
  groupId?: string | null;
  recurrence?: {
    enabled: boolean;
    frequency?: RecurrenceFrequency;
    interval?: number;
    endDate?: string;
    daysOfWeek?: number[];
    dayOfMonth?: number | null;
  };
};

export type UpdateTaskPayload = {
  title?: string;
  description?: string | null;
  priority?: "urgent" | "high" | "medium" | "low";
  scheduledDate?: string;
  scheduledTime?: string | null;
  recurrence?: {
    enabled: boolean;
    frequency?: RecurrenceFrequency;
    interval?: number;
    endDate?: string;
    daysOfWeek?: number[];
    dayOfMonth?: number | null;
  };
};

export type UploadableImage = {
  uri: string;
  name: string;
  mimeType: string;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function createBackendUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimTrailingSlash(mobileEnv.webAppUrl)}${normalizedPath}`;
}

export function createAuthHeaders(sessionToken: string) {
  return {
    Authorization: `Bearer ${sessionToken}`,
  };
}

async function readJson<T>(response: Response) {
  if (!response.ok) {
    let errorCode = `HTTP_${response.status}`;

    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        errorCode = payload.error;
      }
    } catch {
      // Ignore JSON parse failures and keep the HTTP status.
    }

    throw new Error(errorCode);
  }

  return (await response.json()) as T;
}

async function sendImageFormRequest<T>(
  path: string,
  method: "POST" | "PATCH",
  image: UploadableImage,
  sessionToken: string,
) {
  const formData = new FormData();
  formData.append("file", {
    uri: image.uri,
    name: image.name,
    type: image.mimeType,
  } as never);

  const response = await fetch(createBackendUrl(path), {
    method,
    headers: {
      ...createAuthHeaders(sessionToken),
      "Cache-Control": "no-store",
    },
    body: formData,
  });

  return readJson<T>(response);
}

export async function fetchAppState(sessionToken: string) {
  const response = await fetch(createBackendUrl("/api/app-state"), {
    headers: {
      ...createAuthHeaders(sessionToken),
      "Cache-Control": "no-store",
    },
  });

  return readJson<AppStateResponse>(response);
}

export async function fetchPublicAppState() {
  const response = await fetch(createBackendUrl("/api/app-state"), {
    headers: {
      "Cache-Control": "no-store",
    },
  });

  return readJson<AppStateResponse>(response);
}

export async function bootstrapWorkspace(
  payload: {
    workspaceName: string;
    groupName: string;
    displayName: string;
  },
  sessionToken: string,
) {
  const response = await fetch(createBackendUrl("/api/setup/bootstrap"), {
    method: "POST",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  });

  return readJson<BootstrapResponse>(response);
}

export async function exchangeMobileSession(requestId: string) {
  const response = await fetch(createBackendUrl("/api/auth/mobile/exchange"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({ requestId }),
  });

  return readJson<SessionExchangeResponse>(response);
}

export async function submitMembershipRequest(
  payload: {
    inviteToken: string;
    requestedName: string;
  },
  sessionToken: string,
) {
  const response = await fetch(createBackendUrl("/api/membership-requests"), {
    method: "POST",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  });

  return readJson<{ ok: boolean }>(response);
}

export async function postTaskAction(taskId: string, action: TaskAction, sessionToken: string) {
  const response = await fetch(createBackendUrl(`/api/tasks/${taskId}/actions`), {
    method: "POST",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({ action }),
  });

  return readJson<{ ok: boolean }>(response);
}

export async function createTask(payload: CreateTaskPayload, sessionToken: string) {
  const response = await fetch(createBackendUrl("/api/tasks"), {
    method: "POST",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  });

  return readJson<{ ok: boolean }>(response);
}

export async function updateTask(
  taskId: string,
  payload: UpdateTaskPayload,
  sessionToken: string,
) {
  const response = await fetch(createBackendUrl(`/api/tasks/${taskId}`), {
    method: "PATCH",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  });

  return readJson<{ ok: boolean }>(response);
}

export async function deleteTask(taskId: string, sessionToken: string) {
  const response = await fetch(createBackendUrl(`/api/tasks/${taskId}`), {
    method: "DELETE",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Cache-Control": "no-store",
    },
  });

  return readJson<{ ok: boolean }>(response);
}

export async function dismissLog(logId: string, sessionToken: string) {
  const response = await fetch(createBackendUrl(`/api/logs/${logId}/dismiss`), {
    method: "POST",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Cache-Control": "no-store",
    },
  });

  return readJson<{ ok: boolean }>(response);
}

export async function uploadReferencePhoto(
  taskId: string,
  image: UploadableImage,
  sessionToken: string,
) {
  return sendImageFormRequest<{ ok: boolean }>(
    `/api/tasks/${taskId}/reference-photos`,
    "POST",
    image,
    sessionToken,
  );
}

export async function replaceReferencePhoto(
  taskId: string,
  photoId: string,
  image: UploadableImage,
  sessionToken: string,
) {
  return sendImageFormRequest<{ ok: boolean }>(
    `/api/tasks/${taskId}/reference-photos/${photoId}`,
    "PATCH",
    image,
    sessionToken,
  );
}

export async function deleteReferencePhoto(
  taskId: string,
  photoId: string,
  sessionToken: string,
) {
  const response = await fetch(createBackendUrl(`/api/tasks/${taskId}/reference-photos/${photoId}`), {
    method: "DELETE",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Cache-Control": "no-store",
    },
  });

  return readJson<{ ok: boolean }>(response);
}

export async function uploadTaskPhoto(
  taskId: string,
  image: UploadableImage,
  sessionToken: string,
) {
  return sendImageFormRequest<{ ok: boolean }>(
    `/api/tasks/${taskId}/photos`,
    "POST",
    image,
    sessionToken,
  );
}

export async function replaceTaskPhoto(
  taskId: string,
  photoId: string,
  image: UploadableImage,
  sessionToken: string,
) {
  return sendImageFormRequest<{ ok: boolean }>(
    `/api/tasks/${taskId}/photos/${photoId}`,
    "PATCH",
    image,
    sessionToken,
  );
}

export async function deleteTaskPhoto(
  taskId: string,
  photoId: string,
  sessionToken: string,
) {
  const response = await fetch(createBackendUrl(`/api/tasks/${taskId}/photos/${photoId}`), {
    method: "DELETE",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Cache-Control": "no-store",
    },
  });

  return readJson<{ ok: boolean }>(response);
}

export async function generateGroupInvite(groupId: string, sessionToken: string) {
  const response = await fetch(createBackendUrl(`/api/groups/${groupId}/invites`), {
    method: "POST",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Cache-Control": "no-store",
    },
  });

  return readJson<{ ok: boolean; inviteUrl: string; expiresAt: string }>(response);
}

export async function createGroup(
  payload: {
    name: string;
    description?: string | null;
  },
  sessionToken: string,
) {
  const response = await fetch(createBackendUrl("/api/groups"), {
    method: "POST",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  });

  return readJson<{ ok: boolean; group: MobileGroup }>(response);
}

export async function approveMembershipRequest(requestId: string, sessionToken: string) {
  const response = await fetch(createBackendUrl(`/api/membership-requests/${requestId}/approve`), {
    method: "POST",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Cache-Control": "no-store",
    },
  });

  return readJson<{ ok: boolean }>(response);
}

export async function rejectMembershipRequest(requestId: string, sessionToken: string) {
  const response = await fetch(createBackendUrl(`/api/membership-requests/${requestId}/reject`), {
    method: "POST",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Cache-Control": "no-store",
    },
  });

  return readJson<{ ok: boolean }>(response);
}

export async function removeMember(userId: string, sessionToken: string) {
  const response = await fetch(createBackendUrl(`/api/members/${userId}`), {
    method: "DELETE",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Cache-Control": "no-store",
    },
  });

  return readJson<{ ok: boolean }>(response);
}

export async function updateWorkspaceSettings(notificationTime: string, sessionToken: string) {
  const response = await fetch(createBackendUrl("/api/workspace/settings"), {
    method: "PATCH",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({ notificationTime }),
  });

  return readJson<{ ok: boolean }>(response);
}

export async function leaveGroup(groupId: string, sessionToken: string) {
  const response = await fetch(createBackendUrl(`/api/groups/${groupId}/leave`), {
    method: "POST",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Cache-Control": "no-store",
    },
  });

  return readJson<{ ok: boolean; leftWorkspace?: boolean }>(response);
}

export async function saveExpoPushToken(
  expoPushToken: string,
  platform: "ios" | "android",
  sessionToken: string,
) {
  const response = await fetch(createBackendUrl("/api/push/expo"), {
    method: "POST",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({
      expoPushToken,
      platform,
      deviceLabel: "native-app",
    }),
  });

  return readJson<{ ok: boolean }>(response);
}

export async function removeExpoPushToken(expoPushToken: string, sessionToken: string) {
  const response = await fetch(createBackendUrl("/api/push/expo"), {
    method: "DELETE",
    headers: {
      ...createAuthHeaders(sessionToken),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({ expoPushToken }),
  });

  return readJson<{ ok: boolean }>(response);
}
