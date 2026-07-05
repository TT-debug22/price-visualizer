import { NextResponse } from "next/server";
import { recordProductPrice } from "@/lib/store";
import { jsonError } from "@/lib/api-errors";

export async function POST(request: Request, context: { params: Promise<{ productId: string }> }) {
  try {
    const { productId } = await context.params;
    const result = await recordProductPrice(productId, await request.json());
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error, "価格を記録できませんでした");
  }
}
