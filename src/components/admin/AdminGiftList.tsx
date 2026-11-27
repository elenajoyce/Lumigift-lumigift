'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

export interface AdminGift {
  id: string;
  name: string;
  description?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
}

interface AdminGiftsResponse {
  gifts: AdminGift[];
  nextCursor?: string | null;
  prevCursor?: string | null;
  total?: number | null;
}

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

async function fetchAdminGifts(params: {
  cursor: string | null;
  page: number;
  pageSize: number;
}): Promise<AdminGiftsResponse> {
  const search = new URLSearchParams();
  search.set('limit', String(params.pageSize));
  if (params.cursor) {
    search.set('cursor', params.cursor);
  }
  if (params.page > 1) {
    search.set('page', String(params.page));
  }

  const res = await fetch(`/api/v1/admin/gifts?${search.toString()}`, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });

  if (!res.ok) {
    throw new Error(`Failed to load gifts (${res.status})`);
  }

  const data = (await res.json()) as Partial<AdminGiftsResponse> & {
    data?: AdminGift[];
    items?: AdminGift[];
  };

  const gifts = data.gifts ?? data.data ?? data.items ?? [];

  return {
    gifts,
    nextCursor: data.nextCursor ?? null,
    prevCursor: data.prevCursor ?? null,
    total: data.total ?? null,
  };
}

function formatAmount(amount: number | string | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const numeric = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(numeric)) return String(amount);
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? 'currency' : 'decimal',
      currency: currency || undefined,
    }).format(numeric);
  } catch {
    return String(amount);
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function GiftRowSkeleton() {
  return (
    <tr className="animate-pulse">
      <td className="px-4 py-3">
        <div className="h-4 w-3/4 rounded bg-gray-200" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-1/2 rounded bg-gray-200" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-1/3 rounded bg-gray-200" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-1/2 rounded bg-gray-200" />
      </td>
    </tr>
  );
}

export default function AdminGiftList() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const cursor = searchParams.get('cursor');
  const page = parsePositiveInt(searchParams.get('page'), 1);
  const pageSize = parsePositiveInt(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE);

  const queryKey = useMemo(
    () => ['admin-gifts', { cursor, page, pageSize }],
    [cursor, page, pageSize],
  );

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchAdminGifts({ cursor, page, pageSize }),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      const queryString = next.toString();
      router.push(queryString ? `?${queryString}` : '?', { scroll: false });
    },
    [router, searchParams],
  );

  const handleLoadMore = useCallback(() => {
    if (!data?.nextCursor) return;
    updateParams({
      cursor: data.nextCursor,
      page: String(page + 1),
    });
  }, [data?.nextCursor, page, updateParams]);

  const handlePrev = useCallback(() => {
    if (page <= 1) return;
    const prevCursor = data?.prevCursor ?? null;
    updateParams({
      cursor: prevCursor,
      page: String(Math.max(1, page - 1)),
    });
  }, [data?.prevCursor, page, updateParams]);

  const handlePageSizeChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextSize = event.target.value;
      updateParams({
        pageSize: nextSize === String(DEFAULT_PAGE_SIZE) ? null : nextSize,
        cursor: null,
        page: null,
      });
    },
    [updateParams],
  );

  const gifts = data?.gifts ?? [];
  const hasNext = Boolean(data?.nextCursor);
  const hasPrev = page > 1;
  const showInitialLoading = isLoading && gifts.length === 0;
  const showRefreshing = isFetching && !isLoading;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-600">
          Page {page}
          {data?.total != null ? ` · ${data.total} total` : null}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <span>Page size</span>
          <select
            aria-label="Page size"
            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
            value={pageSize}
            onChange={handlePageSizeChange}
            disabled={isFetching}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <span>
            {error instanceof Error ? error.message : 'Failed to load gifts.'}
          </span>
          <button
            type="button"
            className="rounded border border-red-300 px-3 py-1 font-medium hover:bg-red-100"
            onClick={() => refetch()}
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="relative overflow-x-auto rounded border border-gray-200">
        {showRefreshing ? (
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-10 flex items-center justify-center bg-white/60"
          >
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
            <span className="sr-only">Loading gifts…</span>
          </div>
        ) : null}

        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-700">
                Name
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-700">
                Amount
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-700">
                Currency
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-700">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {showInitialLoading ? (
              Array.from({ length: Math.min(pageSize, 5) }).map((_, index) => (
                <GiftRowSkeleton key={`skeleton-${index}`} />
              ))
            ) : gifts.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  No gifts found.
                </td>
              </tr>
            ) : (
              gifts.map((gift) => (
                <tr key={gift.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{gift.name}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatAmount(gift.amount, gift.currency)}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{gift.currency ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{formatDate(gift.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handlePrev}
          disabled={!hasPrev || isFetching}
        >
          Previous
        </button>

        <div className="flex items-center gap-2">
          {hasNext ? (
            <button
              type="button"
              className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleLoadMore}
              disabled={isFetching}
            >
              {isFetching ? 'Loading…' : 'Load more'}
            </button>
          ) : (
            <span className="text-sm text-gray-500">End of list</span>
          )}
        </div>
      </div>
    </div>
  );
}
</｜｜DSML｜｜ parameter>