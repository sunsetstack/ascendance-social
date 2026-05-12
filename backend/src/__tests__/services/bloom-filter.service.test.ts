import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { BloomFilterService } from "@/services/redis/bloom-filter.service";
import { RedisService } from "@/services/redis.service";

describe("BloomFilterService", () => {
  let bloomFilterService: BloomFilterService;
  let getBitStub: sinon.SinonStub;
  let setBitStub: sinon.SinonStub;
  let expireStub: sinon.SinonStub;
  let execStub: sinon.SinonStub;
  let multiStub: sinon.SinonStub;

  beforeEach(() => {
    getBitStub = sinon.stub().returnsThis();
    setBitStub = sinon.stub().returnsThis();
    expireStub = sinon.stub().returnsThis();
    execStub = sinon.stub().resolves([]);
    multiStub = sinon.stub().returns({
      getBit: getBitStub,
      setBit: setBitStub,
      expire: expireStub,
      exec: execStub,
    });

    const mockRedisService = {
      clientInstance: {
        multi: multiStub,
      },
    } as unknown as RedisService;

    bloomFilterService = new BloomFilterService(mockRedisService);
  });

  afterEach(() => {
    sinon.restore();
  });

  it("returns true when all probed bits are set", async () => {
    execStub.resolves([1, 1, 1, 1, 1]);

    const result = await bloomFilterService.mightContain("bf:test", "item-1", {
      expectedItems: 1000,
      falsePositiveRate: 0.001,
    });

    expect(result).to.equal(true);
    expect(getBitStub.called).to.equal(true);
  });

  it("returns false when at least one probed bit is not set", async () => {
    execStub.resolves([1, 1, 0, 1]);

    const result = await bloomFilterService.mightContain("bf:test", "item-2", {
      expectedItems: 1000,
      falsePositiveRate: 0.001,
    });

    expect(result).to.equal(false);
  });

  it("sets bits and applies expiry when adding item", async () => {
    execStub.resolves([0, 0, 0, 1]);

    await bloomFilterService.add(
      "bf:test",
      "item-3",
      {
        expectedItems: 1000,
        falsePositiveRate: 0.001,
      },
      3600,
    );

    expect(setBitStub.called).to.equal(true);
    expect(expireStub.calledWith("bf:test", 3600)).to.equal(true);
  });

  it("throws on invalid filter options", async () => {
    await expect(
      bloomFilterService.mightContain("bf:test", "item-4", {
        expectedItems: 0,
        falsePositiveRate: 0.001,
      }),
    ).to.be.rejectedWith("Bloom filter expectedItems must be a positive number");
  });
});
