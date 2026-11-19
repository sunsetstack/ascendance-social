import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { PostCountersRepository } from "@/repositories/read/PostCountersRepository";

describe("PostCountersRepository query sharing", () => {
  function fixture() {
    const exec = sinon.stub();
    const find = sinon.stub().returns({
      select: () => ({ lean: () => ({ exec }) }),
    });
    return {
      repository: new PostCountersRepository({ find } as never),
      exec,
      find,
    };
  }

  it("shares overlapping reads, deduplicates IDs, and preserves each caller's order", async () => {
    const { repository, exec, find } = fixture();
    let complete!: (posts: unknown[]) => void;
    exec.onFirstCall().returns(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    exec
      .onSecondCall()
      .resolves([{ publicId: "b", likesCount: 2, likesRevision: 3 }]);

    const first = repository.getPostMetadata(["a", "missing", "a"]);
    const second = repository.getPostMetadata(["b", "a"]);
    expect(find.getCalls().map((call) => call.args[0])).to.deep.equal([
      { publicId: { $in: ["a", "missing"] } },
      { publicId: { $in: ["b"] } },
    ]);
    complete([{ publicId: "a", likesCount: 1, likesRevision: 2 }]);
    const [left, right] = await Promise.all([first, second]);
    expect(left[0]).to.include({ likes: 1, likesRevision: 2 });
    expect(left[1]).to.equal(null);
    expect(left[2]).to.deep.equal(left[0]);
    expect(right[0]).to.include({ likes: 2, likesRevision: 3 });
    expect(right[1]).to.deep.equal(left[0]);
  });

  it("does not retain settled results across later requests", async () => {
    const { repository, exec, find } = fixture();
    exec
      .onFirstCall()
      .resolves([{ publicId: "a", likesCount: 1, likesRevision: 1 }]);
    exec
      .onSecondCall()
      .resolves([{ publicId: "a", likesCount: 0, likesRevision: 2 }]);
    expect((await repository.getPostMetadata(["a"]))[0]?.likes).to.equal(1);
    expect((await repository.getPostMetadata(["a"]))[0]).to.include({
      likes: 0,
      likesRevision: 2,
    });
    expect(find.callCount).to.equal(2);
  });

  it("propagates a shared failure and permits a later retry", async () => {
    const { repository, exec, find } = fixture();
    exec.onFirstCall().rejects(new Error("Mongo unavailable"));
    const results = await Promise.allSettled([
      repository.getPostMetadata(["a", "b"]),
      repository.getPostMetadata(["b", "a"]),
    ]);
    expect(find.callCount).to.equal(1);
    for (const result of results) {
      expect(result.status).to.equal("rejected");
      if (result.status === "rejected")
        expect(result.reason.message).to.equal("Mongo unavailable");
    }
    exec.resolves([]);
    expect(await repository.getPostMetadata(["a"])).to.deep.equal([null]);
    expect(find.callCount).to.equal(2);
  });

  it("does not query for an empty page", async () => {
    const { repository, find } = fixture();
    expect(await repository.getPostMetadata([])).to.deep.equal([]);
    expect(find.called).to.equal(false);
  });
});
