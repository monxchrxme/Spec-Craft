import test from "node:test";
import assert from "node:assert/strict";
import {
  arrangeNodes,
  layoutProposals,
  routeEdges,
} from "../public/auto-layout.js";
import { anchors, routePoints } from "../public/graph.js";

const node = (id, x, y, extra = {}) => ({
  id,
  x,
  y,
  width: 100,
  height: 60,
  ...extra,
});

test("layout proposals compare separate routed graphs against an unchanged original", () => {
  const graph = {
    nodes: [node("a", 40, 40), node("b", 232, 40), node("c", 424, 40)],
    edges: [
      { id: "ab", from: "a", to: "b" },
      { id: "bc", from: "b", to: "c" },
    ],
  };
  const baseline = structuredClone(graph);
  const propose = layoutProposals(graph, new Set(["a", "b", "c"]), "explore");
  const first = propose();
  const second = propose();
  assert(first.moved > 0 && second.moved > 0);
  assert.notDeepEqual(first.graph.nodes, second.graph.nodes);
  assert(first.graph.edges.every((edge) => edge.route === "orthogonal"));
  assert.deepEqual(graph, baseline);
});

test("a selected route goes around a central obstacle and preserves other links", () => {
  const a = node("a", 30, 100),
    b = node("b", 570, 100),
    wall = node("wall", 260, 55, { height: 180 });
  const e = { id: "direct", from: "a", to: "b", dashed: true, label: "Запрос" },
    other = { id: "manual", from: "a", to: "wall", route: "curve" };
  const graph = { nodes: [a, wall, b], edges: [e, other] };
  assert.equal(routeEdges(graph, new Set(), new Set(["direct"])), 0);
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

test("a locked route segment keeps its coordinates when a node moves", () => {
  const a = node("a", 30, 100);
  const b = node("b", 550, 210);
  const locked = { from: { x: 340, y: 100 }, to: { x: 340, y: 260 } };
  const edge = {
    id: "e",
    from: a.id,
    to: b.id,
    fromSide: "right",
    toSide: "left",
    lockedSegments: [locked],
  };
  const graph = { nodes: [a, b], edges: [edge] };
  const scope = new Set([a.id]);
  assert.equal(routeEdges(graph, scope), 0);
  const original = edge.points;
  a.y += 50;
  assert.equal(routeEdges(graph, scope), 0);
  assert.notDeepEqual(edge.points, original);
  assert.deepEqual(edge.lockedSegments, [locked]);
  const i = edge.points.findIndex(
    (point) => point.x === locked.from.x && point.y === locked.from.y,
  );
  assert(i >= 0);
  assert.deepEqual(edge.points.slice(i, i + 2), [locked.from, locked.to]);
  const lastValid = edge.points;
  graph.nodes.push(node("obstacle", 320, 150));
  assert.equal(routeEdges(graph, scope), 1);
  assert.deepEqual(edge.points, lastValid);
});

test("the router takes a detour instead of doubling back near a locked segment", () => {
  const a = node("a", 60, 60);
  const b = node("b", 550, 210);
  const lock = { from: { x: 180, y: 70 }, to: { x: 250, y: 70 } };
  const edge = {
    id: "e",
    from: a.id,
    to: b.id,
    fromSide: "right",
    toSide: "left",
    lockedSegments: [lock],
  };
  assert.equal(
    routeEdges({ nodes: [a, b], edges: [edge] }, new Set([a.id])),
    0,
  );
  const [start, end] = anchors(a, b, edge);
  const rawPath = [start, ...edge.points.map(({ x, y }) => [x, y]), end];
  assert.equal(new Set(rawPath.map((p) => p.join(","))).size, rawPath.length);
  assert.deepEqual(routePoints(a, b, edge), rawPath);
  const i = edge.points.findIndex(
    (p) => p.x === lock.from.x && p.y === lock.from.y,
  );
  assert(i >= 0);
  assert.deepEqual(edge.points.slice(i, i + 2), [lock.from, lock.to]);
});

test("older routes hide a retraced diagonal and keep the visible segments", () => {
  const a = node("a", 0, 0);
  const b = node("b", 400, 100);
  const edge = {
    fromSide: "right",
    toSide: "left",
    route: "orthogonal",
    points: [
      { x: 170, y: 30 },
      { x: 245, y: 105 },
      { x: 170, y: 30 },
      { x: 170, y: 130 },
    ],
  };
  const original = structuredClone(edge.points);
  assert.deepEqual(routePoints(a, b, edge), [
    [100, 30],
    [170, 30],
    [170, 130],
    [400, 130],
  ]);
  assert.deepEqual(edge.points, original);
});

test("routing multiple selected arrows leaves even adjacent unselected arrows intact", () => {
  const a = node("a", 30, 100);
  const b = node("b", 390, 210);
  const c = node("c", 390, 390);
  const d = node("d", 30, 390);
  const edges = [
    { id: "one", from: a.id, to: b.id, route: "curve" },
    { id: "two", from: b.id, to: c.id, route: "straight" },
    {
      id: "keep",
      from: d.id,
      to: c.id,
      route: "curve",
      points: [{ x: 280, y: 310 }],
    },
  ];
  const unchanged = structuredClone(edges[2]);
  assert.equal(
    routeEdges(
      { nodes: [a, b, c, d], edges },
      new Set([c.id]),
      new Set(["one", "two"]),
    ),
    0,
  );
  assert.equal(edges[0].route, "orthogonal");
  assert.equal(edges[1].route, "orthogonal");
  assert.deepEqual(edges[2], unchanged);
});

test("alternative layouts follow vertical dependencies or a compact grid", () => {
  const graph = {
    nodes: [
      node("a", 40, 80),
      node("b", 160, 50),
      node("c", 280, 15),
      node("d", 510, 500, { pinned: true }),
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ],
  };
  const scope = new Set(graph.nodes.map((n) => n.id));
  const vertical = structuredClone(graph);
  arrangeNodes(vertical, scope, "vertical");
  const [a, b, c, d] = vertical.nodes;
  assert(a.y < b.y && b.y < c.y);
  assert.deepEqual(d, graph.nodes[3]);
  const grid = structuredClone(graph);
  arrangeNodes(grid, scope, "grid");
  assert.equal(grid.nodes[0].y, grid.nodes[1].y);
  assert(grid.nodes[2].y > grid.nodes[0].y);
  assert.deepEqual(grid.nodes[3], graph.nodes[3]);
});

test("successive explorations move nodes relative to each other and preserve pins", () => {
  const graph = {
    nodes: [
      node("a", 45, 55),
      node("b", 310, 60),
      node("c", 185, 175),
      node("d", 580, 495, { pinned: true }),
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "a" },
    ],
  };
  const scope = new Set(graph.nodes.map(({ id }) => id));
  const pinned = { ...graph.nodes[3] };
  const views = new Set();
  for (let attempt = 0; attempt < 5; attempt++) {
    arrangeNodes(graph, scope, "explore", attempt);
    const [anchor] = graph.nodes;
    const view = JSON.stringify(
      graph.nodes.slice(0, 3).map(({ x, y }) => [x - anchor.x, y - anchor.y]),
    );
    assert(!views.has(view));
    views.add(view);
    assert.deepEqual(graph.nodes[3], pinned);
    assert(graph.nodes.every(({ x, y }) => x >= 0 && y >= 0));
  }
});
