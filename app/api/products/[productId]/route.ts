import { NextResponse } from "next/server";
import { updateProduct } from "@/lib/store";
import { jsonError } from "@/lib/api-errors";

export async function PATCH(request: Request, context: { params: Promise<{ productId: string }> }) {
  try {
    const { productId } = await context.params;
    const state = await updateProduct(productId, await request.json());
    return NextResponse.json(state);
  } catch (error) {
    return jsonError(error, "商品設定を更新できませんでした");
  }
}
