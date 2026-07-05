import { NextResponse } from "next/server";
import { AuthRequiredError } from "./supabase/server";

export function jsonError(error: unknown, fallback: string, status = 400) {
  if (error instanceof AuthRequiredError) {
    return NextResponse.json({ error: error.message, authRequired: true }, { status: 401 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status });
}
