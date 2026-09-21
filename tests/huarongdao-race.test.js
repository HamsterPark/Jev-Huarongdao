import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyMove,
  createInitialState,
  getLegalMoves,
  isSolved,
} from "../assets/js/huarongdao-core.js";
import {
  getShortestDistance,
  getShortestPathMoves,
} from "../assets/js/huarongdao-distances.js";
import {
  createJevDecisionRequest,
  createRaceState,
  JEV_API_URL,
  playRaceMove,
  requestJevMove,
  validateRaceState,
} from "../assets/js/huarongdao-race.js";

test("both boards start identical but independent; exactly one legal slide per turn", () => {
  const initial = createRaceState();
  assert.deepEqual(initial.boards.jev, initial.boards.player);
  assert.notStrictEqual(initial.boards.jev, initial.boards.player);
  assert.equal(initial.turn, "player");
  assert.throws(() => playRaceMove(initial, "jev", "S1:D"), /轮到 player/);
  assert.throws(() => playRaceMove(initial, "player", "C:D"), /非法走法/);
  const afterPlayer = playRaceMove(initial, "player", "S1:D");
  assert.equal(afterPlayer.turn, "jev");
  assert.deepEqual(afterPlayer.boards.jev, initial.boards.jev);
  assert.deepEqual(afterPlayer.boards.player.positions.S1, [1, 4]);
  assert.deepEqual(initial.boards.player.positions.S1, [1, 3]);
  const afterJev = playRaceMove(afterPlayer, "jev", "S2:D");
  assert.equal(afterJev.turn, "player");
  assert.deepEqual(afterJev.moves, {
    jev: ["S2:D"],
    player: ["S1:D"],
  });
  assert.deepEqual(afterPlayer.moves.jev, []);
});

test("first arrival at the exit ends the race without an extra turn", () => {
  const trace = JSON.parse(
    readFileSync(new URL("../trace/jev-solved.json", import.meta.url)),
  );
  let nearGoal = createInitialState();
  for (const entry of trace.moves.slice(0, -1)) {
    nearGoal = applyMove(nearGoal, entry.move);
  }
  assert.equal(isSolved(nearGoal), false);
  const lastMove = trace.moves.at(-1).move;
  assert.ok(getLegalMoves(nearGoal).includes(lastMove));
  const race = createRaceState(nearGoal);
  const finished = playRaceMove(race, "player", lastMove);
  assert.equal(finished.winner, "player");
  assert.equal(finished.turn, null);
  assert.throws(() => playRaceMove(finished, "jev", lastMove), /比赛已经结束/);
});

test("guided Jev candidates strictly reduce exact goal distance", () => {
  const opening = createInitialState();
  assert.equal(getShortestDistance(opening), 116);
  const moves = getShortestPathMoves(opening);
  assert.ok(moves.length > 0);
  for (const move of moves) {
    assert.ok(getLegalMoves(opening).includes(move));
    assert.equal(getShortestDistance(applyMove(opening, move)), 115);
  }
});

test("Jev request contains only guided candidates and uses the key as bearer", async () => {
  const race = playRaceMove(createRaceState(), "player", "S1:D");
  const request = createJevDecisionRequest(race);
  const candidates = Object.keys(request.questions.move.criteria);
  assert.deepEqual(candidates, getShortestPathMoves(race.boards.jev));
  assert.equal(request.state.remaining_shortest_moves, 116);
  let calls = 0;
  const choice = await requestJevMove(race, " test-key ", {
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, JEV_API_URL);
      assert.equal(init.headers.Authorization, "Bearer test-key");
      assert.deepEqual(JSON.parse(init.body), request);
      return {
        ok: true,
        json: async () => ({
          code: 0,
          data: { answers: { move: { choice: candidates[0] } } },
        }),
      };
    },
  });
  assert.equal(choice, candidates[0]);
  assert.equal(calls, 1);
  assert.throws(() => createJevDecisionRequest(createRaceState()), /不是 Jev/);
});

test("Jev API errors and out-of-candidate replies fail closed", async () => {
  const race = playRaceMove(createRaceState(), "player", "S1:D");
  await assert.rejects(
    requestJevMove(race, "key", {
      fetch: async () => ({
        ok: true,
        json: async () => ({
          code: 0,
          data: { answers: { move: { choice: "C:D" } } },
        }),
      }),
    }),
    /不在合法走法/,
  );
  await assert.rejects(
    requestJevMove(race, "key", {
      fetch: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ message: "rate limited" }),
      }),
    }),
    /rate limited/,
  );
  assert.equal(race.turn, "jev");
  assert.deepEqual(race.moves.jev, []);
});

test("IPC race validation replays moves and rejects forged boards or turns", () => {
  const race = playRaceMove(createRaceState(), "player", "S1:D");
  assert.deepEqual(validateRaceState(race), race);
  assert.throws(
    () => validateRaceState({ ...race, turn: "player" }),
    /不一致/,
  );
  assert.throws(
    () =>
      validateRaceState({
        ...race,
        boards: { ...race.boards, jev: race.boards.player },
      }),
    /不一致/,
  );
  assert.throws(
    () => validateRaceState({ ...race, moves: { jev: ["S2:D"], player: [] } }),
    /严格交替/,
  );
});
