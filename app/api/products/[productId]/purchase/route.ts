import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { purchaseProduct } from "@/lib/store";

export async function POST(request: Request, context: { params: Promise<{ productId: string }> }) {
  try {
    const { productId } = await context.params;
    const result = await purchaseProduct(productId, await request.json());
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error, "購入記録を作成できませんでした");
  }
}
