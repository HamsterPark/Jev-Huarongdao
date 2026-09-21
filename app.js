import {
  applyMove,
  createInitialState,
  getLegalMoves,
  getStateKey,
  isSolved,
  PIECES,
} from "./assets/js/huarongdao-core.js";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "jev-huarongdao-endpoint";
const RECENT_STATE_LIMIT = 12;
const REQUEST_TIMEOUT_MS = 30000;
const DIRECTION_NAMES = { U: "上", D: "下", L: "左", R: "右" };
const board = $("board");
const pieceElements = new Map();

let gameState = createInitialState();
let history = [];
let recentStates = [getStateKey(gameState)];
let stateVisits = new Map([[recentStates[0], 1]]);
let lastMoveId = null;
let running = false;
let requesting = false;
let requestController = null;
let timer = null;
let runId = 0;

function endpointValue() {
  return $("endpoint").value.trim();
}

function resolvedEndpoint() {
  const raw = endpointValue();
  if (!raw) throw new Error("请先填写 Jev 服务地址。");
  let url;
  try {
    url = new URL(raw, location.href);
  } catch {
    throw new Error("服务地址格式无效，请填写完整的网址。");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("服务地址需要使用 HTTP 或 HTTPS。");
  }
  return url.href;
}

function saveEndpoint() {
  try {
    localStorage.setItem(STORAGE_KEY, endpointValue());
  } catch {
    // Private browsing may disable storage; the current input still works.
  }
}

function setStatus(title, detail, badge, tone = "") {
  $("statusTitle").textContent = title;
  $("statusDetail").textContent = detail;
  $("gameBadge").textContent = badge;
  $("gameBadge").dataset.tone = tone;
}

function updateControls() {
  $("startBtn").disabled = running || requesting || isSolved(gameState);
  $("pauseBtn").disabled = !running;
  $("stepBtn").disabled = running || requesting || isSolved(gameState);
  $("restartBtn").disabled = requesting && !requestController;
  $("startBtn").textContent = history.length ? "▶ 继续演示" : "▶ 开始演示";
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
  for (const [id, [x, y]] of Object.entries(gameState.positions)) {
    const element = pieceElements.get(id);
    element.style.setProperty("--x", x);
    element.style.setProperty("--y", y);
    element.classList.toggle(
      "is-last",
      lastMoveId?.startsWith(`${id}:`) ?? false,
    );
  }
  $("moveCount").textContent = String(history.length);
  $("optionCount").textContent = String(getLegalMoves(gameState).length);
  $("lastMove").textContent = lastMoveId ? moveLabel(lastMoveId) : "—";
  $("boardHint").textContent = isSolved(gameState)
    ? "曹操到达出口！"
    : lastMoveId
      ? `第 ${history.length} 步 · ${moveLabel(lastMoveId)}`
      : "Jev 尚未开始";
  board.setAttribute(
    "aria-label",
    `华容道棋盘，已走 ${history.length} 步，${isSolved(gameState) ? "曹操已到达出口" : "游戏进行中"}`,
  );
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

function choiceDetails(result, moveId) {
  const confidence = weightText(result.confidence);
  let detail = `${moveLabel(moveId)}${confidence ? ` · Jev 选择权重 ${confidence}` : ""}`;
  const probabilities = result.probabilities;
  if (
    probabilities &&
    typeof probabilities === "object" &&
    !Array.isArray(probabilities)
  ) {
    const alternatives = Object.entries(probabilities)
      .filter(
        ([id, value]) =>
          id !== moveId && PIECES[id.split(":")[0]] && Number.isFinite(value),
      )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([id, value]) => `${moveLabel(id)} ${weightText(value)}`);
    if (alternatives.length) detail += `；备选：${alternatives.join("、")}`;
  }
  return detail;
}

function appendLog(moveId, confidence) {
  const log = $("moveLog");
  const empty = log.querySelector(".empty-log");
  if (empty) empty.remove();
  const item = document.createElement("li");
  const number = document.createElement("strong");
  number.textContent = String(history.length).padStart(2, "0");
  const label = document.createElement("span");
  label.textContent = moveLabel(moveId);
  item.append(number, label);
  if (Number.isFinite(confidence))
    item.title = `Jev 选择权重 ${weightText(confidence)}`;
  log.prepend(item);
  $("logSummary").textContent = `共 ${history.length} 步 · 最新一步在前`;
}

/** Prefer new positions; when every route revisits, offer the least visited ones. */
function movesAvoidingLoops(moves) {
  const next = moves.map((id) => ({
    id,
    key: getStateKey(applyMove(gameState, id)),
  }));
  const recent = new Set(recentStates.slice(-8));
  const fresh = next.filter(({ key }) => !recent.has(key));
  if (fresh.length) return fresh.map(({ id }) => id);
  const minimum = Math.min(...next.map(({ key }) => stateVisits.get(key) ?? 0));
  return next
    .filter(({ key }) => (stateVisits.get(key) ?? 0) === minimum)
    .map(({ id }) => id);
}

function stopCurrentRequest() {
  runId++;
  running = false;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (requestController) requestController.abort();
  requestController = null;
  requesting = false;
  updateControls();
}

function pause() {
  if (!running && !requesting) return;
  stopCurrentRequest();
  setStatus("演示已暂停", "可以继续播放，也可以让 Jev 只走一步。", "已暂停");
}

async function takeOneMove(autoplay) {
  if (requesting || isSolved(gameState)) return;
  let endpoint;
  try {
    endpoint = resolvedEndpoint();
  } catch (error) {
    running = false;
    setStatus("尚未连接 Jev", error.message, "等待连接", "error");
    updateControls();
    return;
  }
  saveEndpoint();

  const legalMoves = getLegalMoves(gameState);
  const offeredMoves = movesAvoidingLoops(legalMoves);
  if (!offeredMoves.length) {
    running = false;
    setStatus("无可走的棋", "当前局面无法继续。可以重新开局。", "演示结束");
    updateControls();
    return;
  }

  requesting = true;
  const thisRun = runId;
  const controller = new AbortController();
  requestController = controller;
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  setStatus(
    "Jev 正在选择",
    `正在考虑 ${offeredMoves.length} 个可行走法……`,
    "思考中",
    "live",
  );
  updateControls();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        game: "huarongdao",
        state: { positions: gameState.positions, legalMoves: offeredMoves },
        history: history.slice(-16),
      }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        result?.error || result?.message || `服务返回 HTTP ${response.status}`,
      );
    }
    if (thisRun !== runId) return;
    if (
      !result ||
      typeof result.move !== "string" ||
      !offeredMoves.includes(result.move)
    ) {
      throw new Error("服务返回了无效走法，请检查 Jev 服务配置。");
    }

    gameState = applyMove(gameState, result.move);
    lastMoveId = result.move;
    history.push(result.move);
    const key = getStateKey(gameState);
    recentStates.push(key);
    if (recentStates.length > RECENT_STATE_LIMIT) recentStates.shift();
    stateVisits.set(key, (stateVisits.get(key) ?? 0) + 1);
    renderBoard();
    appendLog(result.move, result.confidence);

    if (isSolved(gameState)) {
      running = false;
      setStatus(
        "曹操成功脱困！",
        `Jev 用 ${history.length} 步走到了出口。`,
        "已通关",
        "live",
      );
    } else {
      setStatus(
        "Jev 已走一步",
        choiceDetails(result, result.move),
        "演示中",
        "live",
      );
      if (autoplay && running) {
        timer = setTimeout(
          () => {
            timer = null;
            void takeOneMove(true);
          },
          Number($("speed").value),
        );
      }
    }
  } catch (error) {
    if (thisRun !== runId) return;
    running = false;
    const detail =
      error.name === "AbortError"
        ? "等待 Jev 超时，请稍后重试或检查服务地址。"
        : `无法取得 Jev 的下一步：${error.message}`;
    setStatus("Jev 服务不可用", detail, "连接失败", "error");
  } finally {
    clearTimeout(timeout);
    if (requestController === controller) {
      requestController = null;
      requesting = false;
      updateControls();
    }
  }
}

function start() {
  if (running || requesting || isSolved(gameState)) return;
  running = true;
  updateControls();
  void takeOneMove(true);
}

function restart() {
  stopCurrentRequest();
  gameState = createInitialState();
  history = [];
  lastMoveId = null;
  recentStates = [getStateKey(gameState)];
  stateVisits = new Map([[recentStates[0], 1]]);
  $("moveLog").innerHTML =
    '<li class="empty-log">开局已就绪，等待 Jev 落子。</li>';
  $("logSummary").textContent = "等待第一步";
  renderBoard();
  setStatus(
    endpointValue() ? "新棋局已就绪" : "等待 Jev 连接",
    endpointValue()
      ? "点击开始，让 Jev 从经典开局走起。"
      : "填写 Jev 服务地址，然后开始演示。",
    endpointValue() ? "准备就绪" : "等待连接",
  );
  updateControls();
}

function initEndpoint() {
  const fromQuery = new URLSearchParams(location.search).get("api");
  let stored = "";
  try {
    stored = localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    // The page still works without local storage.
  }
  const configured =
    document.querySelector('meta[name="jev-api-endpoint"]')?.content ?? "";
  $("endpoint").value = fromQuery || stored || configured;
}

makeBoard();
initEndpoint();
renderBoard();
restart();

$("startBtn").addEventListener("click", start);
$("pauseBtn").addEventListener("click", pause);
$("stepBtn").addEventListener("click", () => {
  void takeOneMove(false);
});
$("restartBtn").addEventListener("click", restart);
$("saveEndpointBtn").addEventListener("click", () => {
  stopCurrentRequest();
  try {
    resolvedEndpoint();
    saveEndpoint();
    setStatus("Jev 服务已设置", "现在可以开始演示。", "准备就绪");
  } catch (error) {
    setStatus("服务地址无效", error.message, "等待连接", "error");
  }
  updateControls();
});
$("endpoint").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("saveEndpointBtn").click();
});
