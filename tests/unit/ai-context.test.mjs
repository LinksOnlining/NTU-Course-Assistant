import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAiContext } from "../../src/application/ai/index.ts";
import {
  enforceAiContextBudget,
  serializedAiContextBytes,
} from "../../src/application/ai/context-budget.ts";
import {
  AiPermissionGate,
  normalizeAiDataAccessSettings,
} from "../../src/application/ai/permission.ts";
import { grantSensitiveContextAfterUserConsent } from "../../src/application/ai/request-grant.ts";
import {
  AI_DATA_ACCESS_SETTINGS_KEY,
  loadAiDataAccessSettingsRecord,
  saveAiDataAccessSettingsRecord,
} from "../../src/services/ai-data-access-storage.ts";

const timeContext = {
  localDate: "2026-09-26",
  localTime: "10:30",
  timeZone: "Asia/Shanghai",
};

function request(overrides = {}) {
  return {
    id: "ai-request-1",
    intent: "summarize",
    requestedScopes: [],
    selectedItems: [],
    timeContext,
    generatedAt: "2026-09-26T02:30:00.000Z",
    ...overrides,
  };
}

function workspaceSource() {
  return {
    context: {
      date: timeContext.localDate,
      localTime: timeContext.localTime,
      currentItem: { title: "workspace-current-item-sentinel", location: "private-room" },
      nextItem: { title: "workspace-next-item-sentinel", location: "private-room" },
      nextFreeSlot: {
        date: timeContext.localDate,
        startMinute: 660,
        endMinute: 720,
        durationMinutes: 60,
      },
      todayItemCount: 2,
      remainingItemCount: 1,
      openTaskCount: 3,
      overdueTaskCount: 0,
      todayTaskCount: 1,
      weatherSummary: { condition: "workspace-weather-sentinel" },
      hasDiaryToday: true,
      pendingInboxCount: 2,
      routineSuggestion: { title: "workspace-routine-sentinel" },
    },
  };
}

const grants = ["workspace.read", "academic.read", "planner.read", "routine.read", "weather.read"];

test("运行时权限默认拒绝、撤销立即生效且所有写入权限保持关闭", () => {
  const denied = new AiPermissionGate({ requestId: "denied" });
  assert.equal(denied.require("workspace.read").reason, "notGranted");
  assert.equal(denied.require("planner.propose").reason, "inactiveMutation");
  assert.equal(denied.require("planner.write").reason, "inactiveMutation");
  assert.equal(denied.require("diary.read").reason, "requestGrantRequired");
  assert.equal(denied.require("unknown.read").reason, "unknownPermission");

  const allowed = new AiPermissionGate({
    requestId: "allowed",
    settings: {
      persistentGrants: ["workspace.read", "planner.write", "diary.body.read", "inbox.raw.read"],
    },
  });
  assert.equal(allowed.isGranted("workspace.read"), true);
  assert.equal(allowed.isGranted("planner.write"), false);
  assert.equal(allowed.isGranted("diary.body.read"), false);
  assert.equal(allowed.isGranted("inbox.raw.read"), false);

  const revoked = new AiPermissionGate({
    requestId: "revoked",
    settings: { persistentGrants: [] },
  });
  assert.equal(revoked.require("planner.read").reason, "notGranted");

  assert.deepEqual(
    normalizeAiDataAccessSettings({
      persistentGrants: ["workspace.read", "planner.write", "diary.body.read", "bad"],
    }),
    { persistentGrants: ["workspace.read"] },
  );
});

test("数据访问设置以独立非敏感记录保存，并在 Application 加载时校验", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.deepEqual(normalizeAiDataAccessSettings(loadAiDataAccessSettingsRecord(storage)), {
    persistentGrants: [],
  });
  assert.equal(
    saveAiDataAccessSettingsRecord(
      { persistentGrants: ["academic.read", "diary.body.read", "planner.write"] },
      storage,
    ),
    true,
  );
  assert.equal(values.has(AI_DATA_ACCESS_SETTINGS_KEY), true);
  assert.deepEqual(normalizeAiDataAccessSettings(loadAiDataAccessSettingsRecord(storage)), {
    persistentGrants: ["academic.read"],
  });
  values.set(AI_DATA_ACCESS_SETTINGS_KEY, "not-json");
  assert.deepEqual(normalizeAiDataAccessSettings(loadAiDataAccessSettingsRecord(storage)), {
    persistentGrants: [],
  });
});

test("仅查询持久授权的模块，默认时间范围受限且输出是固定 allowlist", async () => {
  const called = [];
  const snapshot = await buildAiContext(
    request({ requestedScopes: [...grants, "planner.write"] }),
    { persistentGrants: grants },
    {
      workspace: async (input) => {
        called.push(["workspace", input]);
        return workspaceSource();
      },
      academic: async (input) => {
        called.push(["academic", input]);
        return {
          occurrences: [
            {
              courseId: "course-1",
              semesterId: "term-1",
              date: "2026-09-28",
              teachingWeek: 3,
              weekday: 1,
              startPeriod: 1,
              endPeriod: 2,
              startTime: "08:00",
              endTime: "09:35",
              room: "A101",
              teacher: "apiKey=course-secret-sentinel",
              status: "NORMAL",
              source: "BASE",
              originalOccurrenceKey: null,
              occurrenceKey: "key",
              appliedOverrideId: null,
              appliedOverrideKind: null,
              privateNote: "hidden-course-note-sentinel",
            },
            {
              courseId: "outside",
              semesterId: "term-1",
              date: "2026-10-10",
              teachingWeek: 5,
              weekday: 6,
              startPeriod: 1,
              endPeriod: 1,
              startTime: "08:00",
              endTime: "08:45",
              room: null,
              teacher: null,
              status: "NORMAL",
              source: "BASE",
              originalOccurrenceKey: null,
              occurrenceKey: "outside",
              appliedOverrideId: null,
              appliedOverrideKind: null,
            },
          ],
          exams: [],
          deadlines: [],
          courseNames: { "course-1": "C:\\Users\\Ethan\\My Documents\\private.txt" },
          secretPayload: "hidden-academic-sentinel",
          apiKey: "deepseek-api-key-secret-sentinel",
        };
      },
      planner: async (input) => {
        called.push(["planner", input]);
        return {
          tasks: [
            {
              id: "task-1",
              title: "写报告",
              description: "hidden-task-description-sentinel C:\\Users\\Ethan\\private.txt",
              status: "open",
              priority: "high",
              deadlineDate: "2026-09-29",
              deadlineTime: null,
              createdAt: "",
              updatedAt: "",
              completedAt: null,
            },
          ],
          events: [
            {
              id: "event-1",
              title: "会议",
              description: "hidden-event-description-sentinel",
              date: "2026-09-27",
              startTime: "10:00",
              endTime: "11:00",
              location: null,
              bufferBeforeMinutes: 15,
              bufferAfterMinutes: 10,
              createdAt: "",
              updatedAt: "",
            },
          ],
          timeBlocks: [],
          rawImportExtras: "hidden-raw-import-sentinel",
        };
      },
      routine: async () => {
        called.push(["routine"]);
        return {
          routines: [
            {
              id: "routine-1",
              title: "运动",
              targetDurationMinutes: 30,
              weekdaysMask: 127,
              preferredStartTime: null,
              preferredEndTime: null,
              enabled: true,
              lastScheduledDate: null,
              createdAt: "",
              updatedAt: "",
              internalNote: "hidden-routine-sentinel",
            },
          ],
        };
      },
      weather: async () => {
        called.push(["weather"]);
        return {
          snapshot: {
            locationLabel: "某市",
            latitude: 31.23,
            longitude: 121.47,
            providerId: "private-provider",
            current: {
              time: "2026-09-26T10:00:00+08:00",
              temperatureCelsius: 24,
              weatherCode: 1,
              humidityPercent: 50,
            },
            hourly: [
              {
                time: "2026-09-26T11:00:00+08:00",
                temperatureCelsius: 25,
                precipitationProbability: 5,
                weatherCode: 2,
              },
              {
                time: "2026-09-26T09:00:00+08:00",
                temperatureCelsius: 23,
                precipitationProbability: 0,
                weatherCode: 1,
              },
              {
                time: "2026-09-27T11:00:00+08:00",
                temperatureCelsius: 26,
                precipitationProbability: 10,
                weatherCode: 3,
              },
            ],
            daily: [{ privateForecastSentinel: true }],
          },
        };
      },
    },
  );

  assert.deepEqual(
    called.map(([module]) => module),
    ["workspace", "academic", "planner", "routine", "weather"],
  );
  assert.equal(called[1][1].timeRange.startDate, "2026-09-26");
  assert.equal(called[1][1].timeRange.endDate, "2026-10-03");
  assert.deepEqual(snapshot.permissions.includedScopes, grants);
  assert.equal(snapshot.moduleContexts.workspace.current, undefined);
  assert.equal(snapshot.moduleContexts.workspace.next, undefined);
  assert.equal(snapshot.moduleContexts.academic.courses.length, 1);
  assert.equal(snapshot.moduleContexts.academic.courses[0].title, "[本地路径已省略]");
  assert.equal(snapshot.moduleContexts.weather.forecast.length, 2);
  assert.ok(
    snapshot.moduleContexts.weather.forecast.some((item) => item.time.startsWith("2026-09-27")),
  );
  assert.deepEqual(snapshot.moduleContexts.planner.events[0], {
    id: "event-1",
    title: "会议",
    date: "2026-09-27",
    start: "10:00",
    end: "11:00",
    occupiedStart: "09:45",
    occupiedEnd: "11:10",
  });
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    "hidden-course-note-sentinel",
    "hidden-academic-sentinel",
    "hidden-task-description-sentinel",
    "hidden-event-description-sentinel",
    "hidden-raw-import-sentinel",
    "hidden-routine-sentinel",
    "hidden-street-sentinel",
    "31.23",
    "121.47",
    "private-provider",
    "privateForecastSentinel",
    "C:\\\\Users",
    "workspace-current-item-sentinel",
    "workspace-next-item-sentinel",
    "workspace-weather-sentinel",
    "workspace-routine-sentinel",
    "private-room",
    "deepseek-api-key-secret-sentinel",
    "My Documents",
    "private.txt",
    "course-secret-sentinel",
  ])
    assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.equal(serialized.includes("[本地路径已省略]"), true);
});

test("各标准权限只调用自身模块的快照 source", async () => {
  const sources = {
    workspace: async () => workspaceSource(),
    academic: async () => ({ occurrences: [], exams: [], deadlines: [], courseNames: {} }),
    planner: async () => ({ tasks: [], events: [], timeBlocks: [] }),
    routine: async () => ({ routines: [] }),
    weather: async () => ({ snapshot: null }),
  };
  for (const permissionId of grants) {
    const called = [];
    const scopedSources = Object.fromEntries(
      Object.entries(sources).map(([moduleId, source]) => [
        moduleId,
        async (...args) => {
          called.push(moduleId);
          return source(...args);
        },
      ]),
    );
    const result = await buildAiContext(
      request({ requestedScopes: [permissionId] }),
      { persistentGrants: grants },
      scopedSources,
    );
    const moduleId = permissionId.split(".")[0];
    assert.deepEqual(called, [moduleId]);
    assert.deepEqual(Object.keys(result.moduleContexts), [moduleId]);
    assert.deepEqual(result.permissions.includedScopes, [permissionId]);
  }
});

test("日记正文没有单次同意时即使被请求也不会查询或泄露", async () => {
  let sourceCalled = false;
  const result = await buildAiContext(
    request({
      id: "diary-default-deny",
      requestedScopes: ["diary.body.read"],
      selectedItems: [{ type: "diaryEntry", id: "diary-private" }],
    }),
    { persistentGrants: ["diary.body.read"] },
    {
      diary: async () => {
        sourceCalled = true;
        return {
          entries: [
            { id: "diary-private", date: "2026-09-26", body: "diary-default-deny-sentinel" },
          ],
        };
      },
    },
  );
  assert.equal(sourceCalled, false);
  assert.doesNotMatch(JSON.stringify(result), /diary-default-deny-sentinel/u);
  assert.equal(result.moduleContexts.diary, undefined);
});

test("没有请求 scope 时不调用任何模块 source，即使本地已有 grant", async () => {
  let sourceCalls = 0;
  const result = await buildAiContext(
    request(),
    { persistentGrants: grants },
    Object.fromEntries(
      grants.map((permission) => [
        permission.split(".")[0],
        async () => {
          sourceCalls += 1;
          return {};
        },
      ]),
    ),
  );
  assert.equal(sourceCalls, 0);
  assert.deepEqual(result.moduleContexts, {});
  assert.deepEqual(result.permissions.includedScopes, []);
});

test("敏感日记/收件箱正文仅在匹配条目、匹配请求的一次同意后加入上下文", async () => {
  const selected = { type: "diaryEntry", id: "diary-1" };
  let seenSelection;
  const grant = grantSensitiveContextAfterUserConsent({
    requestId: "sensitive-request",
    permissionId: "diary.body.read",
    selectedItem: selected,
  });
  const result = await buildAiContext(
    request({
      id: "sensitive-request",
      requestedScopes: ["diary.body.read"],
      selectedItems: [selected, { type: "diaryEntry", id: "diary-2" }],
      requestGrants: [grant],
    }),
    { persistentGrants: ["diary.read"] },
    {
      diary: async (input) => {
        seenSelection = input.selectedItems;
        return {
          entries: [
            { id: "diary-1", date: "2024-01-01", body: "user-selected-body" },
            { id: "diary-2", date: "2026-09-26", body: "unselected-body" },
          ],
        };
      },
    },
  );
  assert.deepEqual(seenSelection, [selected]);
  assert.match(JSON.stringify(result.moduleContexts), /user-selected-body/u);
  assert.doesNotMatch(JSON.stringify(result.moduleContexts), /unselected-body/u);

  const replay = await buildAiContext(
    request({
      id: "sensitive-request",
      requestedScopes: ["diary.body.read"],
      selectedItems: [selected],
      requestGrants: [grant],
    }),
    {},
    {
      diary: async () => ({
        entries: [{ id: "diary-1", date: "2026-09-26", body: "must-not-leak" }],
      }),
    },
  );
  assert.equal(replay.moduleContexts.diary, undefined);
  assert.ok(
    replay.permissions.omittedScopes.some(({ reason }) => reason === "requestConsentRequired"),
  );

  const inboxItem = { type: "inboxItem", id: "inbox-1" };
  let unauthorizedInboxCalled = false;
  const deniedInbox = await buildAiContext(
    request({
      id: "inbox-denied",
      requestedScopes: ["inbox.raw.read"],
      selectedItems: [inboxItem],
    }),
    { persistentGrants: ["inbox.raw.read"] },
    {
      inbox: async () => {
        unauthorizedInboxCalled = true;
        return {
          items: [
            {
              id: "inbox-1",
              capturedAt: "2026-09-26T08:00:00+08:00",
              rawText: "inbox-default-deny-sentinel",
            },
          ],
        };
      },
    },
  );
  assert.equal(unauthorizedInboxCalled, false);
  assert.doesNotMatch(JSON.stringify(deniedInbox), /inbox-default-deny-sentinel/u);
  assert.equal(deniedInbox.moduleContexts.inbox, undefined);

  assert.throws(
    () =>
      grantSensitiveContextAfterUserConsent({
        requestId: "wrong-kind",
        permissionId: "diary.body.read",
        selectedItem: inboxItem,
      }),
    /matching selected item/u,
  );

  const inboxGrant = grantSensitiveContextAfterUserConsent({
    requestId: "inbox-request",
    permissionId: "inbox.raw.read",
    selectedItem: inboxItem,
  });
  const inbox = await buildAiContext(
    request({
      id: "inbox-request",
      requestedScopes: ["inbox.raw.read"],
      selectedItems: [inboxItem],
      requestGrants: [inboxGrant],
    }),
    {},
    {
      inbox: async ({ selectedItems }) => ({
        items: [
          {
            id: "inbox-1",
            capturedAt: "2020-01-01T08:00:00+08:00",
            rawText: "explicitly-selected-inbox-raw",
          },
          {
            id: "inbox-2",
            capturedAt: "2026-09-26T08:00:00+08:00",
            rawText: "unselected-inbox-raw",
          },
        ].filter((item) => selectedItems.some(({ id }) => id === item.id)),
      }),
    },
  );
  assert.match(JSON.stringify(inbox.moduleContexts.inbox), /explicitly-selected-inbox-raw/u);
  assert.doesNotMatch(JSON.stringify(inbox.moduleContexts.inbox), /unselected-inbox-raw/u);
});

test("敏感 Grant 同时绑定权限、requestId 与唯一 objectId", async () => {
  const diaryA = { type: "diaryEntry", id: "diary-A" };
  const diaryB = { type: "diaryEntry", id: "diary-B" };
  const inboxA = { type: "inboxItem", id: "inbox-A" };
  const inboxB = { type: "inboxItem", id: "inbox-B" };
  const cases = [
    {
      grant: grantSensitiveContextAfterUserConsent({
        requestId: "grant-object",
        permissionId: "diary.body.read",
        selectedItem: diaryA,
      }),
      requestId: "grant-object",
      selectedItems: [diaryB],
      scope: "diary.body.read",
    },
    {
      grant: grantSensitiveContextAfterUserConsent({
        requestId: "grant-request",
        permissionId: "diary.body.read",
        selectedItem: diaryA,
      }),
      requestId: "different-request",
      selectedItems: [diaryA],
      scope: "diary.body.read",
    },
    {
      grant: grantSensitiveContextAfterUserConsent({
        requestId: "grant-permission",
        permissionId: "diary.body.read",
        selectedItem: diaryA,
      }),
      requestId: "grant-permission",
      selectedItems: [inboxA],
      scope: "inbox.raw.read",
    },
    {
      grant: grantSensitiveContextAfterUserConsent({
        requestId: "inbox-object",
        permissionId: "inbox.raw.read",
        selectedItem: inboxA,
      }),
      requestId: "inbox-object",
      selectedItems: [inboxB],
      scope: "inbox.raw.read",
    },
    {
      grant: grantSensitiveContextAfterUserConsent({
        requestId: "inbox-cross-type",
        permissionId: "inbox.raw.read",
        selectedItem: inboxA,
      }),
      requestId: "inbox-cross-type",
      selectedItems: [diaryA],
      scope: "diary.body.read",
    },
  ];
  for (const [index, scenario] of cases.entries()) {
    let sourceCalled = false;
    const result = await buildAiContext(
      request({
        id: scenario.requestId,
        requestedScopes: [scenario.scope],
        selectedItems: scenario.selectedItems,
        requestGrants: [scenario.grant],
      }),
      { persistentGrants: ["diary.body.read", "inbox.raw.read"] },
      {
        diary: async () => {
          sourceCalled = true;
          return { entries: [{ id: "diary-A", date: "2026-09-26", body: `object-${index}` }] };
        },
        inbox: async () => {
          sourceCalled = true;
          return {
            items: [
              { id: "inbox-A", capturedAt: "2026-09-26T02:30:00.000Z", rawText: `inbox-${index}` },
            ],
          };
        },
      },
    );
    assert.equal(sourceCalled, false);
    assert.deepEqual(result.permissions.includedScopes, []);
    assert.deepEqual(result.moduleContexts, {});
  }
});

test("Sensitive request grant 只能消费一次，失败后的重试必须签发新 grant", async () => {
  const selected = { type: "diaryEntry", id: "diary-one-shot" };
  const grant = grantSensitiveContextAfterUserConsent({
    requestId: "one-shot-request",
    permissionId: "diary.body.read",
    selectedItem: selected,
  });
  let sourceCalls = 0;
  const input = request({
    id: "one-shot-request",
    requestedScopes: ["diary.body.read"],
    selectedItems: [selected],
    requestGrants: [grant],
  });
  const sources = {
    diary: async () => {
      sourceCalls += 1;
      return { entries: [{ id: selected.id, date: "2026-09-26", body: "one request only" }] };
    },
  };
  const first = await buildAiContext(input, {}, sources);
  const replay = await buildAiContext(input, {}, sources);
  assert.deepEqual(first.permissions.includedScopes, ["diary.body.read"]);
  assert.deepEqual(replay.permissions.includedScopes, []);
  assert.equal(replay.moduleContexts.diary, undefined);
  assert.equal(sourceCalls, 1);
});

test("请求方不能借 workspace.read 提升为其他模块权限", async () => {
  const called = [];
  const result = await buildAiContext(
    request({
      requestedScopes: ["workspace.read", "academic.read", "planner.read", "diary.body.read"],
    }),
    { persistentGrants: ["workspace.read"] },
    {
      workspace: async () => {
        called.push("workspace");
        return workspaceSource();
      },
      academic: async () => {
        called.push("academic");
        return { occurrences: [], exams: [], deadlines: [], courseNames: {} };
      },
      planner: async () => {
        called.push("planner");
        return { tasks: [], events: [], timeBlocks: [] };
      },
      diary: async () => {
        called.push("diary");
        return { entries: [] };
      },
    },
  );
  assert.deepEqual(called, ["workspace"]);
  assert.deepEqual(result.permissions.includedScopes, ["workspace.read"]);
  assert.equal(result.moduleContexts.academic, undefined);
  assert.equal(result.moduleContexts.planner, undefined);
  assert.equal(result.moduleContexts.diary, undefined);
});

test("选中引用仅投影稳定 identity，异常大权限输入不会升级或突破总预算", async () => {
  const selected = {
    type: "plannerEvent",
    id: "event-safe-id",
    title: "selected-object-private-extra-sentinel",
  };
  const result = await buildAiContext(
    request({
      requestedScopes: ["planner.read", `${"planner.read"}${"x".repeat(2000)}`],
      selectedItems: [selected],
      budget: { maxTotalBytes: 1024 },
    }),
    { persistentGrants: ["planner.read"] },
    {
      planner: async () => ({
        tasks: [],
        timeBlocks: [],
        events: [
          {
            id: "event-safe-id",
            title: "公开标题",
            date: "2026-09-27",
            startTime: "10:00",
            endTime: "11:00",
            location: null,
            description: "not projected",
            bufferBeforeMinutes: 0,
            bufferAfterMinutes: 0,
            createdAt: "",
            updatedAt: "",
          },
        ],
      }),
    },
  );
  assert.deepEqual(result.selectedItems, [{ type: "plannerEvent", id: "event-safe-id" }]);
  assert.doesNotMatch(JSON.stringify(result), /selected-object-private-extra-sentinel/u);
  assert.ok(
    result.redactions.some(
      ({ scope, reason }) => scope === "selectedItems" && reason === "privacy",
    ),
  );
  assert.ok(serializedAiContextBytes(result) <= 1024);
  assert.equal(Object.isFrozen(result.moduleContexts.planner.events[0]), true);
  assert.equal(Object.isFrozen(result.selectedItems[0]), true);
  assert.ok(
    result.permissions.omittedScopes.some(({ permissionId }) =>
      permissionId.includes("invalid_permission"),
    ),
  );
});

test("Provider 单模块失败不阻断其他上下文，顺序与序列化稳定", async () => {
  const input = request({ requestedScopes: ["academic.read", "workspace.read"] });
  const settings = { persistentGrants: ["academic.read", "workspace.read"] };
  const sources = {
    academic: async () => {
      throw new Error("source failure with private details");
    },
    workspace: async () => workspaceSource(),
  };
  const first = await buildAiContext(input, settings, sources);
  const second = await buildAiContext(
    request({ requestedScopes: ["workspace.read", "academic.read"] }),
    settings,
    sources,
  );
  assert.deepEqual(first, second);
  assert.deepEqual(first.providerFailures, [
    { moduleId: "academic", category: "sourceUnavailable" },
  ]);
  assert.ok(first.moduleContexts.workspace);
  assert.doesNotMatch(JSON.stringify(first), /private details/u);
});

test("Planner items 按事实时间与稳定 ID 排序，不依赖 source 数组顺序", async () => {
  const tasks = [
    {
      id: "task-z",
      title: "Z",
      status: "open",
      priority: "normal",
      deadlineDate: "2026-09-28",
      deadlineTime: null,
    },
    {
      id: "task-a",
      title: "A",
      status: "open",
      priority: "normal",
      deadlineDate: "2026-09-28",
      deadlineTime: null,
    },
  ];
  const events = [
    {
      id: "event-z",
      title: "Z",
      date: "2026-09-27",
      startTime: "10:00",
      endTime: "11:00",
      location: null,
      description: null,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
    },
    {
      id: "event-a",
      title: "A",
      date: "2026-09-27",
      startTime: "10:00",
      endTime: "11:00",
      location: null,
      description: null,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
    },
  ];
  const snapshot = (reverse) => ({
    tasks: reverse ? [...tasks].reverse() : tasks,
    events: reverse ? [...events].reverse() : events,
    timeBlocks: [],
  });
  const result = await buildAiContext(
    request({ requestedScopes: ["planner.read"] }),
    { persistentGrants: ["planner.read"] },
    { planner: async () => snapshot(false) },
  );
  const reverseResult = await buildAiContext(
    request({ requestedScopes: ["planner.read"] }),
    { persistentGrants: ["planner.read"] },
    { planner: async () => snapshot(true) },
  );
  assert.deepEqual(result, reverseResult);
  assert.deepEqual(
    result.moduleContexts.planner.tasks.map(({ id }) => id),
    ["task-a", "task-z"],
  );
  assert.deepEqual(
    result.moduleContexts.planner.events.map(({ id }) => id),
    ["event-a", "event-z"],
  );
});

test("上下文严格遵守字符串、模块与总字节预算并记录裁剪", async () => {
  const result = await buildAiContext(
    request({
      requestedScopes: ["academic.read"],
      budget: {
        maxTotalBytes: 1024,
        maxModuleBytes: 512,
        maxStringLength: 24,
        maxItemsPerModule: 3,
        maxSelectedItems: 2,
      },
    }),
    { persistentGrants: ["academic.read"] },
    {
      academic: async () => ({
        occurrences: Array.from({ length: 10 }, (_, index) => ({
          courseId: `course-${index}`,
          semesterId: "term",
          date: "2026-09-27",
          teachingWeek: 1,
          weekday: 1,
          startPeriod: 1,
          endPeriod: 1,
          startTime: "08:00",
          endTime: "08:45",
          room: null,
          teacher: null,
          status: "NORMAL",
          source: "BASE",
          originalOccurrenceKey: null,
          occurrenceKey: `key-${index}`,
          appliedOverrideId: null,
          appliedOverrideKind: null,
        })),
        exams: [],
        deadlines: [],
        courseNames: Object.fromEntries(
          Array.from({ length: 10 }, (_, index) => [`course-${index}`, "课程名称".repeat(20)]),
        ),
      }),
    },
  );
  assert.ok(serializedAiContextBytes(result) <= 1024);
  assert.equal(result.budget.maxStringLength, 24);
  assert.equal(result.budget.truncated, true);
  assert.ok(result.budget.omittedCount > 0);
  assert.ok(result.budget.truncatedModules.includes("academic"));
});

test("Context DTO 可以正好落在序列化字节预算边界", async () => {
  let limit = 2048;
  let result;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    result = enforceAiContextBudget(
      {
        requestId: "budget-boundary",
        generatedAt: "2026-09-26T02:30:00.000Z",
        timeContext,
        selectedItems: [],
        moduleContexts: {},
        permissions: { includedScopes: [], omittedScopes: [] },
        redactions: [],
        providerFailures: [],
      },
      {
        maxTotalBytes: limit,
        maxModuleBytes: 8 * 1024,
        maxStringLength: 512,
        maxItemsPerModule: 50,
        maxSelectedItems: 20,
      },
    );
    const actualBytes = serializedAiContextBytes(result);
    if (actualBytes === limit) break;
    limit = actualBytes;
  }
  assert.ok(result);
  assert.equal(result.budget.maxTotalBytes, serializedAiContextBytes(result));
  assert.equal(result.budget.usedBytes, serializedAiContextBytes(result));
  assert.equal(result.budget.truncated, false);
});
