import type { ApiResponse } from '@pkws/shared';

const BASE_URL = '/api';

export async function apiGet<T>(path: string): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE_URL}${path}`);
  return res.json();
}

export async function apiPost<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export async function apiPut<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function apiDelete<T>(path: string): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE' });
  return res.json();
}
