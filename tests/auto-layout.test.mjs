import test from "node:test";
import assert from "node:assert/strict";
import { arrangeNodes, routeEdges } from "../public/auto-layout.js";
import { anchors } from "../public/graph.js";

const node = (id, x, y, extra = {}) => ({
  id,
  x,
  y,
  width: 100,
  height: 60,
  ...extra,
});

test("a selected route goes around a central obstacle and preserves other links", () => {
  const a = node("a", 30, 100),
    b = node("b", 570, 100),
    wall = node("wall", 260, 55, { height: 180 });
  const e = { id: "direct", from: "a", to: "b", dashed: true, label: "Запрос" },
    other = { id: "manual", from: "a", to: "wall", route: "curve" };
  const graph = { nodes: [a, wall, b], edges: [e, other] };
  assert.equal(routeEdges(graph, new Set(), "direct"), 0);
  assert.equal(e.route, "orthogonal");
  assert(e.dashed);
  assert.equal(other.route, "curve");
  const [s, t] = anchors(a, b, e),
    path = [s, ...e.points.map((p) => [p.x, p.y]), t];
  for (let i = 1; i < path.length; i++) {
    const [x, y] = path[i - 1],
      [u, v] = path[i];
    assert(x === u || y === v);
    const crosses =
      x === u
        ? x > wall.x &&
          x < wall.x + wall.width &&
          Math.max(y, v) > wall.y &&
          Math.min(y, v) < wall.y + wall.height
        : y > wall.y &&
          y < wall.y + wall.height &&
          Math.max(x, u) > wall.x &&
          Math.min(x, u) < wall.x + wall.width;
    assert(!crosses);
  }
});
test("layout respects pins, module scope and cycles", () => {
  const a = node("a", 20, 20, { pinned: true }),
    b = node("b", 20, 20),
    c = node("c", 25, 25),
    outside = node("outside", 200, 35);
  const graph = {
    nodes: [a, b, c, outside],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "b" },
    ],
  };
  arrangeNodes(graph, new Set(["a", "b", "c"]));
  assert.deepEqual([a.x, a.y, outside.x, outside.y], [20, 20, 200, 35]);
  for (const [i, n] of graph.nodes.entries())
    for (const o of graph.nodes.slice(i + 1))
      assert(
        n.x + n.width <= o.x ||
          o.x + o.width <= n.x ||
          n.y + n.height <= o.y ||
          o.y + o.height <= n.y,
      );
});
test("a fully blocked port keeps the hand-routed path", () => {
  const a = node("a", 10, 10),
    b = node("b", 240, 10),
    cover = node("cover", 0, 0, { width: 140, height: 100 });
  const e = {
      id: "e",
      from: "a",
      to: "b",
      route: "curve",
      points: [{ x: 150, y: 4 }],
    },
    before = structuredClone(e);
  assert.equal(
    routeEdges({ nodes: [a, b, cover], edges: [e] }, new Set(["a"])),
    1,
  );
  assert.deepEqual(e, before);
});

test("open corridors center bends and provide a straight run into the arrowhead", () => {
  const a = node("a", 25, 25),
    b = node("b", 395, 120);
  const edge = {
    id: "e",
    from: a.id,
    to: b.id,
    fromSide: "right",
    toSide: "left",
    weight: 8,
  };
  const graph = { nodes: [a, b], edges: [edge] };
  assert.equal(routeEdges(graph, new Set(["a", "b"])), 0);
  const [[startX, startY], [endX, endY]] = anchors(a, b, edge);
  const centralX = (startX + endX) / 2;
  assert.deepEqual(edge.points, [
    { x: centralX, y: startY },
    { x: centralX, y: endY },
  ]);
  assert(endX - edge.points.at(-1).x >= 32);
});

test("aligned blocks stay connected by a straight line even with a narrow gap", () => {
  const a = node("a", 0, 0),
    b = node("b", 135, 0);
  const edge = {
    id: "e",
    from: a.id,
    to: b.id,
    fromSide: "right",
    toSide: "left",
  };
  assert.equal(
    routeEdges({ nodes: [a, b], edges: [edge] }, new Set(["a", "b"])),
    0,
  );
  assert.deepEqual(edge.points, [{ x: 117.5, y: 30 }]);
});
