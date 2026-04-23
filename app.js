const STORAGE_KEY = "resilient-planner-state-v2";
const CHAT_KEY = "resilient-planner-chat-v1";
let csrfToken = "";
let deferredInstallPrompt = null;
const isNativeApp = new URLSearchParams(window.location.search).get("native_app") === "1";

const defaultState = {
  targetDate: "",
  reflection: "",
  aiModel: "gpt-5-mini",
  generationMode: "local",
  errands: [{ title: "", start: "", duration: 60, category: "admin" }],
  futureTasks: [{ title: "", category: "job", priority: "high", duration: 90 }]
};

const defaultChatState = {
  previousResponseId: "",
  messages: [
    {
      role: "assistant",
      text: "スケジュールの相談、悩み、優先順位の整理などをここでいつでも聞けます。"
    }
  ]
};

const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];

const templatesByWeekday = {
  0: {
    dayTheme: "回復と来週設計の日",
    blocks: [
      { start: "07:00", end: "08:30", title: "軽い勉強", category: "study", note: "ウォームアップとして軽く進める", flexible: true, intensity: "light" },
      { start: "08:30", end: "10:00", title: "振り返りメモ整理", category: "personal", note: "今週の学びを整理する", flexible: true, intensity: "light" },
      { start: "12:00", end: "13:00", title: "昼食", category: "meal", note: "しっかり休む", fixed: true },
      { start: "13:00", end: "17:00", title: "完全休養 / デート", category: "rest", note: "回復優先。予定がなければ外に出る", flexible: true, intensity: "light" },
      { start: "20:00", end: "21:00", title: "夕食", category: "meal", note: "画面から離れる", fixed: true },
      { start: "21:00", end: "22:00", title: "来週の設計", category: "planning", note: "次週の重要タスクを3つだけ決める", flexible: true, intensity: "light" },
      { start: "22:00", end: "23:00", title: "就寝準備", category: "rest", note: "23時で終了", fixed: true }
    ]
  },
  1: {
    dayTheme: "バランス型の日",
    blocks: [
      { start: "07:00", end: "09:00", title: "TOEIC", category: "study", note: "朝の最重要ブロック", flexible: true, intensity: "deep" },
      { start: "09:00", end: "11:00", title: "研究", category: "research", note: "集中できる時間に進める", flexible: true, intensity: "deep" },
      { start: "11:00", end: "12:00", title: "本 (LLM / Python)", category: "study", note: "軽くインプット", flexible: true, intensity: "light" },
      { start: "12:00", end: "13:00", title: "昼食", category: "meal", note: "授業前に休む", fixed: true },
      { start: "13:00", end: "14:30", title: "授業", category: "class", note: "固定予定", fixed: true },
      { start: "15:00", end: "17:00", title: "就活", category: "job", note: "ES・企業研究・応募", flexible: true, intensity: "deep" },
      { start: "17:00", end: "19:00", title: "制作", category: "creation", note: "NOTE・動画などの資産作り", flexible: true, intensity: "deep" },
      { start: "20:00", end: "21:00", title: "夕食", category: "meal", note: "しっかり回復", fixed: true },
      { start: "21:00", end: "23:00", title: "軽く過ごす", category: "rest", note: "回復時間", flexible: true, intensity: "light" }
    ]
  },
  2: {
    dayTheme: "朝で勝負する日",
    blocks: [
      { start: "07:00", end: "09:00", title: "TOEIC", category: "study", note: "授業前に勝負", flexible: true, intensity: "deep" },
      { start: "09:00", end: "11:00", title: "研究", category: "research", note: "朝の集中を活かす", flexible: true, intensity: "deep" },
      { start: "11:00", end: "12:00", title: "本", category: "study", note: "負荷は軽め", flexible: true, intensity: "light" },
      { start: "12:00", end: "13:00", title: "昼食", category: "meal", note: "授業前に休む", fixed: true },
      { start: "13:00", end: "16:00", title: "授業", category: "class", note: "固定予定", fixed: true },
      { start: "16:00", end: "17:30", title: "就活", category: "job", note: "短めでも前進する", flexible: true, intensity: "medium" },
      { start: "17:30", end: "19:00", title: "制作", category: "creation", note: "軽めに進める", flexible: true, intensity: "medium" },
      { start: "20:00", end: "21:00", title: "夕食", category: "meal", note: "回復時間", fixed: true },
      { start: "21:00", end: "23:00", title: "クールダウン", category: "rest", note: "23時就寝を守る", flexible: true, intensity: "light" }
    ]
  },
  3: {
    dayTheme: "維持の日",
    blocks: [
      { start: "07:00", end: "09:00", title: "TOEIC", category: "study", note: "朝だけは守る", flexible: true, intensity: "deep" },
      { start: "09:00", end: "11:00", title: "研究", category: "research", note: "重要な進捗だけ作る", flexible: true, intensity: "deep" },
      { start: "11:00", end: "12:00", title: "本", category: "study", note: "軽いインプット", flexible: true, intensity: "light" },
      { start: "12:00", end: "13:00", title: "昼食", category: "meal", note: "午後に備える", fixed: true },
      { start: "13:00", end: "14:00", title: "ジム", category: "health", note: "体を整える", flexible: true, intensity: "medium" },
      { start: "14:00", end: "15:00", title: "仮眠", category: "rest", note: "夜に備えて回復", flexible: true, intensity: "light" },
      { start: "15:00", end: "16:30", title: "軽作業", category: "job", note: "就活か読書を無理なく進める", flexible: true, intensity: "light" },
      { start: "17:00", end: "22:00", title: "バイト", category: "work", note: "固定予定", fixed: true },
      { start: "22:00", end: "23:00", title: "食事と就寝準備", category: "meal", note: "帰宅後は回復優先", fixed: true }
    ]
  },
  4: {
    dayTheme: "最強の成長日",
    blocks: [
      { start: "07:00", end: "09:00", title: "TOEIC", category: "study", note: "朝の最重要", flexible: true, intensity: "deep" },
      { start: "09:00", end: "11:00", title: "研究", category: "research", note: "しっかり前進する", flexible: true, intensity: "deep" },
      { start: "11:00", end: "12:00", title: "本", category: "study", note: "視野を広げる", flexible: true, intensity: "light" },
      { start: "12:00", end: "13:00", title: "昼食", category: "meal", note: "集中の切り替え", fixed: true },
      { start: "13:00", end: "14:00", title: "ジム", category: "health", note: "午後の集中準備", flexible: true, intensity: "medium" },
      { start: "14:00", end: "15:00", title: "仮眠", category: "rest", note: "出力前の回復", flexible: true, intensity: "light" },
      { start: "15:00", end: "17:00", title: "就活", category: "job", note: "応募や面談準備を詰める", flexible: true, intensity: "deep" },
      { start: "17:00", end: "19:00", title: "制作", category: "creation", note: "資産作りを進める", flexible: true, intensity: "deep" },
      { start: "20:00", end: "21:00", title: "夕食", category: "meal", note: "しっかり休む", fixed: true },
      { start: "21:00", end: "23:00", title: "整理と回復", category: "rest", note: "明日に疲れを残さない", flexible: true, intensity: "light" }
    ]
  },
  5: {
    dayTheme: "最も負荷を落とす日",
    blocks: [
      { start: "07:00", end: "09:00", title: "TOEIC", category: "study", note: "朝だけ前進する", flexible: true, intensity: "deep" },
      { start: "09:00", end: "11:00", title: "研究", category: "research", note: "最低限でも積む", flexible: true, intensity: "medium" },
      { start: "11:00", end: "12:00", title: "本", category: "study", note: "軽く読む", flexible: true, intensity: "light" },
      { start: "12:00", end: "13:30", title: "昼食と休憩", category: "meal", note: "負荷を上げすぎない", fixed: true },
      { start: "14:40", end: "16:00", title: "授業", category: "class", note: "固定予定", fixed: true },
      { start: "17:00", end: "22:00", title: "バイト", category: "work", note: "固定予定", fixed: true },
      { start: "22:00", end: "23:00", title: "食事と就寝準備", category: "meal", note: "今日は割り切って回復", fixed: true }
    ]
  },
  6: {
    dayTheme: "資産構築の日",
    blocks: [
      { start: "07:00", end: "09:00", title: "TOEIC or 就活", category: "study", note: "週末の朝も流れを切らさない", flexible: true, intensity: "deep" },
      { start: "09:00", end: "11:00", title: "就活タスク", category: "job", note: "応募や企業研究を進める", flexible: true, intensity: "deep" },
      { start: "12:00", end: "13:00", title: "昼食", category: "meal", note: "制作前に休む", fixed: true },
      { start: "13:00", end: "17:00", title: "制作メイン", category: "creation", note: "未来の収入につながる作業", flexible: true, intensity: "deep" },
      { start: "20:00", end: "21:00", title: "夕食", category: "meal", note: "オフに切り替える", fixed: true },
      { start: "21:00", end: "23:00", title: "自由時間", category: "rest", note: "回復を優先", flexible: true, intensity: "light" }
    ]
  }
};

const categoryLabels = {
  admin: "事務",
  job: "就活",
  study: "学習",
  creation: "制作",
  research: "研究",
  health: "健康",
  personal: "私用",
  rest: "回復",
  meal: "食事",
  class: "授業",
  work: "バイト",
  planning: "設計"
};

const categoryNotes = {
  admin: "事務処理をまとめて片づける",
  job: "応募・ES・企業研究など",
  study: "TOEICや読書などの学習",
  creation: "NOTE・動画などの資産作り",
  research: "研究を前進させる",
  health: "身体を整える時間",
  personal: "私用や予定対応",
  rest: "回復を優先する",
  planning: "次の一手を明確にする"
};

let state = loadState();
let chatState = loadChatState();

const targetDateInput = document.getElementById("targetDate");
const reflectionInput = document.getElementById("reflection");
const aiModelInput = document.getElementById("aiModel");
const generationModeInput = document.getElementById("generationMode");
const apiStatus = document.getElementById("apiStatus");
const errandsList = document.getElementById("errandsList");
const futureTasksList = document.getElementById("futureTasksList");
const errandTemplate = document.getElementById("errandTemplate");
const futureTaskTemplate = document.getElementById("futureTaskTemplate");
const analysisSummary = document.getElementById("analysisSummary");
const priorityTodos = document.getElementById("priorityTodos");
const scheduleTimeline = document.getElementById("scheduleTimeline");
const targetDateLabel = document.getElementById("targetDateLabel");
const networkAddress = document.getElementById("networkAddress");
const mobileHint = document.getElementById("mobileHint");
const installHint = document.getElementById("installHint");
const copyAddressButton = document.getElementById("copyAddressButton");
const installAppButton = document.getElementById("installAppButton");
const mobilePanel = document.querySelector(".mobile-panel");
const chatStatus = document.getElementById("chatStatus");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendChatButton = document.getElementById("sendChatButton");
const resetChatButton = document.getElementById("resetChatButton");

document.getElementById("addErrand").addEventListener("click", () => {
  state.errands.push({ title: "", start: "", duration: 60, category: "admin" });
  render();
  persistState();
});

document.getElementById("addFutureTask").addEventListener("click", () => {
  state.futureTasks.push({ title: "", category: "job", priority: "high", duration: 90 });
  render();
  persistState();
});

document.getElementById("generateButton").addEventListener("click", () => {
  runGeneration({ preferAi: generationModeInput.value === "ai" });
});

document.getElementById("aiGenerateButton").addEventListener("click", () => {
  runGeneration({ preferAi: true });
});

document.getElementById("resetButton").addEventListener("click", () => {
  state = structuredClone(defaultState);
  state.targetDate = getTomorrowDateString();
  render();
  persistState();
  clearOutput();
});

targetDateInput.addEventListener("change", persistFromForm);
reflectionInput.addEventListener("input", persistFromForm);
aiModelInput.addEventListener("input", persistFromForm);
generationModeInput.addEventListener("change", persistFromForm);

copyAddressButton.addEventListener("click", async () => {
  const value = networkAddress.dataset.url || "";
  if (!value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    mobileHint.textContent = "スマホ用URLをコピーしました。";
  } catch (error) {
    mobileHint.textContent = "コピーに失敗しました。手動でURLをメモしてください。";
  }
});

installAppButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    installHint.textContent = "この端末ではメニューからインストールしてください。";
    return;
  }
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installAppButton.disabled = true;
  installHint.textContent = choice.outcome === "accepted"
    ? "インストールを受け付けました。"
    : "インストールはキャンセルされました。";
});

sendChatButton.addEventListener("click", () => {
  sendChatMessage();
});

chatInput.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    sendChatMessage();
  }
});

resetChatButton.addEventListener("click", () => {
  chatState = structuredClone(defaultChatState);
  persistChatState();
  renderChat();
  setChatStatus("相談履歴をリセットしました。", "ok");
});

init();

async function init() {
  if (!state.targetDate) {
    state.targetDate = getTomorrowDateString();
  }
  if (isNativeApp && mobilePanel) {
    mobilePanel.style.display = "none";
  }
  render();
  renderOutput(generateSchedule(state));
  renderChat();
  await checkApiStatus();
  if (!isNativeApp) {
    registerServiceWorker();
    setupInstallPrompt();
  }
}

function loadState() {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return structuredClone(defaultState);
  }
  try {
    return { ...structuredClone(defaultState), ...JSON.parse(stored) };
  } catch (error) {
    return structuredClone(defaultState);
  }
}

function loadChatState() {
  const stored = window.localStorage.getItem(CHAT_KEY);
  if (!stored) {
    return structuredClone(defaultChatState);
  }
  try {
    return { ...structuredClone(defaultChatState), ...JSON.parse(stored) };
  } catch (error) {
    return structuredClone(defaultChatState);
  }
}

function persistState() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function persistChatState() {
  window.localStorage.setItem(CHAT_KEY, JSON.stringify(chatState));
}

function persistFromForm() {
  syncFormToState();
  persistState();
}

function syncFormToState() {
  state.targetDate = targetDateInput.value;
  state.reflection = reflectionInput.value.trim();
  state.aiModel = aiModelInput.value.trim() || "gpt-5-mini";
  state.generationMode = generationModeInput.value;
  state.errands = collectListValues(errandsList, ["title", "start", "duration", "category"])
    .map((item) => ({ ...item, duration: normalizeDuration(item.duration, 60) }));
  state.futureTasks = collectListValues(futureTasksList, ["title", "category", "priority", "duration"])
    .map((item) => ({ ...item, duration: normalizeDuration(item.duration, 90) }));
}

function collectListValues(container, keys) {
  return Array.from(container.children).map((child) => {
    const item = {};
    keys.forEach((key) => {
      item[key] = child.querySelector(`[data-key="${key}"]`).value;
    });
    return item;
  });
}

function render() {
  targetDateInput.value = state.targetDate;
  reflectionInput.value = state.reflection;
  aiModelInput.value = state.aiModel || "gpt-5-mini";
  generationModeInput.value = state.generationMode || "local";
  renderDynamicList(errandsList, state.errands, errandTemplate, "errand-item");
  renderDynamicList(futureTasksList, state.futureTasks, futureTaskTemplate, "task-item");
}

function renderDynamicList(container, items, template, extraClass) {
  container.innerHTML = "";
  items.forEach((item, index) => {
    const fragment = template.content.cloneNode(true);
    const listItem = fragment.querySelector(".list-item");
    listItem.classList.add(extraClass);

    Array.from(listItem.querySelectorAll("[data-key]")).forEach((input) => {
      const key = input.dataset.key;
      input.value = item[key] ?? "";
      input.addEventListener("input", persistFromForm);
      input.addEventListener("change", persistFromForm);
    });

    listItem.querySelector('[data-role="remove"]').addEventListener("click", () => {
      items.splice(index, 1);
      if (!items.length) {
        items.push(extraClass === "task-item"
          ? { title: "", category: "job", priority: "high", duration: 90 }
          : { title: "", start: "", duration: 60, category: "admin" });
      }
      render();
      persistState();
    });

    container.appendChild(fragment);
  });
}

async function runGeneration({ preferAi }) {
  syncFormToState();
  persistState();

  const localResult = generateSchedule(state);
  renderOutput(localResult);

  if (!preferAi) {
    return;
  }

  setStatus("AIがローカル案を再調整しています...", "ok");
  try {
    const aiResult = await fetchAiSchedule(localResult);
    renderOutput(mergeAiResultIntoOutput(localResult, aiResult));
    setStatus(`OpenAIで再調整しました。使用モデル: ${state.aiModel || "gpt-5-mini"}`, "ok");
  } catch (error) {
    setStatus(`${error.message} ローカル案はそのまま使えます。`, "error");
  }
}

function generateSchedule(inputState) {
  const targetDate = inputState.targetDate || getTomorrowDateString();
  const date = new Date(`${targetDate}T00:00:00`);
  const weekday = date.getDay();
  const template = structuredClone(templatesByWeekday[weekday]);
  const reflectionMode = analyzeReflection(inputState.reflection);
  const errands = sanitizeErrands(inputState.errands);
  const futureTasks = sanitizeFutureTasks(inputState.futureTasks);
  const scheduledBlocks = template.blocks.map((block) => ({ ...block, source: "template" }));
  const notes = [];
  const warnings = [];

  if (reflectionMode.energy === "low") {
    notes.push("今日の感想から疲労が見えるため、深い作業は絞って回復余白を増やしました。");
    softenTemplate(scheduledBlocks);
  } else if (reflectionMode.energy === "high") {
    notes.push("今日の流れが良さそうなので、重要タスクを朝と夕方に寄せました。");
  } else {
    notes.push("無理しすぎない標準モードで編成しています。");
  }

  if (reflectionMode.missedMorning) {
    notes.push("朝が崩れやすいサインがあるため、午前の最初の2ブロックは余計な予定で埋めないようにしています。");
  }

  const timedErrands = errands.filter((item) => item.start);
  const untimedErrands = errands.filter((item) => !item.start);
  timedErrands.forEach((errand) => {
    insertScheduledBlock(scheduledBlocks, {
      start: errand.start,
      end: addMinutes(errand.start, errand.duration),
      title: errand.title,
      category: errand.category,
      note: categoryNotes[errand.category] || "予定対応",
      fixed: true,
      source: "user"
    }, warnings);
  });

  const pool = [
    ...untimedErrands.map((item) => ({ ...item, priorityScore: 95, label: "明日の用事" })),
    ...futureTasks.map((item) => ({
      ...item,
      priorityScore: item.priority === "high" ? 90 : item.priority === "medium" ? 70 : 50,
      label: "今後の行動"
    }))
  ].sort((a, b) => b.priorityScore - a.priorityScore);

  allocatePoolTasks(scheduledBlocks, pool, reflectionMode, notes);

  const sortedBlocks = scheduledBlocks
    .map((block) => normalizeBlock(block))
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  if (!hasDinnerBlock(sortedBlocks)) {
    sortedBlocks.push({
      start: "20:00",
      end: "21:00",
      title: "夕食",
      category: "meal",
      note: "生活リズム維持のため固定",
      fixed: true,
      source: "auto"
    });
  }

  sortedBlocks.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  return {
    date,
    weekday,
    notes: [`${weekdayLabels[weekday]}曜は「${template.dayTheme}」として設計しています。`, ...notes],
    warnings,
    priorityTodos: buildPriorityTodos(pool, sortedBlocks),
    blocks: sortedBlocks
  };
}

function analyzeReflection(reflectionText) {
  const text = (reflectionText || "").toLowerCase();
  const lowKeywords = ["疲", "眠", "だる", "しんど", "無理", "つかれ", "sleepy", "tired", "exhaust", "burnout"];
  const highKeywords = ["集中", "進ん", "よか", "充実", "productive", "focused", "good", "達成"];
  const missedMorningKeywords = ["寝坊", "起きれ", "朝が崩", "朝無理", "oversleep", "late"];
  const score = highKeywords.reduce((sum, word) => sum + Number(text.includes(word)), 0)
    - lowKeywords.reduce((sum, word) => sum + Number(text.includes(word)), 0);
  return {
    energy: score <= -1 ? "low" : score >= 1 ? "high" : "normal",
    missedMorning: missedMorningKeywords.some((word) => text.includes(word))
  };
}

function sanitizeErrands(errands) {
  return errands
    .filter((item) => item.title && item.title.trim())
    .map((item) => ({
      title: item.title.trim(),
      start: item.start,
      duration: normalizeDuration(item.duration, 60),
      category: item.category || "admin"
    }));
}

function sanitizeFutureTasks(tasks) {
  return tasks
    .filter((item) => item.title && item.title.trim())
    .map((item) => ({
      title: item.title.trim(),
      category: item.category || "job",
      priority: item.priority || "medium",
      duration: normalizeDuration(item.duration, 90)
    }));
}

function softenTemplate(blocks) {
  blocks.forEach((block) => {
    if (block.fixed) {
      return;
    }
    if (block.intensity === "deep") {
      block.title = `${block.title} (短縮版)`;
      block.note = `${block.note}。今日は質重視で短く集中`;
      block.adjusted = true;
    }
    if (block.category === "creation" || block.category === "job") {
      block.intensity = "medium";
    }
  });
}

function insertScheduledBlock(blocks, newBlock, warnings) {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!rangesOverlap(block.start, block.end, newBlock.start, newBlock.end)) {
      continue;
    }
    if (block.fixed) {
      warnings.push(`"${newBlock.title}" が固定予定 "${block.title}" と重なっています。時間の再確認が必要です。`);
      return;
    }
    blocks.splice(index, 1, ...splitFlexibleBlock(block, newBlock));
    blocks.push(newBlock);
    return;
  }
  blocks.push(newBlock);
}

function splitFlexibleBlock(block, newBlock) {
  const pieces = [];
  if (toMinutes(newBlock.start) > toMinutes(block.start)) {
    pieces.push({ ...block, end: newBlock.start });
  }
  if (toMinutes(newBlock.end) < toMinutes(block.end)) {
    pieces.push({ ...block, start: newBlock.end });
  }
  return pieces.filter((piece) => toMinutes(piece.end) - toMinutes(piece.start) >= 15);
}

function allocatePoolTasks(blocks, pool, reflectionMode, notes) {
  const flexibleBlocks = blocks
    .filter((block) => !block.fixed)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  pool.forEach((task) => {
    const matchIndex = flexibleBlocks.findIndex((block) => block.category === task.category && durationOf(block) >= Math.min(task.duration, 60));
    const fallbackIndex = flexibleBlocks.findIndex((block) => durationOf(block) >= Math.min(task.duration, 45));
    const targetIndex = matchIndex >= 0 ? matchIndex : fallbackIndex;

    if (targetIndex === -1) {
      task.unassigned = true;
      notes.push(`"${task.title}" は空き時間不足のため優先ToDoに残しました。`);
      return;
    }

    const target = flexibleBlocks[targetIndex];
    if (reflectionMode.energy === "low" && target.intensity === "deep") {
      target.title = `${task.title} (軽め)`;
    } else {
      target.title = task.title;
    }
    target.category = task.category;
    target.note = `${task.label}を反映。${categoryNotes[task.category] || "重要タスク"}をここで進める`;
    target.adjusted = true;
    target.priority = task.priority || "high";
    task.assigned = `${target.start}-${target.end}`;
  });
}

function buildPriorityTodos(pool, blocks) {
  const todos = pool
    .slice()
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 5)
    .map((task) => {
      const assignedBlock = blocks.find((block) => block.title === task.title || block.title === `${task.title} (軽め)`);
      return assignedBlock
        ? `${task.title} (${assignedBlock.start}-${assignedBlock.end})`
        : `${task.title} (時間再調整が必要)`;
    });

  return todos.length ? todos : ["テンプレートに沿って基本ルーティンを守る日です。"];
}

function normalizeBlock(block) {
  return {
    ...block,
    end: block.end || addMinutes(block.start, 60)
  };
}

function renderOutput(result) {
  const dateLabel = `${result.date.getFullYear()}年${result.date.getMonth() + 1}月${result.date.getDate()}日 (${weekdayLabels[result.weekday]})`;
  targetDateLabel.textContent = dateLabel;

  analysisSummary.innerHTML = "";
  const noteList = document.createElement("ul");
  noteList.className = "analysis-list";
  result.notes.forEach((note) => {
    const item = document.createElement("li");
    item.textContent = note;
    noteList.appendChild(item);
  });
  result.warnings.forEach((warning) => {
    const item = document.createElement("li");
    item.textContent = `注意: ${warning}`;
    noteList.appendChild(item);
  });
  analysisSummary.appendChild(noteList);

  priorityTodos.innerHTML = "";
  const todoList = document.createElement("ul");
  todoList.className = "todo-list";
  result.priorityTodos.forEach((todo) => {
    const item = document.createElement("li");
    item.textContent = todo;
    todoList.appendChild(item);
  });
  priorityTodos.appendChild(todoList);

  scheduleTimeline.innerHTML = "";
  result.blocks.forEach((block) => {
    const card = document.createElement("article");
    card.className = "timeline-item";

    const timePill = document.createElement("div");
    timePill.className = "time-pill";
    timePill.textContent = `${block.start} - ${block.end}`;

    const body = document.createElement("div");
    const title = document.createElement("h4");
    title.textContent = block.title;
    const note = document.createElement("p");
    note.textContent = block.note;
    const chipRow = document.createElement("div");
    chipRow.className = "chip-row";

    const categoryChip = document.createElement("span");
    categoryChip.className = "chip";
    categoryChip.textContent = categoryLabels[block.category] || "予定";
    chipRow.appendChild(categoryChip);

    if (block.fixed) {
      const fixedChip = document.createElement("span");
      fixedChip.className = "chip fixed";
      fixedChip.textContent = "固定";
      chipRow.appendChild(fixedChip);
    }

    if (block.adjusted) {
      const adjustedChip = document.createElement("span");
      adjustedChip.className = "chip adjusted";
      adjustedChip.textContent = "AI調整";
      chipRow.appendChild(adjustedChip);
    }

    body.append(title, note, chipRow);
    card.append(timePill, body);
    scheduleTimeline.appendChild(card);
  });
}

function mergeAiResultIntoOutput(localResult, aiResult) {
  return {
    ...localResult,
    notes: aiResult.summary?.length ? aiResult.summary : localResult.notes,
    warnings: Array.isArray(aiResult.warnings) ? aiResult.warnings : localResult.warnings,
    priorityTodos: aiResult.priority_todos?.length ? aiResult.priority_todos : localResult.priorityTodos,
    blocks: Array.isArray(aiResult.schedule) && aiResult.schedule.length
      ? aiResult.schedule.map((block) => ({ ...block, adjusted: true }))
      : localResult.blocks
  };
}

function clearOutput() {
  analysisSummary.textContent = "まだ生成されていません。";
  priorityTodos.textContent = "まだ生成されていません。";
  scheduleTimeline.textContent = "まだ生成されていません。";
  targetDateLabel.textContent = "対象日を選ぶとここに表示されます。";
}

async function checkApiStatus() {
  try {
    const response = await fetch("/api/status");
    if (!response.ok) {
      throw new Error("status failed");
    }
    const data = await response.json();
    csrfToken = data.csrf_token || "";
    const model = data.model || "gpt-5-mini";
    if (!state.aiModel) {
      state.aiModel = model;
      aiModelInput.value = model;
      persistState();
    }
    if (data.configured) {
      setStatus(`OpenAI接続の準備OKです。現在の既定モデル: ${model}`, "ok");
      setChatStatus("AI相談ボックスも利用できます。", "ok");
    } else {
      setStatus("`.env` に OPENAI_API_KEY を入れるとAI再調整と相談ボックスが使えます。", "");
      setChatStatus("APIキーを設定すると相談ボックスが使えます。", "");
    }
    updateMobileAccess(data);
  } catch (error) {
    setStatus("ローカルモードでは使えます。AI機能を使うときは `python server.py` で開いてください。", "");
    setChatStatus("相談ボックスはサーバー起動時に有効になります。", "");
  }
}

function updateMobileAccess(data) {
  const url = data.app_url || window.location.href;
  networkAddress.textContent = url;
  networkAddress.dataset.url = url;
  mobileHint.textContent = data.install_ready
    ? "このURLなら、インストール後はスマホ単体で使えます。"
    : "本番では HTTPS の公開URLにすると、スマホ単体で使えます。";
  installHint.textContent = data.install_ready
    ? "Chrome で開いてからインストールすると、次からはアイコンをタップするだけです。"
    : "いまはローカル表示です。公開後にインストール可能になります。";
}


async function fetchAiSchedule(localResult) {
  const response = await fetch("/api/generate-schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({
      targetDate: state.targetDate,
      reflection: state.reflection,
      errands: sanitizeErrands(state.errands),
      futureTasks: sanitizeFutureTasks(state.futureTasks),
      heuristicSchedule: {
        notes: localResult.notes,
        priorityTodos: localResult.priorityTodos,
        blocks: localResult.blocks
      },
      model: state.aiModel || "gpt-5-mini"
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "AI生成に失敗しました。");
  }
  return data.result;
}

async function sendChatMessage() {
  const message = chatInput.value.trim();
  if (!message) {
    return;
  }
  syncFormToState();
  persistState();

  chatState.messages.push({ role: "user", text: message });
  chatInput.value = "";
  persistChatState();
  renderChat();
  setChatStatus("AIが考えています...", "ok");
  setChatLoading(true);

  try {
    const result = await fetchChatReply(message);
    chatState.previousResponseId = result.response_id || "";
    chatState.messages.push({ role: "assistant", text: result.answer });
    persistChatState();
    renderChat();
    setChatStatus(`相談に回答しました。使用モデル: ${state.aiModel || "gpt-5-mini"}`, "ok");
  } catch (error) {
    chatState.messages.push({ role: "assistant", text: `接続エラー: ${error.message}` });
    persistChatState();
    renderChat();
    setChatStatus("相談の送信に失敗しました。", "error");
  } finally {
    setChatLoading(false);
  }
}

async function fetchChatReply(message) {
  const schedule = generateSchedule(state);
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({
      message,
      model: state.aiModel || "gpt-5-mini",
      previousResponseId: chatState.previousResponseId,
      context: {
        reflection: state.reflection,
        targetDate: state.targetDate,
        errands: sanitizeErrands(state.errands),
        futureTasks: sanitizeFutureTasks(state.futureTasks),
        currentSchedule: schedule.blocks
      }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "相談に失敗しました。");
  }
  return data.result;
}

function renderChat() {
  chatMessages.innerHTML = "";
  chatState.messages.forEach((message) => {
    const bubble = document.createElement("article");
    bubble.className = `chat-bubble ${message.role}`;
    const label = document.createElement("p");
    label.className = "chat-role";
    label.textContent = message.role === "assistant" ? "AI" : "あなた";
    const body = document.createElement("p");
    body.className = "chat-text";
    body.textContent = message.text;
    bubble.append(label, body);
    chatMessages.appendChild(bubble);
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setStatus(message, mode) {
  apiStatus.textContent = message;
  apiStatus.className = "status-text";
  if (mode) {
    apiStatus.classList.add(mode);
  }
}

function setChatStatus(message, mode) {
  chatStatus.textContent = message;
  chatStatus.className = "status-text";
  if (mode) {
    chatStatus.classList.add(mode);
  }
}

function setChatLoading(isLoading) {
  sendChatButton.disabled = isLoading;
  sendChatButton.textContent = isLoading ? "送信中..." : "相談する";
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").then(() => {
      if (navigator.serviceWorker.controller) {
        installHint.textContent = "PWA 判定を更新するため、ページを一度再読み込みしてください。";
      }
    }).catch(() => {});
  });
}

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installAppButton.disabled = false;
    installHint.textContent = "この端末ではアプリとしてインストールできます。";
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    installAppButton.disabled = true;
    installHint.textContent = "インストール完了。次からはホーム画面のアイコンから開けます。";
  });
}

function getTomorrowDateString() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
}

function toMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function addMinutes(time, minutes) {
  const total = toMinutes(time) + minutes;
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function durationOf(block) {
  return toMinutes(block.end) - toMinutes(block.start);
}

function rangesOverlap(startA, endA, startB, endB) {
  return toMinutes(startA) < toMinutes(endB) && toMinutes(startB) < toMinutes(endA);
}

function normalizeDuration(value, fallback) {
  const numeric = Number(value);
  if (Number.isNaN(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.max(15, Math.round(numeric / 15) * 15);
}

function hasDinnerBlock(blocks) {
  return blocks.some((block) => block.category === "meal" && block.title.includes("夕食"));
}
