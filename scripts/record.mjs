/**
 * Record a complete, guided Jev run locally.
 *
 * Usage:
 *   JEV_API_KEY=... node scripts/record.mjs
 *   node scripts/record.mjs --verify
 *
 * The API key is read only from the environment and is never written to the trace.
 */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  applyMove,
  createInitialState,
  getLegalMoves,
  isSolved,
  PIECES,
  TRACE_FORMAT,
  validateSolvedTrace,
} from "../assets/js/huarongdao-core.js";

const API_URL = "https://www.jevai.org/api/v1/decisions";
const MODEL = "typesafe/jev-1.13";
const DIRECTION_NAMES = { U: "上", D: "下", L: "左", R: "右" };
const outputArgIndex = process.argv.indexOf("--output");
const outputPath = resolve(
  outputArgIndex >= 0
    ? process.argv[outputArgIndex + 1]
    : "trace/jev-solved.json",
);
const checkpointPath = resolve("trace/.record-checkpoint.json");
const verifyOnly = process.argv.includes("--verify");
const finishGuided = process.argv.includes("--finish-guided");

if (outputArgIndex >= 0 && !process.argv[outputArgIndex + 1]) {
  throw new Error("--output needs a file path");
}

/** Ignore identity of same-size pieces when measuring puzzle distance. */
function canonicalKey(state) {
  const positions = state.positions;
  const coord = (id) => positions[id].join(",");
  const group = (ids) => ids.map(coord).sort().join(";");
  return [
    coord("C"),
    coord("H"),
    group(["V1", "V2", "V3", "V4"]),
    group(["S1", "S2", "S3", "S4"]),
  ].join("|");
}

/** Enumerate the reachable graph, then measure each state's exact goal distance. */
function buildDistances() {
  const initial = createInitialState();
  const initialKey = canonicalKey(initial);
  const nodes = new Map([
    [initialKey, { state: initial, neighbors: new Set() }],
  ]);
  const queue = [initialKey];
  for (let head = 0; head < queue.length; head++) {
    const key = queue[head];
    const node = nodes.get(key);
    for (const move of getLegalMoves(node.state)) {
      const nextState = applyMove(node.state, move);
      const nextKey = canonicalKey(nextState);
      node.neighbors.add(nextKey);
      if (!nodes.has(nextKey)) {
        nodes.set(nextKey, { state: nextState, neighbors: new Set() });
        queue.push(nextKey);
      }
    }
  }

  const distances = new Map();
  const distanceQueue = [];
  let goalCount = 0;
  for (const [key, node] of nodes) {
    if (isSolved(node.state)) {
      distances.set(key, 0);
      distanceQueue.push(key);
      goalCount++;
    }
  }
  for (let head = 0; head < distanceQueue.length; head++) {
    const key = distanceQueue[head];
    const distance = distances.get(key);
    for (const neighbor of nodes.get(key).neighbors) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, distance + 1);
      distanceQueue.push(neighbor);
    }
  }
  if (distances.size !== nodes.size)
    throw new Error("Some reachable positions have no path to goal");
  return {
    distances,
    initialDistance: distances.get(initialKey),
    reachableStates: nodes.size,
    goalStates: goalCount,
  };
}

function advancingMoves(state, distances, currentDistance) {
  return getLegalMoves(state).filter((move) => {
    const nextKey = canonicalKey(applyMove(state, move));
    return distances.get(nextKey) === currentDistance - 1;
  });
}

function moveDescription(id) {
  const [piece, direction] = id.split(":");
  return `${PIECES[piece].name}向${DIRECTION_NAMES[direction]}移动一格`;
}

async function askJevOnce(
  state,
  candidates,
  history,
  remainingDistance,
  apiKey,
) {
  const criteria = Object.fromEntries(
    candidates.map((id) => [id, moveDescription(id)]),
  );
  const body = {
    model: MODEL,
    state: {
      game: "华容道，4 列 5 行滑块谜题",
      goal: "让 2×2 的 C（曹操）移动到出口：左上角坐标 (1,3)，棋盘底边中间。每步只能移动一个滑块一格。候选已由离线最短距离计算筛选；请在其中选择。",
      positions: state.positions,
      recent_moves: history.slice(-24),
      remaining_shortest_moves: remainingDistance,
    },
    questions: {
      move: {
        type: "choice",
        instructions:
          "从候选动作中选择最希望走的一步。候选都能使到出口的最短剩余步数减少 1。只选择给出的动作。",
        criteria,
      },
    },
  };
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.code !== 0) {
    const message =
      result?.message || `Jev API returned HTTP ${response.status}`;
    const error = new Error(message);
    error.retryable =
      [408, 429].includes(response.status) ||
      response.status >= 500 ||
      [408, 429, 500, 502, 503, 504].includes(result?.code) ||
      /timeout|temporar|busy|rate.limit|超时|繁忙|稍后/i.test(message);
    throw error;
  }
  const answer = result.data?.answers?.move;
  if (!answer || !candidates.includes(answer.choice)) {
    const error = new Error(
      "Jev returned a move outside the offered candidates",
    );
    error.retryable = false;
    throw error;
  }
  const probabilities = Object.fromEntries(
    Object.entries(answer.probabilities ?? {}).filter(
      ([id, value]) => candidates.includes(id) && Number.isFinite(value),
    ),
  );
  return {
    move: answer.choice,
    confidence: Number.isFinite(answer.confidence)
      ? answer.confidence
      : undefined,
    probabilities: Object.keys(probabilities).length
      ? probabilities
      : undefined,
  };
}

async function askJev(state, candidates, history, remainingDistance, apiKey) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await askJevOnce(
        state,
        candidates,
        history,
        remainingDistance,
        apiKey,
      );
    } catch (error) {
      if (error.retryable === false || attempt === 3) throw error;
      const waitMs = 1500 * 2 ** attempt;
      process.stderr.write(
        `Jev request failed (${error.message}); retrying in ${waitMs} ms.\n`,
      );
      await new Promise((resolveDelay) => setTimeout(resolveDelay, waitMs));
    }
  }
  throw new Error("Jev request exhausted retries");
}

async function loadCheckpoint(distances, initialDistance) {
  let checkpoint;
  try {
    checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Cannot read checkpoint: ${error.message}`);
  }
  if (
    checkpoint.format !== "jev-huarongdao-checkpoint-v1" ||
    checkpoint.initialDistance !== initialDistance ||
    !Array.isArray(checkpoint.moves)
  ) {
    throw new Error("Checkpoint format or puzzle distance does not match");
  }
  let state = createInitialState();
  for (const [index, entry] of checkpoint.moves.entries()) {
    if (isSolved(state))
      throw new Error(`Checkpoint continues after goal at step ${index + 1}`);
    const distance = distances.get(canonicalKey(state));
    const candidates = advancingMoves(state, distances, distance);
    if (!entry || !candidates.includes(entry.move)) {
      throw new Error(`Checkpoint has an invalid move at step ${index + 1}`);
    }
    if (entry.source !== (candidates.length === 1 ? "forced" : "jev")) {
      throw new Error(`Checkpoint has an invalid source at step ${index + 1}`);
    }
    state = applyMove(state, entry.move);
  }
  return { ...checkpoint, state };
}

async function saveCheckpoint(startedAt, initialDistance, moves) {
  await mkdir(dirname(checkpointPath), { recursive: true });
  const checkpoint = {
    format: "jev-huarongdao-checkpoint-v1",
    startedAt,
    initialDistance,
    moves,
  };
  await writeFile(
    checkpointPath,
    `${JSON.stringify(checkpoint, null, 2)}\n`,
    "utf8",
  );
}

async function main() {
  const { distances, initialDistance, reachableStates, goalStates } =
    buildDistances();
  process.stdout.write(
    `Reachable states: ${reachableStates}; goal states: ${goalStates}; shortest solution: ${initialDistance} moves.\n`,
  );
  if (verifyOnly) return;
  const apiKey = process.env.JEV_API_KEY;
  if (!finishGuided && !apiKey)
    throw new Error("Set JEV_API_KEY in the environment before recording");

  const checkpoint = await loadCheckpoint(distances, initialDistance);
  if (finishGuided && !checkpoint) {
    throw new Error("--finish-guided requires an existing Jev checkpoint");
  }
  const checkpointSteps = checkpoint?.moves.length ?? 0;
  let state = checkpoint?.state ?? createInitialState();
  const moves = checkpoint?.moves ?? [];
  const startedAt = checkpoint?.startedAt ?? new Date().toISOString();
  let jevChoices = moves.filter((entry) => entry.source === "jev").length;
  let forcedMoves = moves.filter((entry) => entry.source === "forced").length;
  let guidedMoves = 0;
  if (checkpoint)
    process.stdout.write(`Resuming from checkpoint at step ${moves.length}.\n`);
  while (!isSolved(state)) {
    const distance = distances.get(canonicalKey(state));
    const candidates = advancingMoves(state, distances, distance);
    if (!candidates.length)
      throw new Error(`No distance-reducing move at step ${moves.length + 1}`);
    let entry;
    if (candidates.length === 1) {
      entry = {
        move: candidates[0],
        source: "forced",
        candidateCount: 1,
        candidates,
      };
      forcedMoves++;
    } else if (finishGuided) {
      entry = {
        move: candidates[0],
        source: "guided",
        candidateCount: candidates.length,
        candidates,
      };
      guidedMoves++;
    } else {
      const answer = await askJev(
        state,
        candidates,
        moves.map((item) => item.move),
        distance,
        apiKey,
      );
      entry = {
        ...answer,
        source: "jev",
        candidateCount: candidates.length,
        candidates,
      };
      jevChoices++;
    }
    moves.push(entry);
    state = applyMove(state, entry.move);
    if (!finishGuided) await saveCheckpoint(startedAt, initialDistance, moves);
    process.stdout.write(
      `${String(moves.length).padStart(3)} / ${initialDistance}  ${entry.move.padEnd(6)}  ${entry.source}  choices=${candidates.length}\n`,
    );
  }

  const trace = {
    format: TRACE_FORMAT,
    title: finishGuided
      ? "Jev 选择与路径引导的华容道通关"
      : "Jev 的华容道通关记录",
    metadata: {
      generatedAt: new Date().toISOString(),
      startedAt,
      model: MODEL,
      guidance: {
        kind: "exact-shortest-distance",
        description: finishGuided
          ? `前 ${checkpointSteps} 步录制时，离线求解器只向 Jev 提供最短距离递减的候选；其中 ${jevChoices} 步由 Jev 在多个候选中选择。Jev API 当日额度用尽后，剩余 ${initialDistance - checkpointSteps} 步按最短路径引导完成。`
          : "离线求解器只提供能使最短剩余步数减少 1 的走法；有多个候选时由 Jev 选择，只有一个候选时按最短路径引导继续。",
        initialDistance,
        reachableStates,
        goalStates,
      },
      jevChoices,
      forcedMoves,
      guidedMoves,
      ...(finishGuided
        ? {
            fallback: {
              reason: "Jev API daily request limit reached",
              afterStep: checkpointSteps,
              method: "first exact-distance-decreasing move",
            },
          }
        : {}),
    },
    moves,
  };
  validateSolvedTrace(trace);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
  if (!finishGuided) {
    await unlink(checkpointPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  process.stdout.write(
    `Saved ${moves.length} verified moves to ${outputPath}\n`,
  );
}

await main();
