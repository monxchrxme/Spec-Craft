export function readProject(source) {
  const p = JSON.parse(source);
  if (
    p?.format !== "speccraft" ||
    p.version !== 1 ||
    typeof p.markdown !== "string" ||
    typeof p.name !== "string"
  )
    throw Error("Неподдерживаемый формат или версия проекта SpecCraft.");
  const assets = p.assets ?? {};
  for (const [key, uri] of Object.entries(assets)) {
    if (
      !/^speccraft-asset:_*\d+$/.test(key) ||
      typeof uri !== "string" ||
      !/^data:image\/[\w.+-]+;base64,[a-z\d+/=]+$/i.test(uri)
    )
      throw Error("Повреждён ресурс проекта.");
  }
  const content = p.markdown.replace(/speccraft-asset:_*\d+/g, (key) =>
    Object.hasOwn(assets, key) ? assets[key] : key,
  );
  let header = "";
  if (p.profile) {
    const { standard, fields, source } = p.profile;
    if (
      typeof standard !== "string" ||
      /[\r\n<>]/.test(standard) ||
      !fields ||
      typeof fields !== "object" ||
      Array.isArray(fields) ||
      Object.values(fields).some((value) => typeof value !== "string") ||
      (source !== undefined && typeof source !== "string")
    )
      throw Error("Повреждены данные проекта.");
    // Preserve the old project metadata as ordinary Markdown source.
    header =
      source ??
      "<!-- speccraft: " +
        standard +
        "\n" +
        JSON.stringify(fields, null, 2).replaceAll(">", "\\u003e") +
        "\n-->";
  }
  return {
    name: p.name,
    kind: typeof p.kind === "string" ? p.kind : "Markdown",
    style:
      p.style && typeof p.style === "object" && !Array.isArray(p.style)
        ? p.style
        : {},
    body: header + content,
  };
}
