import { expect } from "chai";
import sinon from "sinon";
import { correlationIdMiddleware } from "@/middleware/correlationId.middleware";
import { getCorrelationId } from "@/runtime/request-context";

describe("correlationIdMiddleware", () => {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it("reuses an incoming x-request-id header", (done) => {
    const req = {
      get: sinon.stub().callsFake((header: string) => {
        if (header === "x-request-id") {
          return "request-abc";
        }

        return undefined;
      }),
    } as any;
    const res = {
      setHeader: sinon.stub(),
    } as any;

    correlationIdMiddleware(req, res, () => {
      expect(req.correlationId).to.equal("request-abc");
      expect(res.setHeader.calledOnceWithExactly("X-Request-ID", "request-abc"))
        .to.be.true;
      expect(getCorrelationId()).to.equal("request-abc");
      done();
    });
  });

  it("creates a new correlation id when the request has none", (done) => {
    const req = {
      get: sinon.stub().returns(undefined),
    } as any;
    const res = {
      setHeader: sinon.stub(),
    } as any;

    correlationIdMiddleware(req, res, () => {
      expect(req.correlationId).to.be.a("string");
      expect(req.correlationId).to.match(uuidPattern);
      expect(
        res.setHeader.calledOnceWithExactly("X-Request-ID", req.correlationId),
      ).to.be.true;
      expect(getCorrelationId()).to.equal(req.correlationId);
      done();
    });
  });
});
