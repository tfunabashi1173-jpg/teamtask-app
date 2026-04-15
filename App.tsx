import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Image,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  SafeAreaView,
  Share,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import * as ImagePicker from "expo-image-picker";
import NetInfo from "@react-native-community/netinfo";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { fetchBackendVersion } from "./src/lib/backend";
import {
  approveMembershipRequest,
  bootstrapWorkspace,
  createGroup,
  createAuthHeaders,
  createBackendUrl,
  createTask,
  deleteTask,
  deleteReferencePhoto,
  deleteTaskPhoto,
  dismissLog,
  exchangeMobileSession,
  fetchAppState,
  fetchPublicAppState,
  generateGroupInvite,
  leaveGroup,
  removeMember,
  removeExpoPushToken,
  postTaskAction,
  rejectMembershipRequest,
  replaceReferencePhoto,
  replaceTaskPhoto,
  submitMembershipRequest,
  type CreateTaskPayload,
  type MobileAppState,
  type MobileGroup,
  type MobileLogRecord,
  type MobileMemberRecord,
  type MobileMembershipRequestRecord,
  type MobileTaskRecord,
  type RecurrenceFrequency,
  type TaskAction,
  type TaskPhotoRecord,
  type UploadableImage,
  uploadReferencePhoto,
  uploadTaskPhoto,
  updateTask,
  updateWorkspaceSettings,
  saveExpoPushToken,
} from "./src/lib/api";

WebBrowser.maybeCompleteAuthSession();
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const SESSION_TOKEN_KEY = "team-task-mobile-session-token";
const EXPO_PUSH_TOKEN_KEY = "team-task-mobile-expo-push-token";
const MORNING_LOCAL_NOTIFICATION_KIND = "morning-task-summary";
const APP_SCHEME = "teamtaskmobile";
const BRAND = "#1F6B52";
const SURFACE = "#F5F2EA";
const CARD = "#FFFCF7";
const BORDER = "#E7E0D4";
const TEXT = "#1E1C19";
const MUTED = "#7E766C";
const WEEKDAYS = [
  { label: "日", value: 0 },
  { label: "月", value: 1 },
  { label: "火", value: 2 },
  { label: "水", value: 3 },
  { label: "木", value: 4 },
  { label: "金", value: 5 },
  { label: "土", value: 6 },
];

type LoadState = "booting" | "logged_out" | "ready";
type DraftTask = {
  title: string;
  description: string;
  priority: "urgent" | "high" | "medium" | "low";
  scheduledDate: string;
  scheduledTime: string;
  recurrenceEnabled: boolean;
  recurrenceFrequency: RecurrenceFrequency;
  recurrenceInterval: string;
  recurrenceEndDate: string;
  recurrenceDaysOfWeek: number[];
  recurrenceDayOfMonth: string;
  copiedFromTaskId: string | null;
};

type EditorMode = "create" | "edit";
type RangeDraft = {
  startDate: string;
  endDate: string;
};
type GroupScopeId = string;
type InviteDraft = {
  rawInput: string;
  requestedName: string;
};
type BootstrapDraft = {
  workspaceName: string;
  groupName: string;
  displayName: string;
};
type GroupDraft = {
  name: string;
  description: string;
};
type DraftReferencePhoto = UploadableImage & {
  previewUri: string;
};

function requestAgeLabel(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function syncLabel(value: string | null) {
  if (!value) {
    return "未同期";
  }

  return `最終同期 ${new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))}`;
}

function createRedirectUri() {
  return `${APP_SCHEME}://auth/callback`;
}

function createDefaultDraft(baseDate: string): DraftTask {
  return {
    title: "",
    description: "",
    priority: "medium",
    scheduledDate: baseDate,
    scheduledTime: "",
    recurrenceEnabled: false,
    recurrenceFrequency: "weekly",
    recurrenceInterval: "1",
    recurrenceEndDate: baseDate,
    recurrenceDaysOfWeek: [],
    recurrenceDayOfMonth: "1",
    copiedFromTaskId: null,
  };
}

function createDraftFromTask(task: MobileTaskRecord): DraftTask {
  return {
    title: task.title,
    description: task.description ?? "",
    priority: task.priority,
    scheduledDate: task.scheduled_date,
    scheduledTime: task.scheduled_time ?? "",
    recurrenceEnabled: Boolean(task.recurrence),
    recurrenceFrequency: task.recurrence?.frequency ?? "weekly",
    recurrenceInterval: String(task.recurrence?.interval_value ?? 1),
    recurrenceEndDate: task.recurrence?.end_date ?? task.scheduled_date,
    recurrenceDaysOfWeek: task.recurrence?.days_of_week ?? [],
    recurrenceDayOfMonth: String(task.recurrence?.day_of_month ?? 1),
    copiedFromTaskId: task.id,
  };
}

function formatApiError(error: unknown) {
  const code = error instanceof Error ? error.message : "";

  switch (code) {
    case "ALREADY_MEMBER":
      return "このグループには既に参加しています。";
    case "DUPLICATE_REQUEST":
      return "参加申請は送信済みです。";
    case "INVALID_INVITE":
      return "招待リンクまたは招待コードが無効です。";
    case "ALREADY_BOOTSTRAPPED":
      return "初期セットアップは既に完了しています。";
    case "HIGH_PRIORITY_CANNOT_POSTPONE":
      return "高優先度タスクは翌日に回せません。";
    case "ACTOR_NOT_FOUND":
      return "メンバー情報の取得に失敗しました。";
    case "TASK_NOT_FOUND":
      return "対象のタスクが見つかりません。";
    case "SESSION_NOT_READY":
      return "ログイン処理が完了していません。";
    case "SESSION_EXPIRED":
      return "ログイン期限が切れました。もう一度ログインしてください。";
    case "UNAUTHORIZED":
    case "HTTP_401":
      return "認証が切れました。再ログインしてください。";
    case "INVALID_INPUT":
      return "入力内容が不足しています。";
    case "INVALID_RECURRENCE":
      return "繰り返し設定が不足しています。";
    case "INVALID_RECURRENCE_PERIOD":
      return "繰り返しの終了日は開始日以降にしてください。";
    case "INVALID_FILE":
      return "画像ファイルを選択してください。";
    case "PHOTO_LIMIT_REACHED":
      return "写真の上限枚数に達しています。";
    case "TASK_NOT_COMPLETED":
      return "完了写真はタスク完了後に登録できます。";
    case "PHOTO_PERMISSION_DENIED":
      return "写真ライブラリへのアクセスを許可してください。";
    case "CAMERA_PERMISSION_DENIED":
      return "カメラへのアクセスを許可してください。";
    case "NOTIFICATION_PERMISSION_DENIED":
      return "通知を許可してください。";
    case "FORBIDDEN":
      return "この操作を実行する権限がありません。";
    case "LAST_ADMIN_CANNOT_LEAVE":
      return "最後の管理者はグループから退出できません。";
    case "MEMBERSHIP_NOT_FOUND":
    case "REQUEST_NOT_FOUND":
      return "対象データが見つかりません。";
    default:
      return "通信に失敗しました。ネットワーク状態を確認してください。";
  }
}

function extractInviteToken(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    return url.searchParams.get("invite")?.trim() ?? trimmed;
  } catch {
    return trimmed;
  }
}

function formatTaskDateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatLocalDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildTodayLabel() {
  return formatLocalDate(new Date());
}

function shiftDate(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return formatLocalDate(date);
}

function parseNotificationTime(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

function buildMorningNotificationSummary(tasks: MobileTaskRecord[], dateLabel: string) {
  const targetTasks = tasks
    .filter(
      (task) =>
        task.scheduled_date === dateLabel &&
        task.deleted_at === null &&
        task.status !== "done" &&
        task.status !== "skipped",
    )
    .sort(compareTaskOrder);

  if (targetTasks.length === 0) {
    return {
      title: `${formatTaskDateLabel(dateLabel)}のタスク`,
      body: "未完了タスクはありません。",
    };
  }

  const preview = targetTasks
    .slice(0, 3)
    .map((task) => task.title)
    .join(" / ");
  const restCount = targetTasks.length - Math.min(targetTasks.length, 3);

  return {
    title: `${formatTaskDateLabel(dateLabel)}のタスク ${targetTasks.length}件`,
    body: restCount > 0 ? `${preview} / ほか${restCount}件` : preview,
  };
}

function recurrenceSummary(task: MobileTaskRecord) {
  if (!task.recurrence) {
    return null;
  }

  if (task.recurrence.frequency === "daily") {
    return `${task.recurrence.interval_value}日ごと`;
  }

  if (task.recurrence.frequency === "weekly") {
    const labels =
      task.recurrence.days_of_week
        ?.map((day) => WEEKDAYS.find((entry) => entry.value === day)?.label)
        .filter(Boolean)
        .join(" ")
        ?? "";
    return `毎週 ${labels}`.trim();
  }

  return `毎月 ${task.recurrence.day_of_month ?? 1}日`;
}

function compareTaskOrder(left: MobileTaskRecord, right: MobileTaskRecord) {
  const priorityRank = (task: MobileTaskRecord) => {
    if (task.status === "done") {
      return 4;
    }

    if (task.priority === "urgent") {
      return 0;
    }

    if (task.priority === "high") {
      return 1;
    }

    if (task.priority === "medium") {
      return 2;
    }

    return 3;
  };

  const rankDiff = priorityRank(left) - priorityRank(right);
  if (rankDiff !== 0) {
    return rankDiff;
  }

  const leftTime = left.scheduled_time ?? "99:99";
  const rightTime = right.scheduled_time ?? "99:99";
  return leftTime.localeCompare(rightTime);
}

function statusLabel(status: MobileTaskRecord["status"]) {
  switch (status) {
    case "pending":
      return "未着手";
    case "in_progress":
      return "作業中";
    case "awaiting_confirmation":
      return "確認待ち";
    case "done":
      return "完了";
    default:
      return "保留";
  }
}

function actionLabel(action: TaskAction) {
  switch (action) {
    case "start":
      return "開始";
    case "confirm":
      return "確認待ち";
    case "complete":
      return "完了";
    case "pause":
      return "中断";
    case "postpone":
      return "翌日";
  }
}

function logMessage(log: MobileLogRecord) {
  const actor = log.actor?.display_name ?? "誰か";
  const title = log.task?.title ?? "タスク";

  switch (log.action_type) {
    case "started":
      return `${actor}が「${title}」を開始`;
    case "completed":
      return `${actor}が「${title}」を完了`;
    case "confirm_requested":
      return `${actor}が「${title}」を確認待ち`;
    case "postponed_to_next_day":
      return `${actor}が「${title}」を翌日に移動`;
    case "created":
      return `${actor}が「${title}」を登録`;
    default:
      return `${actor}が「${title}」を更新`;
  }
}

function groupName(groups: MobileGroup[], groupId: string | null) {
  if (!groupId) {
    return "";
  }

  return groups.find((group) => group.id === groupId)?.name ?? "グループ";
}

function taskTitle(task: MobileTaskRecord) {
  if (task.status === "done") {
    return `✅ ${task.title}`;
  }

  return `${priorityBadge(task.priority)} ${task.title}`;
}

function priorityLabel(priority: MobileTaskRecord["priority"]) {
  switch (priority) {
    case "urgent":
      return "🚨";
    case "high":
      return "🔴";
    case "medium":
      return "🟠";
    default:
      return "⚪️";
  }
}

function priorityBadge(priority: MobileTaskRecord["priority"]) {
  return priorityLabel(priority);
}

function TaskPreviewImage({
  photo,
  sessionToken,
  onPress,
  busy,
}: {
  photo: TaskPhotoRecord;
  sessionToken: string;
  onPress?: () => void;
  busy?: boolean;
}) {
  if (!photo.preview_url) {
    return null;
  }

  return (
    <Pressable onPress={onPress} disabled={busy} style={styles.previewImageWrap}>
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <Image
        source={{
          uri: createBackendUrl(photo.preview_url),
          headers: createAuthHeaders(sessionToken),
        }}
        style={styles.previewImage}
        resizeMode="cover"
      />
      {busy ? (
        <View style={styles.previewImageOverlay}>
          <ActivityIndicator color="#FFFFFF" />
          <Text style={styles.previewImageOverlayText}>アップロード中...</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function localAppMetadata() {
  const version = Constants.expoConfig?.version ?? "0.0.0";
  const commitSha =
    typeof Constants.expoConfig?.extra?.appCommitSha === "string"
      ? Constants.expoConfig.extra.appCommitSha
      : "devbuild";

  return {
    appVersion: `v${version}`,
    commitSha,
  };
}

function SwipeDismissLogItem({
  log,
  busy,
  onDismiss,
}: {
  log: MobileLogRecord;
  busy: boolean;
  onDismiss: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [opened, setOpened] = useState(false);

  const animateTo = useCallback(
    (value: number) => {
      Animated.spring(translateX, {
        toValue: value,
        useNativeDriver: true,
        bounciness: 0,
      }).start(() => {
        setOpened(value !== 0);
      });
    },
    [translateX],
  );

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 12 && Math.abs(gesture.dy) < 10,
      onPanResponderMove: (_, gesture) => {
        const nextValue = opened ? -88 + gesture.dx : gesture.dx;
        translateX.setValue(Math.max(-88, Math.min(0, nextValue)));
      },
      onPanResponderRelease: (_, gesture) => {
        const shouldOpen = opened ? gesture.dx < 24 : gesture.dx < -24;
        animateTo(shouldOpen ? -88 : 0);
      },
      onPanResponderTerminate: () => animateTo(opened ? -88 : 0),
    }),
  ).current;

  return (
    <View style={styles.logSwipeFrame}>
      <View style={styles.logDeleteSlot}>
        <Pressable
          style={styles.logDeleteButton}
          onPress={onDismiss}
          disabled={busy}
        >
          <Text style={styles.logDeleteButtonText}>{busy ? "..." : "削除"}</Text>
        </Pressable>
      </View>
      <Animated.View
        style={[styles.logSwipeCard, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <View style={styles.logBubble}>
          {log.actor?.line_picture_url ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image source={{ uri: log.actor.line_picture_url }} style={styles.logAvatar} />
          ) : (
            <View style={styles.logAvatarFallback}>
              <Text style={styles.logAvatarFallbackText}>
                {(log.actor?.display_name ?? "?").slice(0, 1)}
              </Text>
            </View>
          )}
          <View style={styles.logBody}>
            <Text style={styles.logText}>{logMessage(log)}</Text>
            <Text style={styles.logTime}>
              {new Intl.DateTimeFormat("ja-JP", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(log.created_at))}
            </Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

export default function App() {
  const [loadState, setLoadState] = useState<LoadState>("booting");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [appState, setAppState] = useState<MobileAppState | null>(null);
  const [backendVersion, setBackendVersion] = useState<{ appVersion: string; commitSha: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [actingTaskId, setActingTaskId] = useState<string | null>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [selectedDate, setSelectedDate] = useState(buildTodayLabel());
  const [draftTask, setDraftTask] = useState<DraftTask>(() => createDefaultDraft(buildTodayLabel()));
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [selectedGroupScope, setSelectedGroupScope] = useState<GroupScopeId>("");
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [dismissingLogId, setDismissingLogId] = useState<string | null>(null);
  const [photoViewer, setPhotoViewer] = useState<{ uri: string; label: string } | null>(null);
  const [uploadingPhotoKey, setUploadingPhotoKey] = useState<string | null>(null);
  const [draftReferencePhotos, setDraftReferencePhotos] = useState<DraftReferencePhoto[]>([]);
  const [listModalVisible, setListModalVisible] = useState(false);
  const [rangeDraft, setRangeDraft] = useState<RangeDraft>({
    startDate: buildTodayLabel(),
    endDate: shiftDate(buildTodayLabel(), 30),
  });
  const [managementModalVisible, setManagementModalVisible] = useState(false);
  const [managementBusyKey, setManagementBusyKey] = useState<string | null>(null);
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [inviteDraft, setInviteDraft] = useState<InviteDraft>({ rawInput: "", requestedName: "" });
  const [joiningInvite, setJoiningInvite] = useState(false);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [bootstrapDraft, setBootstrapDraft] = useState<BootstrapDraft>({
    workspaceName: "",
    groupName: "",
    displayName: "",
  });
  const [groupDraft, setGroupDraft] = useState<GroupDraft>({ name: "", description: "" });
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [schedulingTestNotification, setSchedulingTestNotification] = useState(false);
  const [notificationTimeDraft, setNotificationTimeDraft] = useState("08:00");
  const [isOnline, setIsOnline] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<
    "granted" | "denied" | "undetermined"
  >("undetermined");
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const previousSelectedDateRef = useRef(buildTodayLabel());
  const dateTitleSlide = useRef(new Animated.Value(0)).current;
  const [animatedDateLabel, setAnimatedDateLabel] = useState(buildTodayLabel());
  const localVersion = useMemo(localAppMetadata, []);

  const clearMorningLocalNotifications = useCallback(async () => {
    const requests = await Notifications.getAllScheduledNotificationsAsync();
    const targets = requests.filter(
      (request) => request.content.data?.kind === MORNING_LOCAL_NOTIFICATION_KIND,
    );

    await Promise.all(
      targets.map((request) =>
        Notifications.cancelScheduledNotificationAsync(request.identifier),
      ),
    );
  }, []);

  const loadBackendVersion = useCallback(async () => {
    try {
      const version = await fetchBackendVersion();
      setBackendVersion({
        appVersion: version.appVersion,
        commitSha: version.commitSha,
      });
    } catch {
      setBackendVersion(null);
    }
  }, []);

  const loadPublicState = useCallback(async () => {
    try {
      const response = await fetchPublicAppState();
      setAppState(response.state);
    } catch {
      setAppState(null);
    }
  }, []);

  const loadSession = useCallback(async () => {
    const storedToken = await SecureStore.getItemAsync(SESSION_TOKEN_KEY);

    if (!storedToken) {
      setSessionToken(null);
      await loadPublicState();
      setLoadState("logged_out");
      return;
    }

    setSessionToken(storedToken);

    try {
      const response = await fetchAppState(storedToken);
      setAppState(response.state);
      setLoadState("ready");
      setErrorMessage(null);
      setLastSyncedAt(new Date().toISOString());
    } catch (error) {
      await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
      setSessionToken(null);
      await loadPublicState();
      setLoadState("logged_out");
      setErrorMessage(formatApiError(error));
    }
  }, [loadPublicState]);

  useEffect(() => {
    void (async () => {
      await loadBackendVersion();
      await loadSession();
    })();
  }, [loadBackendVersion, loadSession]);

  useEffect(() => {
    if (appState?.workspace?.notification_time) {
      setNotificationTimeDraft(appState.workspace.notification_time.slice(0, 5));
    }
  }, [appState?.workspace?.notification_time]);

  useEffect(() => {
    void (async () => {
      const settings = await Notifications.getPermissionsAsync();
      setNotificationPermission(settings.status);
    })();
  }, []);

  const syncMorningLocalNotification = useCallback(async () => {
    await clearMorningLocalNotifications();

    if (loadState !== "ready") {
      return;
    }

    const notificationTime = appState?.workspace?.notification_time?.slice(0, 5) ?? "";
    const parsedTime = parseNotificationTime(notificationTime);
    if (!parsedTime) {
      return;
    }

    const settings = await Notifications.getPermissionsAsync();
    setNotificationPermission(settings.status);

    if (settings.status !== "granted") {
      return;
    }

    const firstTrigger = new Date();
    firstTrigger.setHours(parsedTime.hour, parsedTime.minute, 0, 0);

    if (firstTrigger.getTime() <= Date.now()) {
      firstTrigger.setDate(firstTrigger.getDate() + 1);
    }

    const scheduleTargets = Array.from({ length: 7 }, (_, index) => {
      const triggerDate = new Date(firstTrigger);
      triggerDate.setDate(firstTrigger.getDate() + index);
      return triggerDate;
    });

    await Promise.all(
      scheduleTargets.map((triggerDate) => {
        const targetDateLabel = formatLocalDate(triggerDate);
        const summary = buildMorningNotificationSummary(appState?.tasks ?? [], targetDateLabel);

        return Notifications.scheduleNotificationAsync({
          content: {
            title: summary.title,
            body: summary.body,
            sound: "default",
            data: {
              kind: MORNING_LOCAL_NOTIFICATION_KIND,
              date: targetDateLabel,
            },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerDate,
          },
        });
      }),
    );
  }, [appState?.tasks, appState?.workspace?.notification_time, clearMorningLocalNotifications, loadState]);

  useEffect(() => {
    if (loadState !== "ready") {
      return;
    }

    void (async () => {
      await ImagePicker.requestMediaLibraryPermissionsAsync();
      await ImagePicker.requestCameraPermissionsAsync();
    })();
  }, [loadState]);

  useEffect(() => {
    void syncMorningLocalNotification();
  }, [syncMorningLocalNotification]);

  useEffect(() => {
    const previousDate = previousSelectedDateRef.current;
    if (previousDate === selectedDate) {
      return;
    }

    const direction = selectedDate > previousDate ? 1 : -1;
    previousSelectedDateRef.current = selectedDate;
    setAnimatedDateLabel(selectedDate);
    dateTitleSlide.setValue(26 * direction);

    Animated.spring(dateTitleSlide, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 6,
      speed: 18,
    }).start();
  }, [dateTitleSlide, selectedDate]);

  const refreshData = useCallback(async () => {
    if (!sessionToken) {
      return;
    }

    setRefreshing(true);

    try {
      const response = await fetchAppState(sessionToken);
      setAppState(response.state);
      setErrorMessage(null);
      setLoadState("ready");
      setLastSyncedAt(new Date().toISOString());
    } catch (error) {
      setErrorMessage(formatApiError(error));
    } finally {
      setRefreshing(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const wasBackground = appStateRef.current !== "active";
      appStateRef.current = nextState;

      if (nextState === "active" && wasBackground) {
        void loadBackendVersion();
        if (sessionToken) {
          void refreshData();
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [loadBackendVersion, refreshData, sessionToken]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const nextOnline = Boolean(state.isConnected && state.isInternetReachable !== false);
      setIsOnline(nextOnline);

      if (nextOnline && sessionToken) {
        void refreshData();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [refreshData, sessionToken]);

  const performInviteJoin = useCallback(
    async (rawInput: string, requestedName: string, authToken: string) => {
      const inviteToken = extractInviteToken(rawInput);
      if (!inviteToken || !requestedName.trim()) {
        throw new Error("INVALID_INPUT");
      }

      await submitMembershipRequest(
        {
          inviteToken,
          requestedName: requestedName.trim(),
        },
        authToken,
      );
      const response = await fetchAppState(authToken);
      setAppState(response.state);
      setLastSyncedAt(new Date().toISOString());
      setJoinModalVisible(false);
      Alert.alert("参加申請を送信しました", "管理者の承認後にグループへ参加できます。");
    },
    [],
  );

  const handleLogin = useCallback(async () => {
    setLoggingIn(true);
    setErrorMessage(null);

    try {
      const redirectUri = createRedirectUri();
      const startUrl = createBackendUrl(
        `/api/auth/mobile/line/start?redirect_uri=${encodeURIComponent(redirectUri)}`,
      );

      const result = await WebBrowser.openAuthSessionAsync(startUrl, redirectUri);

      if (result.type !== "success" || !result.url) {
        throw new Error("LOGIN_CANCELLED");
      }

      const url = new URL(result.url);
      const requestId = url.searchParams.get("request_id");
      const error = url.searchParams.get("error");

      if (error) {
        throw new Error(error);
      }

      if (!requestId) {
        throw new Error("SESSION_NOT_READY");
      }

      const exchange = await exchangeMobileSession(requestId);
      await SecureStore.setItemAsync(SESSION_TOKEN_KEY, exchange.sessionToken);
      setSessionToken(exchange.sessionToken);

      const response = await fetchAppState(exchange.sessionToken);
      setAppState(response.state);
      setLoadState("ready");
      if (inviteDraft.rawInput.trim() && inviteDraft.requestedName.trim()) {
        await performInviteJoin(
          inviteDraft.rawInput,
          inviteDraft.requestedName,
          exchange.sessionToken,
        );
      }
    } catch (error) {
      if (!(error instanceof Error && error.message === "LOGIN_CANCELLED")) {
        setErrorMessage(formatApiError(error));
      }
    } finally {
      setLoggingIn(false);
    }
  }, [inviteDraft.rawInput, inviteDraft.requestedName, performInviteJoin]);

  const handleLogout = useCallback(async () => {
    const storedPushToken = await SecureStore.getItemAsync(EXPO_PUSH_TOKEN_KEY);
    if (storedPushToken && sessionToken) {
      try {
        await removeExpoPushToken(storedPushToken, sessionToken);
      } catch {
        // Ignore push token cleanup failures on logout.
      }
    }
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
    await SecureStore.deleteItemAsync(EXPO_PUSH_TOKEN_KEY);
    await clearMorningLocalNotifications();
    setSessionToken(null);
    setAppState(null);
    setActiveTaskId(null);
    setLoadState("logged_out");
    setExpoPushToken(null);
  }, [clearMorningLocalNotifications, sessionToken]);

  const registerNativePush = useCallback(async () => {
    if (!sessionToken || !Device.isDevice) {
      return;
    }

    const settings = await Notifications.getPermissionsAsync();
    let status = settings.status;

    if (status !== "granted") {
      const requestResult = await Notifications.requestPermissionsAsync();
      status = requestResult.status;
    }

    setNotificationPermission(status);

    if (status !== "granted") {
      return;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId ??
      process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

    if (!projectId) {
      return;
    }

    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResponse.data;
    setExpoPushToken(token);
    await SecureStore.setItemAsync(EXPO_PUSH_TOKEN_KEY, token);

    const platform: "ios" | "android" = Device.osName === "Android" ? "android" : "ios";
    await saveExpoPushToken(token, platform, sessionToken);
  }, [sessionToken]);

  useEffect(() => {
    if (loadState === "ready" && sessionToken) {
      void registerNativePush();
    }
  }, [loadState, registerNativePush, sessionToken]);

  const handleTaskAction = useCallback(
    async (taskId: string, action: TaskAction) => {
      if (!sessionToken) {
        return;
      }

      setActingTaskId(taskId);
      setErrorMessage(null);

      try {
        await postTaskAction(taskId, action, sessionToken);
        await refreshData();
      } catch (error) {
        setErrorMessage(formatApiError(error));
      } finally {
        setActingTaskId(null);
      }
    },
    [refreshData, sessionToken],
  );

  const today = useMemo(buildTodayLabel, []);
  const selectedGroup = useMemo(
    () => appState?.groups.find((group) => group.id === selectedGroupScope) ?? null,
    [appState?.groups, selectedGroupScope],
  );

  useEffect(() => {
    if (!appState) {
      return;
    }

    const availableScopes: GroupScopeId[] = appState.groups.map((group) => group.id);
    if (!availableScopes.includes(selectedGroupScope)) {
      setSelectedGroupScope(appState.groups[0]?.id ?? "");
    }
  }, [appState, selectedGroupScope]);

  useEffect(() => {
    if (appState?.appUser?.display_name) {
      setBootstrapDraft((current) =>
        current.displayName ? current : { ...current, displayName: appState.appUser?.display_name ?? "" },
      );
      setInviteDraft((current) =>
        current.requestedName ? current : { ...current, requestedName: appState.appUser?.display_name ?? "" },
      );
    }
  }, [appState?.appUser?.display_name]);

  const visibleTasks = useMemo(() => {
    if (!appState) {
      return [];
    }

    return appState.tasks
      .filter((task) => {
        if (task.scheduled_date !== selectedDate) {
          return false;
        }

        return Boolean(selectedGroupScope) && task.group_id === selectedGroupScope;
      })
      .sort(compareTaskOrder);
  }, [appState, selectedDate, selectedGroupScope]);

  const selectedTask = useMemo(
    () => visibleTasks.find((task) => task.id === activeTaskId) ?? null,
    [activeTaskId, visibleTasks],
  );

  const summary = useMemo(() => {
    return {
      pending: visibleTasks.filter((task) => task.status === "pending").length,
      inProgress: visibleTasks.filter((task) => task.status === "in_progress").length,
      awaitingConfirmation: visibleTasks.filter(
        (task) => task.status === "awaiting_confirmation",
      ).length,
      done: visibleTasks.filter((task) => task.status === "done").length,
    };
  }, [visibleTasks]);

  const copyableTasks = useMemo(
    () =>
      (appState?.tasks ?? [])
        .filter((task) => Boolean(selectedGroupScope) && task.group_id === selectedGroupScope)
        .slice()
        .sort(compareTaskOrder)
        .slice(0, 12),
    [appState?.tasks, selectedGroupScope],
  );

  const visibleLogs = useMemo(() => {
    if (!appState?.logs?.length) {
      return [];
    }

    return logsExpanded ? appState.logs : appState.logs.slice(0, 1);
  }, [appState?.logs, logsExpanded]);

  const rangeTasks = useMemo(() => {
    if (!appState) {
      return [];
    }

    return appState.tasks
      .filter((task) => {
        if (!(task.scheduled_date >= rangeDraft.startDate && task.scheduled_date <= rangeDraft.endDate)) {
          return false;
        }

        return Boolean(selectedGroupScope) && task.group_id === selectedGroupScope;
      })
      .sort((left, right) => {
        const dateDiff = left.scheduled_date.localeCompare(right.scheduled_date);
        if (dateDiff !== 0) {
          return dateDiff;
        }
        return compareTaskOrder(left, right);
      });
  }, [appState, rangeDraft.endDate, rangeDraft.startDate, selectedGroupScope]);

  const isAdmin = appState?.appUser?.role === "admin";
  const pendingRequests = appState?.pendingRequests ?? [];
  const members = appState?.members ?? [];

  const openCreateModal = useCallback(() => {
    setDraftTask(createDefaultDraft(selectedDate));
    setDraftReferencePhotos([]);
    setEditorMode("create");
    setEditingTaskId(null);
    setCreateModalVisible(true);
  }, [selectedDate]);

  const openListModal = useCallback(() => {
    setRangeDraft({
      startDate: selectedDate,
      endDate: shiftDate(selectedDate, 30),
    });
    setListModalVisible(true);
  }, [selectedDate]);

  const openManagementModal = useCallback(() => {
    setManagementModalVisible(true);
  }, []);

  const openEditModal = useCallback((task: MobileTaskRecord) => {
    setDraftTask(createDraftFromTask(task));
    setDraftReferencePhotos([]);
    setEditorMode("edit");
    setEditingTaskId(task.id);
    setCreateModalVisible(true);
  }, []);

  const applyCopiedTask = useCallback(
    (taskId: string) => {
      const sourceTask = copyableTasks.find((task) => task.id === taskId);
      if (!sourceTask) {
        return;
      }

      setDraftTask((current) => ({
        ...current,
        copiedFromTaskId: sourceTask.id,
        title: sourceTask.title,
        description: sourceTask.description ?? "",
        priority: sourceTask.priority,
        scheduledTime: sourceTask.scheduled_time ?? "",
        recurrenceEnabled: Boolean(sourceTask.recurrence),
        recurrenceFrequency: sourceTask.recurrence?.frequency ?? "weekly",
        recurrenceInterval: String(sourceTask.recurrence?.interval_value ?? 1),
        recurrenceEndDate: sourceTask.recurrence?.end_date ?? current.scheduledDate,
        recurrenceDaysOfWeek: sourceTask.recurrence?.days_of_week ?? [],
        recurrenceDayOfMonth: String(sourceTask.recurrence?.day_of_month ?? 1),
      }));
    },
    [copyableTasks],
  );

  const toggleRecurrenceWeekday = useCallback((day: number) => {
    setDraftTask((current) => ({
      ...current,
      recurrenceDaysOfWeek: current.recurrenceDaysOfWeek.includes(day)
        ? current.recurrenceDaysOfWeek.filter((value) => value !== day)
        : current.recurrenceDaysOfWeek.concat(day).sort(),
    }));
  }, []);

  const saveTask = useCallback(async () => {
    if (!sessionToken || !appState?.workspace) {
      return;
    }

    if (!selectedGroup) {
      setErrorMessage("追加先のグループを選択してください。");
      return;
    }

    const normalizedTitle = draftTask.title.trim();
    if (!normalizedTitle) {
      setErrorMessage("タスク名を入力してください。");
      return;
    }

    const interval = Number(draftTask.recurrenceInterval || "1");
    const dayOfMonth = Number(draftTask.recurrenceDayOfMonth || "1");

    const recurrencePayload = {
      enabled: draftTask.recurrenceEnabled,
      frequency: draftTask.recurrenceEnabled ? draftTask.recurrenceFrequency : undefined,
      interval: draftTask.recurrenceEnabled ? Math.max(1, interval || 1) : undefined,
      endDate: draftTask.recurrenceEnabled ? draftTask.recurrenceEndDate : undefined,
      daysOfWeek:
        draftTask.recurrenceEnabled && draftTask.recurrenceFrequency === "weekly"
          ? draftTask.recurrenceDaysOfWeek
          : undefined,
      dayOfMonth:
        draftTask.recurrenceEnabled && draftTask.recurrenceFrequency === "monthly"
          ? Math.min(31, Math.max(1, dayOfMonth || 1))
          : null,
    };

    setSavingTask(true);
    setErrorMessage(null);

    try {
      if (editorMode === "edit" && editingTaskId) {
        await updateTask(
          editingTaskId,
          {
            title: normalizedTitle,
            description: draftTask.description.trim(),
            priority: draftTask.priority,
            scheduledDate: draftTask.scheduledDate,
            scheduledTime: draftTask.scheduledTime || null,
            recurrence: recurrencePayload,
          },
          sessionToken,
        );
      } else {
        const payload: CreateTaskPayload = {
          workspaceId: appState.workspace.id,
          title: normalizedTitle,
          description: draftTask.description.trim(),
          priority: draftTask.priority,
          scheduledDate: draftTask.scheduledDate,
          scheduledTime: draftTask.scheduledTime || null,
          visibilityType: "group",
          groupId: selectedGroup.id,
          recurrence: recurrencePayload,
        };

        const createdTask = await createTask(payload, sessionToken);

        for (const photo of draftReferencePhotos) {
          await uploadReferencePhoto(createdTask.task.id, photo, sessionToken);
        }
      }

      setCreateModalVisible(false);
      setDraftTask(createDefaultDraft(selectedDate));
      setDraftReferencePhotos([]);
      setEditingTaskId(null);
      setEditorMode("create");
      await refreshData();
    } catch (error) {
      setErrorMessage(formatApiError(error));
    } finally {
      setSavingTask(false);
    }
  }, [
    appState?.workspace,
    draftTask,
    editorMode,
    editingTaskId,
    refreshData,
    draftReferencePhotos,
    selectedGroup,
    selectedDate,
    sessionToken,
  ]);

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      if (!sessionToken) {
        return;
      }

      Alert.alert("タスクを削除", "このタスクを削除します。元に戻せません。", [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setActingTaskId(taskId);
              setErrorMessage(null);
              try {
                await deleteTask(taskId, sessionToken);
                setActiveTaskId(null);
                await refreshData();
              } catch (error) {
                setErrorMessage(formatApiError(error));
              } finally {
                setActingTaskId(null);
              }
            })();
          },
        },
      ]);
    },
    [refreshData, sessionToken],
  );

  const handleDismissLog = useCallback(
    async (logId: string) => {
      if (!sessionToken) {
        return;
      }

      setDismissingLogId(logId);
      setErrorMessage(null);

      try {
        await dismissLog(logId, sessionToken);
        await refreshData();
      } catch (error) {
        setErrorMessage(formatApiError(error));
      } finally {
        setDismissingLogId(null);
      }
    },
    [refreshData, sessionToken],
  );

  const handleGenerateInvite = useCallback(async () => {
    if (!sessionToken || !selectedGroup?.id) {
      return;
    }

    setManagementBusyKey("invite");
    setErrorMessage(null);

    try {
      const result = await generateGroupInvite(selectedGroup.id, sessionToken);
      await Share.share({
        message: result.inviteUrl,
        url: result.inviteUrl,
      });
      await refreshData();
    } catch (error) {
      setErrorMessage(formatApiError(error));
    } finally {
      setManagementBusyKey(null);
    }
  }, [refreshData, selectedGroup?.id, sessionToken]);

  const handleApproveRequest = useCallback(
    async (requestId: string) => {
      if (!sessionToken) {
        return;
      }

      setManagementBusyKey(`approve:${requestId}`);
      setErrorMessage(null);

      try {
        await approveMembershipRequest(requestId, sessionToken);
        await refreshData();
      } catch (error) {
        setErrorMessage(formatApiError(error));
      } finally {
        setManagementBusyKey(null);
      }
    },
    [refreshData, sessionToken],
  );

  const handleRejectRequest = useCallback(
    async (requestId: string) => {
      if (!sessionToken) {
        return;
      }

      setManagementBusyKey(`reject:${requestId}`);
      setErrorMessage(null);

      try {
        await rejectMembershipRequest(requestId, sessionToken);
        await refreshData();
      } catch (error) {
        setErrorMessage(formatApiError(error));
      } finally {
        setManagementBusyKey(null);
      }
    },
    [refreshData, sessionToken],
  );

  const handleRemoveMember = useCallback(
    (member: MobileMemberRecord) => {
      if (!sessionToken) {
        return;
      }

      Alert.alert("メンバーを削除", `${member.display_name} を削除します。`, [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setManagementBusyKey(`member:${member.id}`);
              setErrorMessage(null);
              try {
                await removeMember(member.id, sessionToken);
                await refreshData();
              } catch (error) {
                setErrorMessage(formatApiError(error));
              } finally {
                setManagementBusyKey(null);
              }
            })();
          },
        },
      ]);
    },
    [refreshData, sessionToken],
  );

  const handleSaveNotificationTime = useCallback(async () => {
    if (!sessionToken) {
      return;
    }

    setManagementBusyKey("workspace-settings");
    setErrorMessage(null);

    try {
      await updateWorkspaceSettings(notificationTimeDraft, sessionToken);
      await refreshData();
    } catch (error) {
      setErrorMessage(formatApiError(error));
    } finally {
      setManagementBusyKey(null);
    }
  }, [notificationTimeDraft, refreshData, sessionToken]);

  const handleLeaveCurrentGroup = useCallback(() => {
    if (!sessionToken || !selectedGroup?.id) {
      return;
    }

    Alert.alert("グループから退出", `${selectedGroup.name} から退出します。`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "退出",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setManagementBusyKey("leave-group");
            setErrorMessage(null);
            try {
              await leaveGroup(selectedGroup.id, sessionToken);
              setManagementModalVisible(false);
              await refreshData();
            } catch (error) {
              setErrorMessage(formatApiError(error));
            } finally {
              setManagementBusyKey(null);
            }
          })();
        },
      },
    ]);
  }, [refreshData, selectedGroup?.id, selectedGroup?.name, sessionToken]);

  const chooseImageSource = useCallback(() => {
    return new Promise<"camera" | "library" | null>((resolve) => {
      Alert.alert("画像を追加", "撮影またはライブラリから選択できます。", [
        { text: "キャンセル", style: "cancel", onPress: () => resolve(null) },
        { text: "撮影", onPress: () => resolve("camera") },
        { text: "ライブラリ", onPress: () => resolve("library") },
      ]);
    });
  }, []);

  const pickImageAsset = useCallback(async (): Promise<UploadableImage | null> => {
    const source = await chooseImageSource();
    if (!source) {
      return null;
    }

    let result:
      | ImagePicker.ImagePickerResult
      | null = null;

    if (source === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        throw new Error("CAMERA_PERMISSION_DENIED");
      }

      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.85,
      });
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        throw new Error("PHOTO_PERMISSION_DENIED");
      }

      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.85,
      });
    }

    if (result.canceled) {
      return null;
    }

    const asset = result.assets[0];
    if (!asset?.uri) {
      return null;
    }

    return {
      uri: asset.uri,
      name:
        asset.fileName ?? `${source === "camera" ? "camera" : "photo"}-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? "image/jpeg",
    };
  }, [chooseImageSource]);

  const handleDraftReferencePhotoPick = useCallback(async () => {
    try {
      if (draftReferencePhotos.length >= 2) {
        throw new Error("PHOTO_LIMIT_REACHED");
      }

      const asset = await pickImageAsset();
      if (!asset) {
        return;
      }

      setDraftReferencePhotos((current) =>
        current.concat({
          ...asset,
          previewUri: asset.uri,
        }),
      );
    } catch (error) {
      setErrorMessage(formatApiError(error));
    }
  }, [draftReferencePhotos.length, pickImageAsset]);

  const handleDraftReferencePhotoDelete = useCallback((index: number) => {
    setDraftReferencePhotos((current) => current.filter((_, photoIndex) => photoIndex !== index));
  }, []);

  const openPhotoPreview = useCallback((uri: string, label: string) => {
    setPhotoViewer({ uri, label });
  }, []);

  const handleSubmitJoinRequest = useCallback(async () => {
    if (!inviteDraft.rawInput.trim() || !inviteDraft.requestedName.trim()) {
      setErrorMessage("招待リンクと表示名を入力してください。");
      return;
    }

    if (!sessionToken) {
      await handleLogin();
      return;
    }

    setJoiningInvite(true);
    setErrorMessage(null);
    try {
      await performInviteJoin(inviteDraft.rawInput, inviteDraft.requestedName, sessionToken);
    } catch (error) {
      setErrorMessage(formatApiError(error));
    } finally {
      setJoiningInvite(false);
    }
  }, [handleLogin, inviteDraft.rawInput, inviteDraft.requestedName, performInviteJoin, sessionToken]);

  const handleBootstrap = useCallback(async () => {
    if (!sessionToken) {
      return;
    }

    if (
      !bootstrapDraft.workspaceName.trim() ||
      !bootstrapDraft.groupName.trim() ||
      !bootstrapDraft.displayName.trim()
    ) {
      setErrorMessage("ワークスペース名、グループ名、表示名を入力してください。");
      return;
    }

    setBootstrapBusy(true);
    setErrorMessage(null);
    try {
      await bootstrapWorkspace(
        {
          workspaceName: bootstrapDraft.workspaceName.trim(),
          groupName: bootstrapDraft.groupName.trim(),
          displayName: bootstrapDraft.displayName.trim(),
        },
        sessionToken,
      );
      await refreshData();
    } catch (error) {
      setErrorMessage(formatApiError(error));
    } finally {
      setBootstrapBusy(false);
    }
  }, [bootstrapDraft.displayName, bootstrapDraft.groupName, bootstrapDraft.workspaceName, refreshData, sessionToken]);

  const handleCreateGroup = useCallback(async () => {
    if (!sessionToken) {
      return;
    }

    if (!groupDraft.name.trim()) {
      setErrorMessage("グループ名を入力してください。");
      return;
    }

    setCreatingGroup(true);
    setErrorMessage(null);
    try {
      const result = await createGroup(
        {
          name: groupDraft.name.trim(),
          description: groupDraft.description.trim() || null,
        },
        sessionToken,
      );
      setGroupDraft({ name: "", description: "" });
      await refreshData();
      setSelectedGroupScope(result.group.id);
    } catch (error) {
      setErrorMessage(formatApiError(error));
    } finally {
      setCreatingGroup(false);
    }
  }, [groupDraft.description, groupDraft.name, refreshData, sessionToken]);

  const handleScheduleTestNotification = useCallback(async () => {
    setSchedulingTestNotification(true);
    setErrorMessage(null);
    try {
      const settings = await Notifications.getPermissionsAsync();
      let status = settings.status;

      if (status !== "granted") {
        const requestResult = await Notifications.requestPermissionsAsync();
        status = requestResult.status;
      }

      setNotificationPermission(status);

      if (status !== "granted") {
        throw new Error("NOTIFICATION_PERMISSION_DENIED");
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title: "テスト通知",
          body: `${selectedGroup?.name ?? "個人タスク"} の通知テストです。10秒後に表示されます。`,
          sound: "default",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(Date.now() + 10_000),
        },
      });

      Alert.alert("テスト通知を予約しました", "10秒後にローカル通知を送ります。");
    } catch (error) {
      setErrorMessage(formatApiError(error));
    } finally {
      setSchedulingTestNotification(false);
    }
  }, [selectedGroup?.name]);

  const handleReferencePhotoUpload = useCallback(
    async (taskId: string, photoId?: string) => {
      if (!sessionToken) {
        return;
      }

      try {
        const asset = await pickImageAsset();
        if (!asset) {
          return;
        }

        const key = `reference:${taskId}:${photoId ?? "new"}`;
        setUploadingPhotoKey(key);
        setErrorMessage(null);

        if (photoId) {
          await replaceReferencePhoto(taskId, photoId, asset, sessionToken);
        } else {
          await uploadReferencePhoto(taskId, asset, sessionToken);
        }

        await refreshData();
      } catch (error) {
        setErrorMessage(formatApiError(error));
      } finally {
        setUploadingPhotoKey(null);
      }
    },
    [pickImageAsset, refreshData, sessionToken],
  );

  const handleTaskPhotoUpload = useCallback(
    async (taskId: string, photoId?: string) => {
      if (!sessionToken) {
        return;
      }

      try {
        const asset = await pickImageAsset();
        if (!asset) {
          return;
        }

        const key = `done:${taskId}:${photoId ?? "new"}`;
        setUploadingPhotoKey(key);
        setErrorMessage(null);

        if (photoId) {
          await replaceTaskPhoto(taskId, photoId, asset, sessionToken);
        } else {
          await uploadTaskPhoto(taskId, asset, sessionToken);
        }

        await refreshData();
      } catch (error) {
        setErrorMessage(formatApiError(error));
      } finally {
        setUploadingPhotoKey(null);
      }
    },
    [pickImageAsset, refreshData, sessionToken],
  );

  const handleReferencePhotoDelete = useCallback(
    (taskId: string, photoId: string) => {
      if (!sessionToken) {
        return;
      }

      Alert.alert("説明画像を削除", "この画像を削除します。", [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                setUploadingPhotoKey(`reference:${taskId}:${photoId}`);
                await deleteReferencePhoto(taskId, photoId, sessionToken);
                await refreshData();
              } catch (error) {
                setErrorMessage(formatApiError(error));
              } finally {
                setUploadingPhotoKey(null);
              }
            })();
          },
        },
      ]);
    },
    [refreshData, sessionToken],
  );

  const handleTaskPhotoDelete = useCallback(
    (taskId: string, photoId: string) => {
      if (!sessionToken) {
        return;
      }

      Alert.alert("完了写真を削除", "この画像を削除します。", [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                setUploadingPhotoKey(`done:${taskId}:${photoId}`);
                await deleteTaskPhoto(taskId, photoId, sessionToken);
                await refreshData();
              } catch (error) {
                setErrorMessage(formatApiError(error));
              } finally {
                setUploadingPhotoKey(null);
              }
            })();
          },
        },
      ]);
    },
    [refreshData, sessionToken],
  );

  if (loadState === "booting") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <ExpoStatusBar style="dark" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND} />
          <Text style={styles.bootText}>読み込み中</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadState === "logged_out") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <ExpoStatusBar style="dark" />
        <View style={styles.loginScreen}>
          <Text style={styles.eyebrow}>TEAM TASK NATIVE</Text>
          <Text style={styles.loginTitle}>
            {appState?.authConfigured === false ? "サーバー設定未完了" : "LINEでログイン"}
          </Text>
          <Text style={styles.loginDescription}>
            {appState?.authConfigured === false
              ? "LINE 認証または Supabase の設定が不足しています。Web バックエンドの環境変数を確認してください。"
              : appState?.needsBootstrap
                ? "ログイン後に最初のワークスペースを作成します。"
                : "ブラウザ表示ではなく、Expo ネイティブ画面から直接タスクを扱う構成です。"}
          </Text>

          {appState?.authConfigured === false ? null : (
            <>
              <Pressable
                style={[styles.primaryButton, loggingIn && styles.primaryButtonDisabled]}
                onPress={() => void handleLogin()}
                disabled={loggingIn}
              >
                {loggingIn ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>LINEログインを開始</Text>
                )}
              </Pressable>

              <Pressable
                style={styles.secondaryModalButton}
                onPress={() => setJoinModalVisible(true)}
              >
                <Text style={styles.secondaryModalButtonText}>招待リンクで参加</Text>
              </Pressable>
            </>
          )}

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          <View style={styles.versionCard}>
            <Text style={styles.versionLabel}>アプリ版</Text>
            <Text style={styles.versionValue}>{localVersion.appVersion}</Text>
            <Text style={styles.versionCommit}>{localVersion.commitSha}</Text>
            <Text style={[styles.versionLabel, styles.versionSpacer]}>接続先</Text>
            <Text style={styles.versionValue}>{backendVersion?.appVersion ?? "-"}</Text>
            <Text style={styles.versionCommit}>{backendVersion?.commitSha ?? "-"}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (appState?.needsBootstrap) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <ExpoStatusBar style="dark" />
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <View style={styles.sectionCard}>
            <Text style={styles.eyebrow}>INITIAL SETUP</Text>
            <Text style={styles.sectionTitle}>最初のワークスペースを作成</Text>
            <Text style={styles.modalMeta}>
              初回のみ、ワークスペース名と最初のグループ名、表示名を登録します。
            </Text>

            <View style={styles.formSection}>
              <Text style={styles.fieldLabel}>ワークスペース名</Text>
              <TextInput
                value={bootstrapDraft.workspaceName}
                onChangeText={(workspaceName) =>
                  setBootstrapDraft((current) => ({ ...current, workspaceName }))
                }
                placeholder="会社名や拠点名"
                placeholderTextColor="#A59C91"
                style={styles.textInput}
              />
            </View>

            <View style={styles.formSection}>
              <Text style={styles.fieldLabel}>最初のグループ名</Text>
              <TextInput
                value={bootstrapDraft.groupName}
                onChangeText={(groupName) =>
                  setBootstrapDraft((current) => ({ ...current, groupName }))
                }
                placeholder="品川Cタスク管理"
                placeholderTextColor="#A59C91"
                style={styles.textInput}
              />
            </View>

            <View style={styles.formSection}>
              <Text style={styles.fieldLabel}>あなたの表示名</Text>
              <TextInput
                value={bootstrapDraft.displayName}
                onChangeText={(displayName) =>
                  setBootstrapDraft((current) => ({ ...current, displayName }))
                }
                placeholder="表示名"
                placeholderTextColor="#A59C91"
                style={styles.textInput}
              />
            </View>

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

            <Pressable
              style={[styles.primaryButton, bootstrapBusy && styles.primaryButtonDisabled]}
              onPress={() => void handleBootstrap()}
              disabled={bootstrapBusy}
            >
              {bootstrapBusy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>作成して開始</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ExpoStatusBar style="dark" />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshData()} />}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroTitleWrap}>
              <Text style={styles.eyebrow}>TASK BOARD</Text>
              <Animated.Text
                style={[
                  styles.heroTitle,
                  {
                    transform: [{ translateX: dateTitleSlide }],
                  },
                ]}
              >
                {formatTaskDateLabel(animatedDateLabel)}
              </Animated.Text>
            </View>
            <Pressable style={styles.fabButton} onPress={openCreateModal}>
              <Text style={styles.fabButtonText}>＋</Text>
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scopeRow}
          >
            {((appState?.groups ?? []).map((group) => ({
              id: group.id as GroupScopeId,
              name: group.name,
            }))).map((scope) => (
              <Pressable
                key={scope.id}
                style={[
                  styles.scopeChip,
                  selectedGroupScope === scope.id && styles.scopeChipActive,
                ]}
                onPress={() => setSelectedGroupScope(scope.id)}
              >
                <Text
                  style={[
                    styles.scopeChipText,
                    selectedGroupScope === scope.id && styles.scopeChipTextActive,
                  ]}
                >
                  {scope.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.summaryGrid}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>未着手</Text>
              <Text style={styles.summaryValue}>{summary.pending}</Text>
            </View>
            <View style={[styles.summaryCard, styles.summaryWarm]}>
              <Text style={styles.summaryLabel}>作業中</Text>
              <Text style={styles.summaryValue}>{summary.inProgress}</Text>
            </View>
            <View style={[styles.summaryCard, styles.summaryWarm]}>
              <Text style={styles.summaryLabel}>確認待ち</Text>
              <Text style={styles.summaryValue}>{summary.awaitingConfirmation}</Text>
            </View>
            <View style={[styles.summaryCard, styles.summaryDone]}>
              <Text style={styles.summaryLabel}>完了</Text>
              <Text style={styles.summaryValue}>{summary.done}</Text>
            </View>
          </View>

          <View style={styles.daySwitcherRow}>
            <Pressable
              style={styles.dateSwitchButton}
              onPress={() => setSelectedDate((current) => shiftDate(current, -1))}
            >
              <Text style={styles.dateSwitchText}>前日</Text>
            </Pressable>
            <Pressable
              style={[
                styles.dateSwitchButton,
                selectedDate === today && styles.dateSwitchButtonActive,
              ]}
              onPress={() => setSelectedDate(today)}
            >
              <Text
                style={[
                  styles.dateSwitchText,
                  selectedDate === today && styles.dateSwitchTextActive,
                ]}
              >
                本日
              </Text>
            </Pressable>
            <Pressable
              style={styles.dateSwitchButton}
              onPress={() => setSelectedDate((current) => shiftDate(current, 1))}
            >
              <Text style={styles.dateSwitchText}>翌日</Text>
            </Pressable>
          </View>

          <Pressable style={styles.listLaunchButton} onPress={openListModal}>
            <Text style={styles.listLaunchButtonText}>期間一覧</Text>
          </Pressable>
        </View>

        {errorMessage ? (
          <View style={styles.inlineErrorCard}>
            <Text style={styles.inlineErrorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>タスク</Text>
          </View>

          {visibleTasks.length === 0 ? (
            <Text style={styles.emptyText}>今日のタスクはありません。</Text>
          ) : (
            visibleTasks.map((task) => (
              <Pressable
                key={task.id}
                style={styles.taskCard}
                onPress={() => setActiveTaskId(task.id)}
              >
                <View style={styles.taskHeader}>
                  <View style={styles.taskTitleWrap}>
                    <Text style={styles.taskTitle}>{taskTitle(task)}</Text>
                    {task.scheduled_time ? (
                      <Text style={styles.taskMeta}>{task.scheduled_time}</Text>
                    ) : null}
                    {task.recurrence ? (
                      <Text style={styles.taskSubMeta}>{recurrenceSummary(task)}</Text>
                    ) : null}
                  </View>
                  <View style={styles.taskBadgeWrap}>
                    <Text style={styles.statusChip}>{statusLabel(task.status)}</Text>
                    <Text style={styles.priorityText}>{priorityLabel(task.priority)}</Text>
                  </View>
                </View>
                {task.description ? (
                  <Text style={styles.taskDescription} numberOfLines={2}>
                    {task.description}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>通知</Text>
            {appState?.logs && appState.logs.length > 1 ? (
              <Pressable onPress={() => setLogsExpanded((current) => !current)}>
                <Text style={styles.linkText}>
                  {logsExpanded ? "折りたたむ" : `過去 ${appState.logs.length - 1} 件`}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {visibleLogs.length ? (
            visibleLogs.map((log) => (
              <SwipeDismissLogItem
                key={log.id}
                log={log}
                busy={dismissingLogId === log.id}
                onDismiss={() => void handleDismissLog(log.id)}
              />
            ))
          ) : (
            <Text style={styles.emptyText}>新しい通知はありません。</Text>
          )}
        </View>

        <View style={styles.versionFooter}>
          <View style={styles.footerActionRow}>
            <Pressable style={styles.footerActionButton} onPress={openManagementModal}>
              <Text style={styles.footerActionText}>
                {isAdmin && pendingRequests.length > 0 ? `管理 ${pendingRequests.length}` : "管理"}
              </Text>
            </Pressable>
            <Pressable style={styles.footerActionButton} onPress={() => void handleLogout()}>
              <Text style={styles.footerActionText}>ログアウト</Text>
            </Pressable>
          </View>
          <Text style={styles.versionFooterText}>
            App {localVersion.appVersion} ({localVersion.commitSha}) / Backend {backendVersion?.appVersion ?? "-"} ({backendVersion?.commitSha ?? "-"})
          </Text>
        </View>
      </ScrollView>

      <Modal
        visible={Boolean(selectedTask)}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveTaskId(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setActiveTaskId(null)}>
          <Pressable style={styles.modalCard} onPress={() => null}>
            {selectedTask ? (
              <>
                <Text style={styles.modalTitle}>{taskTitle(selectedTask)}</Text>
                <Text style={styles.modalMeta}>
                  {selectedTask.scheduled_time ? `${selectedTask.scheduled_time} / ` : ""}
                  {statusLabel(selectedTask.status)}
                </Text>
                {selectedTask.recurrence ? (
                  <Text style={styles.modalMeta}>{recurrenceSummary(selectedTask)}</Text>
                ) : null}
                {selectedTask.description ? (
                  <Text style={styles.modalDescription}>{selectedTask.description}</Text>
                ) : null}

                {selectedTask.reference_photos?.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.previewStrip}>
                    {selectedTask.reference_photos.map((photo) => (
                      <View key={photo.id} style={styles.photoCard}>
                        <TaskPreviewImage
                          photo={photo}
                          sessionToken={sessionToken ?? ""}
                          busy={uploadingPhotoKey === `reference:${selectedTask.id}:${photo.id}`}
                          onPress={() =>
                            openPhotoPreview(createBackendUrl(photo.preview_url ?? ""), photo.file_name)
                          }
                        />
                        <View style={styles.photoActionRow}>
                          <Pressable
                            style={styles.photoActionButton}
                            onPress={() => void handleReferencePhotoUpload(selectedTask.id, photo.id)}
                          >
                            <Text style={styles.photoActionText}>
                              {uploadingPhotoKey === `reference:${selectedTask.id}:${photo.id}`
                                ? "..."
                                : "更新"}
                            </Text>
                          </Pressable>
                          <Pressable
                            style={styles.photoActionButton}
                            onPress={() => handleReferencePhotoDelete(selectedTask.id, photo.id)}
                          >
                            <Text style={styles.photoActionText}>削除</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                ) : null}

                <View style={styles.photoSection}>
                  <View style={styles.photoSectionHeader}>
                    <Text style={styles.fieldLabel}>説明用画像</Text>
                    {(selectedTask.reference_photos?.length ?? 0) < 2 ? (
                      <Pressable
                        style={[
                          styles.smallOutlineButton,
                          uploadingPhotoKey === `reference:${selectedTask.id}:new` &&
                            styles.smallOutlineButtonBusy,
                        ]}
                        onPress={() => void handleReferencePhotoUpload(selectedTask.id)}
                        disabled={uploadingPhotoKey === `reference:${selectedTask.id}:new`}
                      >
                        {uploadingPhotoKey === `reference:${selectedTask.id}:new` ? (
                          <View style={styles.inlineBusyRow}>
                            <ActivityIndicator size="small" color={TEXT} />
                            <Text style={styles.smallOutlineButtonText}>追加中</Text>
                          </View>
                        ) : (
                          <Text style={styles.smallOutlineButtonText}>追加</Text>
                        )}
                      </Pressable>
                    ) : null}
                  </View>
                  {!selectedTask.reference_photos?.length ? (
                    <Text style={styles.emptyText}>説明用画像はまだありません。</Text>
                  ) : null}
                </View>

                <View style={styles.photoSection}>
                  <View style={styles.photoSectionHeader}>
                    <Text style={styles.fieldLabel}>完了写真</Text>
                    {selectedTask.status === "done" && (selectedTask.photos?.length ?? 0) < 3 ? (
                      <Pressable
                        style={[
                          styles.smallOutlineButton,
                          uploadingPhotoKey === `done:${selectedTask.id}:new` &&
                            styles.smallOutlineButtonBusy,
                        ]}
                        onPress={() => void handleTaskPhotoUpload(selectedTask.id)}
                        disabled={uploadingPhotoKey === `done:${selectedTask.id}:new`}
                      >
                        {uploadingPhotoKey === `done:${selectedTask.id}:new` ? (
                          <View style={styles.inlineBusyRow}>
                            <ActivityIndicator size="small" color={TEXT} />
                            <Text style={styles.smallOutlineButtonText}>追加中</Text>
                          </View>
                        ) : (
                          <Text style={styles.smallOutlineButtonText}>追加</Text>
                        )}
                      </Pressable>
                    ) : null}
                  </View>
                  {selectedTask.photos?.length ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.previewStrip}>
                      {selectedTask.photos.map((photo) => (
                        <View key={photo.id} style={styles.photoCard}>
                        <TaskPreviewImage
                          photo={photo}
                          sessionToken={sessionToken ?? ""}
                          busy={uploadingPhotoKey === `done:${selectedTask.id}:${photo.id}`}
                          onPress={() =>
                            openPhotoPreview(createBackendUrl(photo.preview_url ?? ""), photo.file_name)
                          }
                        />
                          <View style={styles.photoActionRow}>
                            <Pressable
                              style={styles.photoActionButton}
                              onPress={() => void handleTaskPhotoUpload(selectedTask.id, photo.id)}
                            >
                              <Text style={styles.photoActionText}>
                                {uploadingPhotoKey === `done:${selectedTask.id}:${photo.id}`
                                  ? "..."
                                  : "更新"}
                              </Text>
                            </Pressable>
                            <Pressable
                              style={styles.photoActionButton}
                              onPress={() => handleTaskPhotoDelete(selectedTask.id, photo.id)}
                            >
                              <Text style={styles.photoActionText}>削除</Text>
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </ScrollView>
                  ) : (
                    <Text style={styles.emptyText}>
                      {selectedTask.status === "done"
                        ? "完了写真はまだありません。"
                        : "完了写真はタスク完了後に登録できます。"}
                    </Text>
                  )}
                </View>

                <View style={styles.actionGrid}>
                  <Pressable
                    style={[styles.actionButton, styles.actionButtonSecondary]}
                    onPress={() => openEditModal(selectedTask)}
                    disabled={actingTaskId === selectedTask.id}
                  >
                    <Text style={styles.actionButtonText}>編集</Text>
                  </Pressable>
                  {(["start", "confirm", "complete", "pause", "postpone"] as TaskAction[]).map(
                    (action) => (
                      <Pressable
                        key={action}
                        style={[
                          styles.actionButton,
                          actingTaskId === selectedTask.id && styles.actionButtonDisabled,
                        ]}
                        onPress={() => void handleTaskAction(selectedTask.id, action)}
                        disabled={actingTaskId === selectedTask.id}
                      >
                        <Text style={styles.actionButtonText}>{actionLabel(action)}</Text>
                      </Pressable>
                    ),
                  )}
                </View>

                <Pressable
                  style={[styles.closeButton, styles.deleteButton]}
                  onPress={() => handleDeleteTask(selectedTask.id)}
                >
                  <Text style={styles.deleteButtonText}>削除</Text>
                </Pressable>

                <Pressable
                  style={styles.closeButton}
                  onPress={() => setActiveTaskId(null)}
                >
                  <Text style={styles.closeButtonText}>閉じる</Text>
                </Pressable>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={Boolean(photoViewer)}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoViewer(null)}
      >
        <Pressable style={styles.photoViewerBackdrop} onPress={() => setPhotoViewer(null)}>
          <Pressable style={styles.photoViewerCard} onPress={() => null}>
            <Text style={styles.photoViewerLabel}>{photoViewer?.label ?? ""}</Text>
            {photoViewer ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image
                source={{
                  uri: photoViewer.uri,
                  headers: createAuthHeaders(sessionToken ?? ""),
                }}
                style={styles.photoViewerImage}
                resizeMode="contain"
              />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={listModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setListModalVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setListModalVisible(false)}>
          <Pressable style={[styles.modalCard, styles.largeModalCard]} onPress={() => null}>
            <Text style={styles.modalTitle}>期間タスク一覧</Text>
            <Text style={styles.modalMeta}>既定は選択日から 1 か月です。</Text>

            <View style={styles.formRow}>
              <View style={styles.formColumn}>
                <Text style={styles.fieldLabel}>開始日</Text>
                <TextInput
                  value={rangeDraft.startDate}
                  onChangeText={(startDate) => setRangeDraft((current) => ({ ...current, startDate }))}
                  placeholder="2026-04-15"
                  placeholderTextColor="#A59C91"
                  style={styles.textInput}
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.formColumn}>
                <Text style={styles.fieldLabel}>終了日</Text>
                <TextInput
                  value={rangeDraft.endDate}
                  onChangeText={(endDate) => setRangeDraft((current) => ({ ...current, endDate }))}
                  placeholder="2026-05-15"
                  placeholderTextColor="#A59C91"
                  style={styles.textInput}
                  autoCapitalize="none"
                />
              </View>
            </View>

            <ScrollView style={styles.rangeList} contentContainerStyle={styles.rangeListContent}>
              {rangeTasks.length ? (
                rangeTasks.map((task) => (
                  <Pressable
                    key={task.id}
                    style={styles.rangeTaskCard}
                    onPress={() => {
                      setListModalVisible(false);
                      setSelectedDate(task.scheduled_date);
                      setActiveTaskId(task.id);
                    }}
                  >
                    <View style={styles.rangeTaskHeader}>
                      <Text style={styles.rangeTaskDate}>{formatTaskDateLabel(task.scheduled_date)}</Text>
                      <Text style={styles.rangeTaskStatus}>{statusLabel(task.status)}</Text>
                    </View>
                    <Text style={styles.rangeTaskTitle}>{taskTitle(task)}</Text>
                    {task.scheduled_time ? (
                      <Text style={styles.rangeTaskMeta}>{task.scheduled_time}</Text>
                    ) : null}
                    {task.recurrence ? (
                      <Text style={styles.taskSubMeta}>{recurrenceSummary(task)}</Text>
                    ) : null}
                  </Pressable>
                ))
              ) : (
                <Text style={styles.emptyText}>指定期間のタスクはありません。</Text>
              )}
            </ScrollView>

            <Pressable style={styles.closeButton} onPress={() => setListModalVisible(false)}>
              <Text style={styles.closeButtonText}>閉じる</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={managementModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setManagementModalVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setManagementModalVisible(false)}>
          <Pressable style={[styles.modalCard, styles.largeModalCard]} onPress={() => null}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>グループ詳細</Text>
              <Text style={styles.modalMeta}>{selectedGroup?.name ?? "個人タスク"}</Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.scopeRow}
              >
                {((appState?.groups ?? []).map((group) => ({
                  id: group.id as GroupScopeId,
                  name: group.name,
                }))).map((scope) => (
                  <Pressable
                    key={scope.id}
                    style={[
                      styles.scopeChip,
                      selectedGroupScope === scope.id && styles.scopeChipActive,
                    ]}
                    onPress={() => setSelectedGroupScope(scope.id)}
                  >
                    <Text
                      style={[
                        styles.scopeChipText,
                        selectedGroupScope === scope.id && styles.scopeChipTextActive,
                      ]}
                    >
                      {scope.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Pressable
                style={styles.secondaryModalButton}
                onPress={() => setJoinModalVisible(true)}
              >
                <Text style={styles.secondaryModalButtonText}>招待リンクで参加</Text>
              </Pressable>

              {isAdmin ? (
                <>
                  <View style={styles.formSection}>
                    <Text style={styles.fieldLabel}>朝通知時刻</Text>
                    <View style={styles.formRow}>
                      <View style={styles.formColumn}>
                        <TextInput
                          value={notificationTimeDraft}
                          onChangeText={setNotificationTimeDraft}
                          placeholder="08:00"
                          placeholderTextColor="#A59C91"
                          style={styles.textInput}
                          autoCapitalize="none"
                        />
                      </View>
                      <View style={styles.formColumn}>
                        <Pressable
                          style={styles.primaryButton}
                          onPress={() => void handleSaveNotificationTime()}
                        >
                          <Text style={styles.primaryButtonText}>
                            {managementBusyKey === "workspace-settings" ? "..." : "保存"}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                    <Pressable
                      style={[
                        styles.secondaryModalButton,
                        schedulingTestNotification && styles.primaryButtonDisabled,
                      ]}
                      onPress={() => void handleScheduleTestNotification()}
                      disabled={schedulingTestNotification}
                    >
                      <Text style={styles.secondaryModalButtonText}>
                        {schedulingTestNotification ? "予約中..." : "10秒後に通知テスト"}
                      </Text>
                    </Pressable>
                  </View>

                  <View style={styles.formSection}>
                    <Text style={styles.fieldLabel}>グループ作成</Text>
                    <TextInput
                      value={groupDraft.name}
                      onChangeText={(name) => setGroupDraft((current) => ({ ...current, name }))}
                      placeholder="新しいグループ名"
                      placeholderTextColor="#A59C91"
                      style={styles.textInput}
                    />
                    <TextInput
                      value={groupDraft.description}
                      onChangeText={(description) =>
                        setGroupDraft((current) => ({ ...current, description }))
                      }
                      placeholder="説明（任意）"
                      placeholderTextColor="#A59C91"
                      style={styles.textInput}
                    />
                    <Pressable
                      style={[styles.primaryButton, creatingGroup && styles.primaryButtonDisabled]}
                      onPress={() => void handleCreateGroup()}
                      disabled={creatingGroup}
                    >
                      {creatingGroup ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.primaryButtonText}>グループを作成</Text>
                      )}
                    </Pressable>
                  </View>

                  <View style={styles.formSection}>
                    <Text style={styles.fieldLabel}>承認待ち申請</Text>
                    {pendingRequests.length ? (
                      pendingRequests.map((request: MobileMembershipRequestRecord) => (
                        <View key={request.id} style={styles.managementCard}>
                          <View style={styles.managementBody}>
                            <Text style={styles.managementTitle}>{request.requested_name}</Text>
                            <Text style={styles.managementMetaText}>
                              {requestAgeLabel(request.created_at)}
                            </Text>
                          </View>
                          <View style={styles.managementActionRow}>
                            <Pressable
                              style={styles.compactActionButton}
                              onPress={() => void handleApproveRequest(request.id)}
                            >
                              <Text style={styles.compactActionText}>
                                {managementBusyKey === `approve:${request.id}` ? "..." : "承認"}
                              </Text>
                            </Pressable>
                            <Pressable
                              style={[styles.compactActionButton, styles.compactDangerButton]}
                              onPress={() => void handleRejectRequest(request.id)}
                            >
                              <Text style={styles.compactDangerText}>
                                {managementBusyKey === `reject:${request.id}` ? "..." : "却下"}
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.emptyText}>承認待ちはありません。</Text>
                    )}
                  </View>

                  <View style={styles.formSection}>
                    <View style={styles.photoSectionHeader}>
                      <Text style={styles.fieldLabel}>メンバー</Text>
                      <Pressable
                        style={[
                          styles.smallOutlineButton,
                          !selectedGroup && styles.disabledOutlineButton,
                        ]}
                        onPress={() => void handleGenerateInvite()}
                        disabled={!selectedGroup}
                      >
                        <Text style={styles.smallOutlineButtonText}>
                          {managementBusyKey === "invite" ? "..." : "招待リンク"}
                        </Text>
                      </Pressable>
                    </View>
                    {members.map((member: MobileMemberRecord) => (
                      <View key={member.id} style={styles.managementCard}>
                        <View style={styles.managementBody}>
                          <Text style={styles.managementTitle}>{member.display_name}</Text>
                          <Text style={styles.managementMetaText}>{member.role}</Text>
                        </View>
                        {appState?.appUser?.id !== member.id ? (
                          <Pressable
                            style={[styles.compactActionButton, styles.compactDangerButton]}
                            onPress={() => handleRemoveMember(member)}
                          >
                            <Text style={styles.compactDangerText}>
                              {managementBusyKey === `member:${member.id}` ? "..." : "削除"}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <View style={styles.formSection}>
                  <Text style={styles.fieldLabel}>危険操作</Text>
                  {selectedGroup ? (
                    <Pressable style={[styles.closeButton, styles.deleteButton]} onPress={handleLeaveCurrentGroup}>
                      <Text style={styles.deleteButtonText}>
                        {managementBusyKey === "leave-group" ? "..." : "このグループから退出"}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.emptyText}>個人タスク表示では退出対象のグループはありません。</Text>
                  )}
                </View>
              )}

              <Pressable style={styles.closeButton} onPress={() => setManagementModalVisible(false)}>
                <Text style={styles.closeButtonText}>閉じる</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={createModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setCreateModalVisible(false)}>
          <Pressable style={[styles.modalCard, styles.largeModalCard]} onPress={() => null}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>
                {editorMode === "edit" ? "タスクを編集" : "タスクを追加"}
              </Text>
              <Text style={styles.modalMeta}>
                {editorMode === "edit"
                  ? "内容を更新します"
                  : `追加先: ${selectedGroup ? `${selectedGroup.name}` : "グループ未選択"}`}
              </Text>

              {editorMode === "create" ? (
                <View style={styles.formSection}>
                  <Text style={styles.fieldLabel}>既存タスクをコピー</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {copyableTasks.map((task) => (
                      <Pressable
                        key={task.id}
                        style={[
                          styles.copyTaskChip,
                          draftTask.copiedFromTaskId === task.id && styles.copyTaskChipActive,
                        ]}
                        onPress={() => applyCopiedTask(task.id)}
                      >
                        <Text
                          style={[
                            styles.copyTaskChipText,
                            draftTask.copiedFromTaskId === task.id && styles.copyTaskChipTextActive,
                          ]}
                        >
                          {task.title}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              <View style={styles.formSection}>
                <Text style={styles.fieldLabel}>タイトル</Text>
                <TextInput
                  value={draftTask.title}
                  onChangeText={(title) => setDraftTask((current) => ({ ...current, title }))}
                  placeholder="タスク名"
                  placeholderTextColor="#A59C91"
                  style={styles.textInput}
                />
              </View>

              <View style={styles.formSection}>
                <Text style={styles.fieldLabel}>説明</Text>
                <TextInput
                  value={draftTask.description}
                  onChangeText={(description) =>
                    setDraftTask((current) => ({ ...current, description }))
                  }
                  placeholder="説明"
                  placeholderTextColor="#A59C91"
                  style={[styles.textInput, styles.multilineInput]}
                  multiline
                />
              </View>

              {editorMode === "create" ? (
                <View style={styles.formSection}>
                  <View style={styles.photoSectionHeader}>
                    <Text style={styles.fieldLabel}>説明画像</Text>
                    {draftReferencePhotos.length < 2 ? (
                      <Pressable style={styles.smallOutlineButton} onPress={() => void handleDraftReferencePhotoPick()}>
                        <Text style={styles.smallOutlineButtonText}>追加</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {draftReferencePhotos.length ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.previewStrip}>
                      {draftReferencePhotos.map((photo, index) => (
                        <View key={`${photo.name}-${index}`} style={styles.photoCard}>
                          <Pressable onPress={() => openPhotoPreview(photo.previewUri, photo.name)}>
                            {/* eslint-disable-next-line jsx-a11y/alt-text */}
                            <Image
                              source={{ uri: photo.previewUri }}
                              style={styles.previewImage}
                              resizeMode="cover"
                            />
                          </Pressable>
                          <View style={styles.photoActionRow}>
                            <Pressable
                              style={styles.photoActionButton}
                              onPress={() => handleDraftReferencePhotoDelete(index)}
                            >
                              <Text style={styles.photoActionText}>削除</Text>
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </ScrollView>
                  ) : (
                    <Text style={styles.emptyText}>登録時に説明画像を 2 枚まで添付できます。</Text>
                  )}
                </View>
              ) : null}

              <View style={styles.formRow}>
                <View style={styles.formColumn}>
                  <Text style={styles.fieldLabel}>日付</Text>
                  <TextInput
                    value={draftTask.scheduledDate}
                    onChangeText={(scheduledDate) =>
                      setDraftTask((current) => ({ ...current, scheduledDate }))
                    }
                    placeholder="2026-04-15"
                    placeholderTextColor="#A59C91"
                    style={styles.textInput}
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.formColumn}>
                  <Text style={styles.fieldLabel}>時刻</Text>
                  <TextInput
                    value={draftTask.scheduledTime}
                    onChangeText={(scheduledTime) =>
                      setDraftTask((current) => ({ ...current, scheduledTime }))
                    }
                    placeholder="09:00"
                    placeholderTextColor="#A59C91"
                    style={styles.textInput}
                    autoCapitalize="none"
                  />
                </View>
              </View>

              <View style={styles.formSection}>
                <Text style={styles.fieldLabel}>優先度</Text>
                <View style={styles.optionRow}>
                  {(["urgent", "high", "medium", "low"] as const).map((priority) => (
                    <Pressable
                      key={priority}
                      style={[
                        styles.choiceChip,
                        draftTask.priority === priority && styles.choiceChipActive,
                      ]}
                      onPress={() => setDraftTask((current) => ({ ...current, priority }))}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          draftTask.priority === priority && styles.choiceChipTextActive,
                        ]}
                      >
                        {priorityLabel(priority)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.formSection}>
                <View style={styles.toggleRow}>
                  <Text style={styles.fieldLabel}>繰り返し</Text>
                  <Pressable
                    style={[
                      styles.toggleButton,
                      draftTask.recurrenceEnabled && styles.toggleButtonActive,
                    ]}
                    onPress={() =>
                      setDraftTask((current) => ({
                        ...current,
                        recurrenceEnabled: !current.recurrenceEnabled,
                      }))
                    }
                  >
                    <Text
                      style={[
                        styles.toggleButtonText,
                        draftTask.recurrenceEnabled && styles.toggleButtonTextActive,
                      ]}
                    >
                      {draftTask.recurrenceEnabled ? "ON" : "OFF"}
                    </Text>
                  </Pressable>
                </View>

                {draftTask.recurrenceEnabled ? (
                  <>
                    <View style={styles.optionRow}>
                      {(["daily", "weekly", "monthly"] as RecurrenceFrequency[]).map((frequency) => (
                        <Pressable
                          key={frequency}
                          style={[
                            styles.choiceChip,
                            draftTask.recurrenceFrequency === frequency && styles.choiceChipActive,
                          ]}
                          onPress={() =>
                            setDraftTask((current) => ({
                              ...current,
                              recurrenceFrequency: frequency,
                            }))
                          }
                        >
                          <Text
                            style={[
                              styles.choiceChipText,
                              draftTask.recurrenceFrequency === frequency &&
                                styles.choiceChipTextActive,
                            ]}
                          >
                            {frequency === "daily"
                              ? "毎日"
                              : frequency === "weekly"
                                ? "毎週"
                                : "毎月"}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    <View style={styles.formRow}>
                      <View style={styles.formColumn}>
                        <Text style={styles.fieldLabel}>間隔</Text>
                        <TextInput
                          value={draftTask.recurrenceInterval}
                          onChangeText={(recurrenceInterval) =>
                            setDraftTask((current) => ({ ...current, recurrenceInterval }))
                          }
                          placeholder="1"
                          placeholderTextColor="#A59C91"
                          style={styles.textInput}
                          keyboardType="number-pad"
                        />
                      </View>
                      <View style={styles.formColumn}>
                        <Text style={styles.fieldLabel}>終了日</Text>
                        <TextInput
                          value={draftTask.recurrenceEndDate}
                          onChangeText={(recurrenceEndDate) =>
                            setDraftTask((current) => ({ ...current, recurrenceEndDate }))
                          }
                          placeholder="2026-05-15"
                          placeholderTextColor="#A59C91"
                          style={styles.textInput}
                          autoCapitalize="none"
                        />
                      </View>
                    </View>

                    {draftTask.recurrenceFrequency === "weekly" ? (
                      <View style={styles.optionRow}>
                        {WEEKDAYS.map((day) => (
                          <Pressable
                            key={day.value}
                            style={[
                              styles.weekdayChip,
                              draftTask.recurrenceDaysOfWeek.includes(day.value) &&
                                styles.choiceChipActive,
                            ]}
                            onPress={() => toggleRecurrenceWeekday(day.value)}
                          >
                            <Text
                              style={[
                                styles.choiceChipText,
                                draftTask.recurrenceDaysOfWeek.includes(day.value) &&
                                  styles.choiceChipTextActive,
                              ]}
                            >
                              {day.label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}

                    {draftTask.recurrenceFrequency === "monthly" ? (
                      <View style={styles.formSection}>
                        <Text style={styles.fieldLabel}>毎月の日付</Text>
                        <TextInput
                          value={draftTask.recurrenceDayOfMonth}
                          onChangeText={(recurrenceDayOfMonth) =>
                            setDraftTask((current) => ({ ...current, recurrenceDayOfMonth }))
                          }
                          placeholder="1"
                          placeholderTextColor="#A59C91"
                          style={styles.textInput}
                          keyboardType="number-pad"
                        />
                      </View>
                    ) : null}
                  </>
                ) : null}
              </View>

              <View style={styles.modalActionRow}>
                <Pressable
                  style={styles.secondaryModalButton}
                  onPress={() => setCreateModalVisible(false)}
                >
                  <Text style={styles.secondaryModalButtonText}>閉じる</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryButton, styles.modalPrimaryButton]}
                  onPress={() => void saveTask()}
                  disabled={savingTask}
                >
                  {savingTask ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      {editorMode === "edit" ? "更新" : "登録"}
                    </Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={joinModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setJoinModalVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setJoinModalVisible(false)}>
          <Pressable style={[styles.modalCard, styles.largeModalCard]} onPress={() => null}>
            <Text style={styles.modalTitle}>招待リンクで参加</Text>
            <Text style={styles.modalMeta}>
              招待 URL 全体または末尾の招待コードを入力してください。
            </Text>

            <View style={styles.formSection}>
              <Text style={styles.fieldLabel}>招待リンク / 招待コード</Text>
              <TextInput
                value={inviteDraft.rawInput}
                onChangeText={(rawInput) => setInviteDraft((current) => ({ ...current, rawInput }))}
                placeholder="https://.../?invite=xxxx"
                placeholderTextColor="#A59C91"
                style={styles.textInput}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.formSection}>
              <Text style={styles.fieldLabel}>表示名</Text>
              <TextInput
                value={inviteDraft.requestedName}
                onChangeText={(requestedName) =>
                  setInviteDraft((current) => ({ ...current, requestedName }))
                }
                placeholder="参加時の表示名"
                placeholderTextColor="#A59C91"
                style={styles.textInput}
              />
            </View>

            <View style={styles.modalActionRow}>
              <Pressable
                style={styles.secondaryModalButton}
                onPress={() => setJoinModalVisible(false)}
              >
                <Text style={styles.secondaryModalButtonText}>閉じる</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, styles.modalPrimaryButton]}
                onPress={() => void handleSubmitJoinRequest()}
                disabled={joiningInvite || loggingIn}
              >
                {joiningInvite || loggingIn ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {sessionToken ? "申請する" : "LINEログインして申請"}
                  </Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: SURFACE,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 18,
    paddingBottom: 32,
    gap: 18,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  bootText: {
    color: MUTED,
    fontSize: 15,
  },
  loginScreen: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    gap: 18,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: MUTED,
  },
  loginTitle: {
    fontSize: 34,
    fontWeight: "800",
    color: TEXT,
  },
  loginDescription: {
    fontSize: 16,
    lineHeight: 24,
    color: MUTED,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: BRAND,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  versionCard: {
    borderRadius: 22,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    gap: 4,
  },
  versionLabel: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },
  versionSpacer: {
    marginTop: 10,
  },
  versionValue: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "700",
  },
  versionCommit: {
    color: MUTED,
    fontSize: 13,
  },
  heroCard: {
    borderRadius: 28,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 22,
    gap: 10,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  heroTitleWrap: {
    flex: 1,
  },
  heroTitle: {
    color: TEXT,
    fontSize: 36,
    fontWeight: "800",
  },
  scopeRow: {
    gap: 8,
    paddingTop: 2,
    paddingBottom: 2,
  },
  scopeChip: {
    borderRadius: 999,
    backgroundColor: "#F3EEE4",
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  scopeChipActive: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  scopeChipText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "700",
  },
  scopeChipTextActive: {
    color: "#FFFFFF",
  },
  daySwitcherRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  dateSwitchButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 16,
    backgroundColor: "#F3EEE4",
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  dateSwitchButtonActive: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  dateSwitchText: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "700",
  },
  dateSwitchTextActive: {
    color: "#FFFFFF",
  },
  listLaunchButton: {
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: "#F3EEE4",
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  listLaunchButtonText: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "700",
  },
  fabButton: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: BRAND,
    alignItems: "center",
    justifyContent: "center",
  },
  fabButtonText: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "700",
    marginTop: -2,
  },
  summaryGrid: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  summaryCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 82,
    borderRadius: 18,
    backgroundColor: "#F0EEE8",
    paddingHorizontal: 10,
    paddingVertical: 12,
    justifyContent: "space-between",
  },
  summaryWarm: {
    backgroundColor: "#F7ECD9",
  },
  summaryDone: {
    backgroundColor: "#E2F3E9",
  },
  summaryLabel: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },
  summaryValue: {
    color: TEXT,
    fontSize: 28,
    fontWeight: "800",
  },
  inlineErrorCard: {
    borderRadius: 18,
    backgroundColor: "#FFF1EF",
    borderWidth: 1,
    borderColor: "#F1C9C1",
    padding: 16,
  },
  inlineErrorText: {
    color: "#9E4133",
    fontSize: 14,
    lineHeight: 20,
  },
  sectionCard: {
    borderRadius: 28,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    color: TEXT,
    fontSize: 22,
    fontWeight: "800",
  },
  linkText: {
    color: BRAND,
    fontSize: 14,
    fontWeight: "700",
  },
  emptyText: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
  },
  taskCard: {
    borderRadius: 20,
    backgroundColor: "#F5F2EA",
    padding: 16,
    gap: 10,
  },
  taskHeader: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  taskTitleWrap: {
    flex: 1,
    gap: 6,
  },
  taskTitle: {
    color: TEXT,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
  },
  taskMeta: {
    color: MUTED,
    fontSize: 13,
  },
  taskSubMeta: {
    color: MUTED,
    fontSize: 12,
  },
  managementCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 18,
    backgroundColor: "#F5F2EA",
    padding: 14,
  },
  managementBody: {
    flex: 1,
    gap: 4,
  },
  managementTitle: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "700",
  },
  managementMetaText: {
    color: MUTED,
    fontSize: 12,
  },
  managementActionRow: {
    flexDirection: "row",
    gap: 8,
  },
  compactActionButton: {
    minHeight: 36,
    borderRadius: 12,
    backgroundColor: BRAND,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  compactActionText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  compactDangerButton: {
    backgroundColor: "#FFF0EE",
  },
  compactDangerText: {
    color: "#B13E31",
    fontSize: 12,
    fontWeight: "700",
  },
  disabledOutlineButton: {
    opacity: 0.45,
  },
  taskBadgeWrap: {
    alignItems: "flex-end",
    gap: 6,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#ECE7DD",
    color: TEXT,
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
  },
  priorityText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },
  taskDescription: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
  },
  logBubble: {
    flexDirection: "row",
    gap: 12,
    borderRadius: 22,
    backgroundColor: "#EEF1EB",
    padding: 14,
    alignItems: "flex-start",
  },
  logSwipeFrame: {
    overflow: "hidden",
    borderRadius: 22,
  },
  logSwipeCard: {
    zIndex: 1,
  },
  logDeleteSlot: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 92,
    alignItems: "center",
    justifyContent: "center",
    paddingRight: 6,
  },
  logDeleteButton: {
    width: 76,
    height: "100%",
    borderRadius: 22,
    backgroundColor: "#EADCD7",
    alignItems: "center",
    justifyContent: "center",
  },
  logDeleteButtonText: {
    color: "#8E3B2D",
    fontSize: 13,
    fontWeight: "700",
  },
  logAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  logAvatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#D9E5DB",
  },
  logAvatarFallbackText: {
    color: TEXT,
    fontWeight: "700",
  },
  logBody: {
    flex: 1,
    gap: 2,
  },
  logText: {
    color: TEXT,
    fontSize: 14,
    lineHeight: 20,
  },
  logTime: {
    color: MUTED,
    fontSize: 12,
    marginTop: 6,
  },
  logDismissButton: {
    minWidth: 56,
    minHeight: 36,
    borderRadius: 14,
    backgroundColor: "#E7ECE4",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  logDismissButtonText: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "700",
  },
  versionFooter: {
    alignItems: "center",
    gap: 12,
  },
  footerActionRow: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
  },
  footerActionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  footerActionText: {
    color: BRAND,
    fontSize: 14,
    fontWeight: "700",
  },
  versionFooterText: {
    color: MUTED,
    fontSize: 12,
    textAlign: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 12, 11, 0.3)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 26,
    backgroundColor: CARD,
    padding: 22,
    gap: 12,
  },
  largeModalCard: {
    maxHeight: "86%",
  },
  rangeList: {
    marginTop: 14,
    maxHeight: 420,
  },
  rangeListContent: {
    gap: 10,
    paddingBottom: 8,
  },
  rangeTaskCard: {
    borderRadius: 18,
    backgroundColor: "#F5F2EA",
    padding: 14,
    gap: 6,
  },
  rangeTaskHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  rangeTaskDate: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "700",
  },
  rangeTaskStatus: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },
  rangeTaskTitle: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  rangeTaskMeta: {
    color: MUTED,
    fontSize: 12,
  },
  modalTitle: {
    color: TEXT,
    fontSize: 26,
    fontWeight: "800",
  },
  formSection: {
    gap: 8,
    marginTop: 14,
  },
  formRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  formColumn: {
    flex: 1,
    gap: 8,
  },
  fieldLabel: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "700",
  },
  textInput: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#F5F2EA",
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    color: TEXT,
    fontSize: 15,
  },
  multilineInput: {
    minHeight: 92,
    paddingTop: 14,
    textAlignVertical: "top",
  },
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  choiceChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#F5F2EA",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  weekdayChip: {
    minWidth: 42,
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#F5F2EA",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  choiceChipActive: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  choiceChipText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "700",
  },
  choiceChipTextActive: {
    color: "#FFFFFF",
  },
  copyTaskChip: {
    maxWidth: 220,
    marginRight: 8,
    borderRadius: 16,
    backgroundColor: "#F5F2EA",
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  copyTaskChipActive: {
    backgroundColor: "#E5F1EA",
    borderColor: BRAND,
  },
  copyTaskChipText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "600",
  },
  copyTaskChipTextActive: {
    color: BRAND,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleButton: {
    minWidth: 68,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#F5F2EA",
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "center",
  },
  toggleButtonActive: {
    borderColor: BRAND,
    backgroundColor: "#E5F1EA",
  },
  toggleButtonText: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "700",
  },
  toggleButtonTextActive: {
    color: BRAND,
  },
  modalActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
    marginBottom: 8,
  },
  secondaryModalButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: "#EEE8DC",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  secondaryModalButtonText: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "700",
  },
  modalPrimaryButton: {
    flex: 1,
  },
  modalMeta: {
    color: MUTED,
    fontSize: 14,
  },
  modalDescription: {
    color: TEXT,
    fontSize: 15,
    lineHeight: 22,
  },
  previewStrip: {
    marginTop: 4,
  },
  previewImageWrap: {
    width: 104,
    height: 104,
    borderRadius: 18,
    marginRight: 10,
    overflow: "hidden",
    backgroundColor: "#ECE7DD",
  },
  photoSection: {
    gap: 8,
    marginTop: 6,
  },
  photoSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  photoCard: {
    marginRight: 10,
    gap: 6,
  },
  previewImage: {
    width: "100%",
    height: "100%",
    backgroundColor: "#ECE7DD",
  },
  previewImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(31, 28, 25, 0.48)",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  previewImageOverlayText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  photoActionRow: {
    flexDirection: "row",
    gap: 6,
  },
  photoActionButton: {
    flex: 1,
    minHeight: 32,
    borderRadius: 12,
    backgroundColor: "#F0E9DD",
    alignItems: "center",
    justifyContent: "center",
  },
  photoActionText: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "700",
  },
  smallOutlineButton: {
    minHeight: 34,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#F5F2EA",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  smallOutlineButtonBusy: {
    opacity: 0.85,
  },
  smallOutlineButtonText: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "700",
  },
  inlineBusyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 4,
  },
  actionButton: {
    minWidth: "31%",
    borderRadius: 16,
    backgroundColor: BRAND,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionButtonSecondary: {
    backgroundColor: "#8A7B65",
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  closeButton: {
    marginTop: 2,
    borderRadius: 16,
    backgroundColor: "#EEE8DC",
    paddingVertical: 12,
    alignItems: "center",
  },
  closeButtonText: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "700",
  },
  deleteButton: {
    backgroundColor: "#FFF0EE",
  },
  deleteButtonText: {
    color: "#B13E31",
    fontSize: 14,
    fontWeight: "700",
  },
  errorText: {
    color: "#9E4133",
    fontSize: 14,
    lineHeight: 20,
  },
  photoViewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 12, 11, 0.78)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  photoViewerCard: {
    width: "100%",
    alignItems: "center",
    gap: 12,
  },
  photoViewerLabel: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  photoViewerImage: {
    width: "100%",
    height: 420,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
});
