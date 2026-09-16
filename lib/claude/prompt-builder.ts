/**
 * Public prompt API. Domain modules compose text; this boundary resolves stored
 * project memory for the same builders that historically injected it.
 * Explicit memory (including null/empty) always wins over the database.
 */
import { withStoredProjectMemory } from "./prompts/project-memory";
import * as conversation from "./prompts/conversation";
import * as specification from "./prompts/specification";
import * as qa from "./prompts/qa";
import * as implementation from "./prompts/implementation";
import * as review from "./prompts/review";
import * as refinement from "./prompts/refinement";

export type * from "./prompts/types";
export {
  commentHistorySection,
  REVIEW_CHECKLISTS,
  REVIEW_BOUNDARY_SECTION,
} from "./prompt-sections";

export const buildChatPrompt = withStoredProjectMemory(conversation.buildChatPrompt);

export const buildEpicRefinementPrompt = withStoredProjectMemory(conversation.buildEpicRefinementPrompt);

export const buildEpicFinalizationPrompt = withStoredProjectMemory(conversation.buildEpicFinalizationPrompt);

export {
  buildImportPrompt,
  buildTitleGenerationPrompt,
} from "./prompts/conversation";

export const buildSpecGenerationPrompt = withStoredProjectMemory(specification.buildSpecGenerationPrompt);

export const buildSpecUpdatePrompt = withStoredProjectMemory(specification.buildSpecUpdatePrompt);

export {
  buildProjectStateSection,
  buildSpecAutoRewritePrompt,
} from "./prompts/specification";

export const buildTechCheckPrompt = withStoredProjectMemory(qa.buildTechCheckPrompt);

export const buildE2eTestPrompt = withStoredProjectMemory(qa.buildE2eTestPrompt);

export const buildFailureDigestPrompt = withStoredProjectMemory(qa.buildFailureDigestPrompt);

export const buildTeamBuildPrompt = withStoredProjectMemory(implementation.buildTeamBuildPrompt);

export const buildBuildPrompt = withStoredProjectMemory(implementation.buildBuildPrompt);

export const buildCiFixPrompt = withStoredProjectMemory(implementation.buildCiFixPrompt);

export const buildTicketBuildPrompt = withStoredProjectMemory(implementation.buildTicketBuildPrompt);

export const buildMergeResolutionPrompt = withStoredProjectMemory(implementation.buildMergeResolutionPrompt);

export const buildReviewPrompt = withStoredProjectMemory(review.buildReviewPrompt);

export const buildGradingPrompt = withStoredProjectMemory(review.buildGradingPrompt);

export const buildEpicReviewPrompt = withStoredProjectMemory(review.buildEpicReviewPrompt);

export const buildSecondOpinionPrompt = withStoredProjectMemory(review.buildSecondOpinionPrompt);

export {
  buildMemoryDistillPrompt,
  buildDreamingPrompt,
} from "./prompts/memory";

export const buildRefinementPrompt = withStoredProjectMemory(refinement.buildRefinementPrompt);

export {
  buildDeterministicVerificationFixSection,
  buildDeterministicVerificationReviewSection,
} from "./prompts/verification";
