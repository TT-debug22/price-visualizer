export class ApiResponseError extends Error {
  status: number;
  authRequired: boolean;

  constructor(message: string, status: number, authRequired = false) {
    super(message);
    this.status = status;
    this.authRequired = authRequired;
  }
}

export async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiResponseError(body.error ?? "処理に失敗しました", response.status, Boolean(body.authRequired));
  }
  return body as T;
}
