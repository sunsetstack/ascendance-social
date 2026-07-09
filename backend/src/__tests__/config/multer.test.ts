import { expect } from "chai";
import sinon from "sinon";
import { validateImageUpload } from "@/config/multer";

describe("validateImageUpload", () => {
  it("accepts image uploads whose bytes match the declared MIME type", () => {
    const file = {
      buffer: Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]),
      mimetype: "image/png",
    };
    const req = { file } as any;
    const next = sinon.stub();

    validateImageUpload(req, {} as any, next);

    expect(next.calledOnceWithExactly()).to.be.true;
    expect(file.mimetype).to.equal("image/png");
  });

  it("rejects uploads whose bytes do not match an allowed image type", () => {
    const req = {
      file: {
        buffer: Buffer.from("not an image"),
        mimetype: "image/png",
      },
    } as any;
    const next = sinon.stub();

    validateImageUpload(req, {} as any, next);

    expect(next.calledOnce).to.be.true;
    expect(next.firstCall.args[0]).to.include({ statusCode: 400 });
  });
});
