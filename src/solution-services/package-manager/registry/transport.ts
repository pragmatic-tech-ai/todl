/**
 * The HTTP transport seam for {@link NpmRegistry} (design: todl-package-manager,
 * registry client). A one-method interface so tests drive an in-memory fake and
 * never touch the network; the default implementation is a thin shell over the
 * global `fetch` (Node 20+ / browser).
 */
import { ServiceKey } from "@pragmatic-tech-ai/todl-runtime";

/** A single HTTP request. `body` is a JSON string (publish) or absent (reads). */
export interface HttpRequest
{
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
}

/** An HTTP response with the body as raw bytes (tarballs are binary). */
export interface HttpResponse
{
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** The transport seam: everything the registry client needs from the network. */
export interface HttpTransport
{
  request(req: HttpRequest): Promise<HttpResponse>;
}

/** The container key an alternate transport registers under. Optional — the npm
 *  registry factory falls back to {@link FetchTransport} when none is registered;
 *  a test registers an in-memory fake here to exercise the wire protocol offline. */
export const HttpTransportKey = new ServiceKey<HttpTransport>("PackageHttpTransport");

/** The default transport: `fetch`, reading the whole body into a byte array. */
export class FetchTransport implements HttpTransport
{
  async request(req: HttpRequest): Promise<HttpResponse>
  {
    const init: RequestInit = { method: req.method, headers: req.headers };
    // `string` and `Uint8Array` are both valid fetch bodies at runtime; the cast
    // bridges the lib.dom `BodyInit` typing (its `Uint8Array<ArrayBuffer>` view
    // doesn't unify with our `Uint8Array<ArrayBufferLike>`).
    if (req.body !== undefined) init.body = req.body as BodyInit;
    const res = await fetch(req.url, init);
    const body = new Uint8Array(await res.arrayBuffer());
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { status: res.status, headers, body };
  }
}
