import {
  collaborationRequest,
  collaborationUrl,
  roleLabels,
} from "./collaboration.js";

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
  const form = element("form", undefined, "template-form");
  const picker = element("select");
  picker.setAttribute("aria-label", "Роль по ссылке");
  for (const role of ["reader", "commenter", "editor"])
    picker.add(new Option(roleLabels[role], role));
  const label = element("label", "Роль по ссылке");
  label.append(picker);
  const issue = element("button", "Создать ссылку", "primary");
  form.append(label, issue);
  const currentLink = element("input");
  currentLink.readOnly = true;
  currentLink.setAttribute("aria-label", "Ссылка на общий документ");
  currentLink.hidden = true;
  const list = element("div");
  const status = element("p", undefined, "review-status");
  status.setAttribute("role", "status");
  let pending,
    busy = false;
  const openButton = button(
    "Открыть общий документ",
    () =>
      perform(async () => {
        await ensure();
        open(share);
      }),
    "option",
  );
  panel.append(
    element(
      "p",
      "Ссылка открывает общий документ. Читатель видит документ, комментатор участвует в обсуждении, редактор может менять текст, таблицы и схемы.",
    ),
    openButton,
    form,
    currentLink,
    list,
    status,
  );

  async function ensure() {
    if (!share?.published) share = await publish();
    return share;
  }

  async function showLink(key) {
    currentLink.value = collaborationUrl(share.id, key);
    currentLink.hidden = false;
    try {
      await navigator.clipboard.writeText(currentLink.value);
      status.textContent = "Ссылка скопирована.";
    } catch {
      currentLink.focus();
      currentLink.select();
      status.textContent = "Скопируйте ссылку из поля.";
    }
  }

  function links(data) {
    list.replaceChildren(element("h3", "Активные ссылки"));
    if (!data.invitations.length)
      list.append(element("p", "Активных ссылок пока нет.", "review-status"));
    for (const invitation of data.invitations) {
      const row = element("div", undefined, "share-invitation");
      row.append(
        element("strong", roleLabels[invitation.role]),
        element("small", new Date(invitation.date).toLocaleString("ru")),
        button("Копировать", () => showLink(invitation.key)),
        button("Отозвать", () => {
          if (!confirm("Отозвать эту ссылку? Коллеги по ней потеряют доступ."))
            return;
          void perform(async () => {
            const result = await collaborationRequest(share, {
              action: "revoke",
              invitation: invitation.id,
            });
            links(result);
            if (
              currentLink.value === collaborationUrl(share.id, invitation.key)
            ) {
              currentLink.value = "";
              currentLink.hidden = true;
            }
            status.textContent = "Ссылка отозвана.";
          });
        }),
      );
      list.append(row);
    }
  }

  async function perform(operation) {
    if (busy) return;
    busy = issue.disabled = openButton.disabled = true;
    status.textContent = "";
    try {
      await operation();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = issue.disabled = openButton.disabled = false;
    }
  }

  form.onsubmit = (event) => {
    event.preventDefault();
    void perform(async () => {
      const role = picker.value;
      if (pending?.role !== role)
        pending = { role, requestId: crypto.randomUUID() };
      const data = await collaborationRequest(await ensure(), {
        action: "invite",
        ...pending,
      });
      const created = data.invitations.find(
        (item) => item.id === pending.requestId,
      );
      pending = null;
      links(data);
      if (created) await showLink(created.key);
    });
  };
  if (share?.published)
    void perform(async () => links(await collaborationRequest(share)));
}
