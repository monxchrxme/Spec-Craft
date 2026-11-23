import { privateRequest } from "./private-sync.js";

const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};

export async function privateSyncPanel(panel, { active, status, connect, sync, leave, message }) {
  const feedback = element("p", message || "Проверка входа…");
  feedback.setAttribute("role", "status");
  panel.append(feedback);
  let busy = false;
  function control(label, action, primary) {
    const button = element("button", label, primary ? "primary" : "option");
    button.type = "button";
    button.onclick = () => perform(action);
    return button;
  }
  async function perform(action) {
    if (busy) return;
    busy = true;
    const buttons = [...panel.querySelectorAll("button")];
    for (const button of buttons) button.disabled = true;
    try {
      await action();
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      busy = false;
      for (const button of buttons) button.disabled = false;
    }
  }
  function renderKey(key) {
    const wrap = element("div");
    const label = element("label", "Приватный ключ");
    const field = element("input");
    field.readOnly = true;
    field.value = key;
    field.spellcheck = false;
    label.append(field);
    wrap.append(label, control("Скопировать ключ", async () => {
      try {
        await navigator.clipboard.writeText(key);
        feedback.textContent = "Ключ скопирован.";
      } catch {
        field.select();
        feedback.textContent = "Ключ выделен. Скопируйте его вручную.";
      }
    }));
    wrap.append(element("p", "Ключ даёт полный доступ к пространству. Храните его у себя."));
    return wrap;
  }
  function show(account, google, key) {
    if (!panel.isConnected) return;
    const intro = element("p", account && active === account.id
      ? "Документы и папки этого пространства доступны на подключённых устройствах."
      : "Храните личные документы и папки на подключённых устройствах.");
    panel.replaceChildren(intro, feedback);
    if (account && active === account.id) {
      feedback.dataset.privateStatus = "";
      feedback.textContent = status();
      panel.append(
        control("Синхронизировать сейчас", sync),
        control("Выйти из личного пространства", () => leave(account.id)),
      );
      if (account.method === "key")
        panel.append(control("Показать приватный ключ", async () => {
          const { key } = await privateRequest("show-key", {}, account.id);
          show(account, google, key);
        }));
    } else if (account) {
      feedback.textContent = account.method === "google" ? "Вход через Google выполнен." : "Приватный ключ принят.";
      const label = element("label", undefined, "style-check");
      const include = element("input");
      include.type = "checkbox";
      include.checked = Boolean(key);
      label.append(include, "Добавить локальные документы и папки с этого устройства");
      panel.append(label,
        control("Открыть личное пространство", () => connect(account.id, include.checked), true),
        control("Выйти", () => leave(account.id)));
      if (account.method === "key" && !key)
        panel.append(control("Показать приватный ключ", async () => {
          const { key } = await privateRequest("show-key", {}, account.id);
          show(account, google, key);
        }));
    } else {
      feedback.textContent = message || (active ? "Войдите снова, чтобы возобновить синхронизацию." : "");
      const form = element("form", undefined, "template-form");
      const field = element("input");
      field.type = "password";
      field.required = true;
      field.autocomplete = "off";
      field.spellcheck = false;
      const label = element("label", "Приватный ключ");
      label.append(field);
      form.append(label, element("button", "Войти по ключу", "primary"));
      form.onsubmit = (event) => {
        event.preventDefault();
        void perform(async () => {
          const { account } = await privateRequest("key-login", { key: field.value.trim() });
          show(account, google);
          if (account.id === active) void sync();
        });
      };
      panel.append(form, control("Создать приватный ключ", async () => {
        const { key, account } = await privateRequest("key-create", {});
        show(account, google, key);
      }));
      if (google) {
        panel.append(control("Войти через Google", () => {
          location.assign("/api/private-workspace?action=google");
        }));
      } else panel.append(element("p", "Вход через Google пока не настроен на сайте."));
      if (active) panel.append(control("Перейти к локальным документам", () => leave()));
      else panel.append(control("Продолжить без входа", () => panel.closest("dialog").close()));
    }
    if (key) panel.insertBefore(renderKey(key), feedback);
  }
  try {
    const { account, google } = await privateRequest("session");
    show(account, google);
  } catch (error) {
    feedback.textContent = error.message;
    if (active) panel.append(control("Перейти к локальным документам", () => leave()));
  }
}
