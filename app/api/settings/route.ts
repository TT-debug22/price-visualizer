import { NextResponse } from "next/server";
import { updateSettings } from "@/lib/store";
import { jsonError } from "@/lib/api-errors";

export async function PATCH(request: Request) {
  try {
    const state = await updateSettings(await request.json());
    return NextResponse.json(state);
  } catch (error) {
    return jsonError(error, "設定を更新できませんでした");
  }
}
