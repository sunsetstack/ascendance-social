import crypto from "crypto";
import { inject, injectable } from "tsyringe";
import { RedisService } from "@/services/redis.service";
import { Errors } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

export interface BloomFilterOptions {
  expectedItems: number;
  falsePositiveRate: number;
}

interface BloomFilterShape {
  bitSize: number;
  hashCount: number;
}

@injectable()
export class BloomFilterService {
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
  ) {}

  async mightContain(
    key: string,
    item: string,
    options: BloomFilterOptions,
  ): Promise<boolean> {
    const shape = this.computeShape(options);
    const indexes = this.computeIndexes(item, shape);

    const pipeline = this.redisService.clientInstance.multi();
    for (const index of indexes) {
      pipeline.getBit(key, index);
    }

    const result = await pipeline.exec();
    if (!result) {
      throw Errors.database("Bloom filter read pipeline returned empty result",
      );
    }

    return result.every((bit) => bit === 1);
  }

  async add(
    key: string,
    item: string,
    options: BloomFilterOptions,
    ttlSeconds?: number,
  ): Promise<void> {
    const shape = this.computeShape(options);
    const indexes = this.computeIndexes(item, shape);

    const pipeline = this.redisService.clientInstance.multi();
    for (const index of indexes) {
      pipeline.setBit(key, index, 1);
    }

    if (ttlSeconds !== undefined) {
      if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
        throw Errors.validation(
          "Bloom filter TTL must be a positive number",
        );
      }
      pipeline.expire(key, Math.floor(ttlSeconds));
    }

    const result = await pipeline.exec();
    if (!result) {
      throw Errors.database("Bloom filter write pipeline returned empty result",
      );
    }
  }

  private computeShape(options: BloomFilterOptions): BloomFilterShape {
    if (!Number.isFinite(options.expectedItems) || options.expectedItems <= 0) {
      throw Errors.validation(
        "Bloom filter expectedItems must be a positive number",
      );
    }
    if (
      !Number.isFinite(options.falsePositiveRate) ||
      options.falsePositiveRate <= 0 ||
      options.falsePositiveRate >= 1
    ) {
      throw Errors.validation(
        "Bloom filter falsePositiveRate must be between 0 and 1",
      );
    }

    const ln2 = Math.log(2);
    const bitSize = Math.max(
      8,
      Math.ceil(
        (-options.expectedItems * Math.log(options.falsePositiveRate)) /
          (ln2 * ln2),
      ),
    );
    const hashCount = Math.max(
      1,
      Math.round((bitSize / options.expectedItems) * ln2),
    );

    return { bitSize, hashCount };
  }

  private computeIndexes(item: string, shape: BloomFilterShape): number[] {
    const hashA = crypto.createHash("sha256").update(item, "utf8").digest();
    const hashB = crypto.createHash("sha1").update(item, "utf8").digest();
    const a = hashA.readBigUInt64BE(0);
    let b = hashB.readBigUInt64BE(0);
    if (b === BigInt(0)) {
      b = BigInt(1);
    }

    const indexes: number[] = [];
    const mod = BigInt(shape.bitSize);
    for (let i = 0; i < shape.hashCount; i++) {
      const idx = Number((a + BigInt(i) * b) % mod);
      indexes.push(idx);
    }
    return indexes;
  }
}
