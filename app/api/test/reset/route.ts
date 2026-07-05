import { NextResponse } from "next/server";
import { resetState } from "@/lib/store";
import { jsonError } from "@/lib/api-errors";

export async function POST() {
  try {
    const state = await resetState();
    return NextResponse.json(state);
  } catch (error) {
    return jsonError(error, "テストデータを初期化できませんでした", 403);
  }
}
