import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyMove,
  createInitialState,
  getLegalMoves,
  getStateKey,
  isSolved,
  TRACE_FORMAT,
  validateSolvedTrace,
  validatePositions,
} from "../assets/js/huarongdao-core.js";

test("classic opening has exactly two empty cells and four possible slides", () => {
  const opening = createInitialState();
  const board = validatePositions(opening);
  assert.equal(board.flat().filter((id) => id === null).length, 2);
  assert.deepEqual(getLegalMoves(opening.positions), [
    "S1:D",
    "S2:D",
    "S3:R",
    "S4:L",
  ]);
  assert.equal(isSolved(opening), false);
});

test("a slide moves one cell, never mutates the source, and opens new moves", () => {
  const opening = createInitialState();
  const first = applyMove(opening, "S1:D");
  const second = applyMove(first, "S2:D");
  assert.deepEqual(opening.positions.S1, [1, 3]);
  assert.deepEqual(first.positions.S1, [1, 4]);
  assert.deepEqual(second.positions.S2, [2, 4]);
  assert.ok(getLegalMoves(second).includes("H:D"));
  assert.throws(() => applyMove(opening, "C:D"), /非法走法/);
  assert.throws(() => applyMove(opening, "S1:DD"), /非法走法/);
});

test("the goal is Cao Cao at the bottom-center exit", () => {
  const solved = {
    positions: {
      C: [1, 3],
      V1: [0, 0],
      V2: [3, 0],
      V3: [0, 2],
      V4: [3, 2],
      H: [1, 0],
      S1: [1, 1],
      S2: [2, 1],
      S3: [1, 2],
      S4: [2, 2],
    },
  };
  assert.equal(isSolved(solved), true);
  assert.equal(
    isSolved({
      positions: { ...solved.positions, C: [1, 2], S3: [1, 4], S4: [2, 4] },
    }),
    false,
  );
});

test("invalid boards are rejected and keys are canonical", () => {
  const opening = createInitialState();
  assert.throws(
    () => validatePositions({ ...opening.positions, S1: [2, 3] }),
    /重叠/,
  );
  assert.throws(
    () => validatePositions({ ...opening.positions, C: [3, 0] }),
    /越过棋盘/,
  );
  const reversed = Object.fromEntries(
    Object.entries(opening.positions).reverse(),
  );
  assert.equal(getStateKey(opening), getStateKey(reversed));
});

test("a replay rejects empty, illegal, and unfinished traces", () => {
  assert.throws(
    () => validateSolvedTrace({ format: TRACE_FORMAT, moves: [] }),
    /没有走法/,
  );
  assert.throws(
    () =>
      validateSolvedTrace({ format: TRACE_FORMAT, moves: [{ move: "C:D" }] }),
    /第 1 步非法/,
  );
  assert.throws(
    () =>
      validateSolvedTrace({ format: TRACE_FORMAT, moves: [{ move: "S1:D" }] }),
    /未到达出口/,
  );
});

test("the published trace is complete and its step sources match the metadata", () => {
  const trace = JSON.parse(
    readFileSync(new URL("../trace/jev-solved.json", import.meta.url), "utf8"),
  );
  const states = validateSolvedTrace(trace);
  assert.equal(states.length, trace.moves.length + 1);
  assert.equal(isSolved(states.at(-1)), true);
  for (const entry of trace.moves) {
    assert.ok(entry.candidates.includes(entry.move));
    if (entry.source === "forced") assert.equal(entry.candidateCount, 1);
    else assert.ok(entry.candidateCount > 1);
  }
  assert.equal(
    trace.metadata.jevChoices,
    trace.moves.filter((entry) => entry.source === "jev").length,
  );
  assert.equal(
    trace.metadata.forcedMoves,
    trace.moves.filter((entry) => entry.source === "forced").length,
  );
  assert.equal(
    trace.metadata.guidedMoves,
    trace.moves.filter((entry) => entry.source === "guided").length,
  );
  assert.ok(
    trace.moves
      .slice(trace.metadata.fallback.afterStep)
      .every((entry) => entry.source !== "jev"),
  );
});
