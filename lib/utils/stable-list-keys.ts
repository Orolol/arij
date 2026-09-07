/**
 * Stable React keys for list items that carry no id of their own.
 *
 * `keyOf` derives a key from the item's content; items with identical content
 * get an ordinal so the keys stay unique without reaching for the array
 * index. A content key follows its item through a re-sort or an insertion —
 * the index does not, and React then hands one row's DOM (and any state it
 * holds) to whichever item now sits at that position. The session detail's
 * chronological action list is the live case: it re-sorts as chunk-parsed
 * tool calls arrive between two polls.
 *
 * The result pairs each key with its item rather than returning a parallel
 * array of keys: a consumer that maps over the pairs writes `key={key}` and
 * never touches the index, whereas `key={keys[idx]}` reads as index-keyed
 * again — to a reviewer, and to __tests__/react-index-keys-census.test.ts.
 *
 * Callers with a real id should key on it directly; this is for rows whose
 * source rows have none (merged activity, parsed payloads).
 */
export interface KeyedItem<T> {
  readonly key: string;
  readonly item: T;
}

/**
 * The ASCII unit separator: no rendered text contains it, so a base key that
 * happens to end in "#1" cannot collide with another item's suffixed key.
 */
const UNIT_SEPARATOR = String.fromCharCode(0x1f);

export function withStableKeys<T>(
  items: readonly T[],
  keyOf: (item: T) => string
): KeyedItem<T>[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = keyOf(item);
    const ordinal = seen.get(base) ?? 0;
    seen.set(base, ordinal + 1);
    // Always suffixed, so duplicates and near-duplicates stay distinct.
    return { key: `${base}${UNIT_SEPARATOR}${ordinal}`, item };
  });
}
