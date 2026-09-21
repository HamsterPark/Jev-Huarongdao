import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyMove,
  createInitialState,
  getLegalMoves,
  getStateKey,
  isSolved,
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
