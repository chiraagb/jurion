import { test } from "node:test";
import assert from "node:assert/strict";
import { hubs, reach, sharedCompanies } from "./logic.ts";

const r = (from_position: number, to_position: number) => ({ from_position, to_position });
const refs = [r(1, 2), r(2, 3), r(3, 4), r(4, 2), r(5, 2)]; // 2 -> 3 -> 4 -> 2 is a cycle; 1 and 5 point at 2

test("reach follows links, splits direct from indirect, survives cycles", () => {
  assert.deepEqual(reach(refs, 1, "out"), { direct: [2], indirect: [3, 4] });
  assert.deepEqual(reach(refs, 2, "in"), { direct: [1, 4, 5], indirect: [3] }); // 3 depends on 2 only through 4
  assert.deepEqual(reach(refs, 2, "out"), { direct: [3], indirect: [4] }); // never lists the clause itself
  assert.deepEqual(reach(refs, 9, "out"), { direct: [], indirect: [] });
});

test("hubs ranks by links, ties by position", () => {
  assert.deepEqual(hubs(refs, 2).map((h) => h.pos), [2, 3]);
  assert.deepEqual(hubs(refs, 1)[0], { pos: 2, in: 3, out: 1 });
  assert.deepEqual(hubs([]), []);
});

test("sharedCompanies finds companies in 2+ contracts", () => {
  const links = [{ party: "a", contract: "1" }, { party: "a", contract: "2" }, { party: "b", contract: "1" }, { party: "b", contract: "1" }];
  assert.deepEqual(sharedCompanies(links), ["a"]);
});
