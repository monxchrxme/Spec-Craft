import {
  collaborationRequest,
  collaborationUrl,
  roleLabels,
} from "./collaboration.js";

const permissions = {
  reader: "Может читать документ.",
  commenter: "Может читать и оставлять комментарии.",
  editor: "Может редактировать документ и оставлять комментарии.",
};

const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function button(text, handler, className) {
  const node = element("button", text, className);
  node.type = "button";
  node.onclick = handler;
  return node;
}

export function sharePanel({ panel, share, publish, open }) {
  const form = element("form", undefined, "share-form");
  const picker = element("select");
  picker.id = "share-role";
  for (const role of Object.keys(permissions))
    picker.add(new Option(roleLabels[role], role));
  const label = element("label", "Доступ по ссылке");
  label.htmlFor = picker.id;
  const description = element("p", permissions.reader);
  description.id = "share-permissions";
  picker.setAttribute("aria-describedby", description.id);
  const copy = element("button", "Копировать ссылку", "primary");
  form.append(label, picker, description, copy);
  const currentLink = element("input");
  currentLink.readOnly = true;
  currentLink.setAttribute("aria-label", "Ссылка на общий документ");
  currentLink.hidden = true;
  currentLink.onclick = () => currentLink.select();
  const status = element("p", undefined, "review-status");
  status.setAttribute("role", "status");
  const management = element("details", undefined, "share-management");
  const disclosure = element("summary", "Управление ссылками");
  const list = element("div");
  const create = button("Создать отдельную ссылку", () =>
    perform(() => copyInvitation(picker.value, true)),
  );
  management.append(disclosure, list, create);
  const openButton = open
    ? button("Открыть общий редактор", () =>
        perform(async () => open(await ensure())),
      )
    : null;
  const explanation = open
    ? element(
        "p",
        share?.published
          ? "Коллеги работают в общей копии."
          : "При первом открытии общего редактора или копировании ссылки будет создана общая копия.",
      )
    : null;
  if (openButton) panel.append(explanation);
  panel.append(form, currentLink, status);
  if (openButton) panel.append(openButton);
  panel.append(management);
  let pending,
    busy = false;

  async function ensure() {
    if (!share?.published) share = await publish();
    if (explanation)
      explanation.textContent = "Коллеги работают в общей копии.";
    return share;
  }

  async function showLink(key) {
    currentLink.value = collaborationUrl(share.id, key);
    currentLink.hidden = false;
    try {
      await navigator.clipboard.writeText(currentLink.value);
      status.textContent = "Ссылка скопирована.";
    } catch {
      if (panel.isConnected && panel.closest("dialog")?.open) {
        currentLink.focus();
        currentLink.select();
      }
      status.textContent = "Скопируйте ссылку из поля.";
    }
  }

  function links(invitations) {
    disclosure.textContent =
      "Управление ссылками" +
      (invitations.length ? " · " + invitations.length : "");
    list.replaceChildren();
    if (!invitations.length)
      list.append(element("p", "Активных ссылок пока нет.", "review-status"));
    for (const invitation of [...invitations].reverse()) {
      const row = element("div", undefined, "share-invitation");
      row.append(
        element("strong", roleLabels[invitation.role]),
        element("small", new Date(invitation.date).toLocaleString("ru")),
        button("Копировать", () => perform(() => showLink(invitation.key))),
        button("Отозвать", () => {
          if (
            busy ||
            !confirm("Отозвать эту ссылку? Коллеги по ней потеряют доступ.")
          )
            return;
          void perform(async () => {
            const result = await collaborationRequest(share, {
              action: "revoke",
              invitation: invitation.id,
            });
            links(result.invitations);
            if (
              currentLink.value === collaborationUrl(share.id, invitation.key)
            )
              hideLink();
            status.textContent = "Ссылка отозвана.";
          });
        }),
      );
      list.append(row);
    }
  }

  function hideLink() {
    currentLink.value = "";
    currentLink.hidden = true;
  }

  async function copyInvitation(role, separate = false) {
    await ensure();
    const data = await collaborationRequest(share);
    let invitation =
      !separate && data.invitations.findLast((item) => item.role === role);
    if (!invitation) {
      if (pending?.role !== role || pending.separate !== separate)
        pending = { role, separate, requestId: crypto.randomUUID() };
      const result = await collaborationRequest(share, {
        action: "invite",
        role,
        requestId: pending.requestId,
      });
      invitation = result.invitations.find(
        (item) => item.id === pending.requestId,
      );
      links(result.invitations);
    } else links(data.invitations);
    pending = null;
    if (invitation) await showLink(invitation.key);
  }

  async function perform(operation) {
    if (busy) return;
    busy = true;
    const controls = [copy, picker, create, openButton].filter(Boolean);
    controls.forEach((control) => (control.disabled = true));
    status.textContent = "";
    try {
      await operation();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      controls.forEach((control) => (control.disabled = false));
    }
  }

  picker.onchange = () => {
    description.textContent = permissions[picker.value];
    hideLink();
    status.textContent = "";
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    void perform(() => copyInvitation(picker.value));
  };
  if (share?.published)
    void perform(async () =>
      links((await collaborationRequest(share)).invitations),
    );
  else links([]);
}
