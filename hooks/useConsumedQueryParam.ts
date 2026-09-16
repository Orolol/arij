"use client";
import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { consumeQueryParam } from "@/lib/navigation/deep-link";
/** Run each URL command once; URL cleanup must not reopen a dismissed dialog. */
export function useConsumedQueryParam(name: string, fallback: string, onValue: (value: string) => void) {
  const params = useSearchParams();
  const handled = useRef<string | null>(null);
  const callback = useRef(onValue);
  useEffect(() => { callback.current = onValue; }, [onValue]);
  useEffect(() => {
    const value = params.get(name);
    if (!value) { handled.current = null; return; }
    if (handled.current === value) return;
    handled.current = value;
    callback.current(value);
    consumeQueryParam(params, name, fallback);
  }, [params, name, fallback]);
}
