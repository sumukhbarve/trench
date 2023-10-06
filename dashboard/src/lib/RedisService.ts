/**
 * Copyright 2018 Twitter, Inc.
 * Licensed under the Apache License, Version 2.0
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import Redis from "ioredis";
import { Context } from "sqrl";
import { invariant } from "sqrl-common";
import { RedisInterface, RateLimitOptions } from "./RedisInterface";

function addressToHostPort(
  address: string,
  defaultPort: number
): [string, number] {
  const split = address.split(":");
  if (split.length === 1) {
    return [split[0], defaultPort];
  } else if (split.length === 2) {
    const port = parseInt(split[1], 10);
    invariant(
      port > 0 && "" + port === split[1],
      "Invalid address: %s",
      address
    );
    return [split[0], port];
  } else {
    throw new Error("Invalid address: " + address);
  }
}

export class RedisService implements RedisInterface {
  // @TODO: IoRedis types are not great. We need to improve them but for now we
  // just use the any type.
  private conn: any;

  constructor(address?: string) {
    const [host, port] = addressToHostPort(address || "localhost", 6379);
    this.conn = new Redis({ host, port });
  }

  async ping(ctx: Context) {
    return this.conn.ping();
  }
  async increment(ctx: Context, key: Buffer, amount: number = null) {
    return this.conn.incrby(key, amount == null ? 1 : amount);
  }
  async get(ctx: Context, key: Buffer) {
    return this.conn.get(key);
  }
  async del(ctx: Context, ...keys: Buffer[]) {
    return this.conn.del(...keys);
  }
  async set(ctx: Context, key: Buffer, value: string, mode?: "NX" | "XX") {
    const args = mode ? [mode] : [];
    const rv = await this.conn.set(key, value, ...args);
    if (rv === "OK") {
      return true;
    } else if (rv === null) {
      return false;
    } else {
      throw new Error("Unknown response from Redis set: " + rv);
    }
  }
  async getList(ctx: Context, key: Buffer): Promise<string[]> {
    return this.conn.lrange(key, 0, -1);
  }
  async listPush(
    ctx: Context,
    key: Buffer,
    ...values: Array<string | Buffer | number>
  ): Promise<void> {
    await this.conn.lpush(key, ...values);
  }

  async pfcount(ctx: Context, keys: Buffer[]): Promise<number> {
    return this.conn.pfcount(...keys);
  }

  async pfadd(ctx: Context, key: Buffer, values: string[]): Promise<void> {
    await this.conn.pfaddBuffer(key, ...values);
  }

  async expire(ctx: Context, key: Buffer, seconds: number): Promise<void> {
    await this.conn.expire(key, seconds);
  }

  async mgetNumbers(ctx: Context, keys: Buffer[]): Promise<number[]> {
    const values = await this.conn.mget(...keys);
    return values.map((value) => {
      if (value === null) {
        return value;
      }
      const rv = parseInt(value, 10);
      invariant(!isNaN(rv), "Got invalid number in mgetNumbers");
      return rv;
    });
  }

  close() {
    this.conn.disconnect();
  }
}
