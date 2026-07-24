export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const projectPath = new URL(`../../${specifier.slice(2)}`, import.meta.url);
    try {
      return await nextResolve(projectPath.href, context);
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
      return nextResolve(`${projectPath.href}.ts`, context);
    }
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isMissingRelative =
      error?.code === "ERR_MODULE_NOT_FOUND" && /^\.{1,2}\//.test(specifier);
    if (!isMissingRelative) {
      throw error;
    }
    if (/\.js$/i.test(specifier)) {
      return nextResolve(specifier.replace(/\.js$/i, ".ts"), context);
    }
    if (!/\.[a-z0-9]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
