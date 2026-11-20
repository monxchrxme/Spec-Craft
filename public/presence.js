import { collaborationRequest, roleLabels } from "./collaboration.js";

const clientId = (() => {
  const key = "speccraft:participant-session";
  const id = crypto.randomUUID();
  try {
    const stored = sessionStorage.getItem(key);
    if (/^[a-f0-9-]{36}$/i.test(stored || "")) return stored;
    sessionStorage.setItem(key, id);
  } catch {
    // Storage may be disabled in a private window.
  }
  return id;
})();
export function participantName() {
  try {
    return localStorage.getItem("speccraft:participant") || "";
  } catch {
    return "";
  }
}
export function presenceSession({ share, location, update }) {
  let closed = false,
    busy = false,
    queued = false,
    list = [];
  async function pulse() {
    if (closed || document.hidden) return;
    if (busy) {
      queued = true;
      return;
    }
    busy = true;
    try {
      const { participants } = await collaborationRequest(share, {
        action: "presence",
        client: clientId,
        name: participantName(),
        location: location().slice(0, 160),
      });
      if (closed) return;
      list = participants;
      update?.(list);
    } catch (error) {
      if (error.status === 404 || error.status === 403) stop();
      list = [];
      update?.(list);
    } finally {
      busy = false;
      if (queued) {
        queued = false;
        void pulse();
      }
    }
  }
  function stop() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", pulse);
  }
  const timer = setInterval(pulse, 15_000);
  document.addEventListener("visibilitychange", pulse);
  void pulse();
  return { pulse, stop, names: () => list };
}

export function presencePanel(container, session, role) {
  container.replaceChildren();
  if (role !== "owner") {
    const label = document.createElement("label");
    label.textContent = "Имя в документе";
    const input = document.createElement("input");
    input.maxLength = 80;
    input.value = participantName();
    input.onchange = () => {
      try {
        localStorage.setItem("speccraft:participant", input.value.trim());
      } catch {
        /* Presence remains available with the role label. */
      }
      void session.pulse();
    };
    label.append(input);
    container.append(label);
  }
  const list = document.createElement("ul");
  list.className = "workflow-people";
  container.append(list);
  function update(people) {
    list.replaceChildren();
    if (!people.length) {
      const empty = document.createElement("li");
      empty.textContent = "Нет данных о присутствии.";
      list.append(empty);
    }
    for (const person of people) {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      const location = document.createElement("small");
      name.textContent = person.name + (person.self ? " · вы" : "");
      location.textContent = [roleLabels[person.role], person.location]
        .filter(Boolean)
        .join(" · ");
      item.append(name, location);
      list.append(item);
    }
  }
  update(session.names());
  return update;
}
