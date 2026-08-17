import { randomUUID } from "node:crypto";

import type {
  DailyEditorialPackage,
  EditorialRequest,
  EditorialSelectionResult,
  ResearchPack,
} from "../../types/editorial.ts";
import type {
  DiscoveryTraceEntry,
  EditorialProviderMode,
} from "./types.ts";

export type StoredSelection = {
  request: EditorialRequest;
  selection: EditorialSelectionResult;
  providerMode: EditorialProviderMode;
  providerId: string;
  discoveryTrace: DiscoveryTraceEntry[];
};

export type StoredResearch = {
  selectionId: string;
  pack: ResearchPack;
  providerMode: EditorialProviderMode;
};

export type StoredPackage = {
  researchId: string;
  package: DailyEditorialPackage;
  providerMode: EditorialProviderMode;
};

export class EditorialSessionStore {
  private readonly selections = new Map<string, StoredSelection>();
  private readonly research = new Map<string, StoredResearch>();
  private readonly packages = new Map<string, StoredPackage>();

  saveSelection(value: StoredSelection): string {
    const id = randomUUID();
    this.selections.set(id, structuredClone(value));
    return id;
  }

  getSelection(id: string): StoredSelection | undefined {
    const value = this.selections.get(id);
    return value ? structuredClone(value) : undefined;
  }

  saveResearch(value: StoredResearch): string {
    const id = randomUUID();
    this.research.set(id, structuredClone(value));
    return id;
  }

  getResearch(id: string): StoredResearch | undefined {
    const value = this.research.get(id);
    return value ? structuredClone(value) : undefined;
  }

  savePackage(value: StoredPackage): string {
    const id = randomUUID();
    this.packages.set(id, structuredClone(value));
    return id;
  }

  getPackage(id: string): StoredPackage | undefined {
    const value = this.packages.get(id);
    return value ? structuredClone(value) : undefined;
  }

  updatePackage(id: string, value: StoredPackage): void {
    if (!this.packages.has(id)) return;
    this.packages.set(id, structuredClone(value));
  }
}
