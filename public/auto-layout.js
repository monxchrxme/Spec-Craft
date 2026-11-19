// Route on the horizontal and vertical clearances around the node rectangles.
// Each search state includes the incoming direction so extra bends carry a cost.
import { anchors } from "./graph.js";

const padding = 12;
const sides = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
function clearance(n) {
  return {
    left: n.x - padding,
    right: n.x + n.width + padding,
    top: n.y - padding,
    bottom: n.y + n.height + padding,
  };
}
function blocked(a, b, boxes) {
  const [x, y] = a,
    [u, v] = b;
  return boxes.some((r) =>
    x === u
      ? x > r.left &&
        x < r.right &&
        Math.max(y, v) > r.top &&
        Math.min(y, v) < r.bottom
      : y > r.top &&
        y < r.bottom &&
        Math.max(x, u) > r.left &&
        Math.min(x, u) < r.right,
  );
}
function simple(points) {
  const out = [];
  for (const p of points) {
    const a = out.at(-2),
      b = out.at(-1);
    if (b && b[0] === p[0] && b[1] === p[1]) continue;
    if (
      a &&
      ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1]))
    )
      out.pop();
    out.push(p);
  }
  return out;
}

function pathBetween(start, end, boxes) {
  for (const turn of [
    [end[0], start[1]],
    [start[0], end[1]],
  ]) {
    if (!blocked(start, turn, boxes) && !blocked(turn, end, boxes))
      return [start, turn, end];
  }
  const axis = (i, lo, hi) =>
    [
      ...new Set([start[i], end[i], ...boxes.flatMap((r) => [r[lo], r[hi]])]),
    ].sort((a, b) => a - b);
  const xs = axis(0, "left", "right"),
    ys = axis(1, "top", "bottom");
  const queue = [],
    best = new Map();
  function push(item) {
    let i = queue.length;
    queue.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (queue[p].score <= item.score) break;
      queue[i] = queue[p];
      i = p;
    }
    queue[i] = item;
  }
  function pop() {
    const first = queue[0],
      last = queue.pop();
    if (!queue.length) return first;
    let i = 0;
    while (i * 2 + 1 < queue.length) {
      let j = i * 2 + 1;
      if (j + 1 < queue.length && queue[j + 1].score < queue[j].score) j++;
      if (last.score <= queue[j].score) break;
      queue[i] = queue[j];
      i = j;
    }
    queue[i] = last;
    return first;
  }
  function visit(x, y, dir, cost, parent) {
    const key = (y * xs.length + x) * 3 + dir;
    if ((best.get(key) ?? Infinity) <= cost) return;
    best.set(key, cost);
    push({
      x,
      y,
      dir,
      cost,
      key,
      parent,
      score: cost + Math.abs(xs[x] - end[0]) + Math.abs(ys[y] - end[1]),
    });
  }
  visit(xs.indexOf(start[0]), ys.indexOf(start[1]), 0, 0, null);
  while (queue.length) {
    const p = pop();
    if (best.get(p.key) !== p.cost) continue;
    const here = [xs[p.x], ys[p.y]];
    if (here[0] === end[0] && here[1] === end[1]) {
      const path = [];
      for (let q = p; q; q = q.parent) path.push([xs[q.x], ys[q.y]]);
      return path.reverse();
    }
    for (const [dx, dy] of Object.values(sides)) {
      const x = p.x + dx,
        y = p.y + dy,
        dir = dx ? 1 : 2;
      if (x < 0 || x >= xs.length || y < 0 || y >= ys.length) continue;
      if (!blocked(here, [xs[x], ys[y]], boxes))
        visit(
          x,
          y,
          dir,
          p.cost +
            Math.abs(xs[x] - here[0]) +
            Math.abs(ys[y] - here[1]) +
            (p.dir && p.dir !== dir ? 20 : 0),
          p,
        );
    }
  }
  return null;
}

function portSide(point, node) {
  if (point[0] === node.x) return "left";
  if (point[0] === node.x + node.width) return "right";
  return point[1] === node.y ? "top" : "bottom";
}
function portChoices(preferred, fixed) {
  return Object.hasOwn(sides, fixed)
    ? [fixed]
    : [preferred, ...Object.keys(sides).filter((s) => s !== preferred)];
}
function offset(point, side) {
  return point.map((v, i) => v + sides[side][i] * padding);
}
function routeEdge(edge, fromNode, toNode, boxes, fromObstacles, toObstacles) {
  const [start, end] = anchors(fromNode, toNode, edge);
  const source = portChoices(portSide(start, fromNode), edge.fromSide);
  const target = portChoices(portSide(end, toNode), edge.toSide);
  for (const fromSide of source)
    for (const toSide of target) {
      if (fromNode === toNode && fromSide === toSide) continue;
      const [from, to] = anchors(fromNode, toNode, { fromSide, toSide });
      const s = offset(from, fromSide),
        t = offset(to, toSide);
      if (blocked(from, s, fromObstacles) || blocked(to, t, toObstacles))
        continue;
      const route = pathBetween(s, t, boxes);
      if (!route) continue;
      const bends = simple([from, ...route, to]).slice(1, -1);
      edge.route = "orthogonal";
      // Preserve automatic ports when the default orientation is viable.
      if (fromSide !== portSide(start, fromNode)) edge.fromSide = fromSide;
      if (toSide !== portSide(end, toNode)) edge.toSide = toSide;
      const midpoint = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      edge.points = (bends.length ? bends : [midpoint]).map(([x, y]) => ({
        x,
        y,
      }));
      return true;
    }
  return false;
}
export function routeEdges(graph, scope, selectedEdge = null) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n])),
    boxes = graph.nodes.map(clearance);
  let missed = 0;
  for (const edge of graph.edges) {
    if (
      selectedEdge
        ? edge.id !== selectedEdge
        : !scope.has(edge.from) && !scope.has(edge.to)
    )
      continue;
    const a = byId.get(edge.from),
      b = byId.get(edge.to);
    if (
      !routeEdge(
        edge,
        a,
        b,
        boxes,
        boxes.filter((_, i) => graph.nodes[i] !== a),
        boxes.filter((_, i) => graph.nodes[i] !== b),
      )
    )
      missed++;
  }
  return missed;
}

export function arrangeNodes(graph, scope) {
  const nodes = graph.nodes.filter((n) => scope.has(n.id));
  if (!nodes.length) return;
  const pending = new Set(nodes.map((n) => n.id)),
    rank = new Map();
  const outgoing = new Map(nodes.map((n) => [n.id, []])),
    indegree = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges)
    if (e.from !== e.to && pending.has(e.from) && pending.has(e.to)) {
      outgoing.get(e.from).push(e.to);
      indegree.set(e.to, indegree.get(e.to) + 1);
    }
  const ready = nodes.filter((n) => !indegree.get(n.id)).map((n) => n.id);
  while (pending.size) {
    // Cycles retain a stable source order.
    const id = ready.shift() ?? pending.values().next().value;
    if (!pending.delete(id)) continue;
    for (const next of outgoing.get(id)) {
      if (!pending.has(next)) continue;
      rank.set(next, Math.max(rank.get(next) || 0, (rank.get(id) || 0) + 1));
      indegree.set(next, indegree.get(next) - 1);
      if (!indegree.get(next)) ready.push(next);
    }
  }
  const occupied = graph.nodes.filter((n) => n.pinned || !scope.has(n.id));
  const columns = new Map();
  for (const n of nodes) {
    const r = rank.get(n.id) || 0;
    if (!columns.has(r)) columns.set(r, []);
    columns.get(r).push(n);
  }
  let x = Math.min(...nodes.map((n) => n.x));
  const top = Math.min(...nodes.map((n) => n.y));
  const placements = [];
  for (const [, col] of [...columns].sort(([a], [b]) => a - b)) {
    let y = top;
    for (const n of col) {
      if (n.pinned) continue;
      let collision;
      while (
        (collision = occupied.find(
          (o) =>
            x < o.x + o.width + 30 &&
            x + n.width + 30 > o.x &&
            y < o.y + o.height + 30 &&
            y + n.height + 30 > o.y,
        ))
      )
        y = collision.y + collision.height + 42;
      if (x > 20000 || y > 20000)
        throw Error(
          "Для раскладки недостаточно места. Выделите меньший модуль.",
        );
      const placed = { x, y, width: n.width, height: n.height };
      occupied.push(placed);
      placements.push([n, x, y]);
      y += n.height + 54;
    }
    x += Math.max(...col.map((n) => n.width)) + 92;
  }
  for (const [n, x, y] of placements) Object.assign(n, { x, y });
}
