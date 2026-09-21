/** Exact shortest distances for the classic opening's reachable state graph.
 * Same-size pieces are interchangeable in the key, just as in record.mjs. */
import {
  applyMove,
  createInitialState,
  getLegalMoves,
  isSolved,
} from "./huarongdao-core.js";

export function canonicalPuzzleKey(state) {
  const positions = state.positions ?? state;
  const coord = (id) => positions[id].join(",");
  const group = (ids) => ids.map(coord).sort().join(";");
  return [
    coord("C"),
    coord("H"),
    group(["V1", "V2", "V3", "V4"]),
    group(["S1", "S2", "S3", "S4"]),
  ].join("|");
}

let cachedDistances;

/** Lazily constructed on the first guided Jev turn, then shared. */
export function getDistanceMap() {
  if (cachedDistances) return cachedDistances;
  const opening = createInitialState();
  const initialKey = canonicalPuzzleKey(opening);
  const nodes = new Map([
    [initialKey, { state: opening, neighbors: new Set() }],
  ]);
  const queue = [initialKey];
  for (let head = 0; head < queue.length; head++) {
    const key = queue[head];
    const node = nodes.get(key);
    for (const move of getLegalMoves(node.state)) {
      const nextState = applyMove(node.state, move);
      const nextKey = canonicalPuzzleKey(nextState);
      node.neighbors.add(nextKey);
      if (!nodes.has(nextKey)) {
        nodes.set(nextKey, { state: nextState, neighbors: new Set() });
        queue.push(nextKey);
      }
    }
  }

  const distances = new Map();
  const distanceQueue = [];
  for (const [key, node] of nodes) {
    if (!isSolved(node.state)) continue;
    distances.set(key, 0);
    distanceQueue.push(key);
  }
  for (let head = 0; head < distanceQueue.length; head++) {
    const key = distanceQueue[head];
    for (const neighbor of nodes.get(key).neighbors) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, distances.get(key) + 1);
      distanceQueue.push(neighbor);
    }
  }
  if (distances.size !== nodes.size) {
    throw new Error("存在无法抵达出口的可达局面");
  }
  cachedDistances = distances;
  return distances;
}

/** Every returned move is legal and reduces the exact distance by one. */
export function getShortestPathMoves(state) {
  const distances = getDistanceMap();
  const current = distances.get(canonicalPuzzleKey(state));
  if (current === undefined) throw new Error("棋盘不在经典开局可达状态图中");
  if (current === 0) return [];
  return getLegalMoves(state).filter(
    (move) =>
      distances.get(canonicalPuzzleKey(applyMove(state, move))) === current - 1,
  );
}

export function getShortestDistance(state) {
  const distance = getDistanceMap().get(canonicalPuzzleKey(state));
  if (distance === undefined) throw new Error("棋盘不在经典开局可达状态图中");
  return distance;
}
