import { routePoints } from "./graph.js";

const vector = (a, b) => [b[0] - a[0], b[1] - a[1]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1;

function intersection(a, b, c, d) {
  const u = vector(a, b),
    v = vector(c, d);
  const denominator = cross(u, v);
  if (Math.abs(denominator) < 0.0001) return null;
  const offset = vector(a, c),
    t = cross(offset, v) / denominator,
    s = cross(offset, u) / denominator;
  if (t < 0 || t > 1 || s < 0 || s > 1) return null;
  return [a[0] + t * u[0], a[1] + t * u[1]];
}

function bounds(points) {
  return {
    left: Math.min(...points.map((point) => point[0])),
    right: Math.max(...points.map((point) => point[0])),
    top: Math.min(...points.map((point) => point[1])),
    bottom: Math.max(...points.map((point) => point[1])),
  };
}
function overlap(a, b) {
  return (
    a.left <= b.right &&
    a.right >= b.left &&
    a.top <= b.bottom &&
    a.bottom >= b.top
  );
}
function segments(points) {
  return points.slice(1).map((point, i) => ({
    from: points[i],
    to: point,
    box: bounds([points[i], point]),
  }));
}
function crossing(a, b) {
  if (!overlap(a.box, b.box)) return null;
  const sharedEnds = [a.points[0], a.points.at(-1)].filter((p) =>
    [b.points[0], b.points.at(-1)].some((q) => close(p, q)),
  );
  for (const x of a.segments)
    for (const y of b.segments) {
      if (!overlap(x.box, y.box)) continue;
      const point = intersection(x.from, x.to, y.from, y.to);
      if (point && !sharedEnds.some((end) => close(point, end))) return point;
    }
  return null;
}
function touchesLabel(line, label) {
  if (!overlap(line.box, label.box)) return false;
  const inside = ([x, y]) =>
    x > label.box.left &&
    x < label.box.right &&
    y > label.box.top &&
    y < label.box.bottom;
  return (
    inside(line.from) ||
    inside(line.to) ||
    label.sides.some((side) =>
      intersection(line.from, line.to, side.from, side.to),
    )
  );
}

export function checkDiagram(graph, svg) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const connected = new Set(
    graph.edges.flatMap((edge) => [edge.from, edge.to]),
  );
  const paths = new Map(
    Array.from(svg.querySelectorAll("[data-edge-line]"), (path) => [
      path.closest("[data-edge]").dataset.edge,
      path,
    ]),
  );
  const lines = graph.edges.map((edge) => {
    const from = nodes.get(edge.from),
      to = nodes.get(edge.to);
    let points = routePoints(from, to, edge);
    if (edge.route === "curve") {
      const path = paths.get(edge.id),
        length = path?.getTotalLength() || 0;
      const count = Math.max(8, Math.min(64, Math.ceil(length / 14)));
      if (length)
        points = Array.from({ length: count + 1 }, (_, i) => {
          const point = path.getPointAtLength((length * i) / count);
          return [point.x, point.y];
        });
    }
    return {
      id: edge.id,
      name: edge.label || from.label + " → " + to.label,
      points,
      segments: segments(points),
      box: bounds(points),
    };
  });
  const issues = [];
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i],
        b = lines[j],
        point = crossing(a, b);
      if (point)
        issues.push({
          type: "Пересечение стрелок",
          text: a.name + " и " + b.name,
          edge: a.id,
          point,
        });
    }
  const screen = svg.getScreenCTM()?.inverse();
  if (screen) {
    const labels = [];
    for (const text of svg.querySelectorAll(
      "[data-node] text, [data-edge] text, [data-module] text",
    )) {
      const label = text.textContent.trim();
      if (!label) continue;
      const group = text.closest("[data-node], [data-edge], [data-module]");
      const owner = group.dataset.edge;
      const { x, y, width, height } = text.getBBox();
      if (!width || !height) continue;
      const transform = screen.multiply(text.getScreenCTM());
      const corners = [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
      ].map(([a, b]) => {
        const p = new DOMPoint(a, b).matrixTransform(transform);
        return [p.x, p.y];
      });
      const box = bounds(corners);
      const region = { box, sides: segments([...corners, corners[0]]) };
      const point = [(box.left + box.right) / 2, (box.top + box.bottom) / 2];
      for (const line of lines)
        if (
          line.id !== owner &&
          overlap(line.box, box) &&
          line.segments.some((item) => touchesLabel(item, region))
        )
          issues.push({
            type: "Стрелка перекрывает подпись",
            text: line.name + " · «" + label + "»",
            edge: line.id,
            point,
          });
      for (const other of labels) {
        if (other.group === group) continue;
        const left = Math.max(box.left, other.box.left);
        const right = Math.min(box.right, other.box.right);
        const top = Math.max(box.top, other.box.top);
        const bottom = Math.min(box.bottom, other.box.bottom);
        if (right - left > 2 && bottom - top > 2)
          issues.push({
            type: "Наложение подписей",
            text: "«" + label + "» и «" + other.label + "»",
            node: group.dataset.node || other.group.dataset.node,
            edge: owner || other.group.dataset.edge,
            point: [(left + right) / 2, (top + bottom) / 2],
          });
      }
      labels.push({ box, group, label });
    }
  }
  for (const node of graph.nodes)
    if (!connected.has(node.id))
      issues.push({
        type: "Изолированная фигура",
        text: node.label,
        node: node.id,
        point: [node.x + node.width / 2, node.y + node.height / 2],
      });
  return issues;
}
