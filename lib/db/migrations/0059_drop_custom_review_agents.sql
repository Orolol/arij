-- Removes the custom review agents (0043, `custom_review_agents`).
--
-- The table had a full CRUD (three routes, a hook, a whole band of the Prompts
-- tab) but no dispatcher ever read `system_prompt`: the review routes accept
-- only the four built-in ReviewType values, and `buildReviewPrompt` accepted a
-- `CustomReviewAgentPrompt` shape no caller ever built. A user could create a
-- reviewer and nothing would ever run it. The product decision (2026-09-11) is
-- the complete removal, so the table goes with the code.
DROP TABLE IF EXISTS custom_review_agents;
