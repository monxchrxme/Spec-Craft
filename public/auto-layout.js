// Route on the horizontal and vertical clearances around the node rectangles.
// Each search state includes the incoming direction so extra bends carry a cost.
import { anchors } from "./graph.js";

const obstaclePadding = 12;
const portClearance = 32;
const sides = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
function clearance(n) {
  return {
    left: n.x - obstaclePadding,
    right: n.x + n.width + obstaclePadding,
    top: n.y - obstaclePadding,
    bottom: n.y + n.height + obstaclePadding,
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
      ((a[0] === b[0] && b[0] === p[0] && (b[1] - a[1]) * (p[1] - b[1]) >= 0) ||
        (a[1] === b[1] && b[1] === p[1] && (b[0] - a[0]) * (p[0] - b[0]) >= 0))
    )
      out.pop();
    out.push(p);
  }
  return out;
}

function overlapsRun([a, b], [c, d]) {
  return [0, 1].some((axis) => {
    const fixed = 1 - axis;
    return (
      a[fixed] === b[fixed] &&
      a[fixed] === c[fixed] &&
      a[fixed] === d[fixed] &&
      Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) <
        Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]))
    );
  });
}
const steps = Object.values(sides);

function pathBetween(start, end, boxes, fromSide, toSide, occupied) {
  const open = (a, b) =>
    !blocked(a, b, boxes) && !occupied.some((run) => overlapsRun(run, [a, b]));
  const alongPort = (from, to, side) =>
    side
      ? sides[side][0] * (to[0] - from[0]) + sides[side][1] * (to[1] - from[1])
      : 0;
  const candidates = [];
  const horizontal = fromSide && sides[fromSide][0] !== 0;
  if (
    fromSide &&
    toSide &&
    sides[fromSide].every((v, i) => v === -sides[toSide][i]) &&
    alongPort(start, end, fromSide) >= 0
  ) {
    // Put dogleg turns midway across a clear corridor, away from both ports.
    if (horizontal) {
      const mid = (start[0] + end[0]) / 2;
      candidates.push([
        [mid, start[1]],
        [mid, end[1]],
      ]);
    } else {
      const mid = (start[1] + end[1]) / 2;
      candidates.push([
        [start[0], mid],
        [end[0], mid],
      ]);
    }
  }
  candidates.push([[end[0], start[1]]], [[start[0], end[1]]]);
  for (const turns of candidates) {
    const path = simple([start, ...turns, end]);
    if (path.length === 1) return path;
    if (
      alongPort(start, path[1], fromSide) >= 0 &&
      alongPort(end, path.at(-2), toSide) >= 0 &&
      path.slice(1).every((point, i) => open(path[i], point))
    )
      return path;
  }
  const axis = (i, lo, hi) =>
    [
      ...new Set([
        start[i],
        end[i],
        ...boxes.flatMap((r) => [r[lo], r[hi]]),
        ...occupied.flatMap(([a, b]) => [a[i], b[i]]),
      ]),
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
    const key = (y * xs.length + x) * (steps.length + 1) + dir;
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
      return simple(path.reverse());
    }
    for (const [index, [dx, dy]] of steps.entries()) {
      const x = p.x + dx,
        y = p.y + dy,
        dir = index + 1;
      if (x < 0 || x >= xs.length || y < 0 || y >= ys.length) continue;
      if (x === p.parent?.x && y === p.parent?.y) continue;
      const next = [xs[x], ys[y]];
      if (
        (!p.parent && alongPort(here, next, fromSide) < 0) ||
        (next[0] === end[0] &&
          next[1] === end[1] &&
          alongPort(end, here, toSide) < 0)
      )
        continue;
      if (open(here, next))
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
  return point.map((v, i) => v + sides[side][i] * portClearance);
}
function routeThroughLocks(start, end, boxes, fromSide, toSide, locks, leads) {
  const points = [start];
  const occupied = [...leads];
  const fixed = locks.map(({ from, to }) => [
    [from.x, from.y],
    [to.x, to.y],
  ]);
  for (const run of fixed) {
    if (
      blocked(...run, boxes) ||
      occupied.some((other) => overlapsRun(run, other))
    )
      return null;
    occupied.push(run);
  }
  let cursor = start,
    departure = fromSide;
  function connect(target, approach) {
    const path = pathBetween(
      cursor,
      target,
      boxes,
      departure,
      approach,
      occupied,
    );
    if (!path) return false;
    for (let i = 1; i < path.length; i++) occupied.push([path[i - 1], path[i]]);
    points.push(...path.slice(1));
    return true;
  }
  for (const [a, b] of fixed) {
    const horizontal = a[1] === b[1];
    const direction = horizontal
      ? b[0] > a[0]
        ? "right"
        : "left"
      : b[1] > a[1]
        ? "bottom"
        : "top";
    const approach = {
      right: "left",
      left: "right",
      top: "bottom",
      bottom: "top",
    }[direction];
    if (!connect(a, approach)) return null;
    points.push(b);
    cursor = b;
    departure = direction;
  }
  return connect(end, toSide) ? points : null;
}

function routeEdge(edge, fromNode, toNode, boxes, fromObstacles, toObstacles) {
  const [start, end] = anchors(fromNode, toNode, edge);
  const source = portChoices(portSide(start, fromNode), edge.fromSide);
  const target = portChoices(portSide(end, toNode), edge.toSide);
  for (const fromSide of source)
    for (const toSide of target) {
      const locks = edge.lockedSegments || [];
      if (fromNode === toNode && fromSide === toSide) continue;
      const [from, to] = anchors(fromNode, toNode, { fromSide, toSide });
      const s = offset(from, fromSide),
        t = offset(to, toSide);
      const direction = sides[fromSide];
      const directlyFacing =
        direction.every((v, i) => v === -sides[toSide][i]) &&
        (direction[0] ? from[1] === to[1] : from[0] === to[0]) &&
        (to[0] - from[0]) * direction[0] + (to[1] - from[1]) * direction[1] >=
          26;
      const direct =
        !locks.length &&
        directlyFacing &&
        !blocked(
          from,
          to,
          fromObstacles.filter((box) => toObstacles.includes(box)),
        );
      if (
        !direct &&
        (blocked(from, s, fromObstacles) ||
          blocked(to, t, toObstacles) ||
          overlapsRun([from, s], [to, t]))
      )
        continue;
      const leads = [
        [from, s],
        [to, t],
      ];
      const route = direct
        ? []
        : locks.length
          ? routeThroughLocks(s, t, boxes, fromSide, toSide, locks, leads)
          : pathBetween(s, t, boxes, fromSide, toSide, leads);
      if (!route) continue;
      const bends = locks.length
        ? route
        : simple([from, ...route, to]).slice(1, -1);
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
export function routeEdges(graph, scope, edgeIds = null) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n])),
    boxes = graph.nodes.map(clearance);
  let missed = 0;
  for (const edge of graph.edges) {
    if (
      edgeIds
        ? !edgeIds.has(edge.id)
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

const layoutVariants = ["horizontal", "vertical", "grid", "radial"];

export function arrangeNodes(
  graph,
  scope,
  variant = "horizontal",
  attempt = 0,
) {
  const nodes = graph.nodes.filter((n) => scope.has(n.id));
  if (!nodes.length) return;
  if (variant === "explore") {
    variant = layoutVariants[attempt % layoutVariants.length];
    attempt = Math.floor(attempt / layoutVariants.length);
  }
  const pending = new Set(nodes.map((n) => n.id)),
    rank = new Map();
  const outgoing = new Map(nodes.map((n) => [n.id, []])),
    indegree = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges)
    if (e.from !== e.to && pending.has(e.from) && pending.has(e.to)) {
      outgoing.get(e.from).push(e.to);
      indegree.set(e.to, indegree.get(e.to) + 1);
    }
  const degree = new Map(
    nodes.map(({ id }) => [id, outgoing.get(id).length + indegree.get(id)]),
  );
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
  const occupied = graph.nodes.filter(
    (node) => node.pinned || !scope.has(node.id),
  );
  const columns = new Map();
  const vertical = variant === "vertical";
  const grid = variant === "grid";
  const across = vertical ? "y" : "x";
  const down = vertical ? "x" : "y";
  const wide = vertical ? "height" : "width";
  const tall = vertical ? "width" : "height";
  const spacing = [0, 35, 72][attempt % 3];
  let start = Math.min(...nodes.map((node) => node[across]));
  const top = Math.min(...nodes.map((node) => node[down]));
  const placements = [];
  function place(node, lane, offset) {
    lane = Math.max(0, lane);
    offset = Math.max(0, offset);
    let collision;
    while (
      (collision = occupied.find(
        (other) =>
          lane < other[across] + other[wide] + 30 &&
          lane + node[wide] + 30 > other[across] &&
          offset < other[down] + other[tall] + 30 &&
          offset + node[tall] + 30 > other[down],
      ))
    )
      offset = collision[down] + collision[tall] + 42;
    if (lane > 20000 || offset > 20000)
      throw Error("Для раскладки недостаточно места. Выделите меньший модуль.");
    const position = { [across]: lane, [down]: offset };
    occupied.push({ ...position, width: node.width, height: node.height });
    placements.push([node, position]);
    return offset;
  }
  if (variant === "radial") {
    const ring = nodes.toSorted((a, b) => degree.get(b.id) - degree.get(a.id));
    const center = ring.shift();
    const step =
      Math.max(...nodes.map((node) => Math.max(node.width, node.height))) + 68;
    const radius =
      Math.max(step, (Math.max(1, ring.length) * step) / (2 * Math.PI)) +
      spacing;
    if (!center.pinned)
      place(center, Math.round(start + radius), Math.round(top + radius));
    const originX = center.pinned ? center.x : start + radius;
    const originY = center.pinned ? center.y : top + radius;
    ring.forEach((node, index) => {
      if (node.pinned) return;
      const angle =
        (2 * Math.PI * index) / ring.length -
        Math.PI / 2 +
        (attempt * Math.PI) / 6;
      place(
        node,
        Math.round(originX + radius * Math.cos(angle)),
        Math.round(originY + radius * Math.sin(angle)),
      );
    });
  } else {
    const order = attempt % 2 ? nodes.toReversed() : nodes;
    const count = Math.ceil(Math.sqrt(nodes.length));
    for (const [index, node] of order.entries()) {
      const tier = grid ? index % count : rank.get(node.id) || 0;
      if (!columns.has(tier)) columns.set(tier, []);
      columns.get(tier).push(node);
    }
    const gridStep = grid
      ? Math.max(...nodes.map((node) => node[tall])) + 58 + spacing
      : 0;
    for (const [tier, column] of [...columns].sort(([a], [b]) => a - b)) {
      let offset = top + (attempt % 2 && tier % 2 ? 40 : 0);
      for (const node of column) {
        if (!node.pinned)
          offset =
            place(node, start, offset) +
            (gridStep || node[tall] + 54 + spacing);
        else if (grid) offset += gridStep;
      }
      start +=
        Math.max(...column.map((node) => node[wide])) +
        (grid ? 65 : 92) +
        spacing;
    }
  }
  for (const [node, position] of placements) Object.assign(node, position);
}
