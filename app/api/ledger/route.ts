import { NextResponse } from "next/server";
import { createLedgerEntry } from "@/lib/store";
import { jsonError } from "@/lib/api-errors";

export async function POST(request: Request) {
  try {
    const state = await createLedgerEntry(await request.json());
    return NextResponse.json(state, { status: 201 });
  } catch (error) {
    return jsonError(error, "家計簿を記録できませんでした");
  }
}
