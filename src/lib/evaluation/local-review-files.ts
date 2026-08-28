import fs from "node:fs/promises";

import { notFound } from "next/navigation";

/**
 * Local review pages may depend on large, intentionally untracked experiment
 * artifacts. Keep those tools usable in the research workspace while making a
 * clean production checkout return 404 instead of failing the entire build.
 */
export async function readLocalReviewFiles(paths: string[]) {
  try {
    return await Promise.all(paths.map((filePath) => fs.readFile(filePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") notFound();
    throw error;
  }
}
