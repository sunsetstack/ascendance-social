import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { RedisSessionModule } from "@/services/redis/redis-session.module";

describe("RedisSessionModule", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("saves a session and only extends the user-session index TTL", async () => {
    const pipeline = {
      setEx: sinon.stub().returnsThis(),
      sAdd: sinon.stub().returnsThis(),
      expire: sinon.stub().returnsThis(),
      exec: sinon.stub().resolves([]),
    };
    const client = {
      multi: sinon.stub().returns(pipeline),
    };

    const module = new RedisSessionModule(client as any);

    await module.saveSession(
      {
        sid: "session-1",
        publicId: "user-1",
        status: "active",
      },
      3600,
    );

    expect(pipeline.setEx.calledOnce).to.equal(true);
    expect(pipeline.sAdd.calledOnceWith("user:sessions:user-1", "session-1")).to.equal(true);
    expect(pipeline.expire.firstCall.args).to.deep.equal([
      "user:sessions:user-1",
      3600,
      "NX",
    ]);
    expect(pipeline.expire.secondCall.args).to.deep.equal([
      "user:sessions:user-1",
      3600,
      "GT",
    ]);
  });

  it("loads session payloads together with their remaining TTLs", async () => {
    const pipeline = {
      get: sinon.stub().returnsThis(),
      ttl: sinon.stub().returnsThis(),
      exec: sinon.stub().resolves([
        JSON.stringify({ sid: "session-1", publicId: "user-1" }),
        3600,
        null,
        -2,
      ]),
    };
    const client = {
      multi: sinon.stub().returns(pipeline),
    };

    const module = new RedisSessionModule(client as any);

    const result = await module.getSessionsWithTtl<{
      sid: string;
      publicId: string;
    }>(["session-1", "session-2"]);

    expect(result).to.deep.equal([
      {
        sid: "session-1",
        session: { sid: "session-1", publicId: "user-1" },
        ttlSeconds: 3600,
      },
      {
        sid: "session-2",
        session: null,
        ttlSeconds: -2,
      },
    ]);
  });
});
