/**
 * Fixtures for the CLI providers' output shapes, shared by the dispatch,
 * pipeline and route tests that pretend to be an agent CLI.
 *
 * WHY ONE COPY. `claudeEnvelope` was defined in eight test files in three
 * dialects: five of them emitted `{ type, subtype, result }`, three also
 * carried an optional `total_cost_usd`, and the JSON happened to be formatted
 * differently in each. Nothing caught the drift — a session that reads the
 * envelope only cares about the fields it names, so a test that stopped
 * including `total_cost_usd` would keep passing while testing less. One
 * function, one JSON shape, and `costUsd` present only when it is passed
 * (absent and `undefined` are different to the code under test: an absent
 * `total_cost_usd` is what a provider that reports no usage sends).
 */

/**
 * The `claude --output-format json` result envelope, as one JSON string.
 *
 * `costUsd` is added only when given, because the CLI omits the key entirely
 * when it reports no usage — and `costIsPartial` downstream depends on seeing
 * the difference between a missing key and a zero.
 */
export function claudeEnvelope(
  text: string,
  options: { costUsd?: number } = {},
): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    result: text,
    ...(options.costUsd !== undefined ? { total_cost_usd: options.costUsd } : {}),
  });
}
