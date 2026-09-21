import {
  createInitialState,
  getLegalMoves,
  isSolved,
  PIECES,
  validateSolvedTrace,
} from "./assets/js/huarongdao-core.js";

const $ = (id) => document.getElementById(id);
const DIRECTION_NAMES = { U: "上", D: "下", L: "左", R: "右" };
const board = $("board");
const pieceElements = new Map();

let trace = null;
let replayStates = null;
let currentStep = 0;
let gameState = createInitialState();
let running = false;
let timer = null;

function setStatus(title, detail, badge, tone = "") {
  $("statusTitle").textContent = title;
  $("statusDetail").textContent = detail;
  $("gameBadge").textContent = badge;
  $("gameBadge").dataset.tone = tone;
}

function moveLabel(moveId) {
  const [id, direction] = moveId.split(":");
  return `${PIECES[id].name}向${DIRECTION_NAMES[direction]}`;
}

function weightText(value) {
  if (!Number.isFinite(value)) return "";
  const percent = value <= 1 ? value * 100 : value;
  return `${Math.max(0, Math.min(percent, 100)).toFixed(1)}%`;
}

function makeBoard() {
  for (let i = 0; i < 20; i++) {
    const cell = document.createElement("div");
    cell.className = "board-cell";
    board.appendChild(cell);
  }
  for (const [id, piece] of Object.entries(PIECES)) {
    const element = document.createElement("div");
    element.className = "board-piece";
    element.dataset.id = id;
    element.textContent = piece.name;
    element.style.setProperty("--w", piece.width);
    element.style.setProperty("--h", piece.height);
    board.appendChild(element);
    pieceElements.set(id, element);
  }
}

function renderBoard() {
  const lastMoveId = currentStep ? trace.moves[currentStep - 1].move : null;
  for (const [id, [x, y]] of Object.entries(gameState.positions)) {
    const element = pieceElements.get(id);
    element.style.setProperty("--x", x);
    element.style.setProperty("--y", y);
    element.classList.toggle(
      "is-last",
      lastMoveId?.startsWith(`${id}:`) ?? false,
    );
  }
  $("moveCount").textContent = String(currentStep);
  $("optionCount").textContent = String(getLegalMoves(gameState).length);
  $("lastMove").textContent = lastMoveId ? moveLabel(lastMoveId) : "—";
  $("boardHint").textContent = isSolved(gameState)
    ? "曹操到达出口！"
    : lastMoveId
      ? `第 ${currentStep} 步 · ${moveLabel(lastMoveId)}`
      : "等待回放";
  board.setAttribute(
    "aria-label",
    `华容道棋盘，回放到第 ${currentStep} 步，${isSolved(gameState) ? "曹操已到达出口" : "尚未到达出口"}`,
  );
}

function updateControls() {
  const ready = replayStates !== null;
  const finished = ready && currentStep === trace.moves.length;
  $("startBtn").disabled = !ready || running || finished;
  $("pauseBtn").disabled = !running;
  $("stepBtn").disabled = !ready || running || finished;
  $("restartBtn").disabled = !ready || currentStep === 0;
  $("speed").disabled = !ready;
  $("startBtn").textContent = currentStep ? "▶ 继续播放" : "▶ 播放棋谱";
}

function appendLog(entry) {
  const log = $("moveLog");
  log.querySelector(".empty-log")?.remove();
  const item = document.createElement("li");
  const number = document.createElement("strong");
  number.textContent = String(currentStep).padStart(2, "0");
  const label = document.createElement("span");
  label.textContent = moveLabel(entry.move);
  const source = document.createElement("small");
  source.className = "source-tag";
  source.textContent =
    entry.source === "jev"
      ? "Jev"
      : entry.source === "forced"
        ? "唯一延续"
        : entry.source === "guided"
          ? "求解器"
          : "记录";
  item.append(number, label, source);
  if (Number.isFinite(entry.confidence))
    item.title = `Jev 选择权重 ${weightText(entry.confidence)}`;
  log.prepend(item);
  $("logSummary").textContent =
    `已回放 ${currentStep} / ${trace.moves.length} 步 · 最新一步在前`;
}

function entryDescription(entry) {
  const confidence = weightText(entry.confidence);
  if (entry.source === "forced")
    return `${moveLabel(entry.move)} · 此步是最短解的唯一延续。`;
  if (entry.source === "guided") {
    return `${moveLabel(entry.move)} · Jev 额度耗尽后，由离线求解器从 ${entry.candidateCount} 个最短解候选中选出。`;
  }
  if (entry.source === "jev") {
    return `${moveLabel(entry.move)} · Jev 从 ${entry.candidateCount ?? "多个"} 个最短解候选中选择${confidence ? `，选择权重 ${confidence}` : ""}。`;
  }
  return `${moveLabel(entry.move)} · 棋谱记录的下一步。`;
}

function pause() {
  if (!running) return;
  running = false;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  setStatus(
    "回放已暂停",
    `已看到第 ${currentStep} 步，可继续播放或单步查看。`,
    "已暂停",
  );
  updateControls();
}

function advance() {
  if (!replayStates || currentStep >= trace.moves.length) return;
  const entry = trace.moves[currentStep];
  currentStep++;
  gameState = replayStates[currentStep];
  renderBoard();
  appendLog(entry);
  if (currentStep === trace.moves.length) {
    running = false;
    timer = null;
    setStatus(
      "曹操成功脱困！",
      `完整棋谱共 ${currentStep} 步，已全部回放。`,
      "已通关",
      "live",
    );
  } else {
    setStatus(
      `第 ${currentStep} 步`,
      entryDescription(entry),
      "回放中",
      "live",
    );
  }
  updateControls();
}

function scheduleNext() {
  if (!running) return;
  timer = setTimeout(
    () => {
      timer = null;
      advance();
      scheduleNext();
    },
    Number($("speed").value),
  );
}

function play() {
  if (!replayStates || running || currentStep >= trace.moves.length) return;
  running = true;
  advance();
  scheduleNext();
  updateControls();
}

function restart() {
  pause();
  currentStep = 0;
  gameState = replayStates?.[0] ?? createInitialState();
  $("moveLog").innerHTML = '<li class="empty-log">从第一步开始回放。</li>';
  $("logSummary").textContent = replayStates
    ? `共 ${trace.moves.length} 步 · 等待播放`
    : "棋谱不可用";
  renderBoard();
  if (replayStates)
    setStatus("棋谱已就绪", "点击播放，观看 Jev 的通关记录。", "准备回放");
  updateControls();
}

async function initializeTrace() {
  try {
    const response = await fetch("./trace/jev-solved.json", {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`无法载入棋谱（HTTP ${response.status}）`);
    trace = await response.json();
    replayStates = validateSolvedTrace(trace);
    const jevChoices = trace.moves.filter(
      (entry) => entry.source === "jev",
    ).length;
    const forcedMoves = trace.moves.filter(
      (entry) => entry.source === "forced",
    ).length;
    const guidedMoves = trace.moves.filter(
      (entry) => entry.source === "guided",
    ).length;
    $("traceTitle").textContent = trace.title || "完整通关记录";
    $("traceDescription").textContent =
      trace.metadata?.guidance?.description ||
      "此棋谱逐步校验过走法，全部回放不需连接服务。";
    $("traceCount").textContent = String(trace.moves.length);
    $("jevCount").textContent = String(jevChoices);
    $("forcedCount").textContent = String(forcedMoves);
    $("guidedCount").textContent = String(guidedMoves);
    restart();
  } catch (error) {
    replayStates = null;
    setStatus("棋谱无法播放", error.message, "棋谱错误", "error");
    $("traceDescription").textContent = "棋谱需要从经典开局合法走到出口。";
    $("logSummary").textContent = "棋谱校验失败";
    updateControls();
  }
}

makeBoard();
renderBoard();
updateControls();
void initializeTrace();

$("startBtn").addEventListener("click", play);
$("pauseBtn").addEventListener("click", pause);
$("stepBtn").addEventListener("click", advance);
$("restartBtn").addEventListener("click", restart);
$("speed").addEventListener("change", () => {
  if (!running) return;
  if (timer !== null) clearTimeout(timer);
  scheduleNext();
});
