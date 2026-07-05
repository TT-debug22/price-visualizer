import { NextResponse } from "next/server";
import { updateHistoryExclusion } from "@/lib/store";
import { jsonError } from "@/lib/api-errors";

export async function PATCH(request: Request, context: { params: Promise<{ productId: string; historyId: string }> }) {
  try {
    const { productId, historyId } = await context.params;
    const state = await updateHistoryExclusion(productId, historyId, await request.json());
    return NextResponse.json(state);
  } catch (error) {
    return jsonError(error, "履歴を更新できませんでした");
  }
}
