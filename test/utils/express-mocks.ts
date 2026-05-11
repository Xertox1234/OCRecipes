import type { Request, Response } from "express";
import { vi } from "vitest";

type RequestOverrides = Omit<Partial<Request>, "socket"> & {
  socket?: { remoteAddress?: string | null };
};

export function mockRequest(overrides: RequestOverrides = {}): Request {
  const socket = {
    remoteAddress: "",
    ...(overrides.socket ?? {}),
  } as Request["socket"];

  return {
    ip: "",
    socket,
    ...overrides,
  } as Request;
}

export function mockResponse() {
  const response = {} as Response;
  const status = vi.fn().mockImplementation(() => response);
  const json = vi.fn().mockImplementation(() => response);

  Object.assign(response, { status, json });

  return response as Response & {
    status: typeof status;
    json: typeof json;
  };
}
