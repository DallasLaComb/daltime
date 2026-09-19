import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { components, paths } from '../generated/api';

/**
 * Typed HTTP client driven entirely by `contracts/openapi.json`.
 *
 * Every path, method, request body, and response type below is derived from the
 * generated `paths` type — nothing here is hand-maintained. Calling an
 * unregistered path, using a method a route does not define, or sending a body
 * whose shape disagrees with the contract are all compile errors.
 *
 * This wraps Angular's `HttpClient` rather than `fetch` on purpose: requests
 * must keep flowing through `auth.interceptor.ts` and `impersonation.interceptor.ts`.
 * A fetch-based generated client (openapi-fetch and friends) bypasses Angular's
 * interceptor chain entirely, which would silently strip auth and impersonation
 * headers from every call.
 */

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * The operation object for a path+method, or `never` when the route does not
 * define that method.
 *
 * openapi-typescript emits absent methods as `post?: never`. An optional
 * property does not satisfy a required one, so the `extends` check below fails
 * for those and correctly yields `never`.
 */
type OperationOf<P extends keyof paths, M extends Method> = paths[P] extends { [K in M]: infer O }
  ? O
  : never;

/** Paths in the contract that actually define the given method. */
type PathsFor<M extends Method> = {
  [P in keyof paths]: [OperationOf<P, M>] extends [never] ? never : P;
}[keyof paths];

/** The 200/201 `application/json` response body for an operation. */
type ResponseOf<O> = O extends { responses: infer R }
  ? R extends { 200: { content: { 'application/json': infer T } } }
    ? T
    : R extends { 201: { content: { 'application/json': infer T } } }
      ? T
      : void
  : void;

/**
 * The `application/json` request body for an operation.
 *
 * Operations that declare no body resolve to `undefined`, not `never`: a POST
 * can legitimately carry nothing (see `POST /employee/swap-shifts/{swapId}/claim`,
 * where the swapId in the path is the whole request), and `never` would make
 * such a route impossible to call at all.
 */
type BodyOf<O> = O extends { requestBody: { content: { 'application/json': infer T } } }
  ? T
  : undefined;

/**
 * The body argument for an operation.
 *
 * `BodyOf` resolves a bodyless operation to `undefined`, and two call styles
 * for such routes are both in use and both correct: `patch(path, {})` sends the
 * empty object those routes have always put on the wire, while
 * `post(path, undefined)` sends nothing at all. Accepting either keeps both
 * call sites honest without forcing one slice to rewrite the other's. A real
 * payload on a bodyless route is still a compile error, and operations that DO
 * declare a body stay exactly as strict as `BodyOf` makes them.
 */
type RequestBodyOf<O> = [BodyOf<O>] extends [undefined]
  ? Record<string, never> | undefined
  : BodyOf<O>;

/**
 * Path parameters for an operation, or `never` when it takes none.
 *
 * Matched through an optional key because openapi-typescript emits absent
 * parameter groups as `path?: never` and all-optional groups as `path?: {…}`.
 * Requiring `path:` here would silently resolve both to `never`.
 */
type PathParamsOf<O> = O extends { parameters: { path?: infer T } } ? NonNullable<T> : never;

/**
 * Query parameters for an operation, or `never` when it takes none.
 *
 * Optional-key matching matters more here than for paths: an operation whose
 * query parameters are all optional (`GET /employee/shifts`) is emitted as
 * `query?: {…}`, so the stricter form would have made its month/date/week
 * parameters unreachable.
 */
type QueryParamsOf<O> = O extends { parameters: { query?: infer T } } ? NonNullable<T> : never;

/**
 * Per-operation request options.
 *
 * `params` and `query` resolve to `never` for operations that take none, so
 * passing them where the contract defines none is a compile error.
 */
interface RequestOptions<O> {
  params?: PathParamsOf<O>;
  query?: QueryParamsOf<O>;
}

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.api.baseUrl;

  get<P extends PathsFor<'get'>>(
    path: P,
    options?: RequestOptions<OperationOf<P, 'get'>>,
  ): Observable<ResponseOf<OperationOf<P, 'get'>>> {
    return this.http.get<ResponseOf<OperationOf<P, 'get'>>>(this.url(path, options), {
      params: this.query(options),
    });
  }

  post<P extends PathsFor<'post'>>(
    path: P,
    body: RequestBodyOf<OperationOf<P, 'post'>>,
    options?: RequestOptions<OperationOf<P, 'post'>>,
  ): Observable<ResponseOf<OperationOf<P, 'post'>>> {
    return this.http.post<ResponseOf<OperationOf<P, 'post'>>>(this.url(path, options), body, {
      params: this.query(options),
    });
  }

  put<P extends PathsFor<'put'>>(
    path: P,
    body: RequestBodyOf<OperationOf<P, 'put'>>,
    options?: RequestOptions<OperationOf<P, 'put'>>,
  ): Observable<ResponseOf<OperationOf<P, 'put'>>> {
    return this.http.put<ResponseOf<OperationOf<P, 'put'>>>(this.url(path, options), body, {
      params: this.query(options),
    });
  }

  patch<P extends PathsFor<'patch'>>(
    path: P,
    body: RequestBodyOf<OperationOf<P, 'patch'>>,
    options?: RequestOptions<OperationOf<P, 'patch'>>,
  ): Observable<ResponseOf<OperationOf<P, 'patch'>>> {
    return this.http.patch<ResponseOf<OperationOf<P, 'patch'>>>(this.url(path, options), body, {
      params: this.query(options),
    });
  }

  delete<P extends PathsFor<'delete'>>(
    path: P,
    options?: RequestOptions<OperationOf<P, 'delete'>>,
  ): Observable<ResponseOf<OperationOf<P, 'delete'>>> {
    return this.http.delete<ResponseOf<OperationOf<P, 'delete'>>>(this.url(path, options), {
      params: this.query(options),
    });
  }

  /** Interpolate `{param}` placeholders in a contract path with actual values. */
  private url(path: string, options?: { params?: unknown }): string {
    const params = options?.params as Record<string, string | number> | undefined;
    const resolved = params
      ? path.replace(/\{(\w+)\}/g, (_match, key: string) => {
          const value = params[key];
          if (value === undefined) throw new Error(`Missing path parameter '${key}' for ${path}`);
          return encodeURIComponent(String(value));
        })
      : path;
    return `${this.baseUrl}${resolved}`;
  }

  /** Build HttpParams from an operation's query object, dropping undefined entries. */
  private query(options?: { query?: unknown }): HttpParams {
    let httpParams = new HttpParams();
    const query = options?.query as Record<string, string | number | boolean> | undefined;
    if (!query) return httpParams;
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) httpParams = httpParams.set(key, String(value));
    }
    return httpParams;
  }
}

/**
 * Names a contract schema without deep indexing into the generated file.
 *
 * `ApiSchema<'ManagerProfileResponse'>` reads like the old hand-written model
 * import it replaces, but resolves to the generated type.
 */
export type ApiSchema<K extends keyof components['schemas']> = components['schemas'][K];
