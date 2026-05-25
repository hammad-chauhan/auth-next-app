import { NextResponse } from 'next/server';

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  return 'Internal server error';
}

export function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({ error: getErrorMessage(error) }, { status });
}
