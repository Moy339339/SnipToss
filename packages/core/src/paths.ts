// Path helpers that work for both kinds of absolute path: Windows (E:\…, \\server\share\…) and POSIX (/Users/…). The kind is read from
// the path itself, so no platform flag has to be passed around: a shell hands over paths in its own system's form

/**
 * The separator of a path's own system: a backslash for Windows paths (a drive letter or any backslash in it), a slash for the rest.
 * An empty path counts as Windows, the default of the first shell
 */
export function pathSep(path: string): "\\" | "/" {
  return path === "" || path.includes("\\") || /^[A-Za-z]:/.test(path) ? "\\" : "/";
}

/**
 * Notes folder + relative path (forward slashes) → absolute path; . = the notes folder itself. The separator follows the notes folder:
 * Windows ones (E:\…, \\server\…) use backslashes, other systems' (/Users/…) use forward slashes, so paths also work for a macOS version
 */
export function joinPath(root: string, rel: string): string {
  const base = root.replace(/[\\/]+$/, "");
  const sep = pathSep(root);
  return rel === "." || rel === "" ? base : `${base}${sep}${rel.replaceAll("/", sep)}`;
}
