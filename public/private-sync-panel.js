import { privateRequest } from "./private-sync.js";
import { isWorkspaceSource, rememberWorkspaceSource } from "./private-workspace-storage.js";

const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};

export async function privateSyncPanel(panel, { active, status, details, connect, addLocal, sync, leave, message }) {
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
      feedback.textContent = error.name === "QuotaExceededError"
        ? "Браузеру не хватило места для копирования. Исходные файлы сохранены."
        : error.message;
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
  function show(account, google, key, includeByDefault = false) {
    if (!panel.isConnected) return;
    if (account?.source) rememberWorkspaceSource(account.id);
    const source = account && isWorkspaceSource(account.id);
    delete feedback.dataset.privateStatus;
    const intro = element("p", account && active === account.id
      ? "Здесь открыты документы личного пространства. Локальный список этого браузера доступен после выхода."
      : "Храните личные документы и папки на подключённых устройствах.");
    panel.replaceChildren(intro, feedback);
    if (account && active === account.id) {
      feedback.dataset.privateStatus = "";
      feedback.textContent = status();
      const count = element("p", details());
      count.id = "private-sync-details";
      panel.append(
        element("p", "Код пространства " + account.id.slice(0, 8).toUpperCase()),
        count,
        control("Синхронизировать сейчас", sync),
      );
      if (source) panel.append(control("Добавить локальные документы и папки", addLocal));
      panel.append(control("Выйти из личного пространства", () => leave(account.id)));
      if (account.method === "key")
        panel.append(control("Показать приватный ключ", async () => {
          const { key } = await privateRequest("show-key", {}, account.id);
          show(account, google, key);
        }));
    } else if (account) {
      feedback.textContent = "Вход выполнен. Откройте личное пространство, чтобы начать синхронизацию.";
      const label = element("label", undefined, "style-check");
      const include = element("input");
      include.type = "checkbox";
      include.checked = includeByDefault;
      if (source) {
        label.append(include, "Добавить локальные документы и папки с этого устройства");
        panel.append(label);
      }
      panel.append(
        control("Открыть личное пространство", () => connect(account.id, source && include.checked), true),
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
          if (account.id !== active) await connect(account.id, false);
          else {
            show(account, google);
            await sync();
          }
        });
      };
      panel.append(form, control("Создать приватный ключ", async () => {
        const { key, account } = await privateRequest("key-create", {});
        rememberWorkspaceSource(account.id);
        show(account, google, key, true);
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
