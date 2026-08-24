const fs = require("fs");
const src = fs.readFileSync("D:/dsh-skill/dsh-usage/lib/client.js", "utf8");
let captured = null;
global.window = {
  __ModuleLoader__: { load: (o) => { captured = o; } },
  dispatchEvent: () => {},
  addEventListener: () => {},
};
global.Event = class Event { constructor(t) { this.type = t; } };
const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const R = { useState: (v) => [v, () => {}], useEffect: () => {}, useMemo: (f) => f(), useRef: () => ({ current: null }) };
const req = (n) => (n === "react" ? R : { jsx: () => null, jsxs: () => null, Fragment: "Fragment" });
eval(src);
const mod = captured.factory(req);
const DAY = 86400000;
function noon(offsetDays) { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime() - offsetDays * DAY; }
function msgEvent(seq, tokens, time, model) {
  return {
    type: "assistant/message", seq, time,
    data: {
      turn: 1, step: seq,
      usage: { inputTokens: tokens, outputTokens: Math.floor(tokens / 2), cacheReadTokens: 10, cacheWriteTokens: 5 },
      message: { role: "assistant", content: [], id: "m" + seq, source: { kind: "model", provider: "deepseek-official", model } }
    }
  };
}
const assert = require("assert");

// 折叠两条不同模型的事件
assert.ok(mod.__test.foldMessageEvent("s1", msgEvent(1, 100, noon(0), "deepseek-v4")), "fold e1");
assert.ok(mod.__test.foldMessageEvent("s1", msgEvent(2, 200, noon(0), "deepseek-chat")), "fold e2");
assert.ok(mod.__test.foldMessageEvent("s2", msgEvent(9, 500, noon(3), "deepseek-v4")), "fold s2");
// 水位线去重
assert.ok(!mod.__test.foldMessageEvent("s1", msgEvent(2, 200, noon(0), "deepseek-chat")), "replay deduped");
// 缺 source 时回退 unknown
assert.ok(mod.__test.foldMessageEvent("s3", { type: "assistant/message", seq: 4, time: noon(0), data: { usage: { inputTokens: 10, outputTokens: 5 } } }), "fold no-source");
// 无 usage 事件：只推进水位线（返回 false 表示无日账变更）
assert.ok(!mod.__test.foldMessageEvent("s4", { type: "assistant/message", seq: 7, time: noon(0), data: { message: {} } }), "no-usage returns false");

// saveLedger 防抖 400ms：等落盘后再断言持久化内容
setTimeout(() => {
  const raw = JSON.parse(localStorage.getItem("dsh-usage-stats/ledger/v1"));
  assert.equal(raw.version, 2, "ledger version 2");
  assert.equal(raw.sessions.s4, 7, "watermark advanced");
  const now = new Date();
  const today = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  const models = raw.days[today].byModel;
  assert.ok(models["deepseek-v4"] > 0, "model v4 attributed");
  assert.ok(models["deepseek-chat"] > 0, "model chat attributed");
  assert.ok(models["unknown"] === 15, "missing source falls back to unknown");

  const st = mod.__test.computeStats();
  assert.ok(st.total > 1000, "total sums all sessions");
  assert.ok(st.peakDay !== null && st.peak > 0, "peak recorded");
  console.log("stats:", JSON.stringify(st));
  console.log("byModel today:", JSON.stringify(models));
  console.log("ALL ASSERTIONS PASSED");
}, 600);
