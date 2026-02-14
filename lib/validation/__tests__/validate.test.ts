import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { validateBody, isValidationError } from "../validate";

const testSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().optional(),
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeInvalidJsonRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not json{{{",
  });
}

describe("validateBody", () => {
  it("returns parsed data for valid body", async () => {
    const request = makeRequest({ name: "Alice", age: 30 });
    const result = await validateBody(testSchema, request);

    expect(isValidationError(result)).toBe(false);
    if (!isValidationError(result)) {
      expect(result.data).toEqual({ name: "Alice", age: 30 });
    }
  });

  it("strips unknown fields", async () => {
    const request = makeRequest({ name: "Bob", extra: "ignored" });
    const result = await validateBody(testSchema, request);

    expect(isValidationError(result)).toBe(false);
    if (!isValidationError(result)) {
      expect(result.data).toEqual({ name: "Bob" });
      expect((result.data as any).extra).toBeUndefined();
    }
  });

  it("returns 400 for missing required fields", async () => {
    const request = makeRequest({});
    const result = await validateBody(testSchema, request);

    expect(isValidationError(result)).toBe(true);
    if (isValidationError(result)) {
      expect(result.status).toBe(400);
      const body = await result.json();
      expect(body.error).toBe("Validation failed");
      expect(body.details).toBeDefined();
    }
  });

  it("returns 400 for invalid JSON", async () => {
    const request = makeInvalidJsonRequest();
    const result = await validateBody(testSchema, request);

    expect(isValidationError(result)).toBe(true);
    if (isValidationError(result)) {
      expect(result.status).toBe(400);
      const body = await result.json();
      expect(body.error).toBe("Invalid JSON body");
    }
  });

  it("returns 400 for wrong field types", async () => {
    const request = makeRequest({ name: "Alice", age: "not a number" });
    const result = await validateBody(testSchema, request);

    expect(isValidationError(result)).toBe(true);
    if (isValidationError(result)) {
      expect(result.status).toBe(400);
    }
  });
});

describe("isValidationError", () => {
  it("returns true for NextResponse", async () => {
    const request = makeRequest({});
    const result = await validateBody(testSchema, request);
    expect(isValidationError(result)).toBe(true);
  });

  it("returns false for data object", async () => {
    const request = makeRequest({ name: "Test" });
    const result = await validateBody(testSchema, request);
    expect(isValidationError(result)).toBe(false);
  });
});
