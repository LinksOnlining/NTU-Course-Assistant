import assert from "node:assert/strict";
import { test } from "node:test";
import { DiaryAutosave } from "../../src/workspace/diary/diary-autosave.ts";

const entry = (date, body, id = "entry-id") => ({
  id,
  entryDate: date,
  body,
  createdAt: "2026-09-24T01:00:00.000Z",
  updatedAt: "2026-09-24T01:00:00.000Z",
});

test("diary autosave flushes the latest rapid edit once", async () => {
  const writes = [];
  const states = [];
  const autosave = new DiaryAutosave(
    async (value) => {
      writes.push(value);
      return value;
    },
    (state) => states.push(state),
    60_000,
  );
  autosave.hydrate("2026-09-24", null);
  autosave.schedule("2026-09-24", "first private draft");
  autosave.schedule("2026-09-24", "latest private draft");

  assert.equal(await autosave.flush(), true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body, "latest private draft");
  assert.equal(states.at(-1), "saved");
});

test("diary autosave serializes a slow write before the newest revision", async () => {
  const writes = [];
  const states = [];
  let releaseFirst;
  const autosave = new DiaryAutosave(
    async (value) => {
      writes.push(value.body);
      if (writes.length === 1) await new Promise((resolve) => (releaseFirst = resolve));
      return value;
    },
    (state) => states.push(state),
    60_000,
  );
  autosave.hydrate("2026-09-24", null);
  autosave.schedule("2026-09-24", "older");
  const flushing = autosave.flush();
  await new Promise((resolve) => setImmediate(resolve));
  autosave.schedule("2026-09-24", "newest");
  releaseFirst();

  assert.equal(await flushing, true);
  assert.deepEqual(writes, ["older", "newest"]);
  assert.equal(states.at(-1), "saved");
});

test("failed diary save retains the draft and can be retried", async () => {
  const writes = [];
  const states = [];
  let shouldFail = true;
  const autosave = new DiaryAutosave(
    async (value) => {
      writes.push(value.body);
      if (shouldFail) throw new Error("private error details must not be displayed");
      return value;
    },
    (state) => states.push(state),
    60_000,
  );
  autosave.hydrate("2026-09-24", null);
  autosave.schedule("2026-09-24", "kept draft");
  assert.equal(await autosave.flush(), false);
  assert.equal(states.at(-1), "failed");
  shouldFail = false;
  assert.equal(await autosave.flush(), true);
  assert.deepEqual(writes, ["kept draft", "kept draft"]);
  assert.equal(states.at(-1), "saved");
});

test("date hydration resets pending state without exposing the previous body", async () => {
  const writes = [];
  const autosave = new DiaryAutosave(
    async (value) => (writes.push(value), value),
    () => {},
    60_000,
  );
  autosave.hydrate("2026-09-24", entry("2026-09-24", "private body"));
  autosave.hydrate("2026-09-25", null);
  assert.equal(await autosave.flush(), true);
  assert.deepEqual(writes, []);
});
