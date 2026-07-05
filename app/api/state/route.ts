import { NextResponse } from "next/server";
import { readState } from "@/lib/store";
import { jsonError } from "@/lib/api-errors";

export async function GET() {
  try {
    const state = await readState();
    return NextResponse.json(state);
  } catch (error) {
    return jsonError(error, "状態を読み込めませんでした");
  }
}
