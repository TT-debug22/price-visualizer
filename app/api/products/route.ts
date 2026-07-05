import { NextResponse } from "next/server";
import { createProduct } from "@/lib/store";
import { jsonError } from "@/lib/api-errors";

export async function POST(request: Request) {
  try {
    const state = await createProduct(await request.json());
    return NextResponse.json(state, { status: 201 });
  } catch (error) {
    return jsonError(error, "商品を作成できませんでした");
  }
}
