const STORAGE_KEY = "resilient-planner-state-v4";
const CHAT_KEY = "resilient-planner-chat-v1";
let csrfToken = "";
let deferredInstallPrompt = null;
const isNativeApp = new URLSearchParams(window.location.search).get("native_app") === "1";

const defaultState = {
  targetDate: "",
  fixedRulesText: "",
  todoItems: [],
  reflection: "",
  fatigueLevel: "3",
  focusLevel: "3",
  moodLevel: "normal",
  futureTasksText: "",
  selectedCalendarDate: "",
  calendarMonth: "",
  calendarEntries: {},
  dailyRecords: {},
  dietEntries: {},
  moneyEntries: {},
  historyEntries: {},
  aiModel: "gpt-5-mini",
  generationMode: "local",
  activeTab: "home"
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

function createEmptyTodo() {
  return {
    title: "",
    deadline: "",
    importance: "high",
    duration: 60,
    status: "todo",
    memo: ""
  };
}

function normalizeTodoItem(item) {
  if (!item || typeof item !== "object") {
    return createEmptyTodo();
  }

  return {
    title: item.title || item.text || "",
    deadline: item.deadline || "",
    importance: item.importance || item.priority || (item.done ? "low" : "high"),
    duration: normalizeDuration(item.duration, 60),
    status: item.status || (item.done ? "done" : "todo"),
    memo: item.memo || ""
  };
}

function createEmptyDietEntry() {
  return {
    breakfast: "",
    lunch: "",
    dinner: "",
    snack: "",
    bodyWeight: "",
    exercise: "",
    hungerLevel: "3",
    satisfactionLevel: "3"
  };
}

function createEmptyMoneyEntry() {
  return {
    income: 0,
    fixed: 0,
    food: 0,
    transport: 0,
    fun: 0,
    beauty: 0,
    investment: 0,
    other: 0
  };
}

function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];
const fallbackFixedRulesText = [
  "起床 7:00",
  "食事 20:00",
  "就寝 23:00",
  "水・金 バイト 17:00-22:00",
  "月 13:00-14:30 / 火 13:00-16:00 / 金 14:40-16:00 授業"
].join("\n");

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
let lastGeneratedResult = null;

const targetDateInput = document.getElementById("targetDate");
const fixedRulesInput = document.getElementById("fixedRulesText");
const todoList = document.getElementById("todoList");
const todoItemTemplate = document.getElementById("todoItemTemplate");
const reflectionInput = document.getElementById("reflection");
const futureTasksTextInput = document.getElementById("futureTasksText");
const aiModelInput = document.getElementById("aiModel");
const generationModeInput = document.getElementById("generationMode");
const apiStatus = document.getElementById("apiStatus");
const analysisSummary = document.getElementById("analysisSummary");
const priorityTodos = document.getElementById("priorityTodos");
const scheduleTimeline = document.getElementById("scheduleTimeline");
const targetDateLabel = document.getElementById("targetDateLabel");
const networkAddress = document.getElementById("networkAddress");
const mobileHint = document.getElementById("mobileHint");
const copyAddressButton = document.getElementById("copyAddressButton");
const mobilePanel = document.querySelector(".mobile-panel");
const calendarMonthLabel = document.getElementById("calendarMonthLabel");
const calendarGrid = document.getElementById("calendarGrid");
const selectedDateLabel = document.getElementById("selectedDateLabel");
const selectedDateSubLabel = document.getElementById("selectedDateSubLabel");
const calendarEntryText = document.getElementById("calendarEntryText");
const saveCalendarEntryButton = document.getElementById("saveCalendarEntryButton");
const applyScheduleToCalendarButton = document.getElementById("applyScheduleToCalendarButton");
const chatStatus = document.getElementById("chatStatus");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendChatButton = document.getElementById("sendChatButton");
const resetChatButton = document.getElementById("resetChatButton");
const fatigueLevelInput = document.getElementById("fatigueLevel");
const focusLevelInput = document.getElementById("focusLevel");
const moodLevelInput = document.getElementById("moodLevel");
const dietBreakfastInput = document.getElementById("dietBreakfast");
const dietLunchInput = document.getElementById("dietLunch");
const dietDinnerInput = document.getElementById("dietDinner");
const dietSnackInput = document.getElementById("dietSnack");
const bodyWeightInput = document.getElementById("bodyWeight");
const exerciseTextInput = document.getElementById("exerciseText");
const hungerLevelInput = document.getElementById("hungerLevel");
const satisfactionLevelInput = document.getElementById("satisfactionLevel");
const moneyIncomeInput = document.getElementById("moneyIncome");
const moneyFixedInput = document.getElementById("moneyFixed");
const moneyFoodInput = document.getElementById("moneyFood");
const moneyTransportInput = document.getElementById("moneyTransport");
const moneyFunInput = document.getElementById("moneyFun");
const moneyBeautyInput = document.getElementById("moneyBeauty");
const moneyInvestmentInput = document.getElementById("moneyInvestment");
const moneyOtherInput = document.getElementById("moneyOther");
const moneyDateLabel = document.getElementById("moneyDateLabel");
const monthlySpendTotal = document.getElementById("monthlySpendTotal");
const monthlyRemaining = document.getElementById("monthlyRemaining");
const dailyBudget = document.getElementById("dailyBudget");
const monthlyForecast = document.getElementById("monthlyForecast");
const moneyInsight = document.getElementById("moneyInsight");
const tabButtons = Array.from(document.querySelectorAll("[data-tab-trigger]"));
const tabScreens = Array.from(document.querySelectorAll("[data-tab-screen]"));
const jumpButtons = Array.from(document.querySelectorAll("[data-tab-jump]"));
const homeTodayDate = document.getElementById("homeTodayDate");
const homeTargetDate = document.getElementById("homeTargetDate");
const homeTodoPreview = document.getElementById("homeTodoPreview");
const homeTodayCalendar = document.getElementById("homeTodayCalendar");
const homePriorityPreview = document.getElementById("homePriorityPreview");
const homeSchedulePreview = document.getElementById("homeSchedulePreview");
const homeOpenPlannerButton = document.getElementById("homeOpenPlannerButton");
const homeOpenRecordButton = document.getElementById("homeOpenRecordButton");
const homeOpenMoneyButton = document.getElementById("homeOpenMoneyButton");

document.getElementById("addTodo").addEventListener("click", () => {
  state.todoItems.push(createEmptyTodo());
  renderTodoList();
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
  state.selectedCalendarDate = getTodayDateString();
  state.calendarMonth = getMonthString(state.selectedCalendarDate);
  state.fixedRulesText = fallbackFixedRulesText;
  render();
  persistState();
  clearOutput();
});

targetDateInput.addEventListener("change", persistFromForm);
fixedRulesInput.addEventListener("input", persistFromForm);
reflectionInput.addEventListener("input", persistFromForm);
futureTasksTextInput.addEventListener("input", persistFromForm);
aiModelInput.addEventListener("input", persistFromForm);
generationModeInput.addEventListener("change", persistFromForm);
fatigueLevelInput.addEventListener("change", persistFromForm);
focusLevelInput.addEventListener("change", persistFromForm);
moodLevelInput.addEventListener("change", persistFromForm);
[dietBreakfastInput, dietLunchInput, dietDinnerInput, dietSnackInput, bodyWeightInput, exerciseTextInput, hungerLevelInput, satisfactionLevelInput, moneyIncomeInput, moneyFixedInput, moneyFoodInput, moneyTransportInput, moneyFunInput, moneyBeautyInput, moneyInvestmentInput, moneyOtherInput]
  .filter(Boolean)
  .forEach((input) => {
    input.addEventListener("input", persistFromForm);
    input.addEventListener("change", persistFromForm);
  });
calendarEntryText.addEventListener("input", () => {
  selectedDateSubLabel.textContent = "未保存の変更があります。";
});

if (copyAddressButton) {
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
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const nextTab = button.dataset.tabTrigger;
    if (nextTab) {
      switchTab(nextTab);
    }
  });
});

jumpButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const nextTab = button.dataset.tabJump;
    if (nextTab) {
      switchTab(nextTab);
    }
  });
});

homeOpenPlannerButton?.addEventListener("click", () => switchTab("schedule"));
homeOpenRecordButton?.addEventListener("click", () => switchTab("record"));
homeOpenMoneyButton?.addEventListener("click", () => switchTab("money"));

if (sendChatButton) {
  sendChatButton.addEventListener("click", () => {
    sendChatMessage();
  });
}

if (chatInput) {
  chatInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      sendChatMessage();
    }
  });
}

if (resetChatButton) {
  resetChatButton.addEventListener("click", () => {
    chatState = structuredClone(defaultChatState);
    persistChatState();
    renderChat();
    setChatStatus("相談履歴をリセットしました。", "ok");
  });
}

document.getElementById("prevMonthButton").addEventListener("click", () => {
  state.calendarMonth = shiftMonth(state.calendarMonth || getMonthString(state.selectedCalendarDate), -1);
  persistState();
  renderCalendar();
});

document.getElementById("nextMonthButton").addEventListener("click", () => {
  state.calendarMonth = shiftMonth(state.calendarMonth || getMonthString(state.selectedCalendarDate), 1);
  persistState();
  renderCalendar();
});

saveCalendarEntryButton.addEventListener("click", () => {
  syncFormToState();
  saveCalendarEntry();
});

applyScheduleToCalendarButton.addEventListener("click", () => {
  syncFormToState();
  const schedule = lastGeneratedResult || generateSchedule(state);
  state.calendarEntries[state.selectedCalendarDate] = formatScheduleForCalendar(schedule);
  persistState();
  renderCalendar();
  renderCalendarEditor();
});

init();

async function init() {
  if (!state.targetDate) {
    state.targetDate = getTomorrowDateString();
  }
  if (!state.selectedCalendarDate) {
    state.selectedCalendarDate = getTodayDateString();
  }
  if (!state.calendarMonth) {
    state.calendarMonth = getMonthString(state.selectedCalendarDate);
  }
  if (!state.fixedRulesText) {
    state.fixedRulesText = fallbackFixedRulesText;
  }
  if (!Array.isArray(state.todoItems) || !state.todoItems.length) {
    state.todoItems = [createEmptyTodo()];
  } else {
    state.todoItems = state.todoItems.map((item) => normalizeTodoItem(item));
  }
  if (!state.calendarEntries || typeof state.calendarEntries !== "object") {
    state.calendarEntries = {};
  }
  if (!state.dailyRecords || typeof state.dailyRecords !== "object") {
    state.dailyRecords = {};
  }
  if (!state.dietEntries || typeof state.dietEntries !== "object") {
    state.dietEntries = {};
  }
  if (!state.moneyEntries || typeof state.moneyEntries !== "object") {
    state.moneyEntries = {};
  }
  if (!state.historyEntries || typeof state.historyEntries !== "object") {
    state.historyEntries = {};
  }
  if (!state.activeTab) {
    state.activeTab = "home";
  }
  if (isNativeApp && mobilePanel) {
    mobilePanel.style.display = "none";
  }
  render();
  renderOutput(generateSchedule(state));
  if (chatMessages) {
    renderChat();
  }
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
  saveTodayRecordSnapshot();
  persistState();
  renderMoneySummary();
  renderHomeSummary();
}

function syncFormToState() {
  state.targetDate = targetDateInput.value;
  state.fixedRulesText = fixedRulesInput.value.trim();
  state.todoItems = collectTodoValues();
  state.reflection = reflectionInput.value.trim();
  state.fatigueLevel = fatigueLevelInput.value;
  state.focusLevel = focusLevelInput.value;
  state.moodLevel = moodLevelInput.value;
  state.futureTasksText = futureTasksTextInput.value.trim();
  state.aiModel = aiModelInput.value.trim() || "gpt-5-mini";
  state.generationMode = generationModeInput.value;
}

function saveTodayRecordSnapshot() {
  const todayKey = getTodayDateString();

  state.dailyRecords[todayKey] = {
    date: todayKey,
    reflection: state.reflection,
    fatigueLevel: state.fatigueLevel,
    focusLevel: state.focusLevel,
    moodLevel: state.moodLevel,
    futureTasksText: state.futureTasksText,
    calendarNote: state.calendarEntries[todayKey] || "",
    todos: state.todoItems
      .map((item) => normalizeTodoItem(item))
      .filter((item) => item.title),
    diet: {
      breakfast: dietBreakfastInput?.value.trim() || "",
      lunch: dietLunchInput?.value.trim() || "",
      dinner: dietDinnerInput?.value.trim() || "",
      snack: dietSnackInput?.value.trim() || "",
      bodyWeight: bodyWeightInput?.value || "",
      exercise: exerciseTextInput?.value.trim() || "",
      hungerLevel: hungerLevelInput?.value || "3",
      satisfactionLevel: satisfactionLevelInput?.value || "3"
    },
    money: {
      income: numberOrZero(moneyIncomeInput?.value),
      fixed: numberOrZero(moneyFixedInput?.value),
      food: numberOrZero(moneyFoodInput?.value),
      transport: numberOrZero(moneyTransportInput?.value),
      fun: numberOrZero(moneyFunInput?.value),
      beauty: numberOrZero(moneyBeautyInput?.value),
      investment: numberOrZero(moneyInvestmentInput?.value),
      other: numberOrZero(moneyOtherInput?.value)
    },
    savedAt: new Date().toISOString()
  };

  state.dietEntries[todayKey] = {
    breakfast: dietBreakfastInput?.value.trim() || "",
    lunch: dietLunchInput?.value.trim() || "",
    dinner: dietDinnerInput?.value.trim() || "",
    snack: dietSnackInput?.value.trim() || "",
    bodyWeight: bodyWeightInput?.value || "",
    exercise: exerciseTextInput?.value.trim() || "",
    hungerLevel: hungerLevelInput?.value || "3",
    satisfactionLevel: satisfactionLevelInput?.value || "3"
  };

  state.moneyEntries[todayKey] = {
    income: numberOrZero(moneyIncomeInput?.value),
    fixed: numberOrZero(moneyFixedInput?.value),
    food: numberOrZero(moneyFoodInput?.value),
    transport: numberOrZero(moneyTransportInput?.value),
    fun: numberOrZero(moneyFunInput?.value),
    beauty: numberOrZero(moneyBeautyInput?.value),
    investment: numberOrZero(moneyInvestmentInput?.value),
    other: numberOrZero(moneyOtherInput?.value)
  };

  state.dailyRecords = Object.fromEntries(
    Object.entries(state.dailyRecords).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14)
  );
  state.dietEntries = Object.fromEntries(
    Object.entries(state.dietEntries).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 31)
  );
  state.moneyEntries = Object.fromEntries(
    Object.entries(state.moneyEntries).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 31)
  );
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

function collectTodoValues() {
  return Array.from(todoList.children)
    .map((child) => ({
      title: child.querySelector('[data-key="title"]').value.trim(),
      deadline: child.querySelector('[data-key="deadline"]').value,
      importance: child.querySelector('[data-key="importance"]').value,
      duration: Number(child.querySelector('[data-key="duration"]').value) || 60,
      status: child.querySelector('[data-key="status"]').value,
      memo: child.querySelector('[data-key="memo"]').value.trim()
    }))
    .filter((item, index, items) => item.title || items.length === 1 || index < items.length - 1);
}

function renderTodoList() {
  todoList.innerHTML = "";
  state.todoItems.forEach((item, index) => {
    const normalized = normalizeTodoItem(item);
    const fragment = todoItemTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".todo-item");
    const remove = row.querySelector('[data-role="remove"]');
    const title = row.querySelector('[data-key="title"]');
    const deadline = row.querySelector('[data-key="deadline"]');
    const importance = row.querySelector('[data-key="importance"]');
    const duration = row.querySelector('[data-key="duration"]');
    const status = row.querySelector('[data-key="status"]');
    const memo = row.querySelector('[data-key="memo"]');

    title.value = normalized.title;
    deadline.value = normalized.deadline;
    importance.value = normalized.importance;
    duration.value = String(normalized.duration);
    status.value = normalized.status;
    memo.value = normalized.memo;

    [title, deadline, importance, duration, status, memo].forEach((input) => {
      input.addEventListener("input", persistFromForm);
      input.addEventListener("change", persistFromForm);
    });

    remove.addEventListener("click", () => {
      state.todoItems.splice(index, 1);
      if (!state.todoItems.length) {
        state.todoItems.push(createEmptyTodo());
      }
      renderTodoList();
      persistState();
      renderHomeSummary();
    });

    todoList.appendChild(fragment);
  });
}

function renderCalendar() {
  const monthKey = state.calendarMonth || getMonthString(state.selectedCalendarDate || getTodayDateString());
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const firstDay = new Date(year, monthIndex, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, monthIndex, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  calendarMonthLabel.textContent = `${year}年${monthIndex + 1}月`;
  calendarGrid.innerHTML = "";

  for (let cellIndex = 0; cellIndex < totalCells; cellIndex += 1) {
    const dayOffset = cellIndex - startOffset + 1;
    const date = new Date(year, monthIndex, dayOffset);
    const dateKey = formatDateKey(date);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";

    if (date.getMonth() !== monthIndex) {
      button.classList.add("is-other-month");
    }
    if (dateKey === state.selectedCalendarDate) {
      button.classList.add("is-selected");
    }

    const number = document.createElement("span");
    number.className = "calendar-day__number";
    number.textContent = String(date.getDate());

    const preview = document.createElement("div");
    preview.className = "calendar-day__preview";
    preview.textContent = getCalendarPreview(dateKey);

    button.append(number, preview);
    button.addEventListener("click", () => {
      syncFormToState();
      state.selectedCalendarDate = dateKey;
      state.targetDate = dateKey;
      state.calendarMonth = getMonthString(dateKey);
      persistState();
      renderCalendar();
      renderCalendarEditor();
      renderHomeSummary();
    });

    calendarGrid.appendChild(button);
  }
}

function renderCalendarEditor() {
  const selected = state.selectedCalendarDate || getTodayDateString();
  const date = new Date(`${selected}T00:00:00`);
  selectedDateLabel.textContent = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  selectedDateSubLabel.textContent = `${weekdayLabels[date.getDay()]}曜日`;
  calendarEntryText.value = state.calendarEntries[selected] || "";
}

function saveCalendarEntry() {
  const key = state.selectedCalendarDate || getTodayDateString();
  const value = calendarEntryText.value.trim();
  if (value) {
    state.calendarEntries[key] = value;
  } else {
    delete state.calendarEntries[key];
  }
  state.targetDate = key;
  if (key === getTodayDateString()) {
    saveTodayRecordSnapshot();
  }
  persistState();
  renderCalendar();
  renderCalendarEditor();
  renderHomeSummary();
}

function getCalendarPreview(dateKey) {
  const value = state.calendarEntries[dateKey];
  if (!value) {
    return "";
  }
  return value.split(/\r?\n/).slice(0, 2).join(" / ");
}

function render() {
  targetDateInput.value = state.targetDate;
  fixedRulesInput.value = state.fixedRulesText || "";
  renderTodoList();
  reflectionInput.value = state.reflection;
  fatigueLevelInput.value = state.fatigueLevel || "3";
  focusLevelInput.value = state.focusLevel || "3";
  moodLevelInput.value = state.moodLevel || "normal";
  futureTasksTextInput.value = state.futureTasksText || "";
  aiModelInput.value = state.aiModel || "gpt-5-mini";
  generationModeInput.value = state.generationMode || "local";
  renderCalendar();
  renderCalendarEditor();
  renderRecordInputs();
  renderMoneySummary();
  renderTabs();
  renderHomeSummary();
}

function renderRecordInputs() {
  const todayKey = getTodayDateString();
  const dietEntry = state.dietEntries[todayKey] || createEmptyDietEntry();
  const moneyEntry = state.moneyEntries[todayKey] || createEmptyMoneyEntry();

  if (dietBreakfastInput) dietBreakfastInput.value = dietEntry.breakfast || "";
  if (dietLunchInput) dietLunchInput.value = dietEntry.lunch || "";
  if (dietDinnerInput) dietDinnerInput.value = dietEntry.dinner || "";
  if (dietSnackInput) dietSnackInput.value = dietEntry.snack || "";
  if (bodyWeightInput) bodyWeightInput.value = dietEntry.bodyWeight || "";
  if (exerciseTextInput) exerciseTextInput.value = dietEntry.exercise || "";
  if (hungerLevelInput) hungerLevelInput.value = dietEntry.hungerLevel || "3";
  if (satisfactionLevelInput) satisfactionLevelInput.value = dietEntry.satisfactionLevel || "3";

  if (moneyIncomeInput) moneyIncomeInput.value = String(moneyEntry.income || 0);
  if (moneyFixedInput) moneyFixedInput.value = String(moneyEntry.fixed || 0);
  if (moneyFoodInput) moneyFoodInput.value = String(moneyEntry.food || 0);
  if (moneyTransportInput) moneyTransportInput.value = String(moneyEntry.transport || 0);
  if (moneyFunInput) moneyFunInput.value = String(moneyEntry.fun || 0);
  if (moneyBeautyInput) moneyBeautyInput.value = String(moneyEntry.beauty || 0);
  if (moneyInvestmentInput) moneyInvestmentInput.value = String(moneyEntry.investment || 0);
  if (moneyOtherInput) moneyOtherInput.value = String(moneyEntry.other || 0);

  if (moneyDateLabel) {
    const today = new Date(`${todayKey}T00:00:00`);
    moneyDateLabel.textContent = `${today.getMonth() + 1}月${today.getDate()}日分`;
  }
}

function renderTabs() {
  const requestedTab = state.activeTab || "home";
  const hasRequestedTab = tabScreens.some((screen) => screen.dataset.tabScreen === requestedTab);
  const activeTab = hasRequestedTab ? requestedTab : "home";
  state.activeTab = activeTab;
  tabScreens.forEach((screen) => {
    screen.classList.toggle("is-active", screen.dataset.tabScreen === activeTab);
  });
  tabButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tabTrigger === activeTab);
  });
}

function switchTab(tabName) {
  state.activeTab = tabName;
  renderTabs();
  persistState();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderHomeSummary(result = lastGeneratedResult || generateSchedule(state)) {
  if (!homeTodayDate) {
    return;
  }

  const todayKey = getTodayDateString();
  const today = new Date(`${todayKey}T00:00:00`);
  homeTodayDate.textContent = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 (${weekdayLabels[today.getDay()]})`;
  homeTargetDate.textContent = formatDateLabel(result.date);

  homeTodayCalendar.innerHTML = "";
  const todayNote = state.calendarEntries[todayKey];
  if (todayNote) {
    homeTodayCalendar.classList.remove("empty-state");
    homeTodayCalendar.textContent = todayNote;
  } else {
    homeTodayCalendar.textContent = "今日の予定メモはまだ登録されていません。";
    homeTodayCalendar.classList.add("empty-state");
  }

  const todoItems = state.todoItems
    .map((item) => normalizeTodoItem(item))
    .filter((item) => item.title && item.status !== "done")
    .slice(0, 5);
  renderHomeList(
    homeTodoPreview,
    todoItems.map((item) => `${item.title}${item.deadline ? ` / 締切 ${formatShortDate(item.deadline)}` : ""}${item.importance ? ` / ${importanceLabel(item.importance)}` : ""}`),
    "今日のToDoはまだありません。"
  );

  renderHomeList(homePriorityPreview, result.priorityTodos.slice(0, 4), "まだ生成されていません。");
  renderHomeList(
    homeSchedulePreview,
    result.blocks.slice(0, 6).map((block) => `${block.start}-${block.end} ${block.title}`),
    "まだ生成されていません。"
  );
}

function renderHomeList(container, items, emptyText) {
  container.innerHTML = "";
  if (!items.length) {
    container.textContent = emptyText;
    container.classList.add("empty-state");
    return;
  }

  container.classList.remove("empty-state");
  const list = document.createElement("ul");
  list.className = "home-list";
  items.forEach((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    list.appendChild(item);
  });
  container.appendChild(list);
}

function renderMoneySummary() {
  if (!monthlySpendTotal) {
    return;
  }

  const todayKey = getTodayDateString();
  const today = new Date(`${todayKey}T00:00:00`);
  const monthPrefix = todayKey.slice(0, 7);
  const monthlyEntries = Object.entries(state.moneyEntries || {})
    .filter(([dateKey]) => dateKey.startsWith(monthPrefix))
    .map(([, value]) => value || createEmptyMoneyEntry());

  const totalIncome = monthlyEntries.reduce((sum, item) => sum + numberOrZero(item.income), 0);
  const totalSpend = monthlyEntries.reduce(
    (sum, item) => sum
      + numberOrZero(item.fixed)
      + numberOrZero(item.food)
      + numberOrZero(item.transport)
      + numberOrZero(item.fun)
      + numberOrZero(item.beauty)
      + numberOrZero(item.investment)
      + numberOrZero(item.other),
    0
  );
  const remaining = totalIncome - totalSpend;
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - today.getDate());
  const budgetPerDay = remaining / daysLeft;
  const monthProgress = today.getDate() / daysInMonth;
  const forecast = monthProgress > 0 ? Math.round(totalSpend / monthProgress) : totalSpend;

  monthlySpendTotal.textContent = formatCurrency(totalSpend);
  monthlyRemaining.textContent = formatCurrency(remaining);
  dailyBudget.textContent = formatCurrency(budgetPerDay);
  monthlyForecast.textContent = formatCurrency(forecast);

  const todayMoney = state.moneyEntries[todayKey] || createEmptyMoneyEntry();
  const todayDiet = state.dietEntries[todayKey] || createEmptyDietEntry();
  const messages = [];

  if (numberOrZero(todayMoney.food) > 1500) {
    messages.push("今日の食費が高めなので、明日はコンビニ回数を減らすと整いやすそうです。");
  }
  if (numberOrZero(todayMoney.fun) > 0 && numberOrZero(todayMoney.fun) > numberOrZero(todayMoney.food)) {
    messages.push("娯楽費が食費より大きい日です。月末までの残金も意識しておくと安心です。");
  }
  if ((todayDiet.breakfast || "").trim() === "") {
    messages.push("朝食記録が空なので、明日は午前の集中前に軽くでも食べる前提で予定を組むのがおすすめです。");
  }
  if (messages.length === 0) {
    messages.push("記録が増えるほど、家計と食事の傾向を見て明日の予定を整えやすくなります。");
  }

  moneyInsight.innerHTML = "";
  const list = document.createElement("ul");
  list.className = "home-list";
  messages.forEach((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    list.appendChild(item);
  });
  moneyInsight.classList.remove("empty-state");
  moneyInsight.appendChild(list);
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
  recordHistoryEntry(localResult, { source: "local" });

  if (!preferAi) {
    return;
  }

  setStatus("AIがローカル案を再調整しています...", "ok");
  try {
    const aiResult = await fetchAiSchedule(localResult);
    const mergedResult = mergeAiResultIntoOutput(localResult, aiResult);
    renderOutput(mergedResult);
    recordHistoryEntry(mergedResult, { source: "ai" });
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
  const reflectionContext = buildReflectionContext(inputState);
  const reflectionMode = analyzeReflection(reflectionContext);
  const customRuleLines = parseRuleLines(inputState.fixedRulesText);
  const todoItems = sanitizeTodoItems(inputState.todoItems || []);
  const recentHistory = getRecentHistoryEntries(inputState.historyEntries, targetDate);
  const recentWeeklyRecords = getRecentWeeklyRecords(inputState.dailyRecords, targetDate);
  const carryOverTasks = buildCarryOverTasks(recentHistory, todoItems, inputState.futureTasksText);
  const errands = [];
  const futureTasks = sanitizeFutureTasks(parseFutureTasksText(inputState.futureTasksText));
  const scheduledBlocks = template.blocks.map((block) => ({ ...block, source: "template" }));
  const notes = [];
  const warnings = [];

  if (customRuleLines.length) {
    notes.push(`固定ルール欄の内容を考慮: ${customRuleLines.slice(0, 3).join(" / ")}`);
  }
  if (todoItems.length) {
    notes.push(`今日のToDo: ${todoItems.slice(0, 3).map((item) => item.title).join(" / ")}`);
  }
  if (recentHistory.length) {
    notes.push(buildHistoryInsight(recentHistory));
  }
  if (recentWeeklyRecords.length) {
    notes.push(buildWeeklyInsight(recentWeeklyRecords));
  }

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
  if (recentWeeklyRecords.filter((entry) => numberOrZero(entry.fatigueLevel) >= 4).length >= 3) {
    softenTemplate(scheduledBlocks);
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
    ...todoItems.map((item) => ({
      ...item,
      priorityScore: item.done ? 25 : 100,
      label: "ToDoリスト"
    })),
    ...carryOverTasks,
    ...untimedErrands.map((item) => ({ ...item, priorityScore: 95, label: "明日の用事" })),
    ...futureTasks.map((item) => ({
      ...item,
      priorityScore: item.priority === "high" ? 90 : item.priority === "medium" ? 70 : 50,
      label: "今後の課題"
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
    recentHistory,
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

function sanitizeTodoItems(items) {
  return items
    .map((item) => normalizeTodoItem(item))
    .filter((item) => item.title && item.title.trim())
    .map((item) => ({
      title: item.title.trim(),
      category: inferCategoryFromText(`${item.title} ${item.memo || ""}`),
      priority: item.status === "done" ? "low" : item.importance || "high",
      duration: normalizeDuration(item.duration, 60),
      done: item.status === "done",
      deadline: item.deadline,
      memo: item.memo
    }));
}

function buildReflectionContext(inputState) {
  const fatigue = inputState.fatigueLevel || "3";
  const focus = inputState.focusLevel || "3";
  const mood = inputState.moodLevel || "normal";
  const moodLabel = mood === "good" ? "良い" : mood === "bad" ? "悪い" : "普通";
  const todayKey = getTodayDateString();
  const dietEntry = (inputState.dietEntries || {})[todayKey] || createEmptyDietEntry();
  const moneyEntry = (inputState.moneyEntries || {})[todayKey] || createEmptyMoneyEntry();
  const moneySpend = numberOrZero(moneyEntry.fixed) + numberOrZero(moneyEntry.food) + numberOrZero(moneyEntry.transport)
    + numberOrZero(moneyEntry.fun) + numberOrZero(moneyEntry.beauty) + numberOrZero(moneyEntry.investment) + numberOrZero(moneyEntry.other);
  const freeText = (inputState.reflection || "").trim();
  return [
    `疲労度: ${fatigue}/5`,
    `集中度: ${focus}/5`,
    `気分: ${moodLabel}`,
    `今日の食事: 朝=${dietEntry.breakfast || "なし"}, 昼=${dietEntry.lunch || "なし"}, 夜=${dietEntry.dinner || "なし"}, 間食=${dietEntry.snack || "なし"}`,
    `体重: ${dietEntry.bodyWeight || "未記録"}kg / 運動: ${dietEntry.exercise || "未記録"} / 空腹感: ${dietEntry.hungerLevel || "3"} / 満足度: ${dietEntry.satisfactionLevel || "3"}`,
    `今日のお金: 収入=${numberOrZero(moneyEntry.income)}円 / 支出=${moneySpend}円`,
    freeText
  ].filter(Boolean).join("\n");
}

function getRecentWeeklyRecords(dailyRecords, targetDate) {
  if (!dailyRecords || typeof dailyRecords !== "object") {
    return [];
  }

  return Object.values(dailyRecords)
    .filter((entry) => entry && entry.date && entry.date < targetDate)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);
}

function buildWeeklyInsight(weeklyRecords) {
  if (!weeklyRecords.length) {
    return "";
  }

  const fatigueAverage = weeklyRecords.reduce((sum, item) => sum + numberOrZero(item.fatigueLevel), 0) / weeklyRecords.length;
  const focusAverage = weeklyRecords.reduce((sum, item) => sum + numberOrZero(item.focusLevel), 0) / weeklyRecords.length;
  const highFatigueDays = weeklyRecords.filter((item) => numberOrZero(item.fatigueLevel) >= 4).length;
  const carryOverCount = weeklyRecords.reduce((sum, item) => sum + ((item.todos || []).filter((todo) => todo.status !== "done").length > 0 ? 1 : 0), 0);
  const skippedBreakfastDays = weeklyRecords.filter((item) => !((item.diet || {}).breakfast || "").trim()).length;
  const highFoodCostDays = weeklyRecords.filter((item) => numberOrZero((item.money || {}).food) >= 1500).length;

  if (highFatigueDays >= 3 || fatigueAverage >= 3.8) {
    return "過去1週間は疲労が高めの日が多かったため、明日は回復余白を多めに取る設計にしています。";
  }
  if (focusAverage >= 3.8 && fatigueAverage <= 3) {
    return "過去1週間の集中度が比較的高いので、朝の深い作業枠を活かす前提で組みました。";
  }
  if (skippedBreakfastDays >= 3) {
    return "過去1週間で朝食抜きが続いているため、明日は午前の負荷を上げすぎないように調整しています。";
  }
  if (highFoodCostDays >= 3) {
    return "過去1週間で食費が高い日が続いているため、買い物や食事のタイミングも意識しやすい設計にしています。";
  }
  if (carryOverCount >= 4) {
    return "過去1週間で持ち越しが続いているため、明日は優先順位を絞って終わる量に調整しています。";
  }
  return "過去1週間の記録を参考に、無理のない標準モードで組みました。";
}

function getRecentHistoryEntries(historyEntries, targetDate) {
  if (!historyEntries || typeof historyEntries !== "object") {
    return [];
  }

  return Object.values(historyEntries)
    .filter((entry) => entry && entry.date && entry.date < targetDate)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);
}

function buildCarryOverTasks(historyEntries, todoItems, futureTasksText) {
  const currentTitles = new Set([
    ...todoItems.map((item) => item.title),
    ...parseFutureTasksText(futureTasksText).map((item) => item.title)
  ]);

  return historyEntries
    .flatMap((entry) => Array.isArray(entry.carryOverTitles) ? entry.carryOverTitles : [])
    .filter((title, index, list) => title && list.indexOf(title) === index && !currentTitles.has(title))
    .slice(0, 3)
    .map((title) => ({
      title,
      category: inferCategoryFromText(title),
      priority: "medium",
      duration: 60,
      priorityScore: 82,
      label: "過去の履歴"
    }));
}

function buildHistoryInsight(historyEntries) {
  const latest = historyEntries[0];
  const summary = latest.summary?.[0] || "直近の流れを参考にしています。";
  return `直近${historyEntries.length}日分の履歴も参照: ${latest.date} の記録では「${summary}」でした。`;
}

function parseRuleLines(text) {
  return (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseFutureTasksText(text) {
  return (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((title) => ({
      title,
      category: inferCategoryFromText(title),
      priority: "high",
      duration: 90
    }));
}

function inferCategoryFromText(text) {
  if (/(就活|ES|面接|企業)/i.test(text)) {
    return "job";
  }
  if (/(制作|note|動画|youtube)/i.test(text)) {
    return "creation";
  }
  if (/(研究|ゼミ)/i.test(text)) {
    return "research";
  }
  if (/(toeic|勉強|学習|課題|読書)/i.test(text)) {
    return "study";
  }
  return "personal";
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
  lastGeneratedResult = result;
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

  renderHomeSummary(result);
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
  lastGeneratedResult = null;
  analysisSummary.textContent = "まだ生成されていません。";
  priorityTodos.textContent = "まだ生成されていません。";
  scheduleTimeline.textContent = "まだ生成されていません。";
  targetDateLabel.textContent = "対象日を選ぶとここに表示されます。";
  renderHomeSummary();
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
      setStatus("AIで整える機能と相談機能が使えます。", "ok");
      setChatStatus("AI相談ボックスも利用できます。", "ok");
    } else {
      setStatus("AIはまだ未接続ですが、通常のスケジュール作成は使えます。", "");
      setChatStatus("APIキーを設定すると相談ボックスが使えます。", "");
    }
    updateMobileAccess(data);
  } catch (error) {
    setStatus("AI接続の確認に失敗しました。通常のスケジュール作成は使えます。", "");
    setChatStatus("相談ボックスはサーバー起動時に有効になります。", "");
  }
}

function updateMobileAccess(data) {
  const url = data.app_url || window.location.href;
  networkAddress.textContent = url;
  networkAddress.dataset.url = url;
  mobileHint.textContent = "";
}

function formatScheduleForCalendar(result) {
  return result.blocks.map((block) => `${block.start}-${block.end} ${block.title}`).join("\n");
}

function extractCarryOverTitles(result) {
  return result.priorityTodos
    .map((item) => item.replace(/\s*\([^)]*\)\s*$/u, "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

function recordHistoryEntry(result, meta = {}) {
  const dateKey = formatDateKey(result.date);
  state.historyEntries[dateKey] = {
    date: dateKey,
    source: meta.source || "local",
    reflection: state.reflection,
    fatigueLevel: state.fatigueLevel,
    focusLevel: state.focusLevel,
    moodLevel: state.moodLevel,
    diet: state.dietEntries[dateKey] || createEmptyDietEntry(),
    money: state.moneyEntries[dateKey] || createEmptyMoneyEntry(),
    fixedRulesText: state.fixedRulesText,
    todoItems: state.todoItems,
    futureTasksText: state.futureTasksText,
    calendarNote: state.calendarEntries[dateKey] || "",
    summary: result.notes.slice(0, 4),
    warnings: result.warnings,
    priorityTodos: result.priorityTodos,
    carryOverTitles: extractCarryOverTitles(result),
    schedule: result.blocks.map((block) => ({
      start: block.start,
      end: block.end,
      title: block.title,
      category: block.category
    })),
    savedAt: new Date().toISOString()
  };

  const trimmedEntries = Object.entries(state.historyEntries)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 30);
  state.historyEntries = Object.fromEntries(trimmedEntries);
  persistState();
}


async function fetchAiSchedule(localResult) {
  const reflectionContext = buildReflectionContext(state);
  const response = await fetch("/api/generate-schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({
      targetDate: state.targetDate,
      fixedRulesText: state.fixedRulesText,
      todoItems: state.todoItems,
      calendarNote: state.calendarEntries[state.targetDate] || "",
      recentHistory: getRecentHistoryEntries(state.historyEntries, state.targetDate),
      weeklyRecords: getRecentWeeklyRecords(state.dailyRecords, state.targetDate),
      reflection: reflectionContext,
      errands: [],
      futureTasks: sanitizeFutureTasks(parseFutureTasksText(state.futureTasksText)),
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
  if (!chatInput) {
    return;
  }
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
  const reflectionContext = buildReflectionContext(state);
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({
      message,
      model: state.aiModel || "gpt-5-mini",
      previousResponseId: chatState.previousResponseId,
      context: {
        fixedRulesText: state.fixedRulesText,
        todoItems: state.todoItems,
        reflection: reflectionContext,
        targetDate: state.targetDate,
        calendarNote: state.calendarEntries[state.targetDate] || "",
        recentHistory: getRecentHistoryEntries(state.historyEntries, state.targetDate),
        weeklyRecords: getRecentWeeklyRecords(state.dailyRecords, state.targetDate),
        futureTasks: sanitizeFutureTasks(parseFutureTasksText(state.futureTasksText)),
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
  if (!chatMessages) {
    return;
  }
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
  if (!chatStatus) {
    return;
  }
  chatStatus.textContent = message;
  chatStatus.className = "status-text";
  if (mode) {
    chatStatus.classList.add(mode);
  }
}

function setChatLoading(isLoading) {
  if (!sendChatButton) {
    return;
  }
  sendChatButton.disabled = isLoading;
  sendChatButton.textContent = isLoading ? "送信中..." : "相談する";
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
  });
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonthString(dateKey) {
  return dateKey.slice(0, 7);
}

function shiftMonth(monthKey, offset) {
  const [yearText, monthText] = monthKey.split("-");
  const date = new Date(Number(yearText), Number(monthText) - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getTomorrowDateString() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
}

function formatDateLabel(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 (${weekdayLabels[date.getDay()]})`;
}

function formatShortDate(dateKey) {
  if (!dateKey) {
    return "";
  }
  const date = new Date(`${dateKey}T00:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(Math.round(value || 0));
}

function importanceLabel(value) {
  if (value === "high") {
    return "重要度:高";
  }
  if (value === "low") {
    return "重要度:低";
  }
  return "重要度:中";
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
