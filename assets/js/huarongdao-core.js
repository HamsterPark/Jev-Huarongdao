/** Classic 4 × 5 Huarong Dao rules. Coordinates are each piece's top-left cell. */
export const BOARD_WIDTH = 4;
export const BOARD_HEIGHT = 5;

export const PIECES = Object.freeze({
  C: Object.freeze({ width: 2, height: 2, name: "曹操" }),
  V1: Object.freeze({ width: 1, height: 2, name: "张飞" }),
  V2: Object.freeze({ width: 1, height: 2, name: "赵云" }),
  V3: Object.freeze({ width: 1, height: 2, name: "马超" }),
  V4: Object.freeze({ width: 1, height: 2, name: "黄忠" }),
  H: Object.freeze({ width: 2, height: 1, name: "关羽" }),
  S1: Object.freeze({ width: 1, height: 1, name: "兵一" }),
  S2: Object.freeze({ width: 1, height: 1, name: "兵二" }),
  S3: Object.freeze({ width: 1, height: 1, name: "兵三" }),
  S4: Object.freeze({ width: 1, height: 1, name: "兵四" }),
});

const PIECE_IDS = Object.keys(PIECES);
const DIRECTIONS = Object.freeze({
  U: [0, -1],
  D: [0, 1],
  L: [-1, 0],
  R: [1, 0],
});

function positionsOf(stateOrPositions) {
  return stateOrPositions?.positions ?? stateOrPositions;
}

/** Reject incomplete, overlapping or out-of-bounds positions before use. */
export function validatePositions(stateOrPositions) {
  const positions = positionsOf(stateOrPositions);
  if (!positions || typeof positions !== "object" || Array.isArray(positions)) {
    throw new Error("棋盘状态无效");
  }
  if (Object.keys(positions).length !== PIECE_IDS.length) {
    throw new Error("棋子数量无效");
  }

  const board = Array.from({ length: BOARD_HEIGHT }, () =>
    Array(BOARD_WIDTH).fill(null),
  );
  for (const id of PIECE_IDS) {
    const point = positions[id];
    const piece = PIECES[id];
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !Number.isInteger(point[0]) ||
      !Number.isInteger(point[1])
    ) {
      throw new Error(`棋子 ${id} 的坐标无效`);
    }
    const [x, y] = point;
    if (
      x < 0 ||
      y < 0 ||
      x + piece.width > BOARD_WIDTH ||
      y + piece.height > BOARD_HEIGHT
    ) {
      throw new Error(`棋子 ${id} 越过棋盘`);
    }
    for (let cy = y; cy < y + piece.height; cy++) {
      for (let cx = x; cx < x + piece.width; cx++) {
        if (board[cy][cx])
          throw new Error(`棋子 ${id} 与 ${board[cy][cx]} 重叠`);
        board[cy][cx] = id;
      }
    }
  }
  return board;
}

/** The traditional 横刀立马 opening. */
export function createInitialState() {
  return {
    positions: {
      C: [1, 0],
      V1: [0, 0],
      V2: [3, 0],
      V3: [0, 2],
      V4: [3, 2],
      H: [1, 2],
      S1: [1, 3],
      S2: [2, 3],
      S3: [0, 4],
      S4: [3, 4],
    },
  };
}

/** Return all legal one-cell slides as stable IDs such as `C:D`. */
export function getLegalMoves(stateOrPositions) {
  const positions = positionsOf(stateOrPositions);
  const board = validatePositions(positions);
  const moves = [];
  for (const id of PIECE_IDS) {
    const [x, y] = positions[id];
    const piece = PIECES[id];
    for (const [direction, [dx, dy]] of Object.entries(DIRECTIONS)) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (
        nextX < 0 ||
        nextY < 0 ||
        nextX + piece.width > BOARD_WIDTH ||
        nextY + piece.height > BOARD_HEIGHT
      ) {
        continue;
      }
      let clear = true;
      for (let cy = nextY; cy < nextY + piece.height && clear; cy++) {
        for (let cx = nextX; cx < nextX + piece.width; cx++) {
          if (board[cy][cx] && board[cy][cx] !== id) {
            clear = false;
            break;
          }
        }
      }
      if (clear) moves.push(`${id}:${direction}`);
    }
  }
  return moves;
}

/** Apply a legal slide without mutating the source state. */
export function applyMove(stateOrPositions, moveId) {
  if (!getLegalMoves(stateOrPositions).includes(moveId)) {
    throw new Error(`非法走法：${moveId}`);
  }
  const positions = positionsOf(stateOrPositions);
  const [id, direction] = moveId.split(":");
  const [dx, dy] = DIRECTIONS[direction];
  return {
    positions: {
      ...positions,
      [id]: [positions[id][0] + dx, positions[id][1] + dy],
    },
  };
}

export function isSolved(stateOrPositions) {
  validatePositions(stateOrPositions);
  const [x, y] = positionsOf(stateOrPositions).C;
  return x === 1 && y === 3;
}

/** Canonical state key independent of object property insertion order. */
export function getStateKey(stateOrPositions) {
  validatePositions(stateOrPositions);
  const positions = positionsOf(stateOrPositions);
  return PIECE_IDS.map((id) => `${id}:${positions[id].join(",")}`).join("|");
}
