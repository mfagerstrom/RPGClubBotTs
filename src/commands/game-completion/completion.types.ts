// Type definitions and constants for game completion functionality

import type { Message, ThreadChannel } from "discord.js";
import type { CompletionType } from "../profile.command.js";

export type CompletionAddContext = {
  userId: string;
  completionType: CompletionType;
  completedAt: Date | null;
  finalPlaytimeHours: number | null;
  selectedPlatformId?: number | null;
  note: string | null;
  source: "existing" | "igdb";
  query?: string;
  announce?: boolean;
};

export type CompletionPlatformContext = {
  userId: string;
  gameId: number;
  gameTitle: string;
  completionType: CompletionType;
  completedAt: Date | null;
  finalPlaytimeHours: number | null;
  note: string | null;
  announce?: boolean;
  removeFromNowPlaying: boolean;
  platforms: Array<{ id: number; name: string }>;
};

export type CompletionatorThreadContext = {
  userId: string;
  importId: number;
  threadId: string;
  messageId: string;
  thread: ThreadChannel | null;
  message: Message;
  parentMessage: Message | null;
};

export type CompletionatorDateChoice = "csv" | "today" | "unknown" | "date";

export type CompletionatorAddFormState = {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
  completionType: CompletionType;
  dateChoice: CompletionatorDateChoice;
  customDate: Date | null;
  platformId: number | null;
  otherPlatform: boolean;
};

export type CompletionatorModalKind =
  | "gamedb-query"
  | "igdb-query"
  | "gamedb-manual"
  | "igdb-manual";

export interface ICompletionatorImport {
  importId: number;
  userId: string;
  status: string;
  totalCount: number;
  sourceFilename: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICompletionatorItem {
  itemId: number;
  importId: number;
  rowIndex: number;
  gameTitle: string;
  platformName: string | null;
  regionName: string | null;
  sourceType: string | null;
  timeText: string | null;
  completedAt: Date | null;
  completionType: string | null;
  playtimeHours: number | null;
  gameDbGameId: number | null;
  completionId: number | null;
  status: string;
  errorText: string | null;
}

export interface IgdbSelectOption {
  id: number;
  label: string;
  description: string;
}

export const COMPLETION_PLATFORM_SELECT_PREFIX = "completion-platform-select";
export const COMPLETIONATOR_SKIP_SENTINEL = "skip";
export const COMPLETIONATOR_STATUS_OPTIONS = ["start", "resume", "status", "pause", "cancel"] as const;
export const COMPLETIONATOR_MATCH_THUMBNAIL_NAME = "completionator_match.png";

export type CompletionatorAction = (typeof COMPLETIONATOR_STATUS_OPTIONS)[number];

// Session storage maps
export const completionAddSessions = new Map<string, CompletionAddContext>();
export const completionPlatformSessions = new Map<string, CompletionPlatformContext>();
export const completionatorThreadContexts = new Map<string, CompletionatorThreadContext>();
export const completionatorAddFormStates = new Map<string, CompletionatorAddFormState>();
