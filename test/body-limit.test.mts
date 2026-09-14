/**
 * Per-route request body limits.
 *
 * The door that receives a 4,800-item catalogue must be wide (12 MB); the door that receives one
 * order needs 1 MB. One shared limit either blocks the catalogue or opens every other door to a
 * 10 MB body from a flooder.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ACCESS, DEFAULT_BODY_LIMIT, Kernel, ManualClock, MemoryLogger, createRequestListener, type AnyManifest } from "../dist/index.js";

function testModule() {
  const received: number[] = [];
  const read = async (_ctx: unknown, request: { json(): Promise<unknown> }) => { received.push(String((await request.json() as { chu: string }).chu).length); return { status: 200, body: { ok: true } }; };
  const manifest: AnyManifest = {
    id: "thu", name: "Thử", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
    routes: [
      { method: "POST", path: "/api/nho", access: ACCESS.public, whyPublic: "Test: narrow door, default limit.", rateLimit: { calls: 100, windowMs: 60000 }, handle: read },
      { method: "POST", path: "/api/to", access: ACCESS.public, whyPublic: "Test: wide door, own limit.", rateLimit: { calls: 100, windowMs: 60000 }, bodyLimit: 4 * 1024 * 1024, handle: read }
    ]
  };
  return { received, manifest };
}

/** A minimal stand-in for Node's IncomingMessage: a readable body plus the fields the adapter reads. */
function fakeRequest(url: string, body: Buffer, headers: Record<string, string>): IncomingMessage {
  const stream = Readable.from([body]);
  return Object.assign(stream, { method: "POST", url, headers, socket: { remoteAddress: "1.2.3.4" } }) as unknown as IncomingMessage;
}

/** Goes through the HTTP layer for real: the limit lives there. */
async function post(kernel: Kernel, path: string, bytes: number) {
  const body = JSON.stringify({ chu: "x".repeat(bytes) });
  const request = fakeRequest(path, Buffer.from(body, "utf8"), { host: "localhost", "content-type": "application/json" });
  const written = { status: 0, body: "" };
  const response = { writeHead(status: number) { written.status = status; }, end(chunk?: unknown) { if (chunk) written.body = String(chunk); } } as unknown as ServerResponse;
  await createRequestListener(kernel)(request, response);
  return written;
}

function build(manifest: AnyManifest) {
  return new Kernel({ ports: { logger: new MemoryLogger(), clock: new ManualClock() }, logger: new MemoryLogger(), modules: [manifest] });
}

test("the default limit is 1 MB", () => { assert.equal(DEFAULT_BODY_LIMIT, 1024 * 1024); });

test("narrow door: a 2 MB body is refused with 413 and the module is never called", async () => {
  const m = testModule();
  const r = await post(build(m.manifest), "/api/nho", 2 * 1024 * 1024);
  assert.equal(r.status, 413);
  assert.equal(m.received.length, 0, "the body must not be read into memory before refusing");
});

test("wide door: the same 2 MB body passes", async () => {
  const m = testModule();
  const r = await post(build(m.manifest), "/api/to", 2 * 1024 * 1024);
  assert.equal(r.status, 200, r.body);
  assert.equal(m.received[0], 2 * 1024 * 1024);
});

test("wide door still has its own limit: 5 MB into a 4 MB door is 413", async () => {
  const m = testModule();
  assert.equal((await post(build(m.manifest), "/api/to", 5 * 1024 * 1024)).status, 413);
  assert.equal(m.received.length, 0);
});

test("a non-JSON body is the caller's fault: 400, not 500", async () => {
  const m = testModule();
  const kernel = build(m.manifest);
  const request = fakeRequest("/api/nho", Buffer.from("khong json", "utf8"), { host: "localhost" });
  const written = { status: 0 };
  await createRequestListener(kernel)(request, { writeHead(s: number) { written.status = s; }, end() { /* */ } } as unknown as ServerResponse);
  assert.equal(written.status, 400);
});
