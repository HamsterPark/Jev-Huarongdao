/** Two independent boards, one one-cell slide per turn. No network is needed
 * for the rules; the Jev decision function is kept separate for the host app. */
import {
  applyMove,
  createInitialState,
  getLegalMoves,
  getStateKey,
  isSolved,
  PIECES,
  validatePositions,
} from "./huarongdao-core.js";
import {
  getShortestDistance,
  getShortestPathMoves,
} from "./huarongdao-distances.js";

export const JEV_API_URL = "https://www.jevai.org/api/v1/decisions";
export const JEV_MODEL = "typesafe/jev-1.13";
const DIRECTION_NAMES = { U: "上", D: "下", L: "左", R: "右" };

function copyBoard(board) {
  validatePositions(board);
  return {
    positions: Object.fromEntries(
      Object.entries(board.positions ?? board).map(([id, point]) => [
        id,
        [...point],
      ]),
    ),
  };
}

/** Player moves first. Both boards begin with the same independent position. */
export function createRaceState(initial = createInitialState()) {
  if (isSolved(initial)) throw new Error("不能从已通关的棋盘开始比赛");
  return {
    boards: { jev: copyBoard(initial), player: copyBoard(initial) },
    turn: "player",
    winner: null,
    moves: { jev: [], player: [] },
  };
}

/** Immutable transition. A solved board wins immediately, with no extra turn. */
export function playRaceMove(race, side, moveId) {
  if (race.winner) throw new Error("比赛已经结束");
  if (side !== race.turn) throw new Error(`当前轮到 ${race.turn}`);
  if (!getLegalMoves(race.boards[side]).includes(moveId)) {
    throw new Error(`非法走法：${moveId}`);
  }
  const nextBoard = applyMove(race.boards[side], moveId);
  const winner = isSolved(nextBoard) ? side : null;
  return {
    boards: { ...race.boards, [side]: nextBoard },
    turn: winner ? null : side === "player" ? "jev" : "player",
    winner,
    moves: { ...race.moves, [side]: [...race.moves[side], moveId] },
  };
}

/** Defensive validator for a state received across an IPC boundary. Prefer
 * retaining the canonical race in the host process and accepting only moves. */
export function validateRaceState(race, initial = createInitialState()) {
  if (
    !race ||
    !Array.isArray(race.moves?.player) ||
    !Array.isArray(race.moves?.jev) ||
    race.moves.player.length + race.moves.jev.length > 20000
  ) {
    throw new Error("比赛记录格式无效或过长");
  }
  let replayed = createRaceState(initial);
  let playerIndex = 0;
  let jevIndex = 0;
  while (
    playerIndex < race.moves.player.length ||
    jevIndex < race.moves.jev.length
  ) {
    const side = replayed.turn;
    if (!side) throw new Error("通关后仍有多余走法");
    const index = side === "player" ? playerIndex++ : jevIndex++;
    const move = race.moves[side][index];
    if (typeof move !== "string") throw new Error("双方走法没有严格交替");
    replayed = playRaceMove(replayed, side, move);
  }
  if (
    replayed.turn !== race.turn ||
    replayed.winner !== race.winner ||
    getStateKey(replayed.boards.jev) !== getStateKey(race.boards?.jev) ||
    getStateKey(replayed.boards.player) !== getStateKey(race.boards?.player)
  ) {
    throw new Error("比赛状态与走法记录不一致");
  }
  return replayed;
}

export function createJevDecisionRequest(race) {
  if (race.winner || race.turn !== "jev") {
    throw new Error("当前不是 Jev 的回合");
  }
  const board = race.boards.jev;
  const legalMoves = getShortestPathMoves(board);
  const criteria = Object.fromEntries(
    legalMoves.map((move) => {
      const [id, direction] = move.split(":");
      return [move, `${PIECES[id].name}向${DIRECTION_NAMES[direction]}移动一格`];
    }),
  );
  return {
    model: JEV_MODEL,
    state: {
      game: "华容道 4×5 双棋盘竞速；你控制左侧棋盘，玩家控制右侧棋盘。",
      goal: "尽快让曹操（C，2×2）移动到左上角坐标 (1,3)，即底部中间出口。每回合只能移动一个滑块一格。",
      positions: board.positions,
      your_previous_moves: race.moves.jev.slice(-24),
      player_move_count: race.moves.player.length,
      your_move_count: race.moves.jev.length,
      remaining_shortest_moves: getShortestDistance(board),
      guidance: "候选动作由离线最短距离表筛选，每一步都减少一格最短剩余距离。",
    },
    questions: {
      move: {
        type: "choice",
        instructions: "只从候选动作中选一步。候选都是合法的一格滑动，且令最短剩余步数减少 1。",
        criteria,
      },
    },
  };
}

/** Call from the Electron main process using a key held in memory. The key is
 * not persisted. Fail closed on API errors; never substitute a local move. */
export async function requestJevMove(race, apiKey, options = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("请输入 Jev API key");
  }
  const body = createJevDecisionRequest(race);
  const response = await (options.fetch ?? globalThis.fetch)(
    JEV_API_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: options.signal ?? AbortSignal.timeout(90000),
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.code !== 0) {
    throw new Error(result?.message || `Jev API HTTP ${response.status}`);
  }
  const choice = result.data?.answers?.move?.choice;
  if (!Object.hasOwn(body.questions.move.criteria, choice)) {
    throw new Error("Jev 返回了不在合法走法中的选项");
  }
  return choice;
}
