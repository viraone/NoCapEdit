import type { VideoProject } from "@/lib/models/project";
import { sameProject } from "@/lib/utils/same";

/** An export only counts for the project it was made from, and only until that project is edited; what is posted is public. */
export function exportFits(done: { project: VideoProject } | null, project: VideoProject | null): boolean {
  if (!done || !project) return false;
  if (done.project.id !== project.id) return false;
  return sameProject({ ...done.project, updatedAt: 0 }, { ...project, updatedAt: 0 });
}
