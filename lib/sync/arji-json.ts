import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

const ARJI_JSON = "arji.json";

// --- Types ---

export interface ArjiJsonComment {
  id: string;
  author: string;
  content: string;
  createdAt: string | null;
}

export interface ArjiJsonUserStory {
  id: string;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  status: string;
  position: number;
  comments?: ArjiJsonComment[];
}

export interface ArjiJsonEpic {
  id: string;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  position: number;
  branchName: string | null;
  type?: string;
  user_stories: ArjiJsonUserStory[];
  comments?: ArjiJsonComment[];
}

export interface ArjiJsonProject {
  name: string;
  description: string | null;
  status: string;
  spec: string | null;
}

export interface ArjiJson {
  version: number;
  lastSyncedAt: string;
  project: ArjiJsonProject;
  epics: ArjiJsonEpic[];
}

// --- File I/O ---

export async function readArjiJson(repoPath: string): Promise<ArjiJson | null> {
  const filePath = join(repoPath, ARJI_JSON);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  const data = JSON.parse(raw) as ArjiJson;
  if (!data.project || !Array.isArray(data.epics)) {
    throw new Error(`Invalid ${ARJI_JSON}: missing "project" or "epics" keys`);
  }
  return data;
}

export async function writeArjiJson(repoPath: string, data: ArjiJson): Promise<void> {
  const filePath = join(repoPath, ARJI_JSON);
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export async function arjiJsonExists(repoPath: string): Promise<boolean> {
  try {
    await access(join(repoPath, ARJI_JSON));
    return true;
  } catch {
    return false;
  }
}
