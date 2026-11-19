import {
  makeShare,
  reviewRequest,
  reviewTargets,
  reviewUrl,
} from "./review.js";
import { specIndex, reviewItems, canonical } from "./spec-index.js";

function element(tag, text, cls) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function button(label, fn, cls) {
  const el = element("button", label, cls);
  el.type = "button";
  el.onclick = fn;
  return el;
}
function field(label, control) {
  const el = element("label", label);
  el.append(control);
  return el;
}
function pick(label, items, onChange, value) {
  const el = element("select");
  items.forEach(([key, name]) => el.add(new Option(name, key)));
  if (value !== undefined) el.value = value;
  el.onchange = () => onChange(el.value);
  return field(label, el);
}
function checkbox(label, on, set) {
  const el = element("input");
  el.type = "checkbox";
  el.checked = on;
  el.onchange = () => set(el.checked);
  const line = element("label", undefined, "spec-check");
  line.append(el, document.createTextNode(label));
  return line;
}
function empty(panel, msg) {
  panel.append(element("p", msg, "spec-muted"));
}
const states = ["На согласовании", "Согласована", "Требует доработки"];

export function specPanels(api) {
  const { open, parse, document: current, jump, commit, notice } = api;
  function panel(title) {
    const el = open(title, "");
    el.classList.add("spec-panel");
    return el;
  }
  function trace(key, onlyMissing = false) {
    const box = panel("Связи требований"),
      doc = current(),
      body = doc.body,
      parts = parse(body),
      idx = specIndex(parts);
    const actual = (fn) => {
      if (current().body !== body) {
        trace(undefined, onlyMissing);
        notice("Документ изменился. Выберите связь ещё раз.");
        return;
      }
      fn();
    };
    const req = idx.requirements.find((r) => r.key === key);
    const linkedChecks = (id) => idx.bindings.filter((b) => b.req === id);
    if (!req) {
      const missing = idx.requirements.filter(
        (r) => !linkedChecks(r.id).length,
      );
      empty(
        box,
        "Требований: " +
          idx.requirements.length +
          " · без проверки: " +
          missing.length,
      );
      box.append(
        checkbox("Только без проверки", onlyMissing, (value) =>
          trace(undefined, value),
        ),
      );
      for (const r of onlyMissing ? missing : idx.requirements) {
        const row = element("div", undefined, "spec-entry");
        row.append(
          button(
            r.label,
            () => actual(() => trace(r.key, onlyMissing)),
            "spec-link",
          ),
          element(
            "small",
            "Компоненты: " +
              idx.components.filter((c) => c.reqs.includes(r.id)).length +
              " · проверки: " +
              new Set(linkedChecks(r.id).map((b) => b.check.key)).size,
          ),
        );
        box.append(row);
      }
      if (!idx.requirements.length)
        empty(box, "Добавьте требование с ID в заголовке или таблице.");
      box.append(button("Добавить требование", api.addRequirement, "option"));
      return;
    }
    box.append(
      button(
        "← Все требования",
        () => trace(undefined, onlyMissing),
        "spec-link",
      ),
      element("h3", req.label),
      button("К требованию", () => actual(() => jump(req)), "spec-link"),
    );
    if (req.criterion) empty(box, "Критерий приёмки · " + req.criterion);
    if (idx.requirements.filter((r) => r.id === req.id).length > 1) {
      empty(
        box,
        "ID повторяется. Присвойте требованиям разные ID для однозначной связи.",
      );
      return;
    }
    box.append(element("h3", "Компоненты схем"));
    if (!idx.components.length)
      empty(box, "Вставьте блок-схему в документ, чтобы связать её фигуры.");
    for (const c of idx.components) {
      const row = element("div", undefined, "spec-entry");
      row.append(
        checkbox(c.diagram + " · " + c.label, c.reqs.includes(req.id), (on) =>
          actual(() => {
            const p = parts[c.index],
              g = JSON.parse(p.t.content),
              n = g.nodes.find((n) => n.id === c.node);
            n.requirements = (
              Array.isArray(n.requirements) ? n.requirements : []
            ).filter(
              (s) => typeof s === "string" && s.toUpperCase() !== req.id,
            );
            if (on) n.requirements.push(req.id);
            commit(p.start, p.end, api.fence(g));
            trace(req.key, onlyMissing);
          }),
        ),
        button("К фигуре", () => actual(() => jump(c)), "spec-link"),
      );
      box.append(row);
    }
    box.append(element("h3", "Проверки"));
    for (const check of idx.checks.filter((c) => c.row < 0)) {
      const relations = linkedChecks(req.id).filter((b) => b.check === check);
      const row = element("div", undefined, "spec-entry");
      row.append(
        checkbox(check.label, !!relations.length, (on) =>
          actual(() => {
            if (on) {
              const p = parts[check.index];
              commit(p.end, p.end, "\n\nПроверяет: [[" + req.id + "]]");
            } else {
              let next = body;
              for (const b of relations.slice().reverse()) {
                const p = parts[b.index];
                next = next.slice(0, p.start) + next.slice(p.end);
              }
              commit(0, body.length, next);
            }
            const nextIndex = specIndex(parse(current().body));
            trace(
              nextIndex.requirements.find((r) => r.id === req.id)?.key,
              onlyMissing,
            );
          }),
        ),
        button("К проверке", () => actual(() => jump(check)), "spec-link"),
      );
      box.append(row);
    }
    const form = element("form", undefined, "spec-form"),
      name = element("input");
    name.required = true;
    const create = element("button", "Создать проверку", "primary");
    form.append(field("Название новой проверки", name), create);
    box.append(form);
    form.onsubmit = (e) => {
      e.preventDefault();
      actual(() => {
        const title = name.value.trim().replace(/[\r\n]+/g, " ");
        if (!title) return;
        const number =
          Math.max(0, ...idx.checks.map((c) => Number(c.id.slice(3)))) + 1;
        const id = "TC-" + String(number).padStart(2, "0");
        commit(
          body.length,
          body.length,
          "\n\n## " +
            id +
            " · " +
            title +
            "\n\nПроверяет: [[" +
            req.id +
            "]]\n",
        );
        trace(req.key, onlyMissing);
      });
    };
  }

  function links(query) {
    const box = panel("Ссылки разделов"),
      body = current().body,
      idx = specIndex(parse(body));
    const navigate = (target) => {
      if (current().body !== body) {
        links(query);
        notice("Документ изменился. Выберите раздел ещё раз.");
      } else jump(target);
    };
    const unique = [...new Set(idx.targets.map((t) => t.id || t.label))];
    const unresolved = [
      ...new Set(
        idx.refs
          .filter((r) => !idx.resolve(r.target).length)
          .map((r) => r.target),
      ),
    ];
    const target = query ?? unique[0] ?? unresolved[0];
    if (!target) {
      empty(
        box,
        "Добавьте заголовок или введите ссылку вида [[Название раздела]].",
      );
      return;
    }
    const options = [...new Set([target, ...unique, ...unresolved])];
    box.append(
      pick(
        "Раздел или ID",
        options.map((t) => [t, t]),
        links,
        target,
      ),
    );
    const matches = idx.resolve(target);
    if (!matches.length)
      empty(
        box,
        "Цель не найдена. Проверьте название в ссылке или добавьте такой раздел.",
      );
    if (matches.length > 1)
      empty(box, "Несколько совпадений. Выберите раздел для перехода.");
    for (const t of matches)
      box.append(
        button(
          "Перейти · " +
            t.label +
            (matches.length > 1 ? " · " + t.section : ""),
          () => navigate(t),
          "option",
        ),
      );
    box.append(element("h3", "Обратные ссылки"));
    const incoming = idx.refs.filter(
      (r) =>
        canonical(r.target) === canonical(target) ||
        idx.resolve(r.target).some((t) => matches.includes(t)),
    );
    for (const ref of incoming)
      box.append(
        button(
          ref.source + " · [[" + ref.target + "]]",
          () => navigate(ref),
          "spec-link",
        ),
      );
    if (!incoming.length)
      empty(box, "В документе пока нет ссылок на эту цель.");
    if (unresolved.length) {
      box.append(element("h3", "Ненайденные цели"));
      for (const text of unresolved)
        box.append(button("[[" + text + "]]", () => links(text), "spec-link"));
    }
  }

  function versions(id, compare = false) {
    const box = panel("Версии для согласования"),
      d = current();
    const saved = d.versions || [],
      v = saved.find((s) => s.id === id);
    const form = element("form", undefined, "spec-form"),
      name = element("input");
    name.required = true;
    name.placeholder = "Например, Передано на ревью";
    form.append(
      field("Название версии", name),
      element("button", "Зафиксировать версию", "primary"),
    );
    box.append(form);
    form.onsubmit = (e) => {
      e.preventDefault();
      const title = name.value.trim();
      if (!title) return;
      const snapshot = {
        id: crypto.randomUUID(),
        name: title,
        date: Date.now(),
        state: states[0],
      };
      if (
        api.update((latest) => ({
          ...latest,
          versions: [
            { ...snapshot, body: latest.body, style: latest.style || {} },
            ...(latest.versions || []),
          ],
        }))
      )
        versions(snapshot.id);
    };
    if (!saved.length) {
      empty(
        box,
        "Зафиксируйте текущий документ, чтобы сравнивать последующие правки.",
      );
      return;
    }
    if (!v) {
      for (const item of saved) {
        const row = element("div", undefined, "spec-entry");
        row.append(
          button(item.name, () => versions(item.id, true), "spec-link"),
          element(
            "small",
            item.state + " · " + new Date(item.date).toLocaleString("ru"),
          ),
        );
        box.append(row);
      }
      return;
    }
    box.append(
      button("← Все версии", () => versions(), "spec-link"),
      element("h3", v.name),
      element("small", new Date(v.date).toLocaleString("ru")),
      pick(
        "Статус версии",
        states.map((s) => [s, s]),
        (state) => {
          if (
            api.update((latest) => ({
              ...latest,
              versions: (latest.versions || []).map((item) =>
                item.id === id ? { ...item, state } : item,
              ),
            }))
          )
            versions(id, compare);
        },
        v.state,
      ),
      button("Сравнить с документом", () => versions(id, true), "option"),
      button(
        "Скачать Markdown версии",
        () =>
          api.download(
            d.name.replace(/\.md$/i, "") + " — " + v.name + ".md",
            v.body,
          ),
        "option",
      ),
    );
    const sharing = element("section", undefined, "share-version");
    sharing.append(element("h3", "Согласование по ссылке"));
    empty(
      sharing,
      "По ссылке коллега увидит снимок и сможет оставить замечания. Доступ есть у каждого, у кого есть ссылка.",
    );
    box.append(sharing);
    const shareStatus = element("p", undefined, "spec-muted");
    shareStatus.setAttribute("role", "status");
    const publish = button(
      v.share?.published ? "Копировать ссылку" : "Создать ссылку для коллеги",
      async () => {
        publish.disabled = true;
        try {
          let share = v.share;
          if (!share) {
            share = makeShare();
            if (
              !api.update(
                (latest) => ({
                  ...latest,
                  versions: latest.versions.map((item) =>
                    item.id === id
                      ? { ...item, share: (share = item.share || share) }
                      : item,
                  ),
                }),
                d.id,
              )
            ) {
              throw Error(
                "Не удалось сохранить доступ автора в этом браузере.",
              );
            }
            v.share = share;
          }
          const { closed } = await reviewRequest(share, {
            action: "publish",
            snapshot: {
              name: d.name,
              title: v.name,
              body: v.body,
              style: v.style,
            },
            anchors: reviewTargets(parse(v.body)).map((target) => target.key),
          });
          if (!share.published) {
            const published = { ...share, published: true };
            api.update(
              (latest) => ({
                ...latest,
                versions: latest.versions.map((item) =>
                  item.id === id && item.share?.id === share.id
                    ? { ...item, share: published }
                    : item,
                ),
              }),
              d.id,
            );
            v.share = published;
          }
          if (!sharing.isConnected) return;
          publish.textContent = "Копировать ссылку";
          comments.hidden = false;
          if (closed) {
            shareStatus.textContent = "Доступ по этой ссылке закрыт.";
            return;
          }
          const url = reviewUrl(share.id);
          link.value = url;
          link.hidden = false;
          try {
            await navigator.clipboard.writeText(url);
            shareStatus.textContent = "Ссылка скопирована.";
          } catch {
            link.select();
            shareStatus.textContent = "Ссылка готова. Скопируйте её из поля.";
          }
        } catch (error) {
          shareStatus.textContent = error.message;
        } finally {
          publish.disabled = false;
        }
      },
      "option",
    );
    const link = element("input");
    link.readOnly = true;
    link.hidden = true;
    link.setAttribute("aria-label", "Ссылка на версию");
    const comments = button(
      "Открыть замечания",
      () => api.openReview(v.share, () => versions(id, compare)),
      "option",
    );
    comments.hidden = !v.share;
    sharing.append(publish, link, comments, shareStatus);
    if (!compare) return;
    const a = reviewItems(parse(v.body)),
      b = reviewItems(parse(d.body));
    if (JSON.stringify(v.style) !== JSON.stringify(d.style || {})) {
      a.set("style", {
        label: "Оформление документа",
        value: JSON.stringify(v.style, null, 2),
      });
      b.set("style", {
        label: "Оформление документа",
        value: JSON.stringify(d.style || {}, null, 2),
      });
    }
    let count = 0;
    function diff(title, left, right) {
      const detail = element("details");
      detail.className = "version-change";
      detail.append(element("summary", title));
      for (const [label, value] of [
        ["В версии", left],
        ["Сейчас", right],
      ])
        if (value !== undefined)
          detail.append(element("small", label), element("pre", value));
      box.append(detail);
      count++;
    }
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const left = a.get(key),
        right = b.get(key);
      if (left?.value === right?.value) continue;
      diff(
        (!left ? "Добавлено" : !right ? "Удалено" : "Изменено") +
          " · " +
          (right || left).label,
        left?.value,
        right?.value,
      );
    }
    if (v.body !== d.body) diff("Полный Markdown", v.body, d.body);
    if (!count) empty(box, "Документ совпадает с версией.");
  }
  return { trace, links, versions };
}
