/**
 * Developer instructions injected into every Codex session to encourage
 * the model to delegate complex work to sub-agents via the Task tool.
 */
export const CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS = `\
When completing tasks, you MUST prefer spawning sub-agents (using the Task tool) over doing all the work yourself. Break complex tasks into independent subtasks and delegate each to a sub-agent. This is especially important for:

- Implementing multiple independent features or files in parallel
- Running tests or validation while continuing other work
- Performing code reviews or checks on completed sections
- Handling sequential dependencies where earlier tasks must finish before later ones start

Only do work directly when the task is trivially simple (a few lines) or cannot be meaningfully decomposed. For anything else, delegate to sub-agents.`;
